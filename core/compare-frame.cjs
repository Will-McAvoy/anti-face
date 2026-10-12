/** 对比滑块只裁切上层，不改变两张图的绘制尺寸。 */
function sliderClip(percent) {
  const cut = Math.max(0, Math.min(100, Number(percent) || 0));
  return `inset(0 ${(100 - cut).toFixed(4)}% 0 0)`;
}

function frameBox(zoom, width, height) {
  const pixels = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
  if (zoom === '100%' && pixels) {
    return { width: `${width}px`, height: `${height}px`, mode: 'pixel' };
  }
  return {
    width: '100%',
    height: 'auto',
    aspectRatio: pixels ? `${width} / ${height}` : '16 / 10',
    mode: 'fit'
  };
}

module.exports = { sliderClip, frameBox };
