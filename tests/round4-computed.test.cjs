const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');

test('区域样式在页面上分开生效，壁纸层不拦截鼠标', async () => {
  const document = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE, blur: 0, opacity: 90, radius: 8, wallpaper: null }
  });
  document.regions.sidebar = { opacity: 60 };
  document.regions.composer = { radius: 4 };
  document.wallpaper = { ...document.wallpaper, legacyDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', blur: 2 };
  const { css } = buildDocumentCSS(document);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-css-'));
  const file = path.join(dir, 'region.html');
  await fs.writeFile(file, `<!doctype html><html><head><style>${css}</style></head><body>
    <div id="root"><div class="h-screen w-screen bg-background"><aside data-testid="conversation-list-sidebar"></aside><div data-testid="agent-input-box" id="composer"></div><div class="bg-card" id="card"></div><button id="go">可点</button></div></div>
  </body></html>`);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(pathToFileUrl(file));
    await page.addStyleTag({ content: '[data-testid="conversation-list-sidebar"]{width:120px;height:80px;display:block} #composer{width:200px;height:40px;display:block} .bg-card{width:100px;height:40px} #root{min-height:200px}' });
    const sidebarOpacity = await page.locator('[data-testid="conversation-list-sidebar"]').evaluate(element => getComputedStyle(element).getPropertyValue('--af-sidebar-opacity').trim());
    const composerRadius = await page.locator('#composer').evaluate(element => getComputedStyle(element).borderRadius);
    const before = await page.locator('body').evaluate(element => getComputedStyle(element, '::before').pointerEvents);
    assert.equal(sidebarOpacity, '60%');
    assert.match(composerRadius, /4px/);
    assert.equal(before, 'none');
    await page.locator('#go').click();
  } finally {
    await browser.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function pathToFileUrl(file) {
  return 'file:///' + file.replace(/\\/g, '/');
}
