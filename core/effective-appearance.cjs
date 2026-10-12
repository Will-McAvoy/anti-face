const { validateThemeDocument } = require('./theme-schema.cjs');
const { resolveDocument } = require('./theme-resolver.cjs');
const { REGION_IDS } = require('./regions.cjs');
let sha256Json = () => null;
try {
  ({ sha256Json } = require('./digest.cjs'));
} catch {}
const { solveComposition } = require('./wallpaper-layout.cjs');
const { protectRegions } = require('./readability.cjs');

const SCENE_REGIONS = ['sidebar', 'chat', 'composer', 'card'];

function cloneRegion(region) {
  return {
    opacity: region.opacity,
    blur: region.blur,
    radius: region.radius,
    borderWidth: region.borderWidth,
    borderStrength: region.borderStrength,
    shadow: region.shadow,
    explicit: region.explicit
  };
}

function chooseScene(document, context = {}) {
  const mode = document.sceneAppearance?.mode || 'off';
  if (mode === 'off') return { scene: null, source: 'off' };
  if (mode === 'home' || mode === 'chat') return { scene: mode, source: 'manual' };
  const previewScene = context.previewScene === 'home' || context.previewScene === 'chat' ? context.previewScene : null;
  if (context.contextKind === 'preview' && previewScene) return { scene: previewScene, source: 'preview' };
  if (context.previewing && previewScene) return { scene: previewScene, source: 'preview' };
  if (context.previewing) return { scene: context.frozenScene === 'home' || context.frozenScene === 'chat' ? context.frozenScene : null, source: 'frozen' };
  if (context.scene === 'home' || context.scene === 'chat') return { scene: context.scene, source: 'auto' };
  return { scene: null, source: 'unknown' };
}

function locked(document, field) {
  return Array.isArray(document.readability?.locks) && document.readability.locks.includes(field);
}

function textRectFor(layout, composition, viewport) {
  const rect = composition?.textSafeRect;
  if (!layout || !rect || !viewport) {
    if (!viewport) return null;
    return { x: viewport.width * 0.18, y: viewport.height * 0.16, width: viewport.width * 0.64, height: viewport.height * 0.68 };
  }
  const start = layout.imageToView(rect.x * layout.imageWidth, rect.y * layout.imageHeight);
  const end = layout.imageToView((rect.x + rect.width) * layout.imageWidth, (rect.y + rect.height) * layout.imageHeight);
  const x = Math.max(0, Math.min(start.x, end.x));
  const y = Math.max(0, Math.min(start.y, end.y));
  const width = Math.min(viewport.width - x, Math.abs(end.x - start.x));
  const height = Math.min(viewport.height - y, Math.abs(end.y - start.y));
  if (!(width > 4) || !(height > 4)) return null;
  return { x, y, width, height };
}

function visualSnapshot(resolved) {
  return {
    colors: resolved.colors,
    regions: REGION_IDS.reduce((output, id) => {
      output[id] = { ...resolved.regions[id] };
      delete output[id].explicit;
      return output;
    }, {}),
    wallpaper: {
      fit: resolved.wallpaper.fit,
      focusX: resolved.wallpaper.focusX,
      focusY: resolved.wallpaper.focusY,
      scale: resolved.wallpaper.scale,
      blur: resolved.wallpaper.blur,
      brightness: resolved.wallpaper.brightness,
      saturate: resolved.wallpaper.saturate,
      maskColor: resolved.wallpaper.maskColor,
      maskStrength: resolved.wallpaper.maskStrength
    },
    typography: resolved.typography
  };
}

function resolveEffectiveAppearance(document, context = {}, analysis = null) {
  const validated = validateThemeDocument(document);
  const base = resolveDocument(validated);
  const provenance = {};
  const warnings = [];
  const adjustments = [];
  const colors = { ...base.colors };
  const regions = {};
  for (const id of REGION_IDS) {
    regions[id] = cloneRegion(base.regions[id]);
    for (const field of ['opacity', 'blur', 'radius', 'borderWidth', 'borderStrength', 'shadow']) {
      provenance[`regions.${id}.${field}`] = regions[id].explicit ? 'user' : 'inherited';
    }
  }
  for (const role of ['accent', 'background', 'panel', 'foreground', 'muted', 'border', 'selection']) {
    if (colors[role]) provenance[`colors.${role}`] = validated.colors[role] ? 'user' : 'inherited';
  }
  const wallpaper = { ...validated.wallpaper, composition: { ...validated.wallpaper.composition } };
  provenance['wallpaper.focusX'] = 'user';
  provenance['wallpaper.focusY'] = 'user';
  provenance['wallpaper.maskStrength'] = 'user';

  // 壁纸轮换运行时覆盖
  if (context.wallpaperOverride) {
    if (context.wallpaperOverride.assetId) {
      if (wallpaper.assetId !== context.wallpaperOverride.assetId) {
        adjustments.push({
          id: 'wallpaper-rotation',
          field: 'wallpaper.assetId',
          from: wallpaper.assetId,
          to: context.wallpaperOverride.assetId,
          reason: '壁纸轮换运行时覆盖',
          applied: true
        });
      }
      wallpaper.assetId = context.wallpaperOverride.assetId;
      wallpaper.legacyDataUrl = null;
      provenance['wallpaper.assetId'] = 'rotation';
    } else if (context.wallpaperOverride.legacyDataUrl) {
      wallpaper.legacyDataUrl = context.wallpaperOverride.legacyDataUrl;
      provenance['wallpaper.legacyDataUrl'] = 'rotation';
    }
  }

  const sceneChoice = chooseScene(validated, context);
  const overrides = sceneChoice.scene ? validated.sceneAppearance[sceneChoice.scene] : null;
  if (overrides) {
    if (overrides.maskStrength != null) {
      if (locked(validated, 'wallpaper.maskStrength')) {
        warnings.push({ code: 'LOCKED_LIMIT', message: '壁纸遮罩已锁定，场景模式没有改它', retryable: false });
      } else if (overrides.maskStrength !== wallpaper.maskStrength) {
        adjustments.push({ id: 'scene-mask', field: 'wallpaper.maskStrength', from: wallpaper.maskStrength, to: overrides.maskStrength, reason: '场景模式调整了背景遮罩', applied: true });
        wallpaper.maskStrength = overrides.maskStrength;
        provenance['wallpaper.maskStrength'] = 'scene';
      }
    }
    if (overrides.opacity != null) {
      for (const id of SCENE_REGIONS) {
        const field = `regions.${id}.opacity`;
        if (locked(validated, field)) {
          warnings.push({ code: 'LOCKED_LIMIT', message: '有区域透明度已锁定，场景模式跳过了它', retryable: false });
          continue;
        }
        if (regions[id].opacity !== overrides.opacity) {
          adjustments.push({ id: `scene-${id}`, field, from: regions[id].opacity, to: overrides.opacity, reason: '场景模式调整了区域透明度', applied: true });
          regions[id].opacity = overrides.opacity;
          provenance[field] = 'scene';
        }
      }
    }
  }

  const viewport = context.viewport && context.viewport.width > 0 && context.viewport.height > 0 ? context.viewport : null;
  const imageSize = analysis?.image?.width ? analysis.image : (analysis?.dimensions || null);
  let layout = null;
  if (viewport && imageSize && (wallpaper.assetId || wallpaper.legacyDataUrl)) {
    const solved = solveComposition({
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      viewWidth: viewport.width,
      viewHeight: viewport.height,
      fit: wallpaper.fit,
      scale: wallpaper.scale,
      focusX: wallpaper.focusX,
      focusY: wallpaper.focusY,
      subjectRect: wallpaper.composition.subjectRect,
      textSafeRect: wallpaper.composition.textSafeRect,
      policy: wallpaper.composition.policy
    });
    warnings.push(...solved.warnings);
    if (solved.focusX !== wallpaper.focusX || solved.focusY !== wallpaper.focusY) {
      adjustments.push({
        id: 'composition',
        field: 'wallpaper.focus',
        from: { focusX: wallpaper.focusX, focusY: wallpaper.focusY },
        to: { focusX: solved.focusX, focusY: solved.focusY },
        reason: '构图策略按当前窗口调整了焦点',
        applied: true
      });
      provenance['wallpaper.focusX'] = 'composition';
      provenance['wallpaper.focusY'] = 'composition';
    }
    wallpaper.focusX = solved.focusX;
    wallpaper.focusY = solved.focusY;
    layout = solved.layout;
  }

  const mode = validated.readability?.mode || 'off';
  let readability = null;
  if (mode !== 'off') {
    readability = protectRegions({
      colors,
      regions,
      wallpaper,
      layout,
      viewport,
      image: analysis?.image?.data ? analysis.image : null,
      mode,
      targetContrast: validated.readability.targetContrast,
      locks: validated.readability.locks,
      textRects: viewport ? { chat: textRectFor(layout, wallpaper.composition, viewport) } : null
    });
    warnings.push(...readability.warnings);
    if (mode === 'auto' && readability.applied) {
      for (const id of SCENE_REGIONS) {
        const field = `regions.${id}.opacity`;
        const next = readability.applied.opacities[id];
        if (next != null && next !== regions[id].opacity && !locked(validated, field)) {
          regions[id].opacity = next;
          provenance[field] = 'readability';
        }
      }
      if (readability.applied.maskStrength !== wallpaper.maskStrength && !locked(validated, 'wallpaper.maskStrength')) {
        wallpaper.maskStrength = readability.applied.maskStrength;
        provenance['wallpaper.maskStrength'] = 'readability';
      }
      if (readability.applied.foreground && readability.applied.foreground !== colors.foreground && !locked(validated, 'colors.foreground')) {
        colors.foreground = readability.applied.foreground;
        provenance['colors.foreground'] = 'readability';
      }
      if (readability.applied.muted && readability.applied.muted !== colors.muted && !locked(validated, 'colors.muted')) {
        colors.muted = readability.applied.muted;
        provenance['colors.muted'] = 'readability';
      }
      adjustments.push(...readability.adjustments.filter(item => item.applied));
    } else {
      adjustments.push(...readability.adjustments);
    }
  }

  // 性能自适应临时覆盖层：仅覆盖运行时有效渲染值，不修改原始保存主题
  const perfTier = context.performanceTier || (context.performance?.tier);
  const perfOverrides = context.performanceOverrides || (context.performance?.overrides);
  const maxBlur = perfOverrides?.maxBlur != null
    ? perfOverrides.maxBlur
    : (perfTier === 'powersave' ? 8 : (perfTier === 'lightweight' ? 12 : null));

  if (maxBlur != null && maxBlur < 100) {
    if (wallpaper.blur > maxBlur) {
      adjustments.push({
        id: 'performance-wallpaper-blur',
        field: 'wallpaper.blur',
        from: wallpaper.blur,
        to: maxBlur,
        reason: `性能自适应：壁纸模糊 ${wallpaper.blur}→${maxBlur}px`,
        applied: true
      });
      wallpaper.blur = maxBlur;
      provenance['wallpaper.blur'] = 'performance';
    }
    for (const id of REGION_IDS) {
      if (regions[id].blur > maxBlur) {
        adjustments.push({
          id: `performance-region-blur-${id}`,
          field: `regions.${id}.blur`,
          from: regions[id].blur,
          to: maxBlur,
          reason: `性能自适应：${id}区域模糊 ${regions[id].blur}→${maxBlur}px`,
          applied: true
        });
        regions[id].blur = maxBlur;
        provenance[`regions.${id}.blur`] = 'performance';
      }
    }
  }

  const resolved = {
    document: validated,
    base: base.base,
    colors,
    regions,
    wallpaper,
    typography: validated.typography,
    preset: validated.preset,
    layout
  };
  return {
    resolved,
    provenance,
    adjustments,
    warnings,
    scene: sceneChoice,
    readability,
    documentHash: sha256Json(validated),
    effectiveHash: sha256Json(visualSnapshot(resolved))
  };
}

module.exports = { resolveEffectiveAppearance, visualSnapshot, chooseScene };
