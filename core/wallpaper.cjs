const ranges = require('../shared/appearance-ranges.json');
const { encodePng } = require('./image-decode.cjs');

function wallpaperBox(imageWidth, imageHeight, viewWidth, viewHeight, fit, scale) {
  const safeScale = Math.min(ranges.scale[1], Math.max(ranges.scale[0], scale || 100)) / 100;
  const cover = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  const contain = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  const factor = (fit === 'contain' ? contain : cover) * safeScale;
  return { width: imageWidth * factor, height: imageHeight * factor, factor };
}

/**
 * CSS background-position 百分比：图片上的 focus 点对齐容器上的同一百分比。
 * 返回的是背景左上角相对容器左上角的偏移，窗口变了会按同一焦点重算。
 */
function wallpaperOffset(box, viewWidth, viewHeight, focusX, focusY) {
  const x = (viewWidth - box.width) * (focusX / 100);
  const y = (viewHeight - box.height) * (focusY / 100);
  return { x, y };
}

function focalPointOnView(box, offset, focusX, focusY) {
  return {
    x: offset.x + box.width * (focusX / 100),
    y: offset.y + box.height * (focusY / 100)
  };
}

function resizeNearest(data, width, height, maxEdge) {
  const longest = Math.max(width, height);
  const scale = longest <= maxEdge ? 1 : maxEdge / longest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x / scale));
      const from = (sourceY * width + sourceX) * 4;
      const to = (y * targetWidth + x) * 4;
      output[to] = data[from];
      output[to + 1] = data[from + 1];
      output[to + 2] = data[from + 2];
      output[to + 3] = data[from + 3];
    }
  }
  return { width: targetWidth, height: targetHeight, data: output };
}

function thumbnailPng(decoded, maxEdge = ranges.thumbnailEdge) {
  const resized = resizeNearest(decoded.data, decoded.width, decoded.height, maxEdge);
  return { ...resized, png: encodePng(resized.width, resized.height, resized.data) };
}

function channelLuminance(red, green, blue) {
  const pivot = value => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * pivot(red) + 0.7152 * pivot(green) + 0.0722 * pivot(blue);
}

function contrastRatio(a, b) {
  const left = channelLuminance(a.r, a.g, a.b);
  const right = channelLuminance(b.r, b.g, b.b);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}

function extractPalette(decoded, count = 5) {
  const buckets = new Map();
  const data = decoded.data;
  const step = Math.max(1, Math.floor((decoded.width * decoded.height) / 4000));
  for (let pixel = 0; pixel < decoded.width * decoded.height; pixel += step) {
    const index = pixel * 4;
    if (data[index + 3] < 128) continue;
    const red = data[index] >> 4;
    const green = data[index + 1] >> 4;
    const blue = data[index + 2] >> 4;
    const key = `${red},${green},${blue}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen = [];
  for (const [key, weight] of ranked) {
    const [red, green, blue] = key.split(',').map(part => parseInt(part, 10) * 17);
    const hex = `#${[red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
    const distinct = chosen.every(item => {
      const other = hexToRgb(item.hex);
      const distance = (other.r - red) ** 2 + (other.g - green) ** 2 + (other.b - blue) ** 2;
      return distance > 40 * 40;
    });
    if (!distinct && chosen.length) continue;
    chosen.push({ hex, weight });
    if (chosen.length >= Math.min(5, Math.max(3, count))) break;
  }
  return chosen;
}

function contrastHint(foreground, background, { photographic = false } = {}) {
  const ratio = contrastRatio(hexToRgb(foreground), hexToRgb(background));
  return {
    ratio: Math.round(ratio * 100) / 100,
    estimate: photographic,
    note: photographic
      ? '这是壁纸采样的估计，不能代表整页对比度。'
      : '这是纯色背景的相对对比度。'
  };
}

module.exports = {
  wallpaperBox,
  wallpaperOffset,
  focalPointOnView,
  resizeNearest,
  thumbnailPng,
  extractPalette,
  contrastHint,
  contrastRatio
};
