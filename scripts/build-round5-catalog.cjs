const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { sha256Json, sha256Text } = require('../core/digest.cjs');
const { validateThemeDocument } = require('../core/theme-schema.cjs');
const { render, downscale, encodeRgbPng } = require('./catalog-art.cjs');

const root = path.join(__dirname, '../assets/catalog');
const WALLPAPER_SIZES = [[3840, 2160], [3200, 1800], [2560, 1440]];
// Headroom below the 5 MB maxImageBytes decode limit.
const WALLPAPER_BUDGET_BYTES = Math.floor(4.8 * 1024 * 1024);
const PREVIEW_WIDTH = 640;

const designs = [
  ['石墨夜读', 'graphite', 'dark', ['dark', 'reading'], '低干扰长文', 18, 92, 16],
  ['珍珠页边', 'pearl', 'light', ['light', 'reading'], '纸面留白', 4, 96, 12],
  ['极光悬浮', 'aurora', 'dark', ['dark', 'glass'], '冷色玻璃面板', 22, 74, 18],
  ['午夜窄栏', 'midnight', 'dark', ['dark', 'low-distraction'], '把侧栏压暗', 8, 90, 8],
  ['抹茶卡片', 'matcha', 'light', ['light', 'reading'], '浅底绿强调', 6, 94, 14],
  ['玫瑰雾面', 'rose', 'light', ['light', 'glass'], '浅玻璃与低对比装饰', 16, 80, 20],
  ['北欧静音', 'nord', 'dark', ['dark', 'low-distraction'], '冷灰少装饰', 2, 96, 6],
  ['拿铁纸感', 'latte', 'light', ['light', 'reading'], '暖白阅读', 0, 98, 10],
  ['紫罗兰焦点', 'violet', 'dark', ['dark', 'glass'], '深底高光点', 20, 78, 18],
  ['海面横幅', 'ocean', 'dark', ['dark', 'low-distraction'], '横向色带壁纸', 10, 88, 12],
  ['日落余温', 'sunset', 'dark', ['dark', 'reading'], '暖色但正文压深', 12, 86, 14],
  ['墨线编辑', 'ink', 'dark', ['dark', 'low-distraction'], '近黑工作台', 0, 94, 4],
  ['樱花浅窗', 'sakura', 'light', ['light', 'glass'], '浅粉玻璃', 14, 82, 16],
  ['林间遮罩', 'forest', 'dark', ['dark', 'reading'], '绿色遮罩保护文字', 8, 84, 12],
  ['银白表格', 'silver', 'light', ['light', 'low-distraction'], '浅灰信息密度', 2, 97, 6],
  ['石墨玻璃', 'graphite', 'dark', ['dark', 'glass'], '同一基底的玻璃变体', 24, 70, 20],
  ['珍珠低干扰', 'pearl', 'light', ['light', 'low-distraction'], '几乎不模糊的浅底', 0, 100, 4],
  ['极光阅读', 'aurora', 'dark', ['dark', 'reading'], '极光色上的阅读遮罩', 6, 88, 10],
  ['午夜玻璃', 'midnight', 'dark', ['dark', 'glass'], '高模糊窄圆角', 28, 68, 22],
  ['北欧浅读', 'nord', 'light', ['light', 'reading'], '北欧色的浅色阅读版', 2, 95, 8]
];

const palettes = [
  ['#d2e3bb', '#151817', '#272c29', '#edf0ea', '#9ca69e', '#3c463f', '#355845'],
  ['#3d6b55', '#f4f5ef', '#ffffff', '#25352c', '#718076', '#d5ddd4', '#c9ddc4'],
  ['#a6f3da', '#101d25', '#19303a', '#e5f5f1', '#9bb9bc', '#2c4a52', '#1d4f4a'],
  ['#8eb4ff', '#0e1218', '#1a2230', '#e7eefc', '#93a0b8', '#2a3648', '#24385c'],
  ['#5f8f62', '#f7f3e8', '#fffdf8', '#243126', '#6d7c6e', '#ddd6c6', '#d5e4c8'],
  ['#a85d74', '#f8eef1', '#fff8fa', '#3a2430', '#8d6d78', '#ead7de', '#f0c9d4'],
  ['#d8dee9', '#1c2128', '#242b33', '#eceff4', '#a8b0bb', '#3b4450', '#3d4d63'],
  ['#8a5a3b', '#f6f1e8', '#fffaf3', '#2c241c', '#7d7368', '#e4d8c8', '#ead7bf'],
  ['#c4b5fd', '#161221', '#261c38', '#f3eefe', '#b7adc8', '#43345c', '#4c3d6b'],
  ['#7dd3c7', '#102026', '#17343a', '#e7f7f4', '#8eafb4', '#24545c', '#1c4d52'],
  ['#f0b27a', '#24160f', '#3a2618', '#fff4ea', '#c7aa96', '#5c4030', '#6b4630'],
  ['#d0d5dc', '#090b0e', '#15191f', '#f5f7fa', '#9aa3af', '#2a313b', '#243044'],
  ['#f3b6c8', '#fff5f7', '#ffffff', '#402833', '#8d7380', '#f0d5de', '#f7d6e1'],
  ['#b7d7a8', '#121a14', '#1d2b20', '#eef6ea', '#9aaf96', '#314438', '#2d4a34'],
  ['#6e7c86', '#f3f5f6', '#ffffff', '#1f2930', '#6b767e', '#d5dbe0', '#d3dde4'],
  ['#e7f2c8', '#121614', '#24302a', '#f7fbf2', '#a9b5aa', '#3d4c43', '#3e5a48'],
  ['#315c49', '#fbfaf6', '#ffffff', '#1c2b24', '#6e7d74', '#e1e4dc', '#d4e3d4'],
  ['#d7fff4', '#0c181c', '#163038', '#f3fffb', '#9ec4c2', '#2a5058', '#1e5c58'],
  ['#9db7ff', '#070b14', '#141a2b', '#eef2ff', '#95a0ba', '#2b3550', '#2a3d68'],
  ['#4d6a86', '#f4f7f8', '#ffffff', '#1b2833', '#667684', '#d7e0e6', '#d2e0ea']
];

function documentFor(name, baseThemeId, opacity, blur, radius, index) {
  const [accent, background, panel, foreground, muted, border, selection] = palettes[index];
  return validateThemeDocument({
    schemaVersion: 2,
    id: 'draft',
    name,
    baseThemeId,
    colors: { accent, background, panel, foreground, muted, border, selection },
    regions: {
      global: { opacity, blur, radius },
      sidebar: { opacity: Math.max(40, opacity - 12) },
      chat: { opacity: Math.min(100, opacity + 4) },
      composer: { radius: Math.max(4, radius - 4) }
    },
    wallpaper: {
      fit: index % 2 === 0 ? 'cover' : 'contain',
      focusX: 20 + (index * 3) % 60,
      focusY: 30 + (index * 5) % 40,
      scale: 100,
      blur: index % 4 === 0 ? 0 : 2,
      maskStrength: designs[index][2] === 'dark' ? 18 + (index % 5) * 4 : 8,
      maskColor: '#000000',
      composition: {
        policy: ['manual', 'protect-subject', 'protect-text', 'balanced'][index % 4],
        subjectRect: { x: 0.08 + (index % 5) * 0.02, y: 0.12, width: 0.28, height: 0.36 },
        textSafeRect: { x: 0.42, y: 0.16, width: 0.4, height: 0.5 }
      }
    },
    typography: {
      chatFontSize: 15 + (index % 4),
      lineHeight: 1.4 + (index % 3) * 0.1,
      contentWidth: 680 + index * 8
    },
    readability: { mode: 'off', targetContrast: 4.5, locks: [] },
    sceneAppearance: { mode: 'off', home: { maskStrength: null, opacity: null }, chat: { maskStrength: null, opacity: null } },
    preset: 'custom'
  });
}

// Largest size whose dithered PNG still fits under the app's per-image limit wins.
function renderArt(index) {
  for (const [width, height] of WALLPAPER_SIZES) {
    const pixels = render(index, palettes[index], width, height, { dither: 'random' });
    const wallpaper = encodeRgbPng(width, height, pixels);
    if (wallpaper.length > WALLPAPER_BUDGET_BYTES) continue;
    const thumb = downscale(pixels, width, height, width / PREVIEW_WIDTH);
    return { wallpaper, preview: encodeRgbPng(thumb.width, thumb.height, thumb.data), width, height };
  }
  throw new Error(`壁纸 ${index + 1} 在最小尺寸下仍超过 ${WALLPAPER_BUDGET_BYTES} 字节`);
}

function renderAllArt() {
  const results = new Array(designs.length);
  const limit = Math.max(1, Math.min(designs.length, os.availableParallelism()));
  let next = 0;
  return new Promise((resolve, reject) => {
    let active = 0, failed = false;
    const launch = () => {
      if (failed) return;
      if (next >= designs.length && active === 0) return resolve(results);
      while (active < limit && next < designs.length) {
        const index = next++;
        active += 1;
        const worker = new Worker(__filename, { workerData: { index } });
        worker.once('message', value => {
          results[index] = { ...value, wallpaper: Buffer.from(value.wallpaper), preview: Buffer.from(value.preview) };
          console.log(`wallpaper ${String(index + 1).padStart(2, '0')} ${value.width}x${value.height} ${(value.wallpaper.byteLength / 1048576).toFixed(2)} MB`);
        });
        worker.once('error', error => { failed = true; reject(error); });
        worker.once('exit', () => { active -= 1; launch(); });
      }
    };
    launch();
  });
}

async function main() {
  const art = await renderAllArt();
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(path.join(root, 'wallpapers'), { recursive: true });
  await fs.mkdir(path.join(root, 'previews'), { recursive: true });
  const items = [];
  const signatures = new Set();
  for (let index = 0; index < designs.length; index += 1) {
    const [name, base, mode, tags, summary, blur, opacity, radius] = designs[index];
    const payload = documentFor(name, base, opacity, blur, radius, index);
    const signature = JSON.stringify({ colors: payload.colors, regions: payload.regions, typography: payload.typography, wallpaper: payload.wallpaper });
    if (signatures.has(signature)) throw new Error(`主题没有设计差异: ${name}`);
    signatures.add(signature);
    const wallpaperName = `wallpapers/${String(index + 1).padStart(2, '0')}.png`;
    const previewName = `previews/${String(index + 1).padStart(2, '0')}.png`;
    const { wallpaper, preview } = art[index];
    await fs.writeFile(path.join(root, wallpaperName), wallpaper);
    await fs.writeFile(path.join(root, previewName), preview);
    const encoded = JSON.stringify(payload);
    items.push({
      itemId: `curated-${String(index + 1).padStart(2, '0')}`,
      version: 1,
      name,
      summary,
      tags,
      mode,
      style: tags.includes('glass') ? '玻璃' : tags.includes('reading') ? '阅读' : '低干扰',
      author: 'Anti Face',
      license: 'UNLICENSED',
      source: '内置精选',
      minAppVersion: '0.4.0',
      preview: previewName,
      wallpaper: wallpaperName,
      wallpaperSha256: sha256Text(wallpaper),
      sha256: sha256Json(payload),
      bytes: Buffer.byteLength(encoded),
      payload
    });
  }
  const manifest = { schemaVersion: 1, kind: 'anti-face-catalog', items };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  console.log(`catalog items ${items.length}`);
}

if (isMainThread) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const { wallpaper, preview, width, height } = renderArt(workerData.index);
  parentPort.postMessage({ wallpaper, preview, width, height });
}
