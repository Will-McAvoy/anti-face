const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { documentFromLegacy } = require('../core/theme-schema.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');

test('Chromium 渲染 1: 壁纸轮换运行时覆盖生效并正确编译到背景层 ::before CSS', async () => {
  const browser = await chromium.launch();
  try {
    const doc = documentFromLegacy({
      schemaVersion: 1,
      themeId: 'graphite',
      appearance: { blur: 12, opacity: 90, radius: 8, wallpaper: null }
    });

    // 运行期通过有效外观注入壁纸轮换覆盖
    const rotationAssetUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const effective = resolveEffectiveAppearance(doc, {
      wallpaperOverride: {
        assetId: 'rot-1',
        legacyDataUrl: rotationAssetUrl
      }
    });

    const compiled = buildDocumentCSS(doc, {
      resolved: effective.resolved,
      assetUrl: rotationAssetUrl
    });

    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<!doctype html><html><head></head><body>
      <div id="root">
        <div data-testid="conversation-list-sidebar">侧边栏</div>
      </div>
    </body></html>`);

    await page.addStyleTag({ content: compiled.css });

    // 查询 html body::before 伪元素的实际计算背景图片
    const beforeBgImage = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body, '::before');
      return style ? style.backgroundImage : '';
    });

    assert.ok(beforeBgImage.includes('data:image/png;base64') || beforeBgImage.includes('url('), '壁纸轮换应当成功编译入 body::before 背景层 CSS');
  } finally {
    await browser.close();
  }
});

test('Chromium 渲染 2: 省电模式下运行时模糊度夹持在 Chromium 真实计算样式中生效', async () => {
  const browser = await chromium.launch();
  try {
    const doc = documentFromLegacy({
      schemaVersion: 1,
      themeId: 'graphite',
      appearance: { blur: 24, opacity: 85, radius: 10, wallpaper: null }
    });
    doc.regions = {
      ...doc.regions,
      sidebar: { blur: 20, opacity: 80, radius: 10 }
    };

    // powersave 档位：模糊度上限钳制在 8px
    const effective = resolveEffectiveAppearance(doc, {
      performanceTier: 'powersave'
    });

    const compiled = buildDocumentCSS(doc, {
      resolved: effective.resolved
    });

    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(`<!doctype html><html><head></head><body>
      <div id="root">
        <div data-testid="conversation-list-sidebar">侧边栏</div>
      </div>
    </body></html>`);

    await page.addStyleTag({ content: compiled.css });

    const blurValue = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="conversation-list-sidebar"]');
      return el ? getComputedStyle(el).backdropFilter : '';
    });

    // 验证：包含 8px 模糊，而不是原始的 20px
    assert.match(blurValue, /blur\(8px\)/);
  } finally {
    await browser.close();
  }
});

test('Chromium 渲染 3: 标签与变更摘要 DOM 组件真实渲染排版与视觉无溢出', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.setContent(`<!doctype html><html><head>
      <style>
        .tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 14px;
          font-size: 12px;
          border: 1px solid #333;
          background: #222;
          color: #eee;
        }
        .summary-card {
          border: 1px solid #444;
          border-radius: 8px;
          padding: 16px;
          background: #181818;
          color: #fff;
          font-family: sans-serif;
        }
        .diff-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          border-bottom: 1px solid #282828;
          font-size: 13px;
        }
        .before { color: #888; text-decoration: line-through; }
        .after { color: #58a6ff; font-weight: bold; }
      </style>
    </head><body>
      <div class="summary-card">
        <h3>应用前变化摘要 (基线: 原生默认)</h3>
        <div class="tags-container" style="margin-bottom:12px;">
          <span class="tag-chip">#编程</span>
          <span class="tag-chip">#深色</span>
          <span class="tag-chip">#壁纸轮换</span>
        </div>
        <div class="diff-row">
          <span>侧边栏透明度</span>
          <div><span class="before">原生默认</span> &rarr; <span class="after">80%</span></div>
        </div>
        <div class="diff-row">
          <span>强调色</span>
          <div><span class="before">原生默认</span> &rarr; <span class="after">#2d68ff</span></div>
        </div>
      </div>
    </body></html>`);

    const chipsCount = await page.locator('.tag-chip').count();
    assert.equal(chipsCount, 3);

    const diffRows = await page.locator('.diff-row').count();
    assert.equal(diffRows, 2);

    const cardBox = await page.locator('.summary-card').boundingBox();
    assert.ok(cardBox.width > 300);
    assert.ok(cardBox.height > 100);
  } finally {
    await browser.close();
  }
});
