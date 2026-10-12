const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { decodeImage } = require('../core/image-decode.cjs');
const { resizeNearest } = require('../core/wallpaper.cjs');

const ANALYSIS_SPEC = 'v2-full-512';
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 16;
const HEAVY_BYTES = 512 * 1024;

class ImageAnalysisService {
  constructor(deps = {}) {
    this.assets = deps.assets || null;
    this.maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxEntries = deps.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.cache = new Map();
    this.aliases = new Map();
    this.totalBytes = 0;
    this.inFlight = new Map();
    this.epoch = 0;
    this.stopped = false;
    this._createWorker = deps.createWorker || null;
    this.workerLimit = deps.workerLimit ?? 1;
    this.workerActive = 0;
    this.workerWaiters = [];
  }

  contentHash(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  contentKey(hash) {
    return `content:${hash}:${ANALYSIS_SPEC}`;
  }

  legacyKey(dataUrl) {
    const buffer = this.legacyBuffer(dataUrl);
    if (!buffer || !Buffer.isBuffer(buffer)) return null;
    return this.contentKey(this.contentHash(buffer));
  }

  legacyBuffer(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    if (!/^data:image\/(png|jpeg|webp);base64$/i.test(header)) return { error: { code: 'UNSUPPORTED_IMAGE', message: '只支持 PNG、JPEG 和 WebP' } };
    try {
      const buffer = Buffer.from(dataUrl.slice(comma + 1), 'base64');
      if (!buffer.length) return { error: { code: 'IMAGE_CORRUPT', message: '图片数据是空的' } };
      return buffer;
    } catch {
      return { error: { code: 'IMAGE_CORRUPT', message: '图片数据无法解码' } };
    }
  }

  _touch(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    entry.at = Date.now();
    return entry;
  }

  get(key) {
    return this._touch(key);
  }

  _bytesOf(value) {
    return value?.image?.data ? value.image.data.length : 0;
  }

  set(key, value) {
    if (this.stopped) return null;
    const bytes = this._bytesOf(value);
    const existing = this.cache.get(key);
    if (existing) this.totalBytes -= existing.bytes;
    const entry = {
      dimensions: value.dimensions,
      image: value.image,
      hash: value.hash,
      analysisId: value.analysisId || randomUUID(),
      bytes,
      at: Date.now(),
      error: value.error || null
    };
    this.cache.set(key, entry);
    this.totalBytes += bytes;
    this._evict();
    return this.cache.get(key) || null;
  }

  _evict() {
    while ((this.totalBytes > this.maxBytes || this.cache.size > this.maxEntries) && this.cache.size > 0) {
      let oldestKey = null;
      let oldestAt = Infinity;
      for (const [key, entry] of this.cache) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      const removed = this.cache.get(oldestKey);
      this.cache.delete(oldestKey);
      if (removed) this.totalBytes -= removed.bytes;
      for (const [alias, target] of this.aliases) {
        if (target === oldestKey) this.aliases.delete(alias);
      }
    }
    if (this.totalBytes < 0) this.totalBytes = 0;
  }

  async _readSource(document) {
    const wp = document?.wallpaper;
    if (!wp) return { error: { code: 'MISSING_IMAGE', message: '没有壁纸' } };
    if (wp.assetId && this.assets) {
      try {
        const buffer = await this.assets.read(wp.assetId);
        if (!buffer) return { error: { code: 'MISSING_ASSET', message: '壁纸文件不在本机' } };
        return { buffer, alias: `asset:${wp.assetId}` };
      } catch (error) {
        if (!wp.legacyDataUrl) {
          return { error: { code: error.code === 'ENOENT' ? 'MISSING_ASSET' : 'MISSING_ASSET', message: '壁纸文件读不出来' } };
        }
      }
    } else if (wp.assetId && !wp.legacyDataUrl) {
      return { error: { code: 'MISSING_ASSET', message: '壁纸文件不在本机' } };
    }
    if (wp.legacyDataUrl) {
      const decoded = this.legacyBuffer(wp.legacyDataUrl);
      if (decoded?.error) return decoded;
      if (decoded) return { buffer: decoded, alias: null };
    }
    return { error: { code: 'MISSING_IMAGE', message: '没有可分析的图片' } };
  }

  _public(entry) {
    if (!entry) return null;
    if (entry.error) return { error: entry.error };
    return {
      dimensions: entry.dimensions,
      image: entry.image,
      hash: entry.hash,
      analysisId: entry.analysisId
    };
  }

  analysisFor(document) {
    const wp = document?.wallpaper;
    if (!wp) return null;
    if (wp.legacyDataUrl) {
      const key = this.legacyKey(wp.legacyDataUrl);
      if (key && this.cache.has(key)) return this._public(this._touch(key));
    }
    if (wp.assetId && this.aliases.has(`asset:${wp.assetId}`)) {
      const key = this.aliases.get(`asset:${wp.assetId}`);
      if (this.cache.has(key)) return this._public(this._touch(key));
    }
    return null;
  }

  async _withWorker(task) {
    if (this.workerActive >= this.workerLimit) {
      await new Promise(resolve => this.workerWaiters.push(resolve));
    }
    if (this.stopped) return { error: { code: 'STOPPED', message: '分析已停止' } };
    this.workerActive += 1;
    try {
      return await task();
    } finally {
      this.workerActive -= 1;
      const next = this.workerWaiters.shift();
      if (next) next();
    }
  }

  async _decode(buffer, epoch) {
    if (buffer.length < HEAVY_BYTES) return decodeImage(buffer);
    return this._withWorker(async () => {
      if (this.stopped || epoch !== this.epoch) return { error: { code: 'STALE', message: '分析已取消' } };
      const workerPath = path.join(__dirname, 'workers', 'image-analysis.cjs');
      const worker = this._createWorker ? this._createWorker(workerPath) : new Worker(workerPath);
      try {
        const message = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(Object.assign(new Error('图片解码超时'), { code: 'TIMEOUT' }));
          }, 15000);
          worker.once('message', value => { clearTimeout(timer); resolve(value); });
          worker.once('error', error => { clearTimeout(timer); reject(error); });
          worker.postMessage({ bytes: buffer, decodeOnly: true, coreRoot: path.join(__dirname, '../core') });
        });
        if (!message?.ok) {
          const error = new Error(message?.message || '图片解码失败');
          error.code = message?.code || 'ASSET_INVALID';
          throw error;
        }
        return { width: message.image.width, height: message.image.height, data: Buffer.from(message.sample.data), sample: message.sample };
      } finally {
        try { await worker.terminate(); } catch { /* already gone */ }
      }
    });
  }

  _classifyDecodeError(error) {
    const message = error?.message || '图片无法分析';
    if (/不支持|webp|格式/i.test(message)) return { code: 'UNSUPPORTED_IMAGE', message };
    if (/找不到|不在|ENOENT|missing/i.test(message)) return { code: 'MISSING_ASSET', message };
    return { code: 'IMAGE_CORRUPT', message };
  }

  async prepare(document) {
    const epoch = this.epoch;
    const source = await this._readSource(document);
    if (epoch !== this.epoch || this.stopped) return { stale: true, error: { code: 'STALE', message: '分析已取消' } };
    if (source.error) return source;
    const hash = this.contentHash(source.buffer);
    const key = this.contentKey(hash);
    const cached = this.get(key);
    if (cached) {
      if (source.alias) this.aliases.set(source.alias, key);
      return this._public(cached);
    }
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const task = (async () => {
      try {
        const decoded = await this._decode(source.buffer, epoch);
        if (decoded?.error) return decoded;
        if (epoch !== this.epoch || this.stopped) return { stale: true, error: { code: 'STALE', message: '分析已取消' } };
        const sample = decoded.sample
          ? { width: decoded.sample.width, height: decoded.sample.height, data: Buffer.from(decoded.sample.data) }
          : resizeNearest(decoded.data, decoded.width, decoded.height, 512);
        const result = {
          dimensions: { width: decoded.width, height: decoded.height },
          image: { width: sample.width, height: sample.height, data: Buffer.from(sample.data) },
          hash,
          analysisId: randomUUID()
        };
        if (epoch !== this.epoch || this.stopped) return { stale: true, error: { code: 'STALE', message: '分析已取消' } };
        this.set(key, result);
        if (source.alias) this.aliases.set(source.alias, key);
        return this._public(this.get(key));
      } catch (error) {
        return { error: this._classifyDecodeError(error) };
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, task);
    return task;
  }

  rememberAsset(assetId, buffer, image, dimensions) {
    if (!assetId || !buffer || !image?.data) return null;
    const hash = this.contentHash(buffer);
    const key = this.contentKey(hash);
    this.set(key, { dimensions: dimensions || { width: image.width, height: image.height }, image, hash });
    this.aliases.set(`asset:${assetId}`, key);
    return this._public(this.get(key));
  }

  clear() {
    this.epoch += 1;
    this.cache.clear();
    this.aliases.clear();
    this.totalBytes = 0;
    this.inFlight.clear();
  }

  stop() {
    this.stopped = true;
    this.clear();
  }
}

module.exports = { ImageAnalysisService, ANALYSIS_SPEC, DEFAULT_MAX_BYTES, DEFAULT_MAX_ENTRIES };
