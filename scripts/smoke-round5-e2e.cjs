// Button-driven Electron chain against the simulated host. Not a real Antigravity pass.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'tests/fixtures/desktop-round5-host.cjs');
const corePath = path.join(root, 'core/effective-appearance.cjs');

function png(red, green, blue) {
  const image = new PNG({ width: 48, height: 32 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = red;
    image.data[index + 1] = green;
    image.data[index + 2] = blue;
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image);
}

async function revisionCount(dir) {
  const records = path.join(dir, 'theme-revisions', 'records');
  const names = await fs.readdir(records).catch(() => []);
  return names.filter(name => name.endsWith('.json')).length;
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

async function removeDir(dir) {
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('refusing to delete outside temp');
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByText('设置已保存到本机', { exact: true }).waitFor();
  return { app, page, errors };
}

async function chooseFile(app, file) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
  }, file);
}

async function hostState(page) {
  return page.locator('.connection-card h2').innerText();
}

async function selectWindow(page, id) {
  await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
  await page.getByText(`Mock ${id}`, { exact: true }).click();
  await page.locator('.connection-card h2').filter({ hasText: /可以应用|主题生效中/ }).waitFor();
}

async function applyTheme(page) {
  const button = page.getByRole('button', { name: /应用到 Antigravity|更新主题/ });
  await button.waitFor();
  await page.waitForFunction(() => {
    const found = [...document.querySelectorAll('button')].find(item => /应用到 Antigravity|更新主题/.test(item.textContent || ''));
    return !!found && !found.disabled;
  });
  await button.click();
}

(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r5-e2e-'));
  const bright = path.join(dir, 'bright.png');
  const dark = path.join(dir, 'dark.png');
  const secretDir = 'C:\\do-not-leak-secret-chat\\transcripts';
  await fs.writeFile(bright, png(250, 250, 246));
  await fs.writeFile(dark, png(8, 10, 14));
  let app;
  let page;
  let errors = [];
  let step = 'launch';
  try {
    ({ app, page, errors } = await openApp(dir));
    step = 'E02';
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '项目外观' }).click();
    await chooseFile(app, 'C:\\proj-alpha');
    await page.getByRole('button', { name: '选择项目文件夹' }).click();
    await page.getByText('已识别项目：proj-alpha').waitFor();
    await page.getByLabel('主题标识').fill('ink');
    await page.getByRole('button', { name: '保存项目绑定' }).click();
    await page.getByText(/proj-alpha → ink/).waitFor();
    await selectWindow(page, 'B');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '项目外观' }).click();
    await chooseFile(app, 'C:\\proj-beta');
    await page.getByRole('button', { name: '选择项目文件夹' }).click();
    await page.getByText('已识别项目：proj-beta').waitFor();
    await page.getByLabel('主题标识').fill('pearl');
    await page.getByRole('button', { name: '保存项目绑定' }).click();
    await page.getByText(/proj-beta → pearl/).waitFor();
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '选择墨色' }).click();
    await applyTheme(page);
    await selectWindow(page, 'A');
    await page.locator('.connection-card h2', { hasText: '主题生效中' }).waitFor();
    await selectWindow(page, 'B');
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '选择珍珠白' }).click();
    await applyTheme(page);
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.locator('.connection-card h2', { hasText: '主题生效中' }).waitFor();
    const isolated = await app.evaluate(() => ({
      a: global.round5Mock.windows.A.css,
      b: global.round5Mock.windows.B.css
    }));
    assert.match(isolated.a, /color:#f5f5f5/);
    assert.match(isolated.b, /color:#25352c/);
    assert.notEqual(isolated.a, isolated.b);

    step = 'E03';
    // 恢复原样只作用于当前窗口。B 的慢探测返回后，不能改写 A，也不能给 B 再注入一次。
    await selectWindow(page, 'A');
    await page.locator('.connection-card h2', { hasText: '主题生效中' }).waitFor();
    const beforeRace = await app.evaluate(() => ({
      writes: [global.round5Mock.windows.A.writes, global.round5Mock.windows.B.writes],
      ownerA: global.round5Mock.windows.A.owner,
      ownerB: global.round5Mock.windows.B.owner,
      cssA: global.round5Mock.windows.A.css,
      cssB: global.round5Mock.windows.B.css
    }));
    assert.ok(beforeRace.ownerA);
    assert.ok(beforeRace.ownerB);
    await app.evaluate(() => { global.round5Mock.delayB = 600; });
    await page.getByText('Mock B', { exact: true }).click();
    await page.getByText('Mock A', { exact: true }).click();
    await page.locator('.connection-card h2', { hasText: '检测中' }).waitFor({ timeout: 3000 }).catch(() => {});
    await page.locator('.connection-card h2', { hasText: '主题生效中' }).waitFor();
    await page.getByRole('button', { name: '恢复原样', exact: true }).click();
    await page.locator('.connection-card h2', { hasText: '可以应用' }).waitFor();
    await page.waitForTimeout(900);
    const afterRace = await app.evaluate(() => ({
      writes: [global.round5Mock.windows.A.writes, global.round5Mock.windows.B.writes],
      ownerA: global.round5Mock.windows.A.owner,
      ownerB: global.round5Mock.windows.B.owner,
      cssA: global.round5Mock.windows.A.css,
      cssB: global.round5Mock.windows.B.css
    }));
    assert.equal(afterRace.writes[0], beforeRace.writes[0]);
    assert.equal(afterRace.writes[1], beforeRace.writes[1]);
    assert.equal(afterRace.ownerA, null);
    assert.equal(afterRace.cssA, '');
    assert.equal(afterRace.ownerB, beforeRace.ownerB);
    assert.equal(afterRace.cssB, beforeRace.cssB);
    assert.equal(await page.locator('div.connection-card h2').innerText(), '可以应用');
    await app.evaluate(() => { global.round5Mock.delayB = 0; });

    step = 'E08';
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '真实对比' }).click();
    await page.getByRole('button', { name: '拍摄之前' }).click();
    const beforeShot = page.getByAltText('应用前的窗口截图');
    await beforeShot.waitFor();
    const beforeSrc = await beforeShot.getAttribute('src');
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '选择墨色' }).click();
    await applyTheme(page);
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '真实对比' }).click();
    await page.getByRole('button', { name: '拍摄之后' }).click();
    await page.getByAltText('应用后的窗口截图').waitFor();
    await selectWindow(page, 'B');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '真实对比' }).click();
    assert.equal(await page.getByAltText('应用前的窗口截图').count(), 0);
    assert.equal(await page.getByAltText('应用后的窗口截图').count(), 0);
    await page.getByRole('button', { name: '拍摄之前' }).click();
    const switched = page.getByAltText('应用前的窗口截图');
    await switched.waitFor();
    assert.notEqual(await switched.getAttribute('src'), beforeSrc);
    const captures = await app.evaluate(() => {
      const crypto = global.round5Require('node:crypto');
      const store = global.round5Mock.studio.round5.captures;
      const hash = (id, phase) => {
        const image = store.image(id, phase);
        return image?.png ? crypto.createHash('sha256').update(image.png).digest('hex') : null;
      };
      const a = store.list('A');
      const b = store.list('B');
      const beforeA = a.find(item => item.before);
      const beforeB = b.find(item => item.before);
      return {
        aw: beforeA?.viewport?.width,
        bw: beforeB?.viewport?.width,
        paired: !!(beforeA && a.some(item => item.after && item.id === beforeA.id)),
        aBefore: beforeA ? hash(beforeA.id, 'before') : null,
        bBefore: beforeB ? hash(beforeB.id, 'before') : null
      };
    });
    assert.equal(captures.paired, true);
    assert.equal(captures.aw, 1280);
    assert.equal(captures.bw, 900);
    assert.ok(captures.aBefore && captures.bBefore);
    assert.notEqual(captures.aBefore, captures.bBefore);

    step = 'E01';
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await chooseFile(app, bright);
    await page.getByRole('button', { name: /选择一张喜欢的图片|更换壁纸/ }).click();
    await page.getByRole('button', { name: /更换壁纸/ }).waitFor();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '构图' }).click();
    await page.getByRole('button', { name: '主体右移' }).click();
    const subject = page.getByRole('button', { name: '主体', exact: true });
    const box = await subject.boundingBox();
    assert.ok(box && box.width > 20);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('tab', { name: '阅读保护' }).click();
    await page.getByRole('button', { name: '自动保护' }).click();
    await page.getByRole('tab', { name: '整套配色' }).click();
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await page.getByText('深色专注', { exact: true }).waitFor();
    await page.getByRole('button', { name: '采用整套' }).first().click();
    const revisionsBefore = await revisionCount(dir);
    await page.getByRole('button', { name: '实时试穿', exact: true }).click();
    await page.getByText('实时试穿会暂时修改当前反重力窗口', { exact: false }).waitFor();
    await page.getByRole('button', { name: '保存并结束试穿', exact: true }).click();
    await page.getByText('试穿已保存', { exact: true }).waitFor();
    assert.equal(await revisionCount(dir), revisionsBefore + 1);
    const effective = await app.evaluate((_electron, file) => {
      const { resolveEffectiveAppearance } = global.round5Require(file);
      const studio = global.round5Mock.studio;
      const resolved = resolveEffectiveAppearance(studio.document, studio.round5.contextFor('B'), studio.round5.analysisFor(studio.document));
      return { foreground: resolved.resolved.colors.foreground, css: global.round5Mock.windows.B.css };
    }, corePath);
    assert.match(effective.css, new RegExp(`color:${effective.foreground}`, 'i'));
    assert.match(effective.css, /pointer-events:none/);
    const framed = JSON.parse(await fs.readFile(path.join(dir, 'appearance.json'), 'utf8'));
    assert.equal(framed.document.wallpaper.composition.policy, 'manual');
    assert.ok(framed.document.wallpaper.composition.subjectRect);
    assert.ok(framed.document.wallpaper.composition.subjectRect.x > 0.3);
    assert.equal(framed.document.readability.mode, 'auto');

    step = 'E06';
    await page.getByRole('tab', { name: '整套配色' }).click();
    await app.evaluate(() => { global.round5Mock.delayRead = 800; });
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.waitForTimeout(1000);
    assert.equal(await page.getByRole('button', { name: '采用整套' }).count(), 0);
    await app.evaluate(() => { global.round5Mock.delayRead = 900; });
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await page.getByRole('tab', { name: '阅读保护' }).click();
    await page.waitForTimeout(1100);
    await page.getByRole('tab', { name: '整套配色' }).click();
    assert.equal(await page.getByRole('button', { name: '采用整套' }).count(), 0);
    const jobs = await app.evaluate(() => {
      global.round5Mock.delayRead = 0;
      return global.round5Mock.studio.round5.jobs.size;
    });
    assert.equal(jobs, 0);

    step = 'E04';
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '场景' }).click();
    await page.getByRole('button', { name: '自动', exact: true }).click();
    await page.getByText('当前识别：还不确定').waitFor();
    await app.evaluate(() => { global.round5Mock.scenes.A = 'home'; global.round5Mock.now = 20000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：还不确定').waitFor();
    const unstableWrites = await app.evaluate(() => global.round5Mock.windows.A.writes);
    await page.waitForTimeout(250);
    assert.equal(await app.evaluate(() => global.round5Mock.windows.A.writes), unstableWrites);
    await app.evaluate(() => { global.round5Mock.now = 21000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：首页').waitFor();
    await app.evaluate(() => { global.round5Mock.scenes.A = 'chat'; global.round5Mock.now = 21000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：首页').waitFor();
    await app.evaluate(() => { global.round5Mock.now = 22000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：聊天').waitFor();
    await app.evaluate(() => { global.round5Mock.scenes.A = 'unknown'; global.round5Mock.now = 23000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：聊天').waitFor();
    await app.evaluate(() => { global.round5Mock.now = 24000; });
    await page.getByRole('button', { name: '再识别一次' }).click();
    await page.getByText('当前识别：还不确定').waitFor();
    const pinnedWrites = await app.evaluate(() => global.round5Mock.windows.A.writes);
    await page.getByRole('button', { name: '固定首页' }).click();
    await page.getByText('当前识别：固定首页').waitFor();
    await app.evaluate(() => { global.round5Mock.scenes.A = 'chat'; global.round5Mock.now = 30000; global.round5Mock.autoScene = true; });
    await page.waitForTimeout(200);
    await app.evaluate(() => { global.round5Mock.autoScene = false; });
    assert.equal(await app.evaluate(() => global.round5Mock.windows.A.writes), pinnedWrites);

    step = 'E05';
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '实时试穿', exact: true }).click();
    await page.getByText('实时试穿会暂时修改当前反重力窗口', { exact: false }).waitFor();
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByLabel('自动切换模式').selectOption('schedule');
    await page.getByRole('button', { name: '添加时间点' }).click();
    const during = await app.evaluate(async () => {
      const before = global.round5Mock.windows.A.writes;
      const decision = await global.round5Mock.automation.tick();
      return { before, after: global.round5Mock.windows.A.writes, applied: decision.applied === true, action: decision.action };
    });
    assert.equal(during.applied, false);
    assert.equal(during.after, during.before);
    await page.getByRole('button', { name: '取消试穿', exact: true }).click();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '项目外观' }).click();
    await page.getByLabel('主题标识').fill('pearl');
    const alphaBinding = page.locator('li', { hasText: 'proj-alpha' });
    await alphaBinding.getByRole('button', { name: '改绑' }).click();
    await alphaBinding.getByText(/→ pearl/).waitFor();
    // E03 restored the host and paused global automation. Rebinding resumes
    // the target guard, but must not silently undo that explicit global pause.
    const paused = await app.evaluate(async () => {
      const before = global.round5Mock.windows.A.writes;
      const decision = await global.round5Mock.automation.tick();
      return { before, after: global.round5Mock.windows.A.writes, decision };
    });
    assert.equal(paused.decision.applied, false);
    assert.equal(paused.decision.reason, 'paused-restore');
    assert.equal(paused.after, paused.before);
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByRole('button', { name: '恢复自动切换', exact: true }).click();
    await page.getByText('已恢复自动切换', { exact: false }).waitFor();
    const scheduled = await app.evaluate(async () => {
      const context = global.round5Mock.studio.round5.contextDecision('A');
      const decision = await global.round5Mock.automation.tick();
      return { theme: decision.themeId, css: global.round5Mock.windows.A.css, applied: decision.applied === true, decision, context };
    });
    console.log('E05 automation decision:', JSON.stringify({ applied: scheduled.applied, theme: scheduled.theme, reason: scheduled.decision.reason, stale: scheduled.decision.stale, skipped: scheduled.decision.skipped, code: scheduled.decision.result?.code, context: scheduled.context }));
    assert.equal(scheduled.applied, true);
    assert.equal(scheduled.theme, 'pearl');
    assert.match(scheduled.css, /color:#25352c/);

    step = 'E07';
    const beforeFail = await app.evaluate(() => ({ css: global.round5Mock.windows.A.css, revisions: 0 }));
    beforeFail.revisions = await revisionCount(dir);
    await app.evaluate(() => { global.round5Mock.failVerifies = 1; });
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '选择墨色' }).click();
    await applyTheme(page);
    await page.getByRole('alert').filter({ hasText: /恢复|没有按预期|核对/ }).waitFor();
    assert.equal(await page.getByText('已应用到 Antigravity', { exact: false }).count(), 0);
    const afterFail = await app.evaluate(() => global.round5Mock.windows.A.css);
    assert.equal(afterFail, beforeFail.css);
    assert.equal(await revisionCount(dir), beforeFail.revisions);
    assert.equal(await page.getByRole('button', { name: '更新主题' }).count(), 1);

    step = 'E10';
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '精选' }).click();
    await page.getByText('远程源未配置', { exact: false }).waitFor();
    await page.getByRole('button', { name: /石墨夜读/ }).click();
    await page.getByRole('button', { name: '加入个人库' }).click();
    const libraryFile = path.join(dir, 'theme-library.json');
    let installed = false;
    for (let attempt = 0; attempt < 40 && !installed; attempt += 1) {
      try {
        const library = JSON.parse(await fs.readFile(libraryFile, 'utf8'));
        installed = library.themes.some(theme => theme.sourceItemId === 'curated-01');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (!installed) await page.waitForTimeout(250);
    }
    assert.equal(installed, true);
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.locator('article.theme-card', { hasText: '石墨夜读' }).getByRole('button', { name: '用这套' }).click();
    await page.getByText('已切换到个人主题', { exact: false }).waitFor();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '阅读保护' }).click();
    await page.getByRole('button', { name: '仅建议' }).click();
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '写回当前个人主题' }).click();
    await page.getByText('已写回个人主题', { exact: false }).waitFor();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '精选' }).click();
    await page.getByRole('button', { name: /石墨夜读/ }).click();
    await page.getByText('你改过已加入的副本', { exact: false }).waitFor();
    await page.getByRole('button', { name: '加入个人库' }).click();
    await page.getByRole('alert').filter({ hasText: '改过' }).waitFor();
    const dirty = JSON.parse(await fs.readFile(libraryFile, 'utf8')).themes.find(theme => theme.sourceItemId === 'curated-01');
    assert.equal(dirty.dirty, true);
    assert.equal(dirty.document.readability.mode, 'suggest');

    step = 'E12';
    await selectWindow(page, 'A');
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '项目外观' }).click();
    await chooseFile(app, secretDir);
    await page.getByRole('button', { name: '选择项目文件夹' }).click();
    await page.getByText('已识别项目：transcripts').waitFor();
    await page.getByRole('tab', { name: '诊断' }).click();
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.getByText('只做被动检查', { exact: false }).waitFor();
    const diagnosticFile = path.join(dir, 'diag.json');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, diagnosticFile);
    await page.getByRole('button', { name: '导出诊断' }).click();
    let exported = '';
    for (let attempt = 0; attempt < 20 && !exported; attempt += 1) {
      exported = await fs.readFile(diagnosticFile, 'utf8').catch(() => '');
      if (!exported) await page.waitForTimeout(200);
    }
    assert.ok(exported);
    assert.equal(exported.includes('do-not-leak'), false);
    assert.equal(exported.includes('secret-chat'), false);
    assert.equal(exported.includes('transcripts\\'), false);
    assert.equal(exported.includes('data:image'), false);
    assert.equal(exported.includes('BEGIN_CHAT'), false);
    const pageText = await page.locator('.round5-pre').innerText();
    assert.equal(pageText.includes(secretDir), false);

    step = 'E09';
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    // Make the history asset explicit; selecting a draft no longer autosaves it.
    await chooseFile(app, bright);
    await page.getByRole('button', { name: /选择一张喜欢的图片|更换壁纸/ }).click();
    await page.getByRole('button', { name: /更换壁纸/ }).waitFor();
    await page.getByLabel('新主题名称').fill('旧壁纸');
    await page.getByRole('button', { name: '另存为我的主题' }).click();
    await page.getByText('已保存个人主题 旧壁纸', { exact: false }).waitFor();
    await page.locator('article.theme-card', { hasText: '旧壁纸' }).getByRole('button', { name: '用这套' }).click();
    await page.getByText('已切换到个人主题', { exact: false }).waitFor();
    // The next launch opens the saved appearance's history, so explicitly apply it.
    await applyTheme(page);
    await page.getByText('已应用到 Antigravity', { exact: false }).waitFor();
    const assetA = await app.evaluate(() => global.round5Mock.studio.library.data.themes.find(theme => theme.name === '旧壁纸').document.wallpaper.assetId);
    assert.ok(assetA);
    await chooseFile(app, dark);
    await page.getByRole('button', { name: /选择一张喜欢的图片|更换壁纸/ }).click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '写回当前个人主题' }).click();
    await page.getByText('已写回个人主题', { exact: false }).waitFor();
    await page.locator('article.theme-card', { hasText: '旧壁纸' }).getByRole('button', { name: '删除' }).click();
    await page.getByText('旧壁纸', { exact: true }).waitFor({ state: 'detached' }).catch(() => {});
    const assetPath = await app.evaluate((_electron, id) => {
      const record = global.round5Mock.studio.assets.get(id);
      return record ? global.round5Require('node:path').join(global.round5Mock.studio.assets.files, record.file) : null;
    }, assetA);
    assert.ok(assetPath);
    await fs.access(assetPath);
    await closeApp(app);
    app = null;
    ({ app, page, errors } = await openApp(dir));
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '版本' }).click();
    await page.getByRole('button', { name: '刷新历史' }).click();
    const restores = page.getByRole('button', { name: '确认恢复' });
    await restores.first().waitFor();
    const restoreCount = await restores.count();
    assert.ok(restoreCount >= 2);
    await restores.nth(restoreCount - 1).click();
    await page.waitForTimeout(500);
    const restored = JSON.parse(await fs.readFile(path.join(dir, 'appearance.json'), 'utf8'));
    assert.equal(restored.document.wallpaper.assetId, assetA);
    await fs.access(assetPath);
    const gc = await app.evaluate(async (_electron, id) => {
      const fs = global.round5Require('node:fs/promises');
      const path = global.round5Require('node:path');
      const studio = global.round5Mock.studio;
      await fs.writeFile(path.join(studio.assets.files, 'orphan-e09.png'), Buffer.from('orphan'));
      studio.assets.records.set('orphan-e09', {
        id: 'orphan-e09', file: 'orphan-e09.png', thumbnail: null, refs: [], createdAt: '2000-01-01T00:00:00.000Z',
        sha256: '0', ext: 'png', mime: 'image/png', width: 1, height: 1, bytes: 6
      });
      const removed = await studio.assets.gc(Date.now());
      return { removed, refs: studio.assets.get(id)?.refs || [], orphan: !!studio.assets.get('orphan-e09') };
    }, assetA);
    assert.ok(gc.removed >= 1);
    assert.equal(gc.orphan, false);
    assert.ok(gc.refs.some(ref => ref.startsWith('revision:')));
    await fs.access(assetPath);

    assert.deepEqual(errors, []);
    await closeApp(app);
    app = null;

    step = 'E11';
    const migrateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r5-e11-'));
    try {
      await fs.writeFile(path.join(migrateDir, 'settings.json'), JSON.stringify({
        schemaVersion: 1,
        themeId: 'graphite',
        appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null }
      }));
      ({ app, page, errors } = await openApp(migrateDir));
      const migrated = JSON.parse(await fs.readFile(path.join(migrateDir, 'appearance.json'), 'utf8'));
      assert.equal(migrated.schemaVersion, 1);
      assert.equal(migrated.document.baseThemeId, 'graphite');
      assert.equal(migrated.document.readability.mode, 'off');
      assert.equal(migrated.document.readability.targetContrast, 4.5);
      assert.deepEqual(migrated.document.readability.locks, []);
      assert.equal(migrated.document.sceneAppearance.mode, 'off');
      assert.equal(migrated.document.wallpaper.composition.policy, 'manual');
      assert.equal(migrated.document.wallpaper.composition.subjectRect, null);
      assert.equal(migrated.document.regions.global.opacity, 88);
      await closeApp(app);
      app = null;
      const future = '{"schemaVersion":99,"marker":"KEEP_FUTURE_BYTES"}\n';
      const futureFile = path.join(migrateDir, 'appearance.json');
      await fs.writeFile(futureFile, future);
      ({ app, page, errors } = await openApp(migrateDir));
      await selectWindow(page, 'A');
      await page.getByRole('button', { name: '实时试穿', exact: true }).click();
      await page.getByRole('button', { name: '保存并结束试穿', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: /停止写入|版本过新|损坏/ }).waitFor();
      assert.equal(await fs.readFile(futureFile, 'utf8'), future);
      await closeApp(app);
      app = null;
    } finally {
      if (app) await closeApp(app);
      app = null;
      await removeDir(migrateDir);
    }
    console.log('PASS: round5 button chain E01-E12 on simulated host');
  } catch (error) {
    console.error('FAILED at', step);
    if (page) console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 1800));
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (app) await closeApp(app);
    await removeDir(dir);
  }
})();
