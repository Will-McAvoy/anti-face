/**
 * 阅读保护估算。
 * 通道先按 sRGB 0..1 线性化，再按相对亮度算对比度。
 * 合成顺序（straight alpha，0 全透明，1 不透明）：
 * 1. 不透明主题背景色
 * 2. 壁纸像素（含自身 alpha；模糊只做 3x3 邻域近似，不是浏览器滤镜）
 * 3. 壁纸遮罩色，alpha = maskStrength / 100
 * 4. 区域面板色，alpha = opacity / 100
 * 文字按不透明前景色与合成结果比较。
 * 这是区域采样估算，不是像素级实测，也不能当作无障碍认证。
 */

const ANALYSIS_EDGE = 512;
const BLOCKS = 8;
const MIN_SAMPLES = 4;

const LOCK_FIELDS = Object.freeze([
  'colors.foreground',
  'colors.background',
  'colors.panel',
  'colors.accent',
  'colors.muted',
  'colors.border',
  'colors.selection',
  'wallpaper.maskStrength',
  'wallpaper.maskColor',
  'regions.global.opacity',
  'regions.sidebar.opacity',
  'regions.chat.opacity',
  'regions.composer.opacity',
  'regions.card.opacity'
]);

function linearizeChannel(unit) {
  if (unit <= 0.04045) return unit / 12.92;
  return ((unit + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(red, green, blue) {
  return 0.2126 * linearizeChannel(red / 255)
    + 0.7152 * linearizeChannel(green / 255)
    + 0.0722 * linearizeChannel(blue / 255);
}

function contrastFromLuminance(left, right) {
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

function contrastRgb(a, b) {
  return contrastFromLuminance(relativeLuminance(a.r, a.g, a.b), relativeLuminance(b.r, b.g, b.b));
}

function compositeStraight(dst, src) {
  const outA = src.a + dst.a * (1 - src.a);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (srcChannel, dstChannel) => (srcChannel * src.a + dstChannel * dst.a * (1 - src.a)) / outA;
  return {
    r: channel(src.r, dst.r),
    g: channel(src.g, dst.g),
    b: channel(src.b, dst.b),
    a: outA
  };
}

function hexToRgb(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!match) return null;
  const value = match[1];
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex(color) {
  const channel = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function applyGain(color, brightness, saturate) {
  const gain = (brightness == null ? 100 : brightness) / 100;
  const sat = (saturate == null ? 100 : saturate) / 100;
  const scaled = {
    r: clampByte(color.r * gain),
    g: clampByte(color.g * gain),
    b: clampByte(color.b * gain)
  };
  const luma = 0.2126 * scaled.r + 0.7152 * scaled.g + 0.0722 * scaled.b;
  return {
    r: clampByte(luma + (scaled.r - luma) * sat),
    g: clampByte(luma + (scaled.g - luma) * sat),
    b: clampByte(luma + (scaled.b - luma) * sat),
    a: color.a
  };
}

function pixelAt(image, x, y) {
  if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const index = (y * image.width + x) * 4;
  const data = image.data;
  return { r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] / 255 };
}

function sampleImage(image, x, y, blur) {
  const center = pixelAt(image, x, y);
  if (!center) return null;
  if (!blur) return center;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const sample = pixelAt(image, x + ox, y + oy) || center;
      r += sample.r;
      g += sample.g;
      b += sample.b;
      a += sample.a;
      count += 1;
    }
  }
  return { r: r / count, g: g / count, b: b / count, a: a / count };
}

function backgroundAt(point, model) {
  let color = { ...model.background, a: 1 };
  if (model.image && model.layout) {
    const mapped = model.layout.viewToImage(point.x, point.y);
    const sample = sampleImage(model.image, Math.round(mapped.x), Math.round(mapped.y), model.wallpaper.blur > 0);
    if (sample) {
      const adjusted = applyGain(sample, model.wallpaper.brightness, model.wallpaper.saturate);
      color = compositeStraight(color, adjusted);
    }
  }
  if (model.wallpaper.maskStrength > 0 && model.mask) {
    color = compositeStraight(color, { ...model.mask, a: model.wallpaper.maskStrength / 100 });
  }
  if (model.panelOpacity > 0 && model.panel) {
    color = compositeStraight(color, { ...model.panel, a: model.panelOpacity / 100 });
  }
  return color;
}

function measure(model) {
  if (!model.foreground || !model.background || !model.panel) {
    return { status: 'unknown', reason: 'missing-color', worst: null, p10: null, mean: null, samples: 0 };
  }
  if (model.expectImage && !model.image) {
    return { status: 'unknown', reason: 'missing-image', worst: null, p10: null, mean: null, samples: 0 };
  }
  const view = model.viewport;
  if (!view || !(view.width > 0) || !(view.height > 0)) {
    return { status: 'unknown', reason: 'missing-viewport', worst: null, p10: null, mean: null, samples: 0 };
  }
  const text = model.textRect || { x: view.width * 0.2, y: view.height * 0.2, width: view.width * 0.6, height: view.height * 0.6 };
  if (!(text.width > 0) || !(text.height > 0)) {
    return { status: 'unknown', reason: 'missing-region', worst: null, p10: null, mean: null, samples: 0 };
  }
  const ratios = [];
  for (let row = 0; row < BLOCKS; row += 1) {
    for (let column = 0; column < BLOCKS; column += 1) {
      const x = text.x + (column + 0.5) * text.width / BLOCKS;
      const y = text.y + (row + 0.5) * text.height / BLOCKS;
      const behind = backgroundAt({ x, y }, model);
      ratios.push(contrastRgb(model.foreground, behind));
    }
  }
  if (ratios.length < MIN_SAMPLES) {
    return { status: 'unknown', reason: 'insufficient-samples', worst: null, p10: null, mean: null, samples: ratios.length };
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const p10 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.1))];
  return {
    status: 'estimated',
    reason: model.wallpaper.blur > 0 ? 'blur-approximated' : 'sampled',
    worst: sorted[0],
    p10,
    mean,
    samples: ratios.length,
    approximation: true
  };
}

function locked(locks, field) {
  return Array.isArray(locks) && locks.includes(field);
}

function withMask(model, maskStrength) {
  return { ...model, wallpaper: { ...model.wallpaper, maskStrength } };
}

function withOpacity(model, panelOpacity) {
  return { ...model, panelOpacity };
}

function withForeground(model, foreground) {
  return { ...model, foreground };
}

function searchInteger(start, max, accept) {
  if (accept(start)) return start;
  if (start >= max || !accept(max)) return null;
  let low = start;
  let high = max;
  for (let step = 0; step < 12 && high - low > 1; step += 1) {
    const mid = Math.floor((low + high) / 2);
    if (accept(mid)) high = mid;
    else low = mid;
  }
  return high;
}

function foregroundCandidates(current) {
  const toward = (target, amount) => rgbToHex({
    r: current.r + (target.r - current.r) * amount,
    g: current.g + (target.g - current.g) * amount,
    b: current.b + (target.b - current.b) * amount
  });
  return [rgbToHex(current), '#000000', '#ffffff', toward({ r: 0, g: 0, b: 0 }, 0.5), toward({ r: 255, g: 255, b: 255 }, 0.5), '#f4f7f2', '#17211c'];
}

function protect(model, options) {
  const mode = options.mode || 'off';
  const target = options.targetContrast;
  const locks = options.locks || [];
  const opacityField = options.opacityLock || 'regions.chat.opacity';
  const initial = measure(model);
  const adjustments = [];
  const warnings = [];
  if (initial.status === 'unknown') {
    warnings.push({ code: 'READABILITY_UNKNOWN', message: '采样不足，没有给出对比度分数', retryable: false });
    return { model, measurement: initial, adjustments, warnings, reached: false, projected: null };
  }
  if (mode === 'off') {
    return { model, measurement: initial, adjustments, warnings, reached: initial.worst >= target, projected: null };
  }
  let shadow = { ...model, wallpaper: { ...model.wallpaper } };
  const score = candidate => measure(candidate).worst;
  if (score(shadow) < target && !locked(locks, 'wallpaper.maskStrength')) {
    const chosen = searchInteger(model.wallpaper.maskStrength, 80, strength => score(withMask(shadow, strength)) >= target);
    if (chosen != null && chosen !== model.wallpaper.maskStrength) {
      adjustments.push({
        id: 'mask',
        field: 'wallpaper.maskStrength',
        from: model.wallpaper.maskStrength,
        to: chosen,
        reason: '提高壁纸遮罩，让文字背后的背景更稳',
        applied: mode === 'auto'
      });
      shadow = withMask(shadow, chosen);
    }
  }
  if (score(shadow) < target && !locked(locks, opacityField)) {
    const chosen = searchInteger(Math.round(model.panelOpacity), 100, opacity => score(withOpacity(shadow, opacity)) >= target);
    if (chosen != null && chosen !== Math.round(model.panelOpacity)) {
      adjustments.push({
        id: 'opacity',
        field: opacityField,
        from: Math.round(model.panelOpacity),
        to: chosen,
        reason: '提高文字区域面板不透明度',
        applied: mode === 'auto'
      });
      shadow = withOpacity(shadow, chosen);
    }
  }
  if (score(shadow) < target && !locked(locks, 'colors.foreground')) {
    let bestHex = null;
    let bestScore = score(shadow);
    for (const hex of foregroundCandidates(model.foreground)) {
      const trial = score(withForeground(shadow, hexToRgb(hex)));
      if (trial >= target) {
        bestHex = hex;
        bestScore = trial;
        break;
      }
      if (trial > bestScore) {
        bestScore = trial;
      }
    }
    if (bestHex && bestHex !== rgbToHex(model.foreground)) {
      adjustments.push({
        id: 'foreground',
        field: 'colors.foreground',
        from: rgbToHex(model.foreground),
        to: bestHex,
        reason: '在遮罩仍不够时调整未锁定的文字色',
        applied: mode === 'auto'
      });
      shadow = withForeground(shadow, hexToRgb(bestHex));
    }
  }
  const projected = measure(shadow);
  if (projected.worst < target) {
    warnings.push({
      code: locks.length ? 'LOCKED_LIMIT' : 'READABILITY_UNREACHABLE',
      message: locks.length ? '受锁定项限制，无法达到目标对比度' : '在允许的调整范围内仍达不到目标对比度',
      retryable: false
    });
  }
  return {
    model: mode === 'auto' ? shadow : model,
    measurement: mode === 'auto' ? projected : initial,
    projected: mode === 'suggest' ? projected : null,
    adjustments,
    warnings,
    reached: projected.worst >= target
  };
}

function buildModel({ resolved, viewport, image, textRect, regionId }) {
  const region = resolved.regions[regionId] || resolved.regions.chat;
  const wallpaper = resolved.wallpaper;
  const layout = resolved.layout || null;
  return {
    background: hexToRgb(resolved.colors.background),
    panel: hexToRgb(resolved.colors.panel),
    foreground: hexToRgb(resolved.colors.foreground),
    mask: hexToRgb(wallpaper.maskColor),
    panelOpacity: region.opacity,
    wallpaper,
    image: image || null,
    expectImage: !!(wallpaper.assetId || wallpaper.legacyDataUrl),
    layout,
    viewport,
    textRect
  };
}

function evaluateAllRegions(resolved, options = {}) {
  const regionsToEvaluate = ['chat', 'composer', 'sidebar', 'card'];
  const results = {};
  const viewport = options.viewport || { width: 1280, height: 800 };
  const image = options.image || null;
  const targetContrast = options.targetContrast || 4.5;
  const locks = options.locks || [];

  for (const rid of regionsToEvaluate) {
    const textRect = options.textRects?.[rid] || null;
    const model = buildModel({
      resolved,
      viewport,
      image,
      textRect,
      regionId: rid
    });
    const measurement = measure(model);
    results[rid] = {
      regionId: rid,
      measurement,
      passed: measurement.status === 'estimated' && measurement.worst >= targetContrast
    };
  }
  return results;
}

const PROTECT_REGIONS = ['sidebar', 'chat', 'composer', 'card'];

function defaultRegionRect(viewport, regionId) {
  const width = viewport.width;
  const height = viewport.height;
  if (regionId === 'sidebar') return { x: 0, y: 0, width: Math.max(8, width * 0.22), height };
  if (regionId === 'composer') return { x: width * 0.22, y: height * 0.76, width: Math.max(8, width * 0.78), height: Math.max(8, height * 0.24) };
  if (regionId === 'card') return { x: width * 0.3, y: height * 0.16, width: Math.max(8, width * 0.46), height: Math.max(8, height * 0.3) };
  return { x: width * 0.24, y: height * 0.08, width: Math.max(8, width * 0.7), height: Math.max(8, height * 0.62) };
}

function textRole(regionId) {
  return regionId === 'sidebar' ? 'muted' : 'foreground';
}

function workingState(colors, regions, wallpaper) {
  return {
    background: colors.background,
    panel: colors.panel,
    foreground: colors.foreground,
    muted: colors.muted || colors.foreground,
    opacities: {
      sidebar: regions.sidebar.opacity,
      chat: regions.chat.opacity,
      composer: regions.composer.opacity,
      card: regions.card.opacity
    },
    maskStrength: wallpaper.maskStrength,
    wallpaper
  };
}

function modelForRegion(state, regionId, context) {
  const text = textRole(regionId) === 'muted' ? state.muted : state.foreground;
  return buildModel({
    resolved: {
      colors: { background: state.background, panel: state.panel, foreground: text },
      regions: { [regionId]: { opacity: state.opacities[regionId] } },
      wallpaper: { ...state.wallpaper, maskStrength: state.maskStrength },
      layout: context.layout || null
    },
    viewport: context.viewport,
    image: context.image,
    textRect: context.textRects?.[regionId] || (context.viewport ? defaultRegionRect(context.viewport, regionId) : null),
    regionId
  });
}

function measureRegions(state, context) {
  const regions = {};
  for (const regionId of PROTECT_REGIONS) {
    const measurement = measure(modelForRegion(state, regionId, context));
    regions[regionId] = {
      regionId,
      role: textRole(regionId),
      measurement,
      passed: measurement.status === 'estimated' && measurement.worst >= context.targetContrast
    };
  }
  return regions;
}

function passingHeld(before, after) {
  return PROTECT_REGIONS.every(regionId => !before[regionId].passed || after[regionId].passed);
}

function protectRegions(input) {
  const mode = input.mode || 'off';
  const targetContrast = input.targetContrast ?? 4.5;
  const locks = input.locks || [];
  const context = {
    viewport: input.viewport,
    image: input.image || null,
    layout: input.layout || null,
    textRects: input.textRects || null,
    targetContrast
  };
  const original = workingState(input.colors, input.regions, input.wallpaper);
  const initial = measureRegions(original, context);
  const adjustments = [];
  const warnings = [];
  const unknown = PROTECT_REGIONS.filter(regionId => initial[regionId].measurement.status !== 'estimated');
  if (unknown.length === PROTECT_REGIONS.length) {
    warnings.push({ code: 'READABILITY_UNKNOWN', message: '采样不足，没有给出对比度分数', retryable: false });
    return {
      reached: false,
      measurement: initial.chat.measurement,
      projected: null,
      adjustments,
      warnings,
      regions: initial,
      unmet: unknown.map(regionId => ({ regionId, reason: initial[regionId].measurement.reason || 'unknown', locks: [] })),
      applied: null
    };
  }
  if (mode === 'off') {
    return {
      reached: PROTECT_REGIONS.every(regionId => initial[regionId].passed || initial[regionId].measurement.status !== 'estimated'),
      measurement: initial.chat.measurement,
      projected: null,
      adjustments,
      warnings,
      regions: initial,
      unmet: [],
      applied: null
    };
  }

  let shadow = {
    ...original,
    opacities: { ...original.opacities },
    wallpaper: original.wallpaper
  };
  const scoreOf = candidate => measureRegions(candidate, context);

  for (const regionId of PROTECT_REGIONS) {
    const field = `regions.${regionId}.opacity`;
    if (locked(locks, field)) continue;
    let current = scoreOf(shadow);
    if (current[regionId].passed || current[regionId].measurement.status !== 'estimated') continue;
    const start = Math.round(shadow.opacities[regionId]);
    const chosen = searchInteger(start, 100, opacity => {
      const trial = scoreOf({ ...shadow, opacities: { ...shadow.opacities, [regionId]: opacity } });
      return trial[regionId].passed && passingHeld(current, trial);
    });
    if (chosen != null && chosen !== start) {
      adjustments.push({
        id: `opacity-${regionId}`,
        field,
        from: start,
        to: chosen,
        reason: `提高${regionId}区域面板不透明度`,
        applied: mode === 'auto'
      });
      shadow = { ...shadow, opacities: { ...shadow.opacities, [regionId]: chosen } };
    }
  }

  if (!locked(locks, 'wallpaper.maskStrength')) {
    const current = scoreOf(shadow);
    const failing = PROTECT_REGIONS.some(regionId => current[regionId].measurement.status === 'estimated' && !current[regionId].passed);
    if (failing) {
      const chosen = searchInteger(Math.round(shadow.maskStrength), 80, strength => {
        const trial = scoreOf({ ...shadow, maskStrength: strength });
        const stillFailing = PROTECT_REGIONS.filter(regionId => current[regionId].measurement.status === 'estimated' && !current[regionId].passed);
        const improved = stillFailing.some(regionId => trial[regionId].passed || (trial[regionId].measurement.worst || 0) > (current[regionId].measurement.worst || 0));
        return improved && passingHeld(current, trial) && stillFailing.every(regionId => trial[regionId].passed || (trial[regionId].measurement.worst || 0) + 0.01 >= (current[regionId].measurement.worst || 0));
      });
      if (chosen != null && chosen !== Math.round(shadow.maskStrength)) {
        adjustments.push({
          id: 'mask',
          field: 'wallpaper.maskStrength',
          from: shadow.maskStrength,
          to: chosen,
          reason: '提高共享壁纸遮罩，并保持已达标区域',
          applied: mode === 'auto'
        });
        shadow = { ...shadow, maskStrength: chosen };
      }
    }
  }

  const adjustText = (field, key) => {
    if (locked(locks, field)) return;
    const current = scoreOf(shadow);
    const affected = PROTECT_REGIONS.filter(regionId => textRole(regionId) === (key === 'muted' ? 'muted' : 'foreground'));
    if (!affected.some(regionId => current[regionId].measurement.status === 'estimated' && !current[regionId].passed)) return;
    let best = null;
    let bestScore = -1;
    for (const hex of foregroundCandidates(hexToRgb(shadow[key]))) {
      const trialState = { ...shadow, [key]: hex };
      const trial = scoreOf(trialState);
      if (!passingHeld(current, trial)) continue;
      const worst = Math.min(...affected.map(regionId => trial[regionId].measurement.worst || 0));
      const allPass = affected.every(regionId => trial[regionId].measurement.status !== 'estimated' || trial[regionId].passed);
      if (allPass || worst > bestScore) {
        best = hex;
        bestScore = worst;
        if (allPass) break;
      }
    }
    if (best && best.toLowerCase() !== String(shadow[key] || '').toLowerCase()) {
      adjustments.push({
        id: key,
        field,
        from: shadow[key],
        to: best,
        reason: key === 'muted' ? '调整未锁定的次要文字色' : '调整未锁定的共享文字色',
        applied: mode === 'auto'
      });
      shadow = { ...shadow, [key]: best };
    }
  };
  adjustText('colors.foreground', 'foreground');
  adjustText('colors.muted', 'muted');

  const finalMeasure = scoreOf(shadow);
  const unmet = PROTECT_REGIONS.filter(regionId => finalMeasure[regionId].measurement.status === 'estimated' && !finalMeasure[regionId].passed)
    .map(regionId => ({
      regionId,
      reason: 'below-target',
      locks: [
        `regions.${regionId}.opacity`,
        'wallpaper.maskStrength',
        textRole(regionId) === 'muted' ? 'colors.muted' : 'colors.foreground'
      ].filter(field => locked(locks, field))
    }));
  if (unmet.length) {
    warnings.push({
      code: unmet.some(item => item.locks.length) ? 'LOCKED_LIMIT' : 'READABILITY_UNREACHABLE',
      message: unmet.some(item => item.locks.length) ? '受锁定项限制，部分区域无法达到目标对比度' : '在允许的调整范围内仍有区域达不到目标对比度',
      retryable: false,
      regions: unmet.map(item => item.regionId)
    });
  }
  const applied = mode === 'auto' ? {
    opacities: shadow.opacities,
    maskStrength: shadow.maskStrength,
    foreground: shadow.foreground,
    muted: shadow.muted
  } : null;
  return {
    reached: unmet.length === 0 && unknown.length === 0,
    measurement: (mode === 'auto' ? finalMeasure : initial).chat.measurement,
    projected: mode === 'suggest' ? finalMeasure.chat.measurement : null,
    adjustments,
    warnings,
    regions: mode === 'auto' ? finalMeasure : initial,
    projectedRegions: mode === 'suggest' ? finalMeasure : null,
    unmet,
    applied
  };
}

module.exports = {
  ANALYSIS_EDGE,
  LOCK_FIELDS,
  linearizeChannel,
  relativeLuminance,
  contrastFromLuminance,
  contrastRgb,
  compositeStraight,
  hexToRgb,
  rgbToHex,
  measure,
  protect,
  protectRegions,
  buildModel,
  evaluateAllRegions,
  backgroundAt,
  defaultRegionRect
};
