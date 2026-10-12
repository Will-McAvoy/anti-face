/**
 * CSS 生成与核对共用的作用点。
 * 区域背景透明度是 color-mix 进背景色的 alpha，不是元素 opacity。
 * 8-bit 通道约 1/255；alpha 容差 0.02 只覆盖量化，盖不住 15 个百分点的偏差。
 */
const { REGION_MAP } = require('./regions.cjs');

const CHAT_CONTENT_SELECTOR = '.flex-1.flex.flex-col.min-w-0 > .flex-1.min-h-0';
const WALLPAPER_SELECTOR = 'body::before';
const MASK_SELECTOR = 'body::after';
const RGB_TOLERANCE = 2;
const ALPHA_TOLERANCE = 0.02;
const BLUR_TOLERANCE = 0.5;
const LENGTH_TOLERANCE = 0.5;

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return null;
  return {
    r: parseInt(match[1].slice(0, 2), 16),
    g: parseInt(match[1].slice(2, 4), 16),
    b: parseInt(match[1].slice(4, 6), 16)
  };
}

function expectedRegionBackground(panelHex, opacityPercent) {
  const rgb = hexToRgb(panelHex);
  if (!rgb || !Number.isFinite(Number(opacityPercent))) return null;
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: Number(opacityPercent) / 100 };
}

function regionDescriptors(resolved) {
  const list = [];
  for (const [id, spec] of Object.entries(REGION_MAP.regions)) {
    const region = resolved?.regions?.[id];
    if (!region) continue;
    list.push({
      id,
      label: spec.label,
      selector: spec.required[0],
      selectors: [...spec.required],
      opacity: region.opacity,
      blur: region.blur,
      radius: region.radius,
      background: expectedRegionBackground(resolved.colors?.panel, region.opacity)
    });
  }
  return list;
}

module.exports = {
  CHAT_CONTENT_SELECTOR,
  WALLPAPER_SELECTOR,
  MASK_SELECTOR,
  RGB_TOLERANCE,
  ALPHA_TOLERANCE,
  BLUR_TOLERANCE,
  LENGTH_TOLERANCE,
  hexToRgb,
  expectedRegionBackground,
  regionDescriptors
};
