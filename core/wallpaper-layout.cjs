const { wallpaperBox, wallpaperOffset } = require('./wallpaper.cjs');

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function rectArea(rect) {
  if (!rect) return 0;
  return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function intersection(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return { x, y, width: 0, height: 0 };
  return { x, y, width: right - x, height: bottom - y };
}

function visibleImageRect(box, offset, imageWidth, imageHeight, viewWidth, viewHeight) {
  const x = ((0 - offset.x) / box.width) * imageWidth;
  const y = ((0 - offset.y) / box.height) * imageHeight;
  const right = ((viewWidth - offset.x) / box.width) * imageWidth;
  const bottom = ((viewHeight - offset.y) / box.height) * imageHeight;
  const left = Math.max(0, Math.min(imageWidth, x));
  const top = Math.max(0, Math.min(imageHeight, y));
  const farX = Math.max(0, Math.min(imageWidth, right));
  const farY = Math.max(0, Math.min(imageHeight, bottom));
  return {
    x: left / imageWidth,
    y: top / imageHeight,
    width: Math.max(0, farX - left) / imageWidth,
    height: Math.max(0, farY - top) / imageHeight
  };
}

function cropFraction(subject, visible) {
  const area = rectArea(subject);
  if (!area) return 0;
  const inside = rectArea(intersection(subject, visible));
  return 1 - inside / area;
}

function layoutFor(spec, focusX, focusY) {
  const box = wallpaperBox(spec.imageWidth, spec.imageHeight, spec.viewWidth, spec.viewHeight, spec.fit, spec.scale);
  const offset = wallpaperOffset(box, spec.viewWidth, spec.viewHeight, focusX, focusY);
  const visible = visibleImageRect(box, offset, spec.imageWidth, spec.imageHeight, spec.viewWidth, spec.viewHeight);
  return {
    box,
    offset,
    visible,
    focusX,
    focusY,
    scale: spec.scale,
    fit: spec.fit,
    imageWidth: spec.imageWidth,
    imageHeight: spec.imageHeight,
    viewWidth: spec.viewWidth,
    viewHeight: spec.viewHeight,
    viewToImage(viewX, viewY) {
      return {
        x: ((viewX - offset.x) / box.width) * spec.imageWidth,
        y: ((viewY - offset.y) / box.height) * spec.imageHeight
      };
    },
    imageToView(imageX, imageY) {
      return {
        x: offset.x + (imageX / spec.imageWidth) * box.width,
        y: offset.y + (imageY / spec.imageHeight) * box.height
      };
    }
  };
}

function clampFocus(value) {
  if (!finite(value)) return 50;
  return Math.max(0, Math.min(100, value));
}

function scoreCandidate(spec, focusX, focusY) {
  const layout = layoutFor(spec, focusX, focusY);
  const subjectCrop = cropFraction(spec.subjectRect, layout.visible);
  const overlap = spec.subjectRect && spec.textSafeRect
    ? rectArea(intersection(spec.subjectRect, spec.textSafeRect)) / Math.max(rectArea(spec.textSafeRect), 0.0001)
    : 0;
  const textCrop = cropFraction(spec.textSafeRect, layout.visible);
  const deviation = Math.hypot(focusX - spec.focusX, focusY - spec.focusY) / 100;
  let cost;
  if (spec.policy === 'protect-subject') cost = subjectCrop * 100 + deviation * 5 + textCrop;
  else if (spec.policy === 'protect-text') cost = textCrop * 80 + overlap * 40 + subjectCrop * 10 + deviation;
  else cost = subjectCrop * 40 + textCrop * 40 + overlap * 20 + deviation * 10;
  return { layout, subjectCrop, textCrop, overlap, deviation, cost, focusX, focusY };
}

function candidates(spec) {
  const points = [
    [spec.focusX, spec.focusY],
    [50, 50],
    [0, 50],
    [100, 50],
    [50, 0],
    [50, 100]
  ];
  const pushRect = rect => {
    if (!rect) return;
    const cx = (rect.x + rect.width / 2) * 100;
    const cy = (rect.y + rect.height / 2) * 100;
    points.push([cx, cy], [rect.x * 100, cy], [(rect.x + rect.width) * 100, cy]);
  };
  pushRect(spec.subjectRect);
  pushRect(spec.textSafeRect);
  const unique = [];
  const seen = new Set();
  for (const [x, y] of points) {
    const focusX = Math.round(clampFocus(x));
    const focusY = Math.round(clampFocus(y));
    const key = `${focusX}:${focusY}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([focusX, focusY]);
  }
  return unique;
}

function solveComposition(input) {
  const spec = {
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    viewWidth: input.viewWidth,
    viewHeight: input.viewHeight,
    fit: input.fit === 'contain' ? 'contain' : 'cover',
    scale: input.scale,
    focusX: input.focusX,
    focusY: input.focusY,
    subjectRect: input.subjectRect || null,
    textSafeRect: input.textSafeRect || null,
    policy: input.policy || 'manual'
  };
  const warnings = [];
  if (!finite(spec.viewWidth) || !finite(spec.viewHeight) || spec.viewWidth <= 0 || spec.viewHeight <= 0
    || !finite(spec.imageWidth) || !finite(spec.imageHeight) || spec.imageWidth <= 0 || spec.imageHeight <= 0) {
    warnings.push({ code: 'VIEWPORT_UNKNOWN', message: '窗口或图片尺寸不足，保持当前焦点', retryable: false });
    return {
      focusX: clampFocus(spec.focusX),
      focusY: clampFocus(spec.focusY),
      scale: spec.scale,
      fit: spec.fit,
      policy: spec.policy,
      crop: null,
      warnings,
      layout: null
    };
  }
  if (spec.subjectRect && spec.textSafeRect && rectArea(intersection(spec.subjectRect, spec.textSafeRect)) > 0) {
    warnings.push({ code: 'COMPOSITION_CONFLICT', message: '主体保护区和正文留白区重叠，无法同时完全满足', retryable: false });
  }
  if (spec.policy === 'manual' || (!spec.subjectRect && !spec.textSafeRect)) {
    const layout = layoutFor(spec, spec.focusX, spec.focusY);
    const subjectCrop = cropFraction(spec.subjectRect, layout.visible);
    if (spec.subjectRect && subjectCrop > 0.02) {
      warnings.push({ code: 'SUBJECT_CROPPED', message: '按当前焦点，主体有一部分会在窗口外', retryable: false });
    }
    return {
      focusX: spec.focusX,
      focusY: spec.focusY,
      scale: spec.scale,
      fit: spec.fit,
      policy: spec.policy,
      crop: layout.visible,
      subjectCrop,
      warnings,
      layout
    };
  }
  let best = null;
  for (const [focusX, focusY] of candidates(spec)) {
    const scored = scoreCandidate(spec, focusX, focusY);
    if (!best || scored.cost < best.cost - 0.0001 || (Math.abs(scored.cost - best.cost) <= 0.0001 && scored.deviation < best.deviation)) {
      best = scored;
    }
  }
  if (best.subjectCrop > 0.02) {
    warnings.push({ code: 'SUBJECT_CROPPED', message: '这个窗口比例下无法保住全部主体', retryable: false });
  }
  if (best.textCrop > 0.02 && spec.textSafeRect) {
    warnings.push({ code: 'TEXT_AREA_CROPPED', message: '正文留白区无法完整留在窗口内', retryable: false });
  }
  return {
    focusX: best.focusX,
    focusY: best.focusY,
    scale: spec.scale,
    fit: spec.fit,
    policy: spec.policy,
    crop: best.layout.visible,
    subjectCrop: best.subjectCrop,
    textCrop: best.textCrop,
    overlap: best.overlap,
    warnings,
    layout: best.layout
  };
}

module.exports = { solveComposition, layoutFor, visibleImageRect, cropFraction, intersection };
