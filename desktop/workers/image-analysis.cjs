const path = require('node:path');
const { parentPort } = require('node:worker_threads');

parentPort.on('message', async message => {
  const coreRoot = message.coreRoot || path.join(__dirname, '../../core');
  const { decodeImage } = require(path.join(coreRoot, 'image-decode.cjs'));
  const { generatePaletteThemes } = require(path.join(coreRoot, 'palette-generator.cjs'));
  const { resizeNearest } = require(path.join(coreRoot, 'wallpaper.cjs'));
  try {
    const decoded = await decodeImage(Buffer.from(message.bytes));
    const sample = resizeNearest(decoded.data, decoded.width, decoded.height, 512);
    if (message.decodeOnly) {
      parentPort.postMessage({
        ok: true,
        image: { width: decoded.width, height: decoded.height },
        sample: { width: sample.width, height: sample.height, data: Buffer.from(sample.data) }
      });
      return;
    }
    const themes = generatePaletteThemes({ width: sample.width, height: sample.height, data: sample.data }, { locks: message.locks || {} });
    parentPort.postMessage({
      ok: true,
      image: { width: decoded.width, height: decoded.height },
      sample: { width: sample.width, height: sample.height, data: Buffer.from(sample.data) },
      themes
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code || 'ASSET_INVALID', message: error.message || '图片分析失败' });
  }
});
