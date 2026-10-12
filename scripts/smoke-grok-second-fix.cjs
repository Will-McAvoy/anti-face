// Button-driven checks for the second fix. The host is simulated, not a live Antigravity window.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'tests/fixtures/desktop-round5-host.cjs');

function png(red, green, blue) {
  const image = new PNG({ width: 32, height: 24 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

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

async function chooseFile(app, file) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, file);
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-grok2-'));
  const firstImage = path.join(dir, 'one.png');
  const secondImage = path.join(dir, 'two.png');
  await fs.writeFile(firstImage, png(240, 240, 240));
  await fs.writeFile(secondImage, png(20, 30, 40));
  let app;
  let step = 'launch';
  try {
    const opened = await openApp(dir);
    app = opened.app;
    const page = opened.page;

    step = 'connect-A';
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByText('Mock A', { exact: true }).click();
    await page.locator('.connection-card h2').filter({ hasText: /可以应用|主题生效中/ }).waitFor();

    step = 'preview-scenes';
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '预览首页' }).click();
    await page.getByRole('button', { name: '预览对话' }).click();
    await page.getByText('当前是编辑预览估算，不是已连接窗口的实测尺寸。').waitFor();

    step = 'project-copy';
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '项目外观' }).click();
    await page.getByText('重启后要再次手动关联').waitFor();
    await chooseFile(app, 'C:\\proj-alpha');
    await page.getByRole('button', { name: '选择项目文件夹' }).click();
    await page.getByText('需要手动重新关联').waitFor();

    step = 'slow-capture-switch';
    await page.getByRole('tab', { name: '真实对比' }).click();
    await app.evaluate(() => {
      const target = global.round5Mock.windows.A;
      const original = null;
      global.round5Mock.slowShot = true;
      target.slow = true;
    });
    const clientPatch = await app.evaluate(() => {
      const service = global.round5Mock.service;
      const entry = [...service.targets.values()].find(item => item.id === 'A');
      const original = entry.client.captureScreenshot.bind(entry.client);
      entry.client.captureScreenshot = () => new Promise(resolve => {
        global.round5Mock.releaseShot = () => resolve(original());
      });
      return true;
    });
    assert.equal(clientPatch, true);
    await page.getByRole('button', { name: '拍摄之前' }).click();
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByText('Mock B', { exact: true }).click();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '真实对比' }).click();
    assert.equal(await page.getByRole('button', { name: '拍摄之前' }).isEnabled(), true);
    await app.evaluate(() => { if (global.round5Mock.releaseShot) global.round5Mock.releaseShot(); });
    await page.waitForTimeout(300);
    assert.equal(await page.getByAltText('应用前的窗口截图').count(), 0);
    const cache = await app.evaluate(() => global.round5Mock.studio.round5.captures.list('A').length);
    assert.equal(cache, 0);

    step = 'clear-leaves';
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByText('Mock B', { exact: true }).click();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '真实对比' }).click();
    await page.getByRole('button', { name: '拍摄之前' }).click();
    await page.getByAltText('应用前的窗口截图').waitFor();
    await page.getByRole('button', { name: '清除' }).click();
    assert.equal(await page.getByAltText('应用前的窗口截图').count(), 0);
    assert.equal(await app.evaluate(() => global.round5Mock.studio.round5.captures.list('B').length), 0);
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    assert.equal(await app.evaluate(() => global.round5Mock.studio.round5.captures.list('B').length), 0);

    step = 'palette-switch';
    await chooseFile(app, firstImage);
    await page.getByRole('button', { name: /选择一张喜欢的图片|更换壁纸/ }).click();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '整套配色' }).click();
    await app.evaluate(() => { global.round5Mock.delayRead = 700; });
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await chooseFile(app, secondImage);
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: /更换壁纸/ }).click();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '整套配色' }).click();
    await page.getByRole('button', { name: '生成整套主题' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '生成整套主题' }).isEnabled(), true);
    await app.evaluate(() => { global.round5Mock.delayRead = 0; });
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await page.getByText('深色专注', { exact: true }).waitFor();

    step = 'history-failure';
    const probed = await app.evaluate(async () => {
      const studio = global.round5Mock.studio;
      studio.round5.revisions.fault = 'revision';
      try {
        const result = await studio.applyEditorDocument(studio.document, 'B');
        return {
          state: result?.state || null,
          ok: result?.ok,
          code: result?.code || null,
          message: result?.message || null,
          revisionSaved: result?.revisionSaved,
          verification: result?.verification?.status || null,
          failed: (result?.verification?.checks || []).filter(item => item.state === 'failed').map(item => item.id)
        };
      } catch (error) {
        return { thrown: error.message, code: error.code || null };
      }
    });
    if (probed.revisionSaved !== false) {
      throw new Error(`历史失败没有传到应用结果: ${JSON.stringify(probed)}`);
    }
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '选择墨色' }).click();
    await page.getByRole('button', { name: /应用到 Antigravity|更新主题/ }).click();
    await page.getByRole('alert').getByText(/版本历史没有写完/).waitFor();
    await page.getByRole('button', { name: '重试写入历史' }).waitFor();
    await app.evaluate(() => { global.round5Mock.studio.round5.revisions.fault = null; });
    await page.getByRole('button', { name: '重试写入历史' }).click();
    try {
      await page.getByRole('status').getByText('版本历史已经补写完成。').waitFor();
    } catch (error) {
      const notices = await page.locator('.notice').allTextContents().catch(() => []);
      throw new Error(`${error.message}\nnotices=${JSON.stringify(notices)}`);
    }

    step = 'disconnect-chain';
    const before = await app.evaluate(() => global.round5Mock.studio.round5.getTargetState('A', false)?.instanceId || null);
    await app.evaluate(() => { global.round5Mock.connected = false; });
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByRole('button', { name: '重新检测' }).click();
    await page.waitForTimeout(400);
    const after = await app.evaluate(() => ({
      state: global.round5Mock.studio.round5.getTargetState('A', false),
      targets: global.round5Mock.service.targets.size
    }));
    assert.equal(after.targets, 0);
    assert.equal(after.state, null);
    assert.ok(before);
    await app.evaluate(() => { global.round5Mock.connected = true; });
    await page.getByRole('button', { name: '重新检测' }).click();
    await page.getByText('Mock A', { exact: true }).click();
    const reconnected = await app.evaluate(() => global.round5Mock.studio.round5.getTargetState('A', false)?.instanceId || null);
    assert.ok(reconnected);
    assert.notEqual(reconnected, before);

    console.log(JSON.stringify({ ok: true, step, dir }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, step, message: error.message }));
    process.exitCode = 1;
  } finally {
    await closeApp(app);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
})();
