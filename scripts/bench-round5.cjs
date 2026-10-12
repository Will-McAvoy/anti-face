const { performance } = require('node:perf_hooks');
const os = require('node:os');
const { protect, buildModel } = require('../core/readability.cjs');
const { generatePaletteThemes } = require('../core/palette-generator.cjs');
const { CatalogService } = require('../desktop/catalog-service.cjs');
const { SceneObserver } = require('../desktop/scene-observer.cjs');

function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { n: samples.length, median: Number(median.toFixed(2)), p95: Number(percentile(samples, 95).toFixed(2)), max: Number(sorted.at(-1).toFixed(2)) };
}

const edge = 512;
const data = Buffer.alloc(edge * edge * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i] = i % 64;
  data[i + 1] = 180;
  data[i + 2] = 40;
  data[i + 3] = 255;
}
const image = { width: edge, height: edge, data };
const analysis = [];
for (let i = 0; i < 20; i += 1) {
  const start = performance.now();
  const model = buildModel({
    resolved: {
      colors: { foreground: '#f4f1e8', background: '#1b1a17', panel: '#f7f4ee' },
      regions: { chat: { opacity: 88 } },
      wallpaper: { maskStrength: 0, maskColor: '#000000', focusX: 50, focusY: 50, scale: 100, fit: 'cover' },
      layout: null
    },
    viewport: { width: 1280, height: 800 },
    image,
    textRect: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
    regionId: 'chat'
  });
  protect(model, { mode: 'auto', targetContrast: 4.5, locks: [], opacityLock: 'regions.chat.opacity' });
  generatePaletteThemes(image, { locks: { accent: '#123456' } });
  analysis.push(performance.now() - start);
}

const items = Array.from({ length: 500 }, (_, index) => ({
  name: `项${index}`, summary: '摘要', tags: index % 2 ? ['dark'] : ['light'], mode: index % 2 ? 'dark' : 'light'
}));
const catalog = new CatalogService({ root: require('node:path').join(__dirname, '../assets/catalog') });
async function main() {
const pages = [];
for (let i = 0; i < 20; i += 1) {
  const start = performance.now();
  await catalog.page({ page: (i % 25) + 1, pageSize: 20, items });
  pages.push(performance.now() - start);
}

const timers = new Set();
const observer = new SceneObserver({
  schedule(fn) { const id = { fn }; timers.add(id); return id; },
  clear(id) { timers.delete(id); }
});
for (let i = 0; i < 100; i += 1) observer.watch(`win-${i % 3}`, async () => ({ routeHint: i % 2 ? 'chat' : 'home' }));
const during = observer.activeTimers();
observer.stop();

console.log(JSON.stringify({
  host: { platform: process.platform, cpus: os.cpus()?.length || null, model: os.cpus()?.[0]?.model || null, node: process.version },
  note: '512 方图已在内存中，不含磁盘读取。样本 20 次，无单独预热轮。',
  analysisMs: summarize(analysis),
  catalogPageMs: summarize(pages),
  sceneTimers: { during, afterStop: observer.activeTimers(), scheduled: timers.size }
}, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
