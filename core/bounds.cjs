function intersects(bounds, area) {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const areaRight = area.x + area.width;
  const areaBottom = area.y + area.height;
  return right > area.x + 8 && bounds.x < areaRight - 8 && bottom > area.y + 8 && bounds.y < areaBottom - 8;
}

function clampBounds(bounds, displays) {
  const width = Math.max(240, Math.min(800, Math.round(bounds?.width || 320)));
  const height = Math.max(140, Math.min(600, Math.round(bounds?.height || 220)));
  const areas = (displays || []).map(display => display.workArea || display.bounds).filter(Boolean);
  const primary = areas[0] || { x: 0, y: 0, width: 1280, height: 800 };
  let x = Math.round(bounds?.x ?? primary.x + 24);
  let y = Math.round(bounds?.y ?? primary.y + 24);
  const next = { x, y, width, height };
  if (!areas.some(area => intersects(next, area))) {
    x = primary.x + 24;
    y = primary.y + 24;
  }
  const home = areas.find(area => intersects({ x, y, width, height }, area)) || primary;
  x = Math.min(Math.max(x, home.x), home.x + home.width - width);
  y = Math.min(Math.max(y, home.y), home.y + home.height - height);
  return { x, y, width, height };
}

module.exports = { clampBounds, intersects };
