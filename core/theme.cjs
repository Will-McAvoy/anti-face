const themes = require('../shared/themes.json');
const DEFAULT_APPEARANCE = Object.freeze({ blur: 18, opacity: 88, radius: 14, wallpaper: null });
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PERFORMANCE_PRESETS = Object.freeze({
  performance: Object.freeze({ blur: 0, opacity: 90, radius: 8 }),
  balanced: Object.freeze({ blur: 12, opacity: 75, radius: 16 }),
  visual: Object.freeze({ blur: 24, opacity: 64, radius: 24 })
});

function imageData(buffer) {
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('请选择小于 5 MB 的图片');
  let mime;
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
  else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
  else if (buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP') mime = 'image/webp';
  else throw new Error('仅支持 PNG、JPEG 和 WebP 图片');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function validateAppearance(value) {
  if (!value || typeof value !== 'object') throw new Error('外观设置无效');
  const result = {};
  for (const [key, min, max] of [['blur',0,40],['opacity',40,100],['radius',0,28]]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`外观参数 ${key} 超出范围`);
    result[key] = Math.round(value[key]);
  }
  result.wallpaper = null;
  if (value.wallpaper !== null) {
    if (typeof value.wallpaper !== 'string' || value.wallpaper.length > MAX_IMAGE_BYTES * 1.4) throw new Error('壁纸数据过大或无效');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.wallpaper);
    if (!match || imageData(Buffer.from(match[2], 'base64')) !== value.wallpaper) throw new Error('壁纸数据格式无效');
    result.wallpaper = value.wallpaper;
  }
  return result;
}

function normalizeHistoryPreference(value) {
  if (!value || typeof value !== 'object') return null;
  const days = [7, 30, 90].includes(value.retentionDays) ? value.retentionDays : 30;
  return { enabled: value.enabled === true, retentionDays: days };
}

function validateSettings(value) {
  if (value?.schemaVersion !== 1) throw new Error('不支持的配置版本');
  if (!value || !themes.some(theme => theme.id === value.themeId)) throw new Error('主题不存在');
  const res = {
    schemaVersion: 1,
    themeId: value.themeId,
    appearance: validateAppearance(value.appearance)
  };
  if (value.preset && ['performance', 'balanced', 'visual'].includes(value.preset)) {
    res.preset = value.preset;
  }
  if (typeof value.autoRestoreOnReload === 'boolean') {
    res.autoRestoreOnReload = value.autoRestoreOnReload;
  }
  if (value.history && typeof value.history === 'object') {
    res.history = normalizeHistoryPreference(value.history);
  }
  return res;
}

/** 主题导入导出只携带外观，不携带自动恢复和历史采集这些应用偏好。 */
function exportableTheme(value) {
  const full = validateSettings(value);
  const theme = { schemaVersion: 1, themeId: full.themeId, appearance: full.appearance };
  if (full.preset) theme.preset = full.preset;
  return theme;
}

function buildCSS(value) {
  const settings = validateSettings(value);
  const t = themes.find(theme => theme.id === settings.themeId), a = settings.appearance;
  const panel = `color-mix(in srgb, ${t.panel} ${a.opacity}%, transparent)`;
  const border = `color-mix(in srgb, ${t.foreground} 13%, transparent)`;
  const values = {
    background: t.background, content: a.wallpaper || t.glass ? 'transparent' : t.background,
    foreground: t.foreground, primary: t.accent, 'primary-foreground': t.background,
    secondary: panel, 'secondary-foreground': t.foreground, muted: panel, 'muted-foreground': t.muted,
    sidebar: panel, 'sidebar-muted': panel, 'sidebar-secondary': panel,
    card: panel, 'card-border': border, border, input: border, ring: t.accent,
    popover: t.panel, 'popover-foreground': t.foreground, link: t.accent, placeholder: t.muted,
    'selection-background': `color-mix(in srgb, ${t.accent} 22%, transparent)`,
  };
  const vars = Object.entries(values).flatMap(([key,v]) => [`--${key}:${v} !important;`,`--color-${key}:${v} !important;`]).join('\n');
  const vscode = { 'editor-background':t.background, 'editor-foreground':t.foreground, 'sideBar-background':t.panel, 'sideBar-foreground':t.foreground, 'panel-background':t.panel, 'input-background':t.panel, 'input-foreground':t.foreground, 'focusBorder':t.accent, 'button-background':t.accent, 'button-foreground':t.background, 'foreground':t.foreground, 'descriptionForeground':t.muted };

  return `/* Anti Face: temporary runtime theme */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
:root:root { ${vars}\n${Object.entries(vscode).map(([k,v]) => `--vscode-${k}:${v} !important;`).join('\n')} color-scheme:${t.mode} !important; }
html body { background: ${a.wallpaper ? `url("${a.wallpaper}") center / cover fixed` : t.gradient} !important; color:${t.foreground} !important; }
#root { background:transparent !important; }
.h-screen.w-screen.bg-background { background:${a.wallpaper || t.glass ? 'transparent' : t.background} !important; }
.bg-sidebar, .bg-card { backdrop-filter:blur(${a.blur}px) !important; }
.bg-card, [data-testid="new-conversation-button"] { border-radius:${a.radius}px !important; }
`;
}

module.exports = {
  themes,
  DEFAULT_APPEARANCE,
  PERFORMANCE_PRESETS,
  imageData,
  validateAppearance,
  validateSettings,
  exportableTheme,
  normalizeHistoryPreference,
  buildCSS
};
