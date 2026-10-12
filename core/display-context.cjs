const { appError } = require('./errors.cjs');
const { createHash } = require('node:crypto');

/**
 * 4 套坐标模型与单位：
 * 1. DIP (Device Independent Pixels) - Electron 窗口边界逻辑坐标
 * 2. 物理屏幕像素 (Physical Pixels) - DIP * scaleFactor (DPR)
 * 3. 宿主 DOM CSS 像素 (CSS Pixels) - 宿主视口与元素 getBoundingClientRect
 * 4. CDP 截图像素 (Screenshot Pixels) - clip.width * clip.scale * dpr
 */

function dipToPhysical(rect, scaleFactor = 1) {
  if (!rect || typeof rect !== 'object') throw appError('INVALID_ARGUMENT', 'rect 必须是对象');
  const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
  return {
    x: Math.round(rect.x * scale),
    y: Math.round(rect.y * scale),
    width: Math.round(rect.width * scale),
    height: Math.round(rect.height * scale),
    scale
  };
}

function physicalToDip(rect, scaleFactor = 1) {
  if (!rect || typeof rect !== 'object') throw appError('INVALID_ARGUMENT', 'rect 必须是对象');
  const scale = Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
  return {
    x: Math.round(rect.x / scale),
    y: Math.round(rect.y / scale),
    width: Math.round(rect.width / scale),
    height: Math.round(rect.height / scale),
    scale
  };
}

function cssToScreenshot(clip, dpr = 1) {
  if (!clip || typeof clip !== 'object') throw appError('INVALID_ARGUMENT', 'clip 必须是对象');
  const ratio = Number(dpr) > 0 ? Number(dpr) : 1;
  const scale = Number(clip.scale) > 0 ? Number(clip.scale) : 1;
  const factor = ratio * scale;
  return {
    x: Math.round(clip.x * factor),
    y: Math.round(clip.y * factor),
    width: Math.round(clip.width * factor),
    height: Math.round(clip.height * factor),
    dpr: ratio,
    scale
  };
}

function screenshotToCss(rect, dpr = 1, scale = 1) {
  if (!rect || typeof rect !== 'object') throw appError('INVALID_ARGUMENT', 'rect 必须是对象');
  const ratio = Number(dpr) > 0 ? Number(dpr) : 1;
  const factor = ratio * (Number(scale) > 0 ? Number(scale) : 1);
  return {
    x: Math.round(rect.x / factor),
    y: Math.round(rect.y / factor),
    width: Math.round(rect.width / factor),
    height: Math.round(rect.height / factor),
    scale: Number(scale) || 1
  };
}

/**
 * 屏幕 WorkArea 边界夹持与安全可见性保证
 * 支持负坐标（主屏左侧/上方屏幕）
 * 保证至少标题栏（32px 高度，100px 宽度）完全在某个屏幕可见
 */
function clampBoundsToWorkAreas(bounds, workAreas, fallbackWorkArea) {
  if (!bounds || typeof bounds !== 'object') {
    return fallbackWorkArea ? { ...fallbackWorkArea } : { x: 100, y: 100, width: 1000, height: 720 };
  }

  const primary = fallbackWorkArea || (Array.isArray(workAreas) && workAreas[0]) || { x: 0, y: 0, width: 1920, height: 1080 };
  const areas = Array.isArray(workAreas) && workAreas.length > 0 ? workAreas : [primary];

  const minTitleWidth = 100;
  const minTitleHeight = 32;
  const width = Math.max(300, Math.min(bounds.width || 1000, 3840));
  const height = Math.max(200, Math.min(bounds.height || 720, 2160));

  // 检查是否与任何屏幕的 workArea 有足够的标题栏交集
  let matchedArea = null;
  let maxIntersectArea = 0;

  for (const area of areas) {
    const intersectX = Math.max(bounds.x, area.x);
    const intersectY = Math.max(bounds.y, area.y);
    const intersectRight = Math.min(bounds.x + width, area.x + area.width);
    const intersectBottom = Math.min(bounds.y + height, area.y + area.height);

    if (intersectRight > intersectX && intersectBottom > intersectY) {
      const areaSize = (intersectRight - intersectX) * (intersectBottom - intersectY);
      if (areaSize > maxIntersectArea) {
        maxIntersectArea = areaSize;
        matchedArea = area;
      }
    }
  }

  if (matchedArea) {
    // 在匹配的屏幕内对 bounds 进行微调，避免标题栏被任务栏或屏顶切断
    const safeX = Math.max(matchedArea.x, Math.min(bounds.x, matchedArea.x + matchedArea.width - minTitleWidth));
    const safeY = Math.max(matchedArea.y, Math.min(bounds.y, matchedArea.y + matchedArea.height - minTitleHeight));
    return {
      x: safeX,
      y: safeY,
      width: Math.min(width, matchedArea.width),
      height: Math.min(height, matchedArea.height)
    };
  }

  // 完全脱离所有屏幕：平移回主屏幕安全居中位置
  const safeW = Math.min(width, primary.width);
  const safeH = Math.min(height, primary.height);
  const safeX = primary.x + Math.max(0, Math.round((primary.width - safeW) / 2));
  const safeY = primary.y + Math.max(0, Math.round((primary.height - safeH) / 2));

  return {
    x: safeX,
    y: safeY,
    width: safeW,
    height: safeH
  };
}

/**
 * 计算 Display Context 摘要哈希，用于检测视口与 DPR 变更
 */
function computeDisplayContextHash(viewport, dpr = 1) {
  const v = viewport && typeof viewport === 'object' ? viewport : { width: 0, height: 0 };
  const raw = `${v.width}x${v.height}@${dpr || 1}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

module.exports = {
  dipToPhysical,
  physicalToDip,
  cssToScreenshot,
  screenshotToCss,
  clampBoundsToWorkAreas,
  computeDisplayContextHash
};
