const themes = require('../shared/themes.json');
const { DEFAULT_APPEARANCE } = require('./theme.cjs');
const { validateThemeDocument } = require('./theme-schema.cjs');
const { REGION_IDS } = require('./regions.cjs');

const GLOBAL_DEFAULTS = Object.freeze({
  opacity: DEFAULT_APPEARANCE.opacity,
  blur: DEFAULT_APPEARANCE.blur,
  radius: DEFAULT_APPEARANCE.radius,
  borderWidth: 1,
  borderStrength: 13,
  shadow: 'none'
});

function pick(override, inherited, fallback) {
  if (override != null && override !== 'inherit') return override;
  if (inherited != null && inherited !== 'inherit') return inherited;
  return fallback;
}

function resolveDocument(document, palette = themes) {
  const validated = validateThemeDocument(document);
  const base = palette.find(theme => theme.id === validated.baseThemeId);
  const colors = {
    accent: validated.colors.accent || base.accent,
    background: validated.colors.background || base.background,
    panel: validated.colors.panel || base.panel,
    foreground: validated.colors.foreground || base.foreground,
    muted: validated.colors.muted || base.muted,
    border: validated.colors.border || null,
    selection: validated.colors.selection || null,
    mode: base.mode,
    glass: base.glass,
    gradient: base.gradient,
    name: base.name
  };
  const global = validated.regions.global || {};
  const regions = {};
  for (const region of REGION_IDS) {
    const override = region === 'global' ? global : (validated.regions[region] || {});
    const inherited = region === 'global' ? {} : global;
    regions[region] = {
      opacity: pick(override.opacity, inherited.opacity, GLOBAL_DEFAULTS.opacity),
      blur: pick(override.blur, inherited.blur, GLOBAL_DEFAULTS.blur),
      radius: pick(override.radius, inherited.radius, GLOBAL_DEFAULTS.radius),
      borderWidth: pick(override.borderWidth, inherited.borderWidth, GLOBAL_DEFAULTS.borderWidth),
      borderStrength: pick(override.borderStrength, inherited.borderStrength, GLOBAL_DEFAULTS.borderStrength),
      shadow: pick(override.shadow, inherited.shadow, GLOBAL_DEFAULTS.shadow),
      explicit: region === 'global' ? !!validated.regions.global : !!validated.regions[region]
    };
  }
  return {
    document: validated,
    base,
    colors,
    regions,
    wallpaper: validated.wallpaper,
    typography: validated.typography,
    preset: validated.preset
  };
}

module.exports = { resolveDocument, GLOBAL_DEFAULTS };
