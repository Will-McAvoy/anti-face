const { resolveDocument } = require('./theme-resolver.cjs');
const { REGION_MAP } = require('./regions.cjs');
const { CHAT_CONTENT_SELECTOR } = require('./style-contract.cjs');

const SHADOWS = {
  none: 'none',
  soft: '0 6px 18px color-mix(in srgb, #000000 18%, transparent)',
  medium: '0 12px 32px color-mix(in srgb, #000000 28%, transparent)'
};

function cssNumber(value) {
  if (!Number.isFinite(value)) throw new Error('样式数值无效');
  return String(value);
}

function safeUrl(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 8 * 1024 * 1024) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  return value;
}

function regionBlock(selector, prefix) {
  return `${selector} {
    background: color-mix(in srgb, var(--af-panel) var(--af-${prefix}-opacity), transparent) !important;
    backdrop-filter: blur(var(--af-${prefix}-blur)) !important;
    -webkit-backdrop-filter: blur(var(--af-${prefix}-blur)) !important;
    border-radius: var(--af-${prefix}-radius) !important;
    border-width: var(--af-${prefix}-border-width) !important;
    border-style: solid !important;
    border-color: color-mix(in srgb, var(--af-foreground) var(--af-${prefix}-border-strength), transparent) !important;
    box-shadow: var(--af-${prefix}-shadow) !important;
  }`;
}

function buildDocumentCSS(document, options = {}) {
  const resolved = options.resolved || resolveDocument(document);
  const { colors, regions, wallpaper, typography, base } = resolved;
  const availability = options.regions || null;
  const assetUrl = safeUrl(options.assetUrl || wallpaper.legacyDataUrl);
  const skipped = [];
  const vars = [];
  const pushRegionVars = (prefix, value) => {
    vars.push(`--af-${prefix}-opacity:${cssNumber(value.opacity)}%`);
    vars.push(`--af-${prefix}-blur:${cssNumber(value.blur)}px`);
    vars.push(`--af-${prefix}-radius:${cssNumber(value.radius)}px`);
    vars.push(`--af-${prefix}-border-width:${cssNumber(value.borderWidth)}px`);
    vars.push(`--af-${prefix}-border-strength:${cssNumber(value.borderStrength)}%`);
    vars.push(`--af-${prefix}-shadow:${SHADOWS[value.shadow] || SHADOWS.none}`);
  };
  pushRegionVars('global', regions.global);
  const blocks = [];
  for (const [id, spec] of Object.entries(REGION_MAP.regions)) {
    const found = !availability || spec.required.some(selector => availability[selector] === true || availability[id] === true);
    if (availability && !found) {
      skipped.push(id);
      continue;
    }
    pushRegionVars(id, regions[id]);
    blocks.push(regionBlock(spec.required.join(', '), id));
  }
  const panel = `color-mix(in srgb, ${colors.panel} ${regions.global.opacity}%, transparent)`;
  const border = colors.border || `color-mix(in srgb, ${colors.foreground} ${regions.global.borderStrength}%, transparent)`;
  const palette = {
    background: colors.background,
    foreground: colors.foreground,
    primary: colors.accent,
    'primary-foreground': colors.background,
    secondary: panel,
    'secondary-foreground': colors.foreground,
    muted: panel,
    'muted-foreground': colors.muted,
    sidebar: panel,
    card: panel,
    border,
    input: border,
    ring: colors.accent,
    popover: colors.panel,
    'popover-foreground': colors.foreground,
    link: colors.accent
  };
  const rootVars = Object.entries(palette).flatMap(([key, value]) => [`--${key}:${value} !important;`, `--color-${key}:${value} !important;`]).join('\n');
  const position = `${cssNumber(wallpaper.focusX)}% ${cssNumber(wallpaper.focusY)}%`;
  const size = wallpaper.fit === 'contain' ? 'contain' : 'cover';
  const scale = (wallpaper.scale / 100).toFixed(2);
  const filter = `blur(${cssNumber(wallpaper.blur)}px) brightness(${cssNumber(wallpaper.brightness)}%) saturate(${cssNumber(wallpaper.saturate)}%)`;
  const mask = assetUrl && wallpaper.maskStrength > 0
    ? `html body::after { content:""; position:fixed; inset:0; pointer-events:none; z-index:0; background:${wallpaper.maskColor}; opacity:${(wallpaper.maskStrength / 100).toFixed(2)}; }`
    : 'html body::after { content:none; }';
  const inset = wallpaper.blur > 0 ? (wallpaper.fit === 'contain' ? '0' : '-64px') : '0';
  const layer = assetUrl
    ? `html body::before { content:""; position:fixed; inset:${inset}; z-index:0; pointer-events:none; background-image:url("${assetUrl}"); background-color:${colors.background}; background-repeat:no-repeat; background-size:${size}; background-position:${position}; transform:scale(${scale}); filter:${filter}; }`
    : 'html body::before { content:none; }';
  const chat = CHAT_CONTENT_SELECTOR;
  const typeRules = [];
  const chatDecls = [];
  if (typography.chatFontSize != null) chatDecls.push(`font-size:${cssNumber(typography.chatFontSize)}px !important`);
  if (typography.lineHeight != null) chatDecls.push(`line-height:${cssNumber(typography.lineHeight)} !important`);
  if (typography.contentWidth != null) {
    chatDecls.push(`max-width:min(${cssNumber(typography.contentWidth)}px, 100%) !important`);
    chatDecls.push('margin-inline:auto !important');
    chatDecls.push('overflow-x:auto !important');
  }
  if (chatDecls.length) {
    typeRules.push(`${chat} { ${chatDecls.join(';')}; }`);
    typeRules.push(`[data-testid="agent-input-box"] { font-size:16px !important; line-height:normal !important; }`);
    typeRules.push(`[data-testid="install-editor"], [data-testid="install-editor"] * { font-size:initial !important; line-height:normal !important; }`);
  }
  const css = `/* Anti Face: temporary runtime theme */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:0.01ms !important; animation-iteration-count:1 !important; transition-duration:0.01ms !important; }
}
:root:root { ${rootVars}
${vars.map(item => `${item} !important;`).join('\n')}
--af-panel:${colors.panel}; --af-foreground:${colors.foreground}; color-scheme:${colors.mode} !important; }
html body { background:${base.gradient} !important; color:${colors.foreground} !important; }
${layer}
${mask}
#root, [data-testid="title-menu-bar"] { position:relative; z-index:1; }
#root { background:transparent !important; }
${blocks.join('\n')}
${typeRules.join('\n')}
${colors.selection ? `::selection { background:${colors.selection} !important; color:${colors.foreground} !important; }` : ''}
`;
  return { css, skipped, resolved, baseId: base.id };
}

module.exports = { buildDocumentCSS, safeUrl };
