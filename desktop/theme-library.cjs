const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { appError } = require('../core/errors.cjs');
const {
  LIBRARY_SCHEMA,
  UUID_RE,
  assertSupportedVersion,
  assertThemeName,
  validateThemeDocument,
  documentFromLegacy,
  plainObject
} = require('../core/theme-schema.cjs');
const { encodePng } = require('../core/image-decode.cjs');
const { documentHash } = require('../core/theme-diff.cjs');
const { normalizeTags, matchesThemeFilters, getTagCounts } = require('../core/theme-tags.cjs');
const ranges = require('../shared/appearance-ranges.json');

class ThemeLibrary {
  constructor(file, deps = {}) {
    this.file = file;
    this.assets = deps.assets || null;
    this.now = deps.now || (() => new Date().toISOString());
    this.queue = Promise.resolve();
    this.data = { schemaVersion: LIBRARY_SCHEMA, themes: [] };
    this.frozen = false;
    this.diagnostics = [];
  }

  _exclusive(fn) {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run;
    return run;
  }

  async load() {
    return this._exclusive(async () => {
      let raw = null;
      try {
        raw = await fs.readFile(this.file, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return this.snapshot();
        throw error;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.frozen = true;
        this.diagnostics.push('主题库无法解析，已保留原文件并进入只读状态');
        return { ...this.snapshot(), errorCode: 'CORRUPTED_LIBRARY', warning: '主题库无法解析' };
      }
      try {
        assertSupportedVersion(parsed, LIBRARY_SCHEMA, '主题库');
      } catch (error) {
        this.frozen = true;
        this.diagnostics.push(error.message);
        return { ...this.snapshot(), errorCode: 'UNSUPPORTED_SCHEMA', warning: error.message };
      }
      const rawThemes = Array.isArray(parsed.themes) ? parsed.themes.filter(plainObject) : [];
      const validatedThemes = [];
      for (const t of rawThemes) {
        try {
          if (!t.id || !t.name || !t.document) continue;
          const doc = validateThemeDocument({ ...t.document, id: t.id, name: t.name });
          const entry = {
            id: t.id,
            name: t.name,
            favorite: !!t.favorite,
            tags: normalizeTags(t.tags || []),
            createdAt: t.createdAt || this.now(),
            updatedAt: t.updatedAt || this.now(),
            document: doc,
            thumbnailAssetId: t.thumbnailAssetId || null
          };
          if (typeof t.sourceItemId === 'string' && t.sourceItemId) {
            entry.sourceItemId = t.sourceItemId.slice(0, 80);
            entry.sourceVersion = Number.isInteger(t.sourceVersion) ? t.sourceVersion : 1;
            entry.sourceHash = typeof t.sourceHash === 'string' ? t.sourceHash : '';
            entry.dirty = t.dirty === true;
          }
          validatedThemes.push(entry);
        } catch {
          this.diagnostics.push(`忽略格式无效的主题项: ${t?.id || 'unknown'}`);
        }
      }
      this.data = {
        schemaVersion: LIBRARY_SCHEMA,
        themes: validatedThemes,
        builtinMetadata: plainObject(parsed.builtinMetadata) ? parsed.builtinMetadata : {}
      };
      this._repairDangling();
      return this.snapshot();
    });
  }

  snapshot() {
    return {
      schemaVersion: this.data.schemaVersion,
      themes: this.data.themes.map(theme => ({ ...theme, tags: [...(theme.tags || [])] })),
      builtinMetadata: { ...(this.data.builtinMetadata || {}) },
      diagnostics: [...this.diagnostics],
      frozen: this.frozen
    };
  }

  get(id) {
    const entry = this.data.themes.find(theme => theme.id === id);
    if (entry) {
      return { ...entry, tags: [...(entry.tags || [])], document: { ...entry.document } };
    }
    const builtinThemes = require('../shared/themes.json');
    const builtin = builtinThemes.find(theme => theme.id === id);
    if (builtin) {
      const meta = this.data.builtinMetadata?.[id] || {};
      return {
        id: builtin.id,
        name: builtin.name,
        favorite: false,
        tags: meta.tags || [],
        document: { ...builtin },
        isBuiltin: true
      };
    }
    return null;
  }

  _repairDangling() {
    const ids = new Set(this.data.themes.map(theme => theme.id));
    for (const theme of this.data.themes) {
      if (theme.document?.baseThemeId && !theme.document.baseThemeId) continue;
    }
    return ids;
  }

  repairRules(rules) {
    const ids = new Set(this.data.themes.map(theme => theme.id));
    const builtin = new Set(require('../shared/themes.json').map(theme => theme.id));
    let changed = false;
    const next = (rules || []).map(rule => {
      if (builtin.has(rule.themeId) || ids.has(rule.themeId)) return rule;
      changed = true;
      this.diagnostics.push(`规则 ${rule.id} 引用的主题已不存在，已禁用`);
      return { ...rule, enabled: false };
    });
    return { rules: next, changed };
  }

  async _persist(candidateThemes = this.data.themes) {
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '主题库版本过新或已损坏，已停止写入');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    const body = JSON.stringify({
      schemaVersion: LIBRARY_SCHEMA,
      themes: candidateThemes,
      builtinMetadata: this.data.builtinMetadata || {}
    });
    try {
      await fs.writeFile(temp, body, 'utf8');
      await fs.rename(temp, this.file);
    } catch (err) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw err;
    }
  }

  query({
    search = '',
    query = '',
    tags = [],
    tagMode = 'AND',
    colorScheme = null,
    hasWallpaper = null,
    favoritesOnly = false,
    untaggedOnly = false,
    page = 1,
    pageSize = 60
  } = {}) {
    const filterOptions = {
      search: search || query,
      tags,
      tagMode,
      colorScheme,
      hasWallpaper,
      favoritesOnly,
      untaggedOnly
    };
    const filtered = this.data.themes.filter(theme => matchesThemeFilters(theme, filterOptions));
    const size = Math.max(1, pageSize);
    const safePage = Math.max(1, page);
    const start = (safePage - 1) * size;
    return {
      total: filtered.length,
      page: safePage,
      pageSize: size,
      totalPages: Math.ceil(filtered.length / size) || 1,
      items: filtered.slice(start, start + size).map(t => ({ ...t, tags: [...(t.tags || [])] })),
      tagCounts: getTagCounts(this.data.themes),
      filteredTagCounts: getTagCounts(filtered)
    };
  }

  _swatch(document) {
    const accent = document.colors.accent || '#d2e3bb';
    const background = document.colors.background || '#151817';
    const color = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const left = color(/^#[0-9a-f]{6}$/.test(background) ? background : '#151817');
    const right = color(/^#[0-9a-f]{6}$/.test(accent) ? accent : '#d2e3bb');
    const width = 64;
    const height = 36;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const mix = x / width;
        const index = (y * width + x) * 4;
        data[index] = Math.round(left[0] * (1 - mix) + right[0] * mix);
        data[index + 1] = Math.round(left[1] * (1 - mix) + right[1] * mix);
        data[index + 2] = Math.round(left[2] * (1 - mix) + right[2] * mix);
        data[index + 3] = 255;
      }
    }
    return encodePng(width, height, data);
  }

  async _rememberWallpaper(document, ref) {
    if (!this.assets || !document.wallpaper?.assetId) return;
    await this.assets.addRef(document.wallpaper.assetId, ref);
  }

  async saveNew(document, name, tags = []) {
    return this._exclusive(async () => {
      const validated = validateThemeDocument({ ...document, id: randomUUID(), name: name || document.name });
      const now = this.now();
      const normalizedTags = normalizeTags(tags);
      const entry = {
        id: validated.id,
        name: validated.name,
        favorite: false,
        tags: normalizedTags,
        createdAt: now,
        updatedAt: now,
        document: { ...validated, id: validated.id },
        thumbnailAssetId: null
      };
      let stagedThumb = null;
      if (this.assets) {
        const png = this._swatch(validated);
        const record = await this.assets.putDecoded(png, { format: 'png', mime: 'image/png', width: 64, height: 36, data: png });
        entry.thumbnailAssetId = record.id;
        stagedThumb = record.id;
      }
      const candidateThemes = [entry, ...this.data.themes];
      try {
        await this._persist(candidateThemes);
      } catch (err) {
        if (this.assets && stagedThumb) {
          await this.assets.release(stagedThumb, `thumb:${entry.id}`).catch(() => {});
        }
        throw err;
      }
      if (this.assets && stagedThumb) {
        await this.assets.addRef(stagedThumb, `thumb:${entry.id}`).catch(() => {});
      }
      await this._rememberWallpaper(validated, `theme:${entry.id}`).catch(() => {});
      this.data.themes = candidateThemes;
      return entry;
    });
  }

  async rename(id, name) {
    return this._exclusive(async () => {
      const entryIndex = this.data.themes.findIndex(theme => theme.id === id);
      if (entryIndex < 0) throw appError('INVALID_ARGUMENT', '主题不存在');
      if (!UUID_RE.test(id || '')) throw appError('INVALID_ARGUMENT', '不能改动内置主题');
      const oldEntry = this.data.themes[entryIndex];
      const newName = assertThemeName(name);
      const updatedEntry = {
        ...oldEntry,
        name: newName,
        document: validateThemeDocument({ ...oldEntry.document, name: newName }),
        updatedAt: this.now()
      };
      const candidateThemes = [...this.data.themes];
      candidateThemes[entryIndex] = updatedEntry;
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      return updatedEntry;
    });
  }

  async copy(id) {
    const entry = this._requireCustom(id);
    const name = assertThemeName(`${entry.name} 副本`.slice(0, ranges.nameLength[1]));
    return this.saveNew(entry.document, name, entry.tags || []);
  }

  async updateTags(id, tags) {
    return this._exclusive(async () => {
      const normalized = normalizeTags(tags);
      if (UUID_RE.test(id || '')) {
        const entryIndex = this.data.themes.findIndex(theme => theme.id === id);
        if (entryIndex < 0) throw appError('INVALID_ARGUMENT', '主题不存在');
        const oldEntry = this.data.themes[entryIndex];
        const updatedEntry = {
          ...oldEntry,
          tags: normalized,
          updatedAt: this.now()
        };
        const candidateThemes = [...this.data.themes];
        candidateThemes[entryIndex] = updatedEntry;
        await this._persist(candidateThemes);
        this.data.themes = candidateThemes;
        return updatedEntry;
      } else {
        const builtinThemes = require('../shared/themes.json');
        if (!builtinThemes.some(theme => theme.id === id)) {
          throw appError('INVALID_ARGUMENT', '主题不存在');
        }
        this.data.builtinMetadata = this.data.builtinMetadata || {};
        this.data.builtinMetadata[id] = {
          tags: normalized,
          updatedAt: this.now()
        };
        await this._persist();
        return { id, tags: normalized };
      }
    });
  }

  async favorite(id, favorite) {
    return this._exclusive(async () => {
      const entryIndex = this.data.themes.findIndex(theme => theme.id === id);
      if (entryIndex < 0) throw appError('INVALID_ARGUMENT', '主题不存在');
      if (!UUID_RE.test(id || '')) throw appError('INVALID_ARGUMENT', '不能改动内置主题');
      const oldEntry = this.data.themes[entryIndex];
      const updatedEntry = {
        ...oldEntry,
        favorite: !!favorite,
        updatedAt: this.now()
      };
      const candidateThemes = [...this.data.themes];
      candidateThemes[entryIndex] = updatedEntry;
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      return this._favorites();
    });
  }

  async reorder(ids) {
    return this._exclusive(async () => {
      if (!Array.isArray(ids)) throw appError('INVALID_ARGUMENT', '排序无效');
      const favorites = new Map(this.data.themes.filter(theme => theme.favorite).map(theme => [theme.id, theme]));
      if (ids.length !== favorites.size || ids.some(id => !favorites.has(id))) {
        throw appError('INVALID_ARGUMENT', '收藏排序和当前收藏不一致');
      }
      const unique = new Set(ids);
      if (unique.size !== ids.length) {
        throw appError('INVALID_ARGUMENT', '排序列表中含有重复 ID');
      }
      const rank = new Map(ids.map((id, index) => [id, index]));
      const candidateThemes = [...this.data.themes].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      return this._favorites();
    });
  }

  _favorites() {
    return this.data.themes.filter(theme => theme.favorite).map(theme => theme.id);
  }

  _requireCustom(id) {
    if (!UUID_RE.test(id || '')) throw appError('INVALID_ARGUMENT', '不能改动内置主题');
    const entry = this.data.themes.find(theme => theme.id === id);
    if (!entry) throw appError('INVALID_ARGUMENT', '主题不存在');
    return entry;
  }

  async attachSource(id, source) {
    return this._exclusive(async () => {
      const entry = this._requireCustom(id);
      if (!source || typeof source.sourceItemId !== 'string' || !source.sourceItemId) {
        throw appError('INVALID_ARGUMENT', '精选来源无效');
      }
      const updated = {
        ...entry,
        sourceItemId: source.sourceItemId.slice(0, 80),
        sourceVersion: Number.isInteger(source.sourceVersion) ? source.sourceVersion : 1,
        sourceHash: typeof source.sourceHash === 'string' ? source.sourceHash : '',
        dirty: source.dirty === true,
        updatedAt: this.now()
      };
      const candidateThemes = this.data.themes.map(theme => theme.id === id ? updated : theme);
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      return updated;
    });
  }

  async updateDocument(id, document) {
    return this._exclusive(async () => {
      const entry = this._requireCustom(id);
      const validated = validateThemeDocument({ ...document, id, name: document?.name || entry.name });
      const hash = documentHash(validated);
      const updated = {
        ...entry,
        name: validated.name,
        document: validated,
        updatedAt: this.now()
      };
      if (entry.sourceItemId && hash !== documentHash(entry.document)) updated.dirty = true;
      const previousAsset = entry.document?.wallpaper?.assetId || null;
      const nextAsset = validated.wallpaper?.assetId || null;
      const candidateThemes = this.data.themes.map(theme => theme.id === id ? updated : theme);
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      if (this.assets && previousAsset && previousAsset !== nextAsset) {
        await this.assets.release(previousAsset, `theme:${id}`).catch(() => {});
      }
      if (this.assets && nextAsset && nextAsset !== previousAsset) {
        await this.assets.addRef(nextAsset, `theme:${id}`).catch(() => {});
      }
      return updated;
    });
  }

  async remove(id, context = {}) {
    return this._exclusive(async () => {
      if (!UUID_RE.test(id || '')) throw appError('INVALID_ARGUMENT', '不能删除内置主题');
      const index = this.data.themes.findIndex(theme => theme.id === id);
      if (index < 0) throw appError('INVALID_ARGUMENT', '主题不存在');
      const entry = this.data.themes[index];
      const candidateThemes = this.data.themes.filter(theme => theme.id !== id);
      await this._persist(candidateThemes);
      this.data.themes = candidateThemes;
      if (this.assets && entry.document?.wallpaper?.assetId) await this.assets.release(entry.document.wallpaper.assetId, `theme:${id}`);
      if (this.assets && entry.thumbnailAssetId) await this.assets.release(entry.thumbnailAssetId, `thumb:${id}`);
      const repaired = this.repairRules(context.rules || []);
      return {
        deletedId: id,
        deletedName: entry.name,
        keptAppliedSnapshot: context.appliedId === id,
        rules: repaired.rules,
        rulesChanged: repaired.changed
      };
    });
  }

  has(id) {
    return this.data.themes.some(theme => theme.id === id);
  }

  async importPack(text) {
    const raw = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
    if (raw.length > ranges.maxImportBytes) throw appError('INVALID_ARGUMENT', '导入文件不能超过 12 MB');
    let pack;
    try {
      pack = JSON.parse(raw.toString('utf8'));
    } catch {
      throw appError('INVALID_ARGUMENT', '主题包不是有效的 JSON');
    }
    if (plainObject(pack) && pack.schemaVersion > LIBRARY_SCHEMA && pack.kind === 'anti-face-theme-pack') {
      throw appError('UNSUPPORTED_SCHEMA', '主题包版本过新，没有写入主题库');
    }
    const drafts = this._readPack(pack);
    const staged = [];
    const before = await fs.readFile(this.file, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error));
    try {
      const assetsByKey = new Map();
      for (const draft of drafts) {
        for (const asset of draft.assets) {
          if (asset.path || asset.file || asset.url) throw appError('INVALID_ARGUMENT', '主题包不能携带外部路径');
          const buffer = Buffer.from(asset.data, 'base64');
          const item = this.assets ? await this.assets.stage(buffer) : null;
          if (item) staged.push(item);
          assetsByKey.set(asset.id, item);
        }
      }
      const entries = [];
      for (const draft of drafts) {
        let document = validateThemeDocument({ ...draft.document, id: randomUUID(), name: draft.name });
        if (document.wallpaper.assetId && assetsByKey.get(document.wallpaper.assetId)) {
          const stagedAsset = assetsByKey.get(document.wallpaper.assetId);
          const stored = await this.assets.putDecoded(stagedAsset.buffer, stagedAsset.decoded);
          document = validateThemeDocument({ ...document, wallpaper: { ...document.wallpaper, assetId: stored.id, legacyDataUrl: null } });
        }
        entries.push({ document, tags: draft.tags || [] });
      }
      return await this._exclusive(async () => {
        const created = [];
        const candidateThemes = [...this.data.themes];
        for (const item of entries) {
          const now = this.now();
          const entry = {
            id: item.document.id,
            name: item.document.name,
            favorite: false,
            tags: normalizeTags(item.tags || []),
            createdAt: now,
            updatedAt: now,
            document: item.document,
            thumbnailAssetId: null
          };
          candidateThemes.unshift(entry);
          created.push(entry);
        }
        await this._persist(candidateThemes);
        for (const entry of created) {
          if (entry.document.wallpaper.assetId && this.assets) {
            await this.assets.addRef(entry.document.wallpaper.assetId, `theme:${entry.id}`);
          }
        }
        this.data.themes = candidateThemes;
        if (this.assets) await this.assets.abortStaged(staged);
        return { created, ignoredPreferences: true };
      });
    } catch (error) {
      if (this.assets) await this.assets.abortStaged(staged);
      const current = await fs.readFile(this.file, 'utf8').catch(failure => failure.code === 'ENOENT' ? '' : Promise.reject(failure));
      if (current !== before) throw appError('SAVE_FAILED', '导入中断，主题库可能已变化');
      throw error;
    }
  }

  _readPack(pack) {
    if (plainObject(pack) && pack.schemaVersion === 1 && pack.themeId && pack.appearance && !pack.kind) {
      const document = documentFromLegacy(pack);
      return [{ name: document.name, tags: [], document, assets: [] }];
    }
    if (!plainObject(pack) || pack.kind !== 'anti-face-theme-pack') throw appError('INVALID_ARGUMENT', '不是 Anti Face 主题包');
    assertSupportedVersion(pack, 1, '主题包');
    if (!Array.isArray(pack.themes) || pack.themes.length === 0 || pack.themes.length > 50) {
      throw appError('INVALID_ARGUMENT', '主题包里的主题数量无效');
    }
    const assets = new Map((pack.assets || []).map(asset => [asset.id, asset]));
    return pack.themes.map(theme => {
      if (!plainObject(theme) || !plainObject(theme.document)) throw appError('INVALID_ARGUMENT', '主题包内容无效');
      const document = validateThemeDocument({ ...theme.document, name: theme.name || theme.document.name });
      const used = [];
      if (document.wallpaper.assetId) {
        const asset = assets.get(document.wallpaper.assetId);
        if (!asset || typeof asset.data !== 'string') throw appError('ASSET_INVALID', '主题包缺少壁纸数据');
        used.push(asset);
      }
      return { name: document.name, tags: normalizeTags(theme.tags || []), document, assets: used };
    });
  }

  async exportPack(id) {
    const entry = this._requireCustom(id);
    const assets = [];
    if (entry.document.wallpaper?.assetId && this.assets) {
      const record = this.assets.get(entry.document.wallpaper.assetId);
      const buffer = await this.assets.read(entry.document.wallpaper.assetId);
      assets.push({ id: record.id, mime: record.mime, data: buffer.toString('base64') });
    }
    return {
      schemaVersion: 1,
      kind: 'anti-face-theme-pack',
      themes: [{ name: entry.name, tags: entry.tags || [], document: entry.document }],
      assets
    };
  }
}

module.exports = { ThemeLibrary };
