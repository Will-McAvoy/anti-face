const { linearizeChannel, contrastRgb, hexToRgb, rgbToHex } = require('./readability.cjs');

const ROLES = ['background', 'panel', 'foreground', 'muted', 'accent', 'border', 'selection'];

function rgbToOklab(red, green, blue) {
  const r = linearizeChannel(red / 255);
  const g = linearizeChannel(green / 255);
  const b = linearizeChannel(blue / 255);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lr = Math.cbrt(l);
  const mr = Math.cbrt(m);
  const sr = Math.cbrt(s);
  return {
    L: 0.2104542553 * lr + 0.7936177850 * mr - 0.0040720468 * sr,
    a: 1.9779984951 * lr - 2.4285922050 * mr + 0.4505937099 * sr,
    b: 0.0259040371 * lr + 0.7827717662 * mr - 0.8086757660 * sr
  };
}

function downsample(image, edge) {
  const longest = Math.max(image.width, image.height);
  const scale = longest <= edge ? 1 : edge / longest;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = image.data[from + 3];
    }
  }
  return { width, height, data };
}

function collectPixels(image) {
  const pixels = [];
  const total = image.width * image.height;
  const step = Math.max(1, Math.floor(total / 6000));
  for (let index = 0; index < total; index += step) {
    const offset = index * 4;
    if (image.data[offset + 3] < 128) continue;
    const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
    const lab = rgbToOklab(rgb[0], rgb[1], rgb[2]);
    pixels.push({ rgb, lab, chroma: Math.hypot(lab.a, lab.b) });
  }
  return pixels;
}

function cluster(pixels) {
  if (!pixels.length) return [];
  const sorted = [...pixels].sort((a, b) => a.lab.L - b.lab.L || a.rgb[0] - b.rgb[0]);
  const seeds = [0.1, 0.3, 0.5, 0.7, 0.9].map(quantile => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))]);
  let centers = seeds.map(seed => ({ ...seed.lab, rgb: seed.rgb.slice() }));
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const groups = centers.map(() => ({ count: 0, L: 0, a: 0, b: 0, r: 0, g: 0, bChannel: 0 }));
    for (const pixel of pixels) {
      let best = 0;
      let bestDistance = Infinity;
      for (let index = 0; index < centers.length; index += 1) {
        const center = centers[index];
        const distance = (center.L - pixel.lab.L) ** 2 + (center.a - pixel.lab.a) ** 2 + (center.b - pixel.lab.b) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      const group = groups[best];
      group.count += 1;
      group.L += pixel.lab.L;
      group.a += pixel.lab.a;
      group.b += pixel.lab.b;
      group.r += pixel.rgb[0];
      group.g += pixel.rgb[1];
      group.bChannel += pixel.rgb[2];
    }
    centers = groups.map((group, index) => {
      if (!group.count) return centers[index];
      return {
        L: group.L / group.count,
        a: group.a / group.count,
        b: group.b / group.count,
        rgb: [group.r / group.count, group.g / group.count, group.bChannel / group.count],
        count: group.count
      };
    });
  }
  return centers
    .filter(center => center.count)
    .map(center => ({
      hex: rgbToHex({ r: center.rgb[0], g: center.rgb[1], b: center.rgb[2] }),
      count: center.count,
      L: center.L,
      chroma: Math.hypot(center.a, center.b)
    }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

function mix(hex, toward, amount) {
  const from = hexToRgb(hex);
  const target = hexToRgb(toward);
  return rgbToHex({
    r: from.r + (target.r - from.r) * amount,
    g: from.g + (target.g - from.g) * amount,
    b: from.b + (target.b - from.b) * amount
  });
}

function readableForeground(background) {
  const dark = '#17211c';
  const light = '#f4f7f2';
  const bg = hexToRgb(background);
  return contrastRgb(hexToRgb(light), bg) >= contrastRgb(hexToRgb(dark), bg) ? light : dark;
}

function applyLocks(colors, locks) {
  const next = { ...colors };
  for (const [role, value] of Object.entries(locks || {})) {
    if (ROLES.includes(role) && /^#[0-9a-f]{6}$/.test(value)) next[role] = value;
  }
  return next;
}

function schemeFrom(kind, clusters, locks) {
  const ranked = clusters.length ? clusters : [{ hex: '#6d7a72', count: 1, L: 0.4, chroma: 0 }];
  const accent = [...ranked].sort((a, b) => b.chroma - a.chroma || b.count - a.count)[0].hex;
  const darkest = [...ranked].sort((a, b) => a.L - b.L)[0].hex;
  const lightest = [...ranked].sort((a, b) => b.L - a.L)[0].hex;
  let colors;
  if (kind === 'dark-focus') {
    colors = {
      background: '#121418',
      panel: '#1e242c',
      foreground: '#f2f4f8',
      muted: '#a3adba',
      accent: ranked[0].chroma > 0.02 ? accent : '#7eb6ff',
      border: '#313846',
      selection: '#35567a'
    };
  } else if (kind === 'light-clean') {
    colors = {
      background: '#f7f6f3',
      panel: '#ffffff',
      foreground: '#1c1b19',
      muted: '#66706a',
      accent: ranked[0].chroma > 0.02 ? mix(accent, '#1c1b19', 0.25) : '#2f6f4e',
      border: '#ddd8d0',
      selection: '#d7eadf'
    };
  } else {
    const background = darkest;
    const foreground = readableForeground(background);
    colors = {
      background,
      panel: mix(background, lightest, 0.18),
      foreground,
      muted: mix(foreground, background, 0.45),
      accent: ranked[0].chroma > 0.02 ? accent : (foreground === '#f4f7f2' ? '#d2e3bb' : '#3d6b55'),
      border: mix(background, foreground, 0.22),
      selection: mix(accent, background, 0.55)
    };
  }
  colors = applyLocks(colors, locks);
  const background = hexToRgb(colors.background);
  const foreground = hexToRgb(colors.foreground);
  const ratio = contrastRgb(foreground, background);
  const warnings = [];
  if (ratio < 4.5) {
    warnings.push({ code: locks?.foreground || locks?.background ? 'LOCKED_LIMIT' : 'READABILITY_UNREACHABLE', message: '这套配色在纯色背景上低于 4.5:1，应用时阅读保护会再评估', retryable: false });
  }
  return { id: kind, label: kind === 'dark-focus' ? '深色专注' : kind === 'light-clean' ? '浅色简洁' : '原图氛围', colors, contrast: Math.round(ratio * 100) / 100, warnings };
}

function distinct(list) {
  const signature = item => ROLES.map(role => item.colors[role]).join('|');
  for (let index = 0; index < list.length; index += 1) {
    for (let other = index + 1; other < list.length; other += 1) {
      if (signature(list[index]) === signature(list[other])) return false;
    }
  }
  return true;
}

function generatePaletteThemes(image, options = {}) {
  if (!image || !image.width || !image.height || !image.data) {
    return { ok: false, code: 'ASSET_INVALID', message: '没有可分析的图片', schemes: [] };
  }
  const sample = downsample(image, options.edge || 128);
  const pixels = collectPixels(sample);
  const clusters = cluster(pixels);
  const opaque = pixels.length;
  const total = sample.width * sample.height;
  const warnings = [];
  if (!opaque) warnings.push({ code: 'READABILITY_UNKNOWN', message: '图片几乎全透明，已使用稳定的备用配色', retryable: false });
  else if (opaque / Math.max(1, Math.ceil(total / Math.max(1, Math.floor(total / 6000)))) < 0.05) {
    warnings.push({ code: 'READABILITY_UNKNOWN', message: '不透明像素很少，配色可能不稳定', retryable: false });
  }
  const schemes = ['atmosphere', 'dark-focus', 'light-clean'].map(kind => schemeFrom(kind, clusters, options.locks || {}));
  if (!distinct(schemes)) {
    schemes[1].colors.background = '#10141c';
    schemes[2].colors.background = '#fbfaf7';
  }
  return {
    ok: true,
    schemes,
    warnings,
    clusters: clusters.slice(0, 5),
    sample: { width: sample.width, height: sample.height },
    approximation: true
  };
}

module.exports = { generatePaletteThemes, ROLES };
