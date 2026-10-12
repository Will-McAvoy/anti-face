const { stableStringify } = require('./stable-json.cjs');
const { sha256Json } = require('./digest.cjs');

const REGION_IDS = ['global', 'sidebar', 'chat', 'composer', 'card'];
const COLOR_ROLES = ['accent', 'background', 'panel', 'foreground', 'muted', 'border', 'selection'];

function getPath(source, path) {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let cursor = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

function flatten(value, prefix = '', output = []) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort()) flatten(value[key], prefix ? `${prefix}.${key}` : key, output);
    return output;
  }
  output.push([prefix, value]);
  return output;
}

function diffDocuments(left, right) {
  const leftFlat = new Map(flatten(left));
  const rightFlat = new Map(flatten(right));
  const keys = [...new Set([...leftFlat.keys(), ...rightFlat.keys()])].sort();
  const changes = [];
  for (const key of keys) {
    const before = leftFlat.has(key) ? leftFlat.get(key) : undefined;
    const after = rightFlat.has(key) ? rightFlat.get(key) : undefined;
    if (stableStringify(before === undefined ? null : before) !== stableStringify(after === undefined ? null : after)) {
      changes.push({ path: key, before: before === undefined ? null : before, after: after === undefined ? null : after });
    }
  }
  return changes;
}

function selectionPaths(selection) {
  const paths = [];
  const groups = new Set(selection?.groups || []);
  const regions = new Set(selection?.regions || []);
  if (groups.has('colors')) COLOR_ROLES.forEach(role => paths.push(`colors.${role}`));
  if (groups.has('typography')) ['chatFontSize', 'lineHeight', 'contentWidth'].forEach(key => paths.push(`typography.${key}`));
  if (groups.has('wallpaper')) {
    ['assetId', 'legacyDataUrl', 'fit', 'focusX', 'focusY', 'scale', 'blur', 'brightness', 'saturate', 'maskColor', 'maskStrength'].forEach(key => paths.push(`wallpaper.${key}`));
    paths.push('wallpaper.composition');
  }
  for (const region of REGION_IDS) {
    if (regions.has(region) || groups.has(region)) paths.push(`regions.${region}`);
  }
  return paths;
}

function partialRestore(current, source, selection) {
  const next = JSON.parse(JSON.stringify(current));
  const paths = selectionPaths(selection);
  if (!paths.length) {
    const error = new Error('没有选择可恢复的字段');
    error.code = 'INVALID_ARGUMENT';
    throw error;
  }
  for (const path of paths) {
    if (path === 'wallpaper.composition') {
      next.wallpaper = { ...next.wallpaper, composition: source.wallpaper?.composition ? JSON.parse(JSON.stringify(source.wallpaper.composition)) : { subjectRect: null, textSafeRect: null, policy: 'manual' } };
      continue;
    }
    const value = getPath(source, path);
    setPath(next, path, value === undefined ? null : JSON.parse(JSON.stringify(value)));
  }
  return next;
}

function documentHash(document) {
  return sha256Json(document);
}

module.exports = { diffDocuments, partialRestore, selectionPaths, documentHash, REGION_IDS, COLOR_ROLES };
