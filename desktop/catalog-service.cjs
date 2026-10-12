const fs = require('node:fs/promises');
const path = require('node:path');
const { sha256Text, sha256Json } = require('../core/digest.cjs');
const { validateCatalogManifest } = require('../core/catalog-schema.cjs');
const { validateThemeDocument } = require('../core/theme-schema.cjs');
const { appError, publicError } = require('../core/errors.cjs');

class CatalogService {
  constructor(deps = {}) {
    this.root = deps.root;
    this.fetchImpl = deps.fetchImpl || globalThis.fetch;
    this.remoteBaseUrl = deps.remoteBaseUrl || null;
    this.timeoutMs = deps.timeoutMs ?? 4000;
    this.maxBytes = deps.maxBytes ?? 8 * 1024 * 1024;
    this.cache = null;
  }

  async listBundled() {
    const manifest = await this._bundled();
    return manifest.items.map(summary);
  }

  async page({ search = '', tag = '', mode = '', page = 1, pageSize = 12, items = null } = {}) {
    const source = items || await this.listBundled();
    const needle = String(search || '').trim().toLowerCase();
    const filtered = source.filter(item => {
      if (needle && !`${item.name} ${item.summary} ${item.tags.join(' ')}`.toLowerCase().includes(needle)) return false;
      if (tag && !item.tags.includes(tag)) return false;
      if (mode && item.mode !== mode) return false;
      return true;
    });
    const size = Math.max(1, Math.min(60, pageSize));
    const safePage = Math.max(1, page);
    const start = (safePage - 1) * size;
    return { items: filtered.slice(start, start + size), total: filtered.length, page: safePage, pageSize: size };
  }

  async getBundled(itemId) {
    const manifest = await this._bundled();
    const item = manifest.items.find(entry => entry.itemId === itemId);
    if (!item) throw appError('INVALID_ARGUMENT', '没有这套精选主题');
    const payload = validateThemeDocument(item.payload);
    return { ...summary(item), payload };
  }

  async readWallpaper(relativePath, expectedHash) {
    const file = inside(this.root, relativePath);
    const buffer = await fs.readFile(file);
    const digest = sha256Text(buffer);
    if (expectedHash && digest !== expectedHash) throw appError('CATALOG_HASH_MISMATCH', '内置壁纸校验不一致');
    return buffer;
  }

  async fetchRemote(url, expected) {
    if (!this.remoteBaseUrl) throw appError('CATALOG_UNAVAILABLE', '远程源未配置');
    let parsed;
    try { parsed = new URL(url); } catch { throw appError('INVALID_ARGUMENT', '远程地址无效'); }
    const base = new URL(this.remoteBaseUrl);
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (parsed.origin !== base.origin || (parsed.protocol !== 'https:' && !loopback)) {
      throw appError('CATALOG_UNAVAILABLE', '远程地址不在预配置来源内');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { redirect: 'error', signal: controller.signal });
      if (!response.ok) throw appError('CATALOG_UNAVAILABLE', '远程目录没有返回内容', { retryable: true });
      const length = Number(response.headers.get('content-length') || 0);
      if (length > this.maxBytes) throw appError('CATALOG_TOO_LARGE', '远程资源超过大小限制');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.maxBytes) throw appError('CATALOG_TOO_LARGE', '远程资源超过大小限制');
      if (expected?.sha256 && sha256Text(bytes) !== expected.sha256) throw appError('CATALOG_HASH_MISMATCH', '远程资源校验不一致');
      if (expected?.json) {
        const parsedBody = JSON.parse(bytes.toString('utf8'));
        return parsedBody;
      }
      return bytes;
    } catch (error) {
      if (error.code) throw error;
      throw appError('CATALOG_UNAVAILABLE', '远程目录不可用', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async _bundled() {
    if (this.cache) return this.cache;
    const file = path.join(this.root, 'manifest.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const manifest = validateCatalogManifest(raw);
    for (const item of manifest.items) {
      const canonical = sha256Json(item.payload);
      if (canonical !== item.sha256) throw appError('CATALOG_HASH_MISMATCH', `内置主题 ${item.name} 校验不一致`);
      const encoded = Buffer.byteLength(JSON.stringify(item.payload));
      if (encoded !== item.bytes) throw appError('CATALOG_TOO_LARGE', `内置主题 ${item.name} 大小记录不一致`);
    }
    this.cache = manifest;
    return manifest;
  }
}

function summary(item) {
  return {
    itemId: item.itemId,
    version: item.version,
    name: item.name,
    summary: item.summary,
    tags: item.tags,
    mode: item.mode,
    style: item.style,
    author: item.author,
    license: item.license,
    source: item.source,
    minAppVersion: item.minAppVersion,
    preview: item.preview,
    wallpaper: item.wallpaper,
    sha256: item.sha256
  };
}

function inside(root, relativePath) {
  const file = path.resolve(root, relativePath);
  const base = path.resolve(root);
  if (file !== base && !file.startsWith(base + path.sep)) throw appError('INVALID_ARGUMENT', '精选路径无效');
  return file;
}

module.exports = { CatalogService, publicError };
