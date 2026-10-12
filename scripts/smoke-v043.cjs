// Button chain for v0.4.3: custom line-height apply, a forced wrong ratio, and a late apply after restore.
// The host window is simulated. Line-height is read from a hidden Chromium window, not echoed from the expected ratio.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'tests/fixtures/desktop-round5-host.cjs');

function armClicks(page) {
  const proto = Object.getPrototypeOf(page.locator('body'));
  if (proto.antiFaceNoWait) return;
  const original = proto.click;
  proto.click = function (options = {}) {
    return original.call(this, { noWaitAfter: true, ...options });
  };
  proto.antiFaceNoWait = true;
}

async function closeApp(app) {
  if (!app) return;
  let timer;
  const kill = new Promise(resolve => {
    timer = setTimeout(() => {
      try { app.process()?.kill(); } catch { /* already exited */ }
      resolve();
    }, 8000);
  });
  await Promise.race([app.close().catch(() => {}), kill]);
  clearTimeout(timer);
}

async function openApp(dir) {
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  const app = await electron.launch({ args: [fixture], cwd: root, env, timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  armClicks(page);
  page.on('dialog', dialog => { void dialog.accept(); });
  await page.getByText('设置已保存到本机', { exact: true }).waitFor();
  return { app, page };
}

async function setRange(page, name, value) {
  const slider = page.getByRole('slider', { name, exact: true });
  await slider.evaluate((input, next) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

function mark(outDir, step) {
  require('node:fs').appendFileSync(path.join(outDir, 'smoke-v043.log'), `${new Date().toISOString()} ${step}\n`);
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-v043-'));
  const outDir = path.join(root, 'artifacts', 'v043');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'smoke-v043.log'), '');
  let app;
  let step = 'launch';
  const note = next => { step = next; mark(outDir, next); };
  const report = { steps: [], host: 'simulated-window-plus-hidden-chromium-line-height', realAntigravity: '未验证' };
  try {
    note('launch');
    const opened = await openApp(dir);
    app = opened.app;
    const page = opened.page;
    note('launched');

    note('connect');
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByText('Mock A', { exact: true }).click();
    await page.locator('.connection-card h2').filter({ hasText: /可以应用|主题生效中/ }).waitFor();

    note('line-height-controls');
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '聊天内容区', exact: true }).click();
    await page.getByRole('checkbox', { name: '字号跟随宿主', exact: true }).click();
    await setRange(page, '聊天字号', 18);
    await page.getByRole('checkbox', { name: '行距跟随宿主', exact: true }).click();
    assert.equal(await page.getByRole('slider', { name: '聊天行距', exact: true }).inputValue(), '1.5');
    assert.equal(await page.getByRole('slider', { name: '聊天字号', exact: true }).inputValue(), '18');
    await app.evaluate(() => { global.round5Mock.realLineHeight = true; global.round5Mock.lineHeightLog = []; });

    note('apply-correct-ratio');
    await page.getByRole('button', { name: '应用到 Antigravity', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '已应用到 Antigravity' }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    const correct = await app.evaluate(() => {
      const sample = global.round5Mock.lastLineHeight;
      const css = global.round5Mock.windows.A.css;
      return { sample, cssHasUnitless: /line-height:1\.5 !important/.test(css), cssHas27: /line-height:27px/.test(css) };
    });
    assert.equal(correct.sample.state, 'present');
    assert.ok(Math.abs(correct.sample.actual.fontSizePx - 18) < 0.2, JSON.stringify(correct.sample));
    assert.ok(Math.abs(correct.sample.actual.lineHeightPx - 27) < 0.5, JSON.stringify(correct.sample));
    assert.ok(Math.abs(correct.sample.actual.ratio - 1.5) <= 0.02, JSON.stringify(correct.sample));
    assert.equal(correct.cssHasUnitless, true);
    assert.equal(correct.cssHas27, false);
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.locator('.connection-card h2', { hasText: '主题生效中' }).waitFor();
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    report.steps.push({ step, ok: true, sample: correct.sample.actual });

    note('apply-wrong-ratio');
    const beforeWrong = await app.evaluate(() => global.round5Mock.windows.A.writes);
    await app.evaluate(() => {
      global.round5Mock.forceLineRatio = 1.8;
      global.round5Mock.forceLineOnce = true;
    });
    await page.getByRole('button', { name: '更新主题', exact: true }).click();
    const alert = page.getByRole('alert');
    await alert.waitFor();
    const alertText = await alert.innerText();
    assert.match(alertText, /恢复|核对|没有按预期/);
    assert.doesNotMatch(alertText, /已应用到 Antigravity/);
    const wrong = await app.evaluate(() => ({
      log: global.round5Mock.lineHeightLog.map(item => item.actual && item.actual.ratio),
      css: global.round5Mock.windows.A.css,
      writes: global.round5Mock.windows.A.writes
    }));
    assert.ok(wrong.log.some(ratio => Math.abs(ratio - 1.8) <= 0.02), JSON.stringify(wrong.log));
    assert.match(wrong.css, /line-height:1\.5 !important/);
    assert.ok(wrong.writes >= beforeWrong);
    const afterWrong = await app.evaluate(() => {
      const service = global.round5Mock.service;
      const entry = service.targets.get('A');
      return {
        state: entry?.state || null,
        message: entry?.message || null,
        session: !!entry?.session,
        statusSession: !!entry?.status?.session,
        globalSession: !!service.status?.session
      };
    });
    report.steps.push({ step, ok: true, alertText, ratios: wrong.log, afterWrong });

    note('late-apply-restore');
    const beforeLate = await app.evaluate(() => ({
      writes: global.round5Mock.windows.A.writes,
      finished: global.round5Mock.editorApplyFinished || 0
    }));
    const heldFile = path.join(dir, 'save-held.flag');
    const releaseFile = path.join(dir, 'release-save.flag');
    const finishFile = path.join(dir, 'apply-finished.txt');
    await fs.writeFile(path.join(dir, 'hold-save.flag'), '1');
    await page.getByRole('button', { name: '更新主题', exact: true }).click();
    await page.getByText('正在应用…', { exact: true }).waitFor();
    note('wait-save-held');
    const heldAt = Date.now();
    while (!require('node:fs').existsSync(heldFile)) {
      if (Date.now() - heldAt > 8000) throw new Error('保存阶段没有停住');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const restoreButton = page.getByRole('button', { name: '恢复原样', exact: true });
    assert.equal(await restoreButton.isEnabled(), true);
    await restoreButton.click();
    await page.getByRole('status').filter({ hasText: '已恢复 Antigravity 原始外观' }).waitFor();
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.locator('.connection-card h2', { hasText: '可以应用' }).waitFor();
    const during = await app.evaluate(() => ({
      writes: global.round5Mock.windows.A.writes,
      css: global.round5Mock.windows.A.css,
      owner: global.round5Mock.windows.A.owner,
      active: global.round5Mock.studio.round5.targetStates.get('A')?.activeDocument || null
    }));
    assert.equal(during.writes, beforeLate.writes);
    assert.equal(during.css, '');
    assert.equal(during.owner, null);
    assert.equal(during.active, null);
    await fs.writeFile(releaseFile, 'go');
    const releasedAt = Date.now();
    while (Number(await fs.readFile(finishFile, 'utf8').catch(() => '0')) <= beforeLate.finished) {
      if (Date.now() - releasedAt > 8000) throw new Error('释放后旧应用没有结束');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const after = await app.evaluate(() => ({
      writes: global.round5Mock.windows.A.writes,
      css: global.round5Mock.windows.A.css,
      owner: global.round5Mock.windows.A.owner,
      active: global.round5Mock.studio.round5.targetStates.get('A')?.activeDocument || null
    }));
    assert.equal(after.writes, beforeLate.writes);
    assert.equal(after.css, '');
    assert.equal(after.owner, null);
    assert.equal(after.active, null);
    assert.equal(await page.getByRole('status').filter({ hasText: '已应用到 Antigravity' }).count(), 0);
    assert.equal(await page.getByRole('status').filter({ hasText: '已恢复 Antigravity 原始外观' }).count(), 1);
    report.steps.push({ step: 'late-apply-restore', ok: true, writes: after.writes });

    report.ok = true;
    await fs.writeFile(path.join(outDir, 'smoke-v043.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.ok = false;
    report.failedStep = step;
    report.error = error && error.stack ? error.stack : String(error);
    await fs.writeFile(path.join(outDir, 'smoke-v043.json'), JSON.stringify(report, null, 2));
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await closeApp(app);
  }
})();
