const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { randomUUID } = require('node:crypto');
const { decodeImage } = require('../core/image-decode.cjs');
const { thumbnailPng } = require('../core/wallpaper.cjs');
const { appError } = require('../core/errors.cjs');
const ranges = require('../shared/appearance-ranges.json');

function inside(root, target) {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw appError('INVALID_ARGUMENT', '资源路径越界');
  }
  return resolved;
}

class AssetStore {
  constructor(directory, deps = {}) {
    this.root = path.resolve(directory);
    this.files = path.join(this.root, 'files');
    this.incoming = path.join(this.root, 'incoming');
    this.indexFile = path.join(this.root, 'index.json');
    this.decodeImage = deps.decodeImage || decodeImage;
    this.now = deps.now || (() => new Date().toISOString());
    this.retentionMs = deps.retentionMs || ranges.assetRetentionMs;
    this.queue = Promise.resolve();
    this.records = new Map();
    this.loaded = false;
    this.importGeneration = 0;
    this.latestImportId = null;
    this.dataUrls = new Map();
  }

  async init() {
    await fs.mkdir(this.files, { recursive: true });
    await fs.mkdir(this.incoming, { recursive: true });
    await this._load();
  }

  async _load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await fs.readFile(this.indexFile, 'utf8'));
      if (parsed.schemaVersion > 1) {
        this.frozen = true;
        this.loaded = true;
        return;
      }
      for (const record of parsed.records || []) this.records.set(record.id, record);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  async _writeIndex() {
    if (this.frozen) throw appError('UNSUPPORTED_SCHEMA', '资源索引版本过新，已停止写入');
    const payload = { schemaVersion: 1, records: [...this.records.values()] };
    const temp = path.join(this.root, `${randomUUID()}.tmp`);
    inside(this.root, temp);
    await fs.writeFile(temp, JSON.stringify(payload), 'utf8');
    await fs.rename(temp, this.indexFile);
  }

  _exclusive(fn) {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run;
    return run;
  }

  beginImport() {
    this.importGeneration += 1;
    return this.importGeneration;
  }

  async importImage(buffer, generation = this.importGeneration) {
    const decoded = await this.decodeImage(buffer);
    if (generation !== this.importGeneration) return { stale: true, record: null };
    const record = await this.putDecoded(buffer, decoded);
    if (generation !== this.importGeneration) return { stale: true, record };
    this.latestImportId = record.id;
    return { stale: false, record };
  }

  async putDecoded(buffer, decoded) {
    return this._exclusive(async () => {
      await this._load();
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const existing = [...this.records.values()].find(record => record.sha256 === sha256);
      if (existing) return existing;
      const ext = decoded.format === 'jpeg' ? 'jpg' : decoded.format;
      const id = randomUUID();
      const filename = `${sha256}.${ext}`;
      const destination = inside(this.files, path.join(this.files, filename));
      const temp = inside(this.files, path.join(this.files, `${id}.tmp`));
      await fs.writeFile(temp, buffer);
      await fs.rename(temp, destination);
      let thumbnail = null;
      try {
        const thumb = thumbnailPng(decoded);
        const thumbName = `${sha256}.thumb.png`;
        const thumbPath = inside(this.files, path.join(this.files, thumbName));
        await fs.writeFile(thumbPath, thumb.png);
        thumbnail = thumbName;
      } catch {
        thumbnail = null;
      }
      const record = {
        id,
        sha256,
        ext,
        mime: decoded.mime,
        width: decoded.width,
        height: decoded.height,
        bytes: buffer.length,
        file: filename,
        thumbnail,
        createdAt: this.now(),
        refs: []
      };
      this.records.set(id, record);
      await this._writeIndex();
      return record;
    });
  }

  async addRef(id, ref) {
    return this._exclusive(async () => {
      const record = this.records.get(id);
      if (!record) throw appError('ASSET_INVALID', '壁纸资源不存在');
      if (!record.refs.includes(ref)) record.refs.push(ref);
      await this._writeIndex();
      return record;
    });
  }

  async release(id, ref) {
    return this._exclusive(async () => {
      const record = this.records.get(id);
      if (!record) return null;
      record.refs = record.refs.filter(item => item !== ref);
      await this._writeIndex();
      return record;
    });
  }

  get(id) {
    return this.records.get(id) || null;
  }

  async read(id) {
    const record = this.records.get(id);
    if (!record) throw appError('ASSET_INVALID', '壁纸资源不存在');
    const file = inside(this.files, path.join(this.files, record.file));
    return fs.readFile(file);
  }

  async dataUrl(id) {
    if (this.dataUrls.has(id)) return this.dataUrls.get(id);
    const record = this.records.get(id);
    if (!record) throw appError('ASSET_INVALID', '壁纸资源不存在');
    const buffer = await this.read(id);
    const url = `data:${record.mime};base64,${buffer.toString('base64')}`;
    this.dataUrls.set(id, url);
    if (this.dataUrls.size > 4) this.dataUrls.delete(this.dataUrls.keys().next().value);
    return url;
  }

  async stage(buffer) {
    const decoded = await this.decodeImage(buffer);
    const id = randomUUID();
    const ext = decoded.format === 'jpeg' ? 'jpg' : decoded.format;
    const filename = `${id}.${ext}`;
    const file = inside(this.incoming, path.join(this.incoming, filename));
    await fs.writeFile(file, buffer);
    return { id, filename, decoded, buffer };
  }

  async abortStaged(items) {
    for (const item of items || []) {
      const file = inside(this.incoming, path.join(this.incoming, item.filename));
      await fs.rm(file, { force: true });
    }
  }

  async gc(nowMs = Date.now()) {
    return this._exclusive(async () => {
      let removed = 0;
      for (const record of [...this.records.values()]) {
        if (record.refs.length) continue;
        const created = Date.parse(record.createdAt);
        if (Number.isFinite(created) && nowMs - created < this.retentionMs) continue;
        const file = inside(this.files, path.join(this.files, record.file));
        await fs.rm(file, { force: true });
        if (record.thumbnail) {
          await fs.rm(inside(this.files, path.join(this.files, record.thumbnail)), { force: true });
        }
        this.records.delete(record.id);
        this.dataUrls.delete(record.id);
        removed += 1;
      }
      await this._writeIndex();
      return removed;
    });
  }
}

module.exports = { AssetStore, inside };
