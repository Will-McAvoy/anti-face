const { appError } = require('./errors.cjs');

const MAX_TAGS_PER_THEME = 12;
const MAX_TAG_LENGTH = 24; // codepoints
const MAX_TOTAL_TAGS_LENGTH = 200;

function normalizeTag(raw) {
  if (typeof raw !== 'string') return '';
  // Unicode NFC normalization and trim
  const trimmed = raw.normalize('NFC').trim();
  // Filter out control characters
  const clean = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  const codepoints = [...clean];
  if (codepoints.length === 0) return '';
  if (codepoints.length > MAX_TAG_LENGTH) {
    throw appError('INVALID_ARGUMENT', `单个标签长度不能超过 ${MAX_TAG_LENGTH} 个字符`);
  }
  return clean;
}

function normalizeTags(rawList) {
  if (!rawList) return [];
  if (!Array.isArray(rawList)) {
    throw appError('INVALID_ARGUMENT', '标签必须是数组');
  }
  const result = [];
  const seenLower = new Set();
  let totalLen = 0;

  for (const item of rawList) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (seenLower.has(lower)) continue;
    seenLower.add(lower);
    totalLen += [...tag].length;
    if (totalLen > MAX_TOTAL_TAGS_LENGTH) {
      throw appError('INVALID_ARGUMENT', `所有标签总长度不能超过 ${MAX_TOTAL_TAGS_LENGTH} 字符`);
    }
    result.push(tag);
    if (result.length >= MAX_TAGS_PER_THEME) break;
  }

  return result;
}

function validateThemeMetadata(meta = {}) {
  const tags = normalizeTags(meta.tags || []);
  return {
    ...meta,
    tags
  };
}

function relativeLuminance(hex) {
  if (!hex || typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return 0.1;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function deriveColorScheme(document) {
  const bg = document?.colors?.background || '#151817';
  const lum = relativeLuminance(bg);
  return lum >= 0.4 ? 'light' : 'dark';
}

function matchesThemeFilters(entry, filters = {}) {
  if (!entry) return false;

  // 1. 收藏过滤
  if (filters.favoritesOnly && !entry.favorite) {
    return false;
  }

  // 2. 无标签专属过滤
  const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
  if (filters.untaggedOnly) {
    if (entryTags.length > 0) return false;
  }

  // 3. 标签匹配
  const queryTags = Array.isArray(filters.tags) ? filters.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (queryTags.length > 0 && !filters.untaggedOnly) {
    const entryTagsLower = new Set(entryTags.map(t => t.toLowerCase()));
    const mode = (filters.tagMode || 'AND').toUpperCase();
    if (mode === 'OR') {
      const hasAny = queryTags.some(t => entryTagsLower.has(t));
      if (!hasAny) return false;
    } else {
      // AND 模式：必须包含所有选中的标签
      const hasAll = queryTags.every(t => entryTagsLower.has(t));
      if (!hasAll) return false;
    }
  }

  // 4. 深浅色（从背景亮度派生）
  if (filters.colorScheme) {
    const derived = deriveColorScheme(entry.document);
    if (derived !== filters.colorScheme) return false;
  }

  // 5. 有无壁纸
  if (filters.hasWallpaper !== null && filters.hasWallpaper !== undefined) {
    const hasWp = !!(entry.document?.wallpaper?.assetId || entry.document?.wallpaper?.legacyDataUrl);
    if (hasWp !== !!filters.hasWallpaper) return false;
  }

  // 6. 搜索文本 (名称、ID、以及标签)
  const needle = String(filters.query || filters.search || '').trim().toLowerCase();
  if (needle) {
    const nameMatch = (entry.name || '').toLowerCase().includes(needle);
    const idMatch = (entry.id || '').toLowerCase().includes(needle);
    const tagMatch = entryTags.some(t => t.toLowerCase().includes(needle));
    if (!nameMatch && !idMatch && !tagMatch) return false;
  }

  return true;
}

function getTagCounts(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    for (const tag of tags) {
      const lower = tag.toLowerCase();
      const existing = map.get(lower);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(lower, { tag, count: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'));
}

module.exports = {
  MAX_TAGS_PER_THEME,
  MAX_TAG_LENGTH,
  MAX_TOTAL_TAGS_LENGTH,
  normalizeTag,
  normalizeTags,
  validateThemeMetadata,
  relativeLuminance,
  deriveColorScheme,
  matchesThemeFilters,
  getTagCounts
};
