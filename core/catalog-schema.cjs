const { appError } = require('./errors.cjs');
const { plainObject } = require('./theme-schema.cjs');

const CATALOG_SCHEMA = 1;
const ITEM_LIMIT = 500;
const TAGS = new Set(['dark', 'light', 'glass', 'reading', 'low-distraction']);

function assertText(value, label, max) {
  if (typeof value !== 'string') throw appError('INVALID_ARGUMENT', `${label}无效`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /[\u0000-\u001f]/.test(trimmed)) throw appError('INVALID_ARGUMENT', `${label}无效`);
  return trimmed;
}

function validateCatalogItem(value) {
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '精选条目无效');
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw appError('INVALID_ARGUMENT', '精选条目无效');
  }
  const tags = Array.isArray(value.tags) ? value.tags.map(tag => assertText(tag, '标签', 32)) : [];
  if (!tags.length || tags.length > 8 || tags.some(tag => !TAGS.has(tag))) throw appError('INVALID_ARGUMENT', '精选标签无效');
  if (value.mode !== 'dark' && value.mode !== 'light') throw appError('INVALID_ARGUMENT', '精选明暗无效');
  if (!plainObject(value.payload)) throw appError('INVALID_ARGUMENT', '精选主题数据无效');
  const sha256 = typeof value.sha256 === 'string' ? value.sha256.toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw appError('CATALOG_HASH_MISMATCH', '精选主题缺少校验');
  return {
    itemId: assertText(value.itemId, '条目', 80),
    version: Number.isInteger(value.version) && value.version > 0 && value.version < 1000 ? value.version : (() => { throw appError('INVALID_ARGUMENT', '精选版本无效'); })(),
    name: assertText(value.name, '名称', 40),
    summary: assertText(value.summary, '简介', 160),
    tags,
    mode: value.mode,
    style: assertText(value.style, '风格', 40),
    author: assertText(value.author, '作者', 40),
    license: assertText(value.license, '许可', 40),
    source: assertText(value.source, '来源', 40),
    minAppVersion: assertText(value.minAppVersion, '应用版本', 20),
    preview: assertText(value.preview, '预览', 120),
    wallpaper: value.wallpaper == null ? null : assertText(value.wallpaper, '壁纸', 120),
    wallpaperSha256: value.wallpaperSha256 == null ? null : (typeof value.wallpaperSha256 === 'string' && /^[0-9a-f]{64}$/i.test(value.wallpaperSha256) ? value.wallpaperSha256.toLowerCase() : (() => { throw appError('CATALOG_HASH_MISMATCH', '壁纸校验无效'); })()),
    sha256,
    bytes: Number.isInteger(value.bytes) && value.bytes > 0 && value.bytes <= 8 * 1024 * 1024 ? value.bytes : (() => { throw appError('CATALOG_TOO_LARGE', '精选资源大小无效'); })(),
    payload: value.payload
  };
}

function validateCatalogManifest(value) {
  if (!plainObject(value) || value.schemaVersion !== CATALOG_SCHEMA) throw appError('UNSUPPORTED_SCHEMA', '精选目录版本不受支持');
  if (value.kind !== 'anti-face-catalog') throw appError('INVALID_ARGUMENT', '精选目录类型无效');
  if (!Array.isArray(value.items) || value.items.length > ITEM_LIMIT) throw appError('INVALID_ARGUMENT', '精选目录过大');
  const items = value.items.map(validateCatalogItem);
  const seen = new Set();
  for (const item of items) {
    const key = `${item.itemId}@${item.version}`;
    if (seen.has(key)) throw appError('INVALID_ARGUMENT', '精选目录有重复条目');
    seen.add(key);
  }
  return { schemaVersion: CATALOG_SCHEMA, kind: 'anti-face-catalog', items };
}

module.exports = { CATALOG_SCHEMA, ITEM_LIMIT, TAGS, validateCatalogItem, validateCatalogManifest };
