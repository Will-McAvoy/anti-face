const ranges = require('../shared/appearance-ranges.json');
const themes = require('../shared/themes.json');
const { appError } = require('./errors.cjs');
const { REGION_IDS } = require('./regions.cjs');
const { PERFORMANCE_PRESETS, DEFAULT_APPEARANCE } = require('./theme.cjs');

const THEME_SCHEMA = 2;
const LIBRARY_SCHEMA = 1;
const PREFERENCES_SCHEMA = 1;
const SETTINGS_SCHEMA = 1;
const SHADOWS = new Set(['none', 'soft', 'medium']);
const FITS = new Set(['cover', 'contain']);
const PRESET_NAMES = new Set(['performance', 'balanced', 'visual', 'custom']);
const READABILITY_MODES = new Set(['off', 'suggest', 'auto']);
const SCENE_MODES = new Set(['off', 'auto', 'home', 'chat']);
const COMPOSITION_POLICIES = new Set(['manual', 'protect-subject', 'protect-text', 'balanced']);
const LOCK_FIELDS = new Set([
  'colors.foreground', 'colors.background', 'colors.panel', 'colors.accent', 'colors.muted',
  'colors.border', 'colors.selection', 'wallpaper.maskStrength', 'wallpaper.maskColor',
  'regions.global.opacity', 'regions.sidebar.opacity', 'regions.chat.opacity',
  'regions.composer.opacity', 'regions.card.opacity'
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function rejectDangerousKey(key) {
  if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
    throw appError('INVALID_ARGUMENT', '配置包含不允许的字段');
  }
}

function inRange(value, min, max, label, { integer = false, precision = null } = {}) {
  if (typeof value === 'string' && /url\(|var\(|expression\(|;|\}|\{/.test(value)) {
    throw appError('INVALID_ARGUMENT', `${label}不能包含样式文本`);
  }
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number < min || number > max) {
    throw appError('INVALID_ARGUMENT', `${label}超出范围`);
  }
  let next = integer ? Math.round(number) : number;
  if (precision != null) {
    const factor = 10 ** precision;
    next = Math.round(next * factor) / factor;
  }
  if (next < min || next > max) throw appError('INVALID_ARGUMENT', `${label}超出范围`);
  return next;
}

function optionalNumber(value, min, max, label, options) {
  if (value == null || value === 'inherit') return null;
  return inRange(value, min, max, label, options);
}

function parseColor(value, label = '颜色') {
  if (value == null || value === 'inherit') return null;
  if (typeof value === 'string') {
    if (/url\(|var\(|;|\}|\{|expression\(/i.test(value)) {
      throw appError('INVALID_ARGUMENT', `${label}不能包含样式或地址`);
    }
    const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) throw appError('INVALID_ARGUMENT', `${label}只接受 #RRGGBB`);
    return `#${match[1].toLowerCase()}`;
  }
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', `${label}无效`);
  const channels = ['r', 'g', 'b'].map(key => {
    rejectDangerousKey(key);
    if (!Number.isInteger(value[key]) || value[key] < 0 || value[key] > 255) {
      throw appError('INVALID_ARGUMENT', `${label}通道无效`);
    }
    return value[key];
  });
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
}

function defaultComposition() {
  return { subjectRect: null, textSafeRect: null, policy: 'manual' };
}

function defaultReadability() {
  return { mode: 'off', targetContrast: 4.5, locks: [] };
}

function defaultSceneOverrides() {
  return { maskStrength: null, opacity: null };
}

function defaultSceneAppearance() {
  return { mode: 'off', home: defaultSceneOverrides(), chat: defaultSceneOverrides() };
}

function defaultWallpaper() {
  return {
    assetId: null,
    legacyDataUrl: null,
    fit: 'cover',
    focusX: 50,
    focusY: 50,
    scale: 100,
    blur: 0,
    brightness: 100,
    saturate: 100,
    maskColor: '#000000',
    maskStrength: 0,
    composition: defaultComposition()
  };
}

function defaultTypography() {
  return { chatFontSize: null, lineHeight: null, contentWidth: null };
}

function validateRegion(value, label) {
  if (value == null || value === 'inherit') return null;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', `${label}无效`);
  const result = {};
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  if ('opacity' in value) result.opacity = optionalNumber(value.opacity, ranges.opacity[0], ranges.opacity[1], `${label}透明度`, { integer: true });
  if ('blur' in value) result.blur = optionalNumber(value.blur, ranges.blur[0], ranges.blur[1], `${label}模糊`, { integer: true });
  if ('radius' in value) result.radius = optionalNumber(value.radius, ranges.radius[0], ranges.radius[1], `${label}圆角`, { integer: true });
  if ('borderWidth' in value) result.borderWidth = optionalNumber(value.borderWidth, ranges.borderWidth[0], ranges.borderWidth[1], `${label}边框`, { integer: true });
  if ('borderStrength' in value) result.borderStrength = optionalNumber(value.borderStrength, ranges.borderStrength[0], ranges.borderStrength[1], `${label}边框强度`, { integer: true });
  if ('shadow' in value && value.shadow != null && value.shadow !== 'inherit') {
    if (!SHADOWS.has(value.shadow)) throw appError('INVALID_ARGUMENT', `${label}阴影无效`);
    result.shadow = value.shadow;
  }
  for (const key of Object.keys(result)) if (result[key] == null) delete result[key];
  return Object.keys(result).length ? result : null;
}

function validateNormalizedRect(value, label) {
  if (value == null) return null;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', `${label}无效`);
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw appError('INVALID_ARGUMENT', `${label}不完整`);
  }
  const x = inRange(value.x, 0, 1, `${label}横坐标`, { precision: 4 });
  const y = inRange(value.y, 0, 1, `${label}纵坐标`, { precision: 4 });
  const width = inRange(value.width, 0.01, 1, `${label}宽度`, { precision: 4 });
  const height = inRange(value.height, 0.01, 1, `${label}高度`, { precision: 4 });
  if (x + width > 1.0001 || y + height > 1.0001) throw appError('INVALID_ARGUMENT', `${label}超出图片范围`);
  return { x, y, width, height };
}

function validateComposition(value) {
  const base = defaultComposition();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '构图参数无效');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  base.subjectRect = validateNormalizedRect(value.subjectRect, '主体保护区');
  base.textSafeRect = validateNormalizedRect(value.textSafeRect, '正文留白区');
  if (value.policy != null && !COMPOSITION_POLICIES.has(value.policy)) throw appError('INVALID_ARGUMENT', '构图策略无效');
  if (value.policy) base.policy = value.policy;
  return base;
}

function validateReadability(value) {
  const base = defaultReadability();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '阅读保护无效');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  if (value.mode != null && !READABILITY_MODES.has(value.mode)) throw appError('INVALID_ARGUMENT', '阅读保护模式无效');
  if (value.mode) base.mode = value.mode;
  if (value.targetContrast != null) {
    base.targetContrast = inRange(value.targetContrast, 3, 7, '对比度目标', { precision: 2 });
  }
  if (value.locks != null) {
    if (!Array.isArray(value.locks) || value.locks.length > LOCK_FIELDS.size) throw appError('INVALID_ARGUMENT', '锁定字段无效');
    const locks = [];
    for (const item of value.locks) {
      if (typeof item !== 'string' || !LOCK_FIELDS.has(item) || locks.includes(item)) {
        throw appError('INVALID_ARGUMENT', '锁定字段无效');
      }
      locks.push(item);
    }
    base.locks = locks;
  }
  return base;
}

function validateSceneOverrides(value, label) {
  const base = defaultSceneOverrides();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', `${label}无效`);
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  if (value.maskStrength != null) base.maskStrength = inRange(value.maskStrength, ranges.maskStrength[0], ranges.maskStrength[1], `${label}遮罩`, { integer: true });
  if (value.opacity != null) base.opacity = inRange(value.opacity, ranges.opacity[0], ranges.opacity[1], `${label}透明度`, { integer: true });
  return base;
}

function validateSceneAppearance(value) {
  const base = defaultSceneAppearance();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '场景外观无效');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  if (value.mode != null && !SCENE_MODES.has(value.mode)) throw appError('INVALID_ARGUMENT', '场景模式无效');
  if (value.mode) base.mode = value.mode;
  base.home = validateSceneOverrides(value.home, '首页氛围');
  base.chat = validateSceneOverrides(value.chat, '聊天专注');
  return base;
}

function migrateThemeDocumentV1ToV2(value) {
  if (!plainObject(value) || value.schemaVersion !== 1) throw appError('UNSUPPORTED_SCHEMA', '只能迁移第 1 版主题文档');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  const wallpaper = plainObject(value.wallpaper) ? { ...value.wallpaper } : value.wallpaper;
  if (plainObject(wallpaper) && wallpaper.composition == null) wallpaper.composition = defaultComposition();
  return {
    ...value,
    schemaVersion: 2,
    readability: value.readability == null ? defaultReadability() : value.readability,
    sceneAppearance: value.sceneAppearance == null ? defaultSceneAppearance() : value.sceneAppearance,
    wallpaper
  };
}

function validateWallpaper(value) {
  const base = defaultWallpaper();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '壁纸参数无效');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  if (value.assetId != null) {
    if (typeof value.assetId !== 'string' || !UUID_RE.test(value.assetId)) throw appError('INVALID_ARGUMENT', '壁纸资源无效');
    base.assetId = value.assetId;
  }
  if (value.legacyDataUrl != null) {
    if (typeof value.legacyDataUrl !== 'string' || value.legacyDataUrl.length > ranges.maxImageBytes * 1.4) {
      throw appError('ASSET_INVALID', '壁纸数据过大或无效');
    }
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.legacyDataUrl)) {
      throw appError('ASSET_INVALID', '壁纸数据格式无效');
    }
    base.legacyDataUrl = value.legacyDataUrl;
  }
  if (value.fit != null && !FITS.has(value.fit)) throw appError('INVALID_ARGUMENT', '壁纸填充方式无效');
  if (value.fit) base.fit = value.fit;
  base.focusX = value.focusX == null ? base.focusX : inRange(value.focusX, ranges.focus[0], ranges.focus[1], '水平焦点', { integer: true });
  base.focusY = value.focusY == null ? base.focusY : inRange(value.focusY, ranges.focus[0], ranges.focus[1], '垂直焦点', { integer: true });
  base.scale = value.scale == null ? base.scale : inRange(value.scale, ranges.scale[0], ranges.scale[1], '壁纸缩放', { integer: true });
  base.blur = value.blur == null ? base.blur : inRange(value.blur, ranges.wallpaperBlur[0], ranges.wallpaperBlur[1], '壁纸模糊', { integer: true });
  base.brightness = value.brightness == null ? base.brightness : inRange(value.brightness, ranges.brightness[0], ranges.brightness[1], '亮度', { integer: true });
  base.saturate = value.saturate == null ? base.saturate : inRange(value.saturate, ranges.saturate[0], ranges.saturate[1], '饱和度', { integer: true });
  base.maskColor = value.maskColor == null ? base.maskColor : (parseColor(value.maskColor, '遮罩颜色') || base.maskColor);
  base.maskStrength = value.maskStrength == null ? base.maskStrength : inRange(value.maskStrength, ranges.maskStrength[0], ranges.maskStrength[1], '遮罩强度', { integer: true });
  base.composition = validateComposition(value.composition);
  return base;
}

function validateTypography(value) {
  const base = defaultTypography();
  if (value == null) return base;
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '排版无效');
  for (const key of Object.keys(value)) rejectDangerousKey(key);
  base.chatFontSize = optionalNumber(value.chatFontSize, ranges.chatFontSize[0], ranges.chatFontSize[1], '聊天字号', { integer: true });
  base.lineHeight = optionalNumber(value.lineHeight, ranges.lineHeight[0], ranges.lineHeight[1], '行距', { precision: 2 });
  base.contentWidth = optionalNumber(value.contentWidth, ranges.contentWidth[0], ranges.contentWidth[1], '内容宽度', { integer: true });
  return base;
}

function validateColors(value) {
  if (value == null) return {};
  if (!plainObject(value)) throw appError('INVALID_ARGUMENT', '颜色无效');
  const result = {};
  for (const key of ['accent', 'background', 'panel', 'foreground', 'muted', 'border', 'selection']) {
    if (key in value) {
      const color = parseColor(value[key], key);
      if (color) result[key] = color;
    }
  }
  return result;
}

function assertThemeName(name) {
  if (typeof name !== 'string') throw appError('INVALID_ARGUMENT', '主题名称无效');
  const trimmed = name.trim();
  if (trimmed.length < ranges.nameLength[0] || trimmed.length > ranges.nameLength[1]) {
    throw appError('INVALID_ARGUMENT', '主题名称需要 1 到 40 个字符');
  }
  if (/[\u0000-\u001f]/.test(trimmed)) throw appError('INVALID_ARGUMENT', '主题名称无效');
  return trimmed;
}

function knownTheme(id) {
  return themes.some(theme => theme.id === id);
}

function validateThemeDocument(value) {
  if (!plainObject(value) || !Number.isInteger(value.schemaVersion)) {
    throw appError('UNSUPPORTED_SCHEMA', '主题文档版本不受支持');
  }
  if (value.schemaVersion > THEME_SCHEMA) throw appError('UNSUPPORTED_SCHEMA', '主题文档版本过新，已保留原文件');
  const source = value.schemaVersion === 1 ? migrateThemeDocumentV1ToV2(value) : value;
  if (source.schemaVersion !== THEME_SCHEMA) throw appError('UNSUPPORTED_SCHEMA', '主题文档版本不受支持');
  for (const key of Object.keys(source)) rejectDangerousKey(key);
  value = source;
  if (!knownTheme(value.baseThemeId)) throw appError('INVALID_ARGUMENT', '基础主题不存在');
  const id = value.id == null ? 'draft' : String(value.id);
  if (id !== 'draft' && !UUID_RE.test(id) && !knownTheme(id)) throw appError('INVALID_ARGUMENT', '主题标识无效');
  const regions = {};
  const incomingRegions = plainObject(value.regions) ? value.regions : {};
  for (const region of REGION_IDS) regions[region] = validateRegion(incomingRegions[region], region);
  const document = {
    schemaVersion: THEME_SCHEMA,
    id,
    name: assertThemeName(value.name || themes.find(theme => theme.id === value.baseThemeId).name),
    baseThemeId: value.baseThemeId,
    colors: validateColors(value.colors),
    regions,
    wallpaper: validateWallpaper(value.wallpaper),
    typography: validateTypography(value.typography),
    readability: validateReadability(value.readability),
    sceneAppearance: validateSceneAppearance(value.sceneAppearance),
    preset: value.preset == null ? 'custom' : value.preset
  };
  if (!PRESET_NAMES.has(document.preset)) throw appError('INVALID_ARGUMENT', '性能预设无效');
  return document;
}

function matchPreset(appearance) {
  for (const [name, preset] of Object.entries(PERFORMANCE_PRESETS)) {
    if (appearance.blur === preset.blur && appearance.opacity === preset.opacity && appearance.radius === preset.radius) return name;
  }
  return 'custom';
}

function documentFromLegacy(settings) {
  const appearance = settings.appearance || DEFAULT_APPEARANCE;
  const base = themes.find(theme => theme.id === settings.themeId) || themes[0];
  return validateThemeDocument({
    schemaVersion: THEME_SCHEMA,
    id: 'draft',
    name: base.name,
    baseThemeId: base.id,
    colors: {},
    regions: {
      global: { opacity: appearance.opacity, blur: appearance.blur, radius: appearance.radius }
    },
    wallpaper: appearance.wallpaper ? { legacyDataUrl: appearance.wallpaper } : null,
    typography: null,
    preset: settings.preset || matchPreset(appearance)
  });
}

function legacyAppearanceFromDocument(document) {
  const validated = validateThemeDocument(document);
  const global = validated.regions.global || {};
  return {
    blur: global.blur != null ? global.blur : DEFAULT_APPEARANCE.blur,
    opacity: global.opacity != null ? global.opacity : DEFAULT_APPEARANCE.opacity,
    radius: global.radius != null ? global.radius : DEFAULT_APPEARANCE.radius,
    wallpaper: validated.wallpaper.legacyDataUrl
  };
}

function migrateV1Settings(raw) {
  if (!plainObject(raw) || raw.schemaVersion !== SETTINGS_SCHEMA) {
    throw appError('UNSUPPORTED_SCHEMA', '只能迁移第 1 版配置');
  }
  const { validateSettings } = require('./theme.cjs');
  const settings = validateSettings(raw);
  return {
    fromVersion: 1,
    settings,
    document: documentFromLegacy(settings),
    preferences: {
      autoRestoreOnReload: Object.prototype.hasOwnProperty.call(raw, 'autoRestoreOnReload')
        ? raw.autoRestoreOnReload === true
        : undefined,
      history: settings.history ? { enabled: settings.history.enabled === true, retentionDays: settings.history.retentionDays } : undefined
    }
  };
}

function resetRegion(document, region) {
  const validated = validateThemeDocument(document);
  if (!REGION_IDS.includes(region) || region === 'global') {
    if (region !== 'global') throw appError('INVALID_ARGUMENT', '未知区域');
  }
  return validateThemeDocument({
    ...validated,
    regions: { ...validated.regions, [region]: null }
  });
}

function resetAppearance(document, options = {}) {
  const validated = validateThemeDocument(document);
  const includeWallpaper = options.includeWallpaper !== false;
  const includeTypography = options.includeTypography !== false;
  return validateThemeDocument({
    ...validated,
    colors: {},
    regions: {},
    wallpaper: includeWallpaper ? null : validated.wallpaper,
    typography: includeTypography ? null : validated.typography,
    preset: 'custom'
  });
}

function applyPreset(document, preset) {
  if (!PERFORMANCE_PRESETS[preset]) throw appError('INVALID_ARGUMENT', '性能预设无效');
  const validated = validateThemeDocument(document);
  const values = PERFORMANCE_PRESETS[preset];
  return validateThemeDocument({
    ...validated,
    preset,
    regions: {
      ...validated.regions,
      global: { ...(validated.regions.global || {}), blur: values.blur, opacity: values.opacity, radius: values.radius }
    }
  });
}

function markCustomIfDiverged(document) {
  const validated = validateThemeDocument(document);
  const global = validated.regions.global || {};
  const appearance = {
    blur: global.blur != null ? global.blur : DEFAULT_APPEARANCE.blur,
    opacity: global.opacity != null ? global.opacity : DEFAULT_APPEARANCE.opacity,
    radius: global.radius != null ? global.radius : DEFAULT_APPEARANCE.radius
  };
  const matched = matchPreset(appearance);
  if (validated.preset !== 'custom' && validated.preset !== matched) {
    return validateThemeDocument({ ...validated, preset: 'custom' });
  }
  return validated;
}

function assertSupportedVersion(value, supported, label) {
  if (!plainObject(value) || !Number.isInteger(value.schemaVersion)) {
    throw appError('UNSUPPORTED_SCHEMA', `${label}缺少版本`);
  }
  if (value.schemaVersion > supported) {
    throw appError('UNSUPPORTED_SCHEMA', `${label}版本过新，已保留原文件`);
  }
  if (value.schemaVersion < 1) throw appError('UNSUPPORTED_SCHEMA', `${label}版本不受支持`);
}

function assertPayloadSize(value, max = ranges.maxImportBytes) {
  let encoded;
  try {
    encoded = JSON.stringify(value ?? null);
  } catch {
    throw appError('INVALID_ARGUMENT', '请求无法编码');
  }
  if (Buffer.byteLength(encoded) > max) throw appError('INVALID_ARGUMENT', '请求过大');
}

function assertTargetId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw appError('INVALID_ARGUMENT', '窗口目标无效');
  }
  return value;
}

module.exports = {
  ranges,
  THEME_SCHEMA,
  LIBRARY_SCHEMA,
  PREFERENCES_SCHEMA,
  SETTINGS_SCHEMA,
  UUID_RE,
  plainObject,
  parseColor,
  defaultWallpaper,
  defaultTypography,
  defaultReadability,
  defaultSceneAppearance,
  defaultComposition,
  migrateThemeDocumentV1ToV2,
  validateThemeDocument,
  LOCK_FIELDS,
  documentFromLegacy,
  legacyAppearanceFromDocument,
  migrateV1Settings,
  resetRegion,
  resetAppearance,
  applyPreset,
  markCustomIfDiverged,
  matchPreset,
  assertThemeName,
  assertSupportedVersion,
  assertPayloadSize,
  assertTargetId,
  knownTheme
};
