const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writeAtomic } = require('../core/atomic-write.cjs');
const { appError } = require('../core/errors.cjs');
const { plainObject, validateThemeDocument } = require('../core/theme-schema.cjs');
const { documentHash, diffDocuments } = require('../core/theme-diff.cjs');

const REVISION_SCHEMA = 1;
const DEFAULT_KEEP = 50;

function uniqueIds(list) {
  const seen = new Set();
  const out = [];
  for (const id of list || []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

class ThemeRevisionStore {
  constructor(dir, deps = {}) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    this.recordDir = path.join(dir, 'records');
    this.assets = deps.assets || null;
    this.now = deps.now || (() => new Date().toISOString());
    this.keep = deps.keep || DEFAULT_KEEP;
    this.index = { schemaVersion: REVISION_SCHEMA, themes: {}, retired: [], held: [] };
    this.frozen = false;
    this.orphans = [];
    this.recoveryCandidates = [];
    this.retiredKnown = true;
    this.queue = Promise.resolve();
    this.journalDir = path.join(dir, 'journal');
    this.fault = null;
    this.beforeMutation = deps.beforeMutation || null;
  }

  runExclusive(task) {
    const run = this.queue.catch(() => {}).then(() => task());
    this.queue = run.then(() => {}, () => {});
    return run;
  }

  async load() {
    await fs.mkdir(this.recordDir, { recursive: true });
    await fs.mkdir(this.journalDir, { recursive: true });
    return this.runExclusive(() => this._loadUnlocked());
  }

  async _loadUnlocked() {
    let raw = null;
    try { raw = await fs.readFile(this.indexFile, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (raw == null) {
      this.index = { schemaVersion: REVISION_SCHEMA, themes: {}, retired: [], held: [] };
      this.retiredKnown = true;
      this.orphans = await this._scanOrphans();
      await this._recoverJournalUnlocked();
      return this.snapshot();
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch {
      this.frozen = true;
      this.orphans = await this._scanOrphans();
      return { ...this.snapshot(), errorCode: 'REVISION_DAMAGED' };
    }
    if (!plainObject(parsed) || parsed.schemaVersion > REVISION_SCHEMA) {
      this.frozen = true;
      this.orphans = await this._scanOrphans();
      return { ...this.snapshot(), errorCode: 'UNSUPPORTED_SCHEMA' };
    }
    const retiredKnown = Array.isArray(parsed.retired);
    this.retiredKnown = retiredKnown;
    this.index = {
      schemaVersion: REVISION_SCHEMA,
      themes: plainObject(parsed.themes) ? parsed.themes : {},
      retired: retiredKnown ? uniqueIds(parsed.retired) : [],
      held: Array.isArray(parsed.held) ? uniqueIds(parsed.held) : []
    };
    if (!retiredKnown) {
      const ambiguous = await this._diskIds();
      const known = this._indexedIds();
      this.index.held = uniqueIds([...(this.index.held || []), ...ambiguous.filter(id => !known.has(id))]);
      await this._writeIndexDirect(this.index);
      this.retiredKnown = true;
    }
    await this._recoverJournalUnlocked();
    await this._noteHeldCandidates();
    this.orphans = await this._scanOrphans();
    return this.snapshot();
  }

  snapshot() {
    return {
      schemaVersion: this.index.schemaVersion,
      frozen: this.frozen,
      orphans: [...this.orphans],
      recoveryCandidates: this.recoveryCandidates.map(item => ({ ...item })),
      themes: Object.fromEntries(Object.entries(this.index.themes).map(([themeId, entry]) => [themeId, {
        currentRevisionId: entry.currentRevisionId || null,
        items: (entry.items || []).map(item => ({ ...item }))
      }]))
    };
  }

  list(themeId) {
    return this.index.themes[themeId]?.items || [];
  }

  async read(revisionId) {
    const file = path.join(this.recordDir, `${revisionId}.json`);
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!plainObject(parsed) || parsed.schemaVersion !== 1) throw appError('REVISION_DAMAGED', '版本记录无法读取');
    return parsed;
  }

  diff(leftId, rightId) {
    return Promise.all([this.read(leftId), this.read(rightId)]).then(([left, right]) => diffDocuments(left.document, right.document));
  }

  record(input) {
    return this.runExclusive(() => this._recordUnlocked(input));
  }

  pin(themeId, revisionId, pinned) {
    return this.runExclusive(() => this._pinUnlocked(themeId, revisionId, pinned));
  }

  removeTheme(themeId, options = {}) {
    return this.runExclusive(() => this._removeThemeUnlocked(themeId, options));
  }

  adoptCandidate(revisionId) {
    return this.runExclusive(() => this._adoptUnlocked(revisionId));
  }

  async _touch(kind) {
    if (typeof this.beforeMutation === 'function') await this.beforeMutation(kind);
  }

  _shape(themes, patch = {}) {
    const retired = Object.prototype.hasOwnProperty.call(patch, 'retired') ? patch.retired : this.index.retired;
    const held = Object.prototype.hasOwnProperty.call(patch, 'held') ? patch.held : this.index.held;
    return { schemaVersion: REVISION_SCHEMA, themes, retired: uniqueIds(retired), held: uniqueIds(held) };
  }

  _indexedIds() {
    const known = new Set();
    for (const entry of Object.values(this.index.themes || {})) {
      for (const item of entry.items || []) known.add(item.revisionId);
    }
    return known;
  }

  async _recordUnlocked(input) {
    await this._touch('record');
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '版本索引版本过新，已停止写入');
    const document = validateThemeDocument(input.document);
    const hash = documentHash(document);
    const themeId = input.themeId || document.id;
    const operationId = typeof input.operationId === 'string' && input.operationId ? input.operationId : null;
    if (operationId) {
      const prior = await this._readJournal(operationId);
      if (prior?.status === 'committed') {
        const summary = this._findSummary(prior.themeId || themeId, prior.revisionId);
        if (summary) return { revision: summary, deduped: true, operationId };
      }
      if (prior?.status === 'pending' && prior.revisionId) {
        const finished = await this._finishPending(prior, operationId);
        if (finished) return finished;
      }
    }
    const existing = this.list(themeId).find(item => item.documentHash === hash);
    if (existing && input.source !== 'restore') return { revision: existing, deduped: true, operationId };
    if (this.fault === 'revision') throw appError('SAVE_FAILED', '版本记录写入失败');
    const revisionId = randomUUID();
    const assetRefs = [];
    if (document.wallpaper?.assetId) assetRefs.push(document.wallpaper.assetId);
    const record = {
      schemaVersion: 1,
      revisionId,
      themeId,
      parentRevisionId: input.parentRevisionId || this.index.themes[themeId]?.currentRevisionId || null,
      createdAt: this.now(),
      source: input.source || 'save',
      restoredFromRevisionId: input.restoredFromRevisionId || null,
      documentHash: hash,
      document,
      assetRefs
    };
    const summary = this._summaryFromParts(record, document, input.pinned === true, operationId);
    await fs.mkdir(this.recordDir, { recursive: true });
    await writeAtomic(path.join(this.recordDir, `${revisionId}.json`), JSON.stringify(record));
    if (operationId) await this._writeJournal(operationId, { status: 'pending', revisionId, themeId, phase: 'record-written' });
    if (this.fault === 'index') {
      this.orphans.push(revisionId);
      throw appError('SAVE_FAILED', '版本索引替换失败');
    }
    const previous = this.index.themes[themeId] || { currentRevisionId: null, items: [] };
    const items = [summary, ...previous.items.filter(item => item.revisionId !== revisionId)];
    const nextIndex = this._shape({ ...this.index.themes, [themeId]: { currentRevisionId: revisionId, items } });
    try {
      await this._writeIndexDirect(nextIndex);
    } catch (error) {
      this.orphans.push(revisionId);
      throw error;
    }
    this.index = nextIndex;
    if (this.fault === 'commit') throw appError('SAVE_FAILED', '版本提交标记失败');
    if (operationId) await this._writeJournal(operationId, { status: 'committed', revisionId, themeId });
    if (this.assets && document.wallpaper?.assetId) {
      await this.assets.addRef(document.wallpaper.assetId, `revision:${revisionId}`).catch(() => {});
    }
    await this._trimUnlocked(themeId);
    return { revision: summary, deduped: false, operationId };
  }

  async _pinUnlocked(themeId, revisionId, pinned) {
    await this._touch('pin');
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '版本索引版本过新，已停止写入');
    const entry = this.index.themes[themeId];
    if (!entry) throw appError('INVALID_ARGUMENT', '没有这个主题的版本');
    const items = entry.items.map(item => item.revisionId === revisionId ? { ...item, pinned: pinned === true } : item);
    if (!items.some(item => item.revisionId === revisionId)) throw appError('INVALID_ARGUMENT', '没有这个版本');
    const next = this._shape({ ...this.index.themes, [themeId]: { ...entry, items } });
    await this._writeIndexDirect(next);
    this.index = next;
    return items.find(item => item.revisionId === revisionId);
  }

  async _removeThemeUnlocked(themeId, { release = true } = {}) {
    await this._touch('remove');
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '版本索引版本过新，已停止写入');
    const entry = this.index.themes[themeId];
    if (!entry) return [];
    const removed = entry.items.slice();
    const themes = { ...this.index.themes };
    delete themes[themeId];
    const retired = uniqueIds([...(this.index.retired || []), ...removed.map(item => item.revisionId)]);
    const next = this._shape(themes, { retired });
    await this._writeIndexDirect(next);
    this.index = next;
    for (const item of removed) {
      if (release && this.assets) {
        for (const assetId of item.assetRefs || []) await this.assets.release(assetId, `revision:${item.revisionId}`).catch(() => {});
      }
      if (release) await fs.rm(path.join(this.recordDir, `${item.revisionId}.json`), { force: true }).catch(() => {});
    }
    return removed;
  }

  async _trimUnlocked(themeId) {
    const entry = this.index.themes[themeId];
    if (!entry) return;
    const current = entry.currentRevisionId;
    const kept = [];
    const dropped = [];
    let spare = 0;
    for (const item of entry.items) {
      if (item.pinned || item.revisionId === current) kept.push(item);
      else if (spare < this.keep) {
        kept.push(item);
        spare += 1;
      } else dropped.push(item);
    }
    if (!dropped.length) return;
    await this._touch('trim');
    const retired = uniqueIds([...(this.index.retired || []), ...dropped.map(item => item.revisionId)]);
    const next = this._shape({ ...this.index.themes, [themeId]: { ...entry, items: kept } }, { retired });
    await this._writeIndexDirect(next);
    this.index = next;
    for (const item of dropped) {
      if (this.assets) {
        for (const assetId of item.assetRefs || []) await this.assets.release(assetId, `revision:${item.revisionId}`).catch(() => {});
      }
      await fs.rm(path.join(this.recordDir, `${item.revisionId}.json`), { force: true }).catch(() => {});
    }
  }

  async _adoptUnlocked(revisionId) {
    await this._touch('adopt');
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '版本索引版本过新，已停止写入');
    const candidate = this.recoveryCandidates.find(item => item.revisionId === revisionId);
    if (!candidate) throw appError('INVALID_ARGUMENT', '没有这条可恢复的历史');
    if ((this.index.retired || []).includes(revisionId)) throw appError('INVALID_ARGUMENT', '这条历史已经删除');
    const summary = await this._reindexFileUnlocked(path.join(this.recordDir, `${revisionId}.json`), null, { makeCurrent: false });
    this.recoveryCandidates = this.recoveryCandidates.filter(item => item.revisionId !== revisionId);
    return summary;
  }

  _summaryFromParts(record, document, pinned, operationId) {
    return {
      revisionId: record.revisionId,
      parentRevisionId: record.parentRevisionId,
      createdAt: record.createdAt,
      source: record.source,
      restoredFromRevisionId: record.restoredFromRevisionId,
      documentHash: record.documentHash,
      assetRefs: record.assetRefs || [],
      name: document?.name,
      colors: {
        accent: document?.colors?.accent || null,
        background: document?.colors?.background || null,
        panel: document?.colors?.panel || null,
        foreground: document?.colors?.foreground || null
      },
      pinned: pinned === true,
      operationId: operationId || null
    };
  }

  async _writeIndexDirect(index) {
    await writeAtomic(this.indexFile, JSON.stringify(index));
  }

  _findSummary(themeId, revisionId) {
    return (this.index.themes[themeId]?.items || []).find(item => item.revisionId === revisionId) || null;
  }

  async _readJournal(operationId) {
    try {
      return JSON.parse(await fs.readFile(path.join(this.journalDir, `${operationId}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _writeJournal(operationId, body) {
    await fs.mkdir(this.journalDir, { recursive: true });
    await writeAtomic(path.join(this.journalDir, `${operationId}.json`), JSON.stringify({ operationId, ...body }));
  }

  async _finishPending(prior, operationId) {
    const file = path.join(this.recordDir, `${prior.revisionId}.json`);
    try { await fs.access(file); } catch { return null; }
    if ((this.index.retired || []).includes(prior.revisionId)) {
      await this._writeJournal(operationId, { status: 'committed', revisionId: prior.revisionId, themeId: prior.themeId, retired: true });
      return null;
    }
    if (!this._findSummary(prior.themeId, prior.revisionId)) {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      const summary = {
        revisionId: prior.revisionId,
        parentRevisionId: parsed.parentRevisionId || null,
        createdAt: parsed.createdAt,
        source: parsed.source,
        restoredFromRevisionId: parsed.restoredFromRevisionId || null,
        documentHash: parsed.documentHash,
        assetRefs: parsed.assetRefs || [],
        name: parsed.document?.name,
        colors: {
          accent: parsed.document?.colors?.accent || null,
          background: parsed.document?.colors?.background || null,
          panel: parsed.document?.colors?.panel || null,
          foreground: parsed.document?.colors?.foreground || null
        },
        pinned: false,
        operationId
      };
      const previous = this.index.themes[prior.themeId] || { currentRevisionId: null, items: [] };
      const nextIndex = this._shape({
        ...this.index.themes,
        [prior.themeId]: {
          currentRevisionId: previous.currentRevisionId || prior.revisionId,
          items: [summary, ...previous.items.filter(item => item.revisionId !== prior.revisionId)]
        }
      }, { held: (this.index.held || []).filter(id => id !== prior.revisionId) });
      if (!previous.currentRevisionId) nextIndex.themes[prior.themeId].currentRevisionId = prior.revisionId;
      await this._writeIndexDirect(nextIndex);
      this.index = nextIndex;
      if (this.assets) {
        for (const assetId of summary.assetRefs || []) await this.assets.addRef(assetId, `revision:${summary.revisionId}`).catch(() => {});
      }
    }
    await this._writeJournal(operationId, { status: 'committed', revisionId: prior.revisionId, themeId: prior.themeId });
    return { revision: this._findSummary(prior.themeId, prior.revisionId), deduped: true, operationId, recovered: true };
  }

  async _recoverJournalUnlocked() {
    let names = [];
    try { names = await fs.readdir(this.journalDir); } catch { return; }
    for (const name of names.filter(item => item.endsWith('.json'))) {
      const operationId = name.replace(/\.json$/, '');
      let journal;
      try { journal = JSON.parse(await fs.readFile(path.join(this.journalDir, name), 'utf8')); } catch { continue; }
      if (!journal?.revisionId) continue;
      if (journal.status === 'committed') {
        await this._recoverCommittedUnlocked(journal);
        continue;
      }
      if (journal.status !== 'pending') continue;
      const recordFile = path.join(this.recordDir, `${journal.revisionId}.json`);
      let exists = true;
      try { await fs.access(recordFile); } catch { exists = false; }
      if (!exists) {
        await this._writeJournal(operationId, { ...journal, status: 'recovery-needed' });
        continue;
      }
      await this._finishPending(journal, operationId);
    }
  }

  async _recoverCommittedUnlocked(journal) {
    const revisionId = journal.revisionId;
    const themeId = journal.themeId;
    if (!revisionId) return;
    if (themeId && this._findSummary(themeId, revisionId)) return;
    if ((this.index.retired || []).includes(revisionId)) return;
    const file = path.join(this.recordDir, `${revisionId}.json`);
    let exists = true;
    try { await fs.access(file); } catch { exists = false; }
    if (!exists) return;
    if ((this.index.held || []).includes(revisionId) || !this.retiredKnown) {
      this._noteCandidate(revisionId, themeId || null, 'unclassified');
      return;
    }
    await this._reindexFileUnlocked(file, journal.operationId || null, { makeCurrent: false });
  }

  async _reindexFileUnlocked(file, operationId, options = {}) {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!plainObject(parsed) || parsed.schemaVersion !== 1) throw appError('REVISION_DAMAGED', '版本记录无法读取');
    const themeId = parsed.themeId;
    const existing = this._findSummary(themeId, parsed.revisionId);
    if (existing) return existing;
    const summary = this._summaryFromParts(parsed, parsed.document, false, operationId);
    const previous = this.index.themes[themeId] || { currentRevisionId: null, items: [] };
    const items = [summary, ...previous.items.filter(item => item.revisionId !== summary.revisionId)];
    const currentRevisionId = options.makeCurrent || !previous.currentRevisionId ? summary.revisionId : previous.currentRevisionId;
    const next = this._shape(
      { ...this.index.themes, [themeId]: { currentRevisionId, items } },
      { held: (this.index.held || []).filter(id => id !== summary.revisionId) }
    );
    await this._writeIndexDirect(next);
    this.index = next;
    if (this.assets) {
      for (const assetId of summary.assetRefs || []) await this.assets.addRef(assetId, `revision:${summary.revisionId}`).catch(() => {});
    }
    return summary;
  }

  async _noteHeldCandidates() {
    for (const revisionId of this.index.held || []) {
      if ((this.index.retired || []).includes(revisionId)) continue;
      if ([...this._indexedIds()].includes(revisionId)) continue;
      let themeId = null;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(this.recordDir, `${revisionId}.json`), 'utf8'));
        themeId = parsed.themeId || null;
      } catch { continue; }
      this._noteCandidate(revisionId, themeId, 'unclassified');
    }
  }

  _noteCandidate(revisionId, themeId, reason) {
    if (!revisionId || this.recoveryCandidates.some(item => item.revisionId === revisionId)) return;
    this.recoveryCandidates.push({ revisionId, themeId: themeId || null, reason });
  }

  async _diskIds() {
    let names = [];
    try { names = await fs.readdir(this.recordDir); } catch { return []; }
    return names.filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, ''));
  }

  async _scanOrphans() {
    const known = this._indexedIds();
    for (const id of this.index.retired || []) known.add(id);
    for (const id of this.index.held || []) known.add(id);
    const ids = await this._diskIds();
    return ids.filter(id => !known.has(id));
  }
}

module.exports = { ThemeRevisionStore, REVISION_SCHEMA };
