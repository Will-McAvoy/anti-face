const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');

function pageHtml(title) {
  return `<!doctype html><html><head><title>${title}</title></head><body>
    <div id="root"></div>
    <div data-testid="conversation-list-sidebar" style="width:80px;height:40px">侧栏</div>
    <div data-testid="agent-input-box" style="width:120px;height:32px">输入</div>
  </body></html>`;
}

test('真实 Chromium 会套用生成的颜色，两页截图像素不同', async () => {
  const browser = await chromium.launch();
  try {
    const dark = buildDocumentCSS(documentFromLegacy({ schemaVersion: 1, themeId: 'ink', appearance: { blur: 0, opacity: 90, radius: 8, wallpaper: null } }), {
      resolved: null
    });
    const lightDoc = documentFromLegacy({ schemaVersion: 1, themeId: 'pearl', appearance: { blur: 0, opacity: 96, radius: 10, wallpaper: null } });
    lightDoc.colors = { ...lightDoc.colors, foreground: '#203028', background: '#f4f1e8' };
    const light = buildDocumentCSS(lightDoc);
    const context = await browser.newContext({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
    const home = await context.newPage();
    await home.setContent(pageHtml('home'));
    await home.addStyleTag({ content: dark.css });
    const color = await home.evaluate(() => getComputedStyle(document.body).color);
    assert.match(color, /rgb/);
    const before = PNG.sync.read(await home.screenshot());
    const chat = await context.newPage();
    await chat.setContent(pageHtml('chat'));
    await chat.addStyleTag({ content: light.css });
    const after = PNG.sync.read(await chat.screenshot());
    let different = 0;
    for (let i = 0; i < before.data.length; i += 16) if (before.data[i] !== after.data[i]) different += 1;
    assert.ok(different > 10, '两套主题的截图应当能看出差别');
    const hit = await home.evaluate(() => {
      const box = document.querySelector('[data-testid="agent-input-box"]').getBoundingClientRect();
      const node = document.elementFromPoint(box.x + 4, box.y + 4);
      return node?.getAttribute('data-testid') || node?.tagName;
    });
    assert.equal(hit, 'agent-input-box');
    const missing = await context.newPage();
    await missing.setContent('<!doctype html><html><body><div data-testid="agent-input-box">输入</div></body></html>');
    assert.equal(await missing.locator('[data-testid="conversation-list-sidebar"]').count(), 0);
    const conflict = await context.newPage();
    await conflict.setContent(pageHtml('conflict'));
    await conflict.addStyleTag({ content: dark.css });
    const themed = await conflict.evaluate(() => getComputedStyle(document.body).color);
    await conflict.addStyleTag({ content: 'html body { color: rgb(255, 0, 0) !important; }' });
    const covered = await conflict.evaluate(() => getComputedStyle(document.body).color);
    assert.notEqual(covered, themed);
    assert.equal(covered, 'rgb(255, 0, 0)');
    const other = await browser.newContext({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1 });
    const second = await other.newPage();
    await second.setContent(pageHtml('other-window'));
    await second.addStyleTag({ content: light.css });
    const isolated = await second.evaluate(() => getComputedStyle(document.body).color);
    assert.notEqual(isolated, await home.evaluate(() => getComputedStyle(document.body).color));
    await other.close();
    await context.close();
  } finally {
    await browser.close();
  }
});
