/** Rebuild README images from the actual Preview component and running web UI.
 * Run: node scripts/capture-readme.mjs. Never connects to a host window. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { build, createServer, preview as serveBuild } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/media');
const evidence = path.join(root, 'artifacts/readme');
const themes = JSON.parse(await fs.readFile(path.join(root, 'shared/themes.json'), 'utf8'));
const previewCss = await fs.readFile(path.join(root, 'src/styles/preview.css'), 'utf8');
const theme = id => {
  const found = themes.find(item => item.id === id);
  assert.ok(found, `Missing built-in theme: ${id}`);
  return found;
};
const wallpaper = async id => 'data:image/png;base64,' +
  (await fs.readFile(path.join(root, `assets/catalog/wallpapers/${id}.png`))).toString('base64');
const baseline = { blur: 0, opacity: 100, radius: 0, wallpaper: null };
const visual = { blur: 24, opacity: 64, radius: 24, wallpaper: await wallpaper('03') };
const balanced = { blur: 12, opacity: 75, radius: 16, wallpaper: null };
const paper = { blur: 0, opacity: 96, radius: 10, wallpaper: null };
const css = `
* { box-sizing: border-box; }
body { margin: 0; background: #0b1013; color: #ecf2ef;
  font-family: "Segoe UI", "Microsoft YaHei", sans-serif; -webkit-font-smoothing: antialiased; }
.sheet { width: 1440px; padding: 46px 42px 32px;
  background: radial-gradient(ellipse at 85% 0%, #20433d88, transparent 56%), #0b1013; }
.masthead { display: flex; align-items: center; justify-content: space-between; }
.wordmark { font-size: 20px; font-weight: 650; letter-spacing: 4px; }
.wordmark span { color: #a6f3da; }
.pill { color: #b0c9c0; border: 1px solid #a6f3da30; background: #a6f3da09;
  border-radius: 30px; padding: 8px 14px; font-size: 14px; }
h1 { font-size: 43px; font-weight: 600; letter-spacing: -1.5px; margin: 30px 0 12px; }
h1 em { font-style: normal; color: #a6f3da; }
.intro { margin: 0 0 30px; color: #9dada8; font-size: 18px; line-height: 1.7; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 26px; }
.card { min-width: 0; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
.label { display: flex; align-items: center; gap: 10px; font-size: 22px; font-weight: 600; }
.label small { font-size: 11px; font-weight: 500; letter-spacing: 1.6px; color: #7e938a; }
.dot { width: 8px; height: 8px; background: #7e8a86; border-radius: 50%; }
.after .dot { background: #a6f3da; box-shadow: 0 0 14px #a6f3da55; }
.meta { color: #8b9c95; font-size: 13px; }
.card .preview { height: 405px; border-radius: 12px; }
.card-foot { margin: 13px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }
.chip { color: #9daea6; background: #ffffff05; border: 1px solid #ffffff10;
  padding: 6px 10px; border-radius: 6px; font-size: 13px; }
.after .chip { color: #b1d4c5; border-color: #a6f3da22; }
.footer { display: flex; justify-content: space-between; align-items: center; margin-top: 29px;
  padding-top: 19px; border-top: 1px solid #ffffff10; color: #71857b; font-size: 13px; }
.footer b { color: #9aafa3; font-weight: 400; }
.gallery .grid { row-gap: 28px; }
.gallery h1, .studio h1 { margin-top: 25px; }
.gallery .label { font-size: 21px; }
.studio .screen { border: 1px solid #ffffff20; border-radius: 12px; width: 100%; display: block; }
`;

let browser;
let applicationServer;
const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
try {
  await server.listen();
  const { Preview } = await server.ssrLoadModule('/src/components/Preview.tsx');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  function preview(id, appearance, scene = 'home', document = null) {
    return renderToStaticMarkup(React.createElement(Preview, { theme: theme(id), appearance, scene, document }));
  }
  function card(label, english, meta, content, chips, after = false) {
    return `<article class="card${after ? ' after' : ''}"><div class="card-head">
      <div class="label"><i class="dot"></i>${label}<small>${english}</small></div><span class="meta">${meta}</span></div>
      ${content}<div class="card-foot">${chips.map(text => `<span class="chip">${text}</span>`).join('')}</div></article>`;
  }
  function sheet(title, intro, cards, extra = '') {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${previewCss}\n${css}</style></head>
      <body><main class="sheet ${extra}"><header class="masthead"><div class="wordmark">ANTI<span> FACE</span></div>
      <span class="pill">Antigravity Desktop · 内置场景预览</span></header>
      <h1>${title}</h1><p class="intro">${intro}</p><section class="grid">${cards}</section>
      <footer class="footer"><b>配色 · 壁纸 · 毛玻璃 · 圆角 · 阅读排版</b><span>同场景渲染 / 示意布局，实际效果以客户端为准</span></footer>
      </main></body></html>`;
  }
  const report = { source: 'src/components/Preview.tsx + src/styles/preview.css', hostConnected: false, assets: [] };
  async function capture(name, html, expectedPreviews) {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      const urls = [...document.querySelectorAll('[style]')].flatMap(el =>
        [...el.style.backgroundImage.matchAll(/url\(["']?(.*?)["']?\)/g)].map(match => match[1]));
      await Promise.all(urls.map(src => new Promise((resolve, reject) => {
        const image = new Image(); image.onload = resolve; image.onerror = () => reject(new Error('Wallpaper failed to load')); image.src = src;
      })));
    });
    assert.equal(await page.getByTestId('theme-preview').count(), expectedPreviews);
    if (expectedPreviews === 2) {
      assert.equal(await page.getByTestId('theme-preview').nth(0).innerText(),
        await page.getByTestId('theme-preview').nth(1).innerText(), 'Both scenes must contain identical text');
    }
    const dimensions = await page.locator('.sheet').boundingBox();
    await page.locator('.sheet').screenshot({ path: path.join(output, name), animations: 'disabled' });
    report.assets.push({ name, width: dimensions.width, height: dimensions.height,
      bytes: (await fs.stat(path.join(output, name))).size });
  }
  await capture('home-before-after.png', sheet('从基础外观，到<em>你的工作氛围。</em>',
    '同一工作空间，换一种感受。用配色、壁纸与透明层次，让日常界面更合心意。',
    card('换肤前', 'BEFORE', '石墨 / 基础配置', preview('graphite', baseline), ['纯色面板', '无壁纸', '直角边界']) +
    card('换肤后', 'AFTER', '极光玻璃 / 视觉优先', preview('aurora', visual),
      ['内置极光壁纸', '24 px 毛玻璃', '64% 不透明度', '24 px 圆角'], true)), 2);
  const readingDocument = { typography: { chatFontSize: 16, lineHeight: 1.75, contentWidth: 480 } };
  await capture('chat-before-after.png', sheet('好看的外观，也要<em>舒服地阅读。</em>',
    '从深色紧凑排版切换到浅色阅读配置，同时调整字号与行距。',
    card('调整前', 'BEFORE', '石墨 / 对话场景', preview('graphite', baseline, 'chat'), ['默认预览字号', '深色面板']) +
    card('调整后', 'AFTER', '珍珠白 / 阅读配置', preview('pearl', paper, 'chat', readingDocument),
      ['浅色底', '16 px 正文字号', '1.75 倍行距'], true)), 2);
  await capture('theme-gallery.png', sheet('一种工具，<em>不止一种风格。</em>',
    '深色、浅色、玻璃质感与柔和粉白。四种预览，来自同一套内置主题。',
    card('极光玻璃', 'AURORA', '深色 · 毛玻璃', preview('aurora', visual), ['适合喜欢冷调与透明层次的你'], true) +
    card('珍珠白', 'PEARL', '浅色 · 清晰留白', preview('pearl', paper), ['柔和浅底，减少装饰干扰']) +
    card('樱花', 'SAKURA', '浅色 · 柔和粉白', preview('sakura', { ...balanced, wallpaper: await wallpaper('13') }), ['粉白配色，搭配内置樱花壁纸']) +
    card('午夜蓝', 'MIDNIGHT', '深色 · 沉静蓝调', preview('midnight', balanced), ['低调深蓝与轻量强调色']), 'gallery'), 4);

  // Capture the production bundle, matching the renderer shipped in the desktop app.
  // Build under artifacts so this tool does not replace the developer's dist folder.
  const appBuild = path.join(evidence, 'dist');
  await build({ root, configFile: path.join(root, 'vite.config.ts'),
    build: { outDir: appBuild, emptyOutDir: false }, logLevel: 'warn' });
  applicationServer = await serveBuild({ root, configFile: path.join(root, 'vite.config.ts'),
    build: { outDir: appBuild }, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
  await page.setViewportSize({ width: 1440, height: 1900 });
  await page.goto(`http://127.0.0.1:${applicationServer.httpServer.address().port}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '选择极光玻璃', exact: true }).click();
  await page.getByRole('button', { name: /视觉优先/ }).click();
  assert.equal(await page.getByRole('button', { name: '选择极光玻璃', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByTestId('theme-preview').count(), 1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(evidence, 'studio-raw.png'), animations: 'disabled' });
  assert.equal(await page.locator('.theme-card').count(), 15);
  const screen = await page.locator('.theme-library').screenshot({ animations: 'disabled' });
  await capture('studio.png', `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head>
    <body><main class="sheet studio"><header class="masthead"><div class="wordmark">ANTI<span> FACE</span></div>
    <span class="pill">应用局部截图 · 浏览器预览模式</span></header><h1>15 套主题，<em>选一个喜欢的。</em></h1>
    <p class="intro">从内置主题开始，按深浅或玻璃风格筛选，再把外观细调成自己的样子。</p>
    <img class="screen" alt="Anti Face 运行中的主题选择区" src="data:image/png;base64,${screen.toString('base64')}">
    <footer class="footer"><b>15 套内置主题 · 三档性能预设 · 本地配置</b><span>浏览器界面截图 / 连接与应用功能请使用桌面版</span></footer></main></body></html>`, 0);
  assert.deepEqual(errors, [], 'Browser errors while capturing README images');
  await fs.writeFile(path.join(evidence, 'capture-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await applicationServer?.close();
  await server.close();
}
