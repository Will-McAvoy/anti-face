const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
async function waitUntil(read, expected) {
  const started = Date.now();
  let actual;
  while (Date.now() - started < 8000) {
    actual = await read();
    if (actual === expected) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(actual, expected);
}
async function waitForSettings(file, predicate) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 8000) {
    try {
      last = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(last);
      if (predicate(parsed)) return parsed;
    } catch { /* 文件可能还在原子替换 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('settings.json 没有在关闭前写到预期状态: ' + last);
}
(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-smoke-'));
  const temps = [temp];
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^选择/ }).count(), 16); // 15 themes + wallpaper
    await page.getByRole('button', { name: '选择极光玻璃', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '选择极光玻璃', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('slider', { name: '背景模糊' }).fill('27');
    await page.getByRole('button', { name: '浅色', exact: true }).click();
    assert.equal(await page.locator('.theme-card').count(), 5);
    await page.getByRole('button', { name: '全部', exact: true }).click();
    await page.getByRole('textbox', { name: '搜索主题' }).fill('不存在的主题');
    await page.getByText('没有找到匹配的主题。试试其他关键词。').waitFor();
    await page.getByRole('textbox', { name: '搜索主题' }).fill('');
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    await page.reload();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '选择极光玻璃', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByRole('slider', { name: '背景模糊' }).inputValue(), '27');
    const png = path.join(temp, 'wallpaper.png');
    await fs.writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', 'base64'));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, png);
    await page.getByRole('button', { name: /选择一张喜欢的图片/ }).click();
    await page.getByRole('button', { name: '移除壁纸', exact: true }).waitFor();
    assert.ok((await page.getByTestId('theme-preview').evaluate(el => getComputedStyle(el).backgroundImage)).includes('data:image/png'));
    await page.getByRole('button', { name: '移除壁纸', exact: true }).click();
    const exported = path.join(temp, 'export.json');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, exported);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByText('主题配置已导出', { exact: true }).waitFor();
    const config = JSON.parse(await fs.readFile(exported, 'utf8'));
    assert.equal(config.themeId, 'aurora');
    const imported = path.join(temp, 'import.json');
    await fs.writeFile(imported, JSON.stringify({ ...config, themeId: 'pearl' }));
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, imported);
    await page.getByRole('button', { name: '导入', exact: true }).click();
    await page.getByText('配置已导入预览，点击应用后才会改变客户端。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '选择珍珠白', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: '关闭提示' }).click();
    await page.getByRole('button', { name: '选择极光玻璃', exact: true }).click();
    // An iframe must not be able to call privileged IPC through the top frame.
    await page.evaluate(() => { const frame = document.createElement('iframe'); frame.srcdoc = '<html></html>'; frame.id = 'ipc-probe-frame'; document.body.appendChild(frame); });
    const iframe = page.frameLocator('#ipc-probe-frame');
    await iframe.locator('body').waitFor({ state: 'attached' });
    assert.equal(await iframe.locator('body').evaluate(() => typeof window.antiFace), 'undefined');
    await page.evaluate(() => document.getElementById('ipc-probe-frame').remove());
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    assert.notEqual(await page.getByTestId('theme-preview').evaluate(el => getComputedStyle(el).backgroundImage), 'none');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(root, 'artifacts/studio.png') });
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByRole('heading', { name: '与 Antigravity 连接。' }).waitFor();
    if (process.argv.includes('--host')) {
      await page.getByRole('button', { name: '重新检测', exact: true }).click();
      await page.getByRole('heading', { name: '可以应用', exact: true }).waitFor({ timeout: 20000 });
      const host = await page.evaluate(() => window.antiFace.inspectHost());
      assert.ok(host.fingerprint && host.compatibility === 'verified');
      await page.getByRole('button', { name: '应用到 Antigravity', exact: true }).click();
      await page.getByRole('heading', { name: '主题生效中', exact: true }).waitFor({ timeout: 20000 });
      await page.getByRole('button', { name: '恢复原样', exact: true }).click();
      await page.getByRole('heading', { name: '可以应用', exact: true }).waitFor({ timeout: 15000 });
      console.log('PASS: real host apply and restore through Electron IPC');
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(root, 'artifacts/connection.png') });
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(root, 'artifacts/studio.png') });
    const exposed = await page.evaluate(() => ({ node: typeof window.require, bridge: typeof window.antiFace?.apply }));
    assert.deepEqual(exposed, { node: 'undefined', bridge: 'function' });
    await assert.rejects(page.evaluate(() => window.antiFace.saveSettings({ schemaVersion: 1, themeId: 'bad', appearance: {} })), /主题不存在/);
    await page.getByRole('button', { name: '实时任务状态', exact: true }).click();
    await page.getByRole('heading', { name: '实时状态与 Token 监控。' }).waitFor();
    const windowSelect = page.getByLabel('选择宿主窗口');
    const noWindow = page.getByText('未发现已验证的 Antigravity 窗口');
    let sawWindow = false;
    try {
      await windowSelect.waitFor({ timeout: 8000 });
      sawWindow = true;
    } catch { /* 当前没有已验证窗口时保持空态 */ }
    if (sawWindow) {
      const values = await windowSelect.locator('option').evaluateAll(nodes => nodes.map(node => node.value));
      assert.ok(values.length >= 1 && values.every(Boolean));
      for (const value of values) await windowSelect.selectOption(value);
      await windowSelect.selectOption(values[0]);
      assert.equal(await windowSelect.inputValue(), values[0]);
    } else {
      await noWindow.waitFor();
      await page.getByText('状态未知').waitFor();
    }
    await page.getByRole('button', { name: '切换为测试模拟数据', exact: true }).click();
    await page.getByText('测试模拟数据 (Fixture)').waitFor();
    await page.getByText('Gemini 3.8 Flash (High) [模拟数据]').waitFor();
    await page.getByText(/2[,.]?200/).waitFor();
    await page.getByRole('button', { name: '切换为真实宿主数据', exact: true }).click();
    await page.getByText('真实 Antigravity 宿主观测').waitFor();
    await page.getByText(/已读到累计 Token|当前没有可核对的 Token 用量/).waitFor();
    assert.equal(await page.getByText('Gemini 3.8 Flash (High) [模拟数据]').count(), 0);
    await page.screenshot({ path: path.join(root, 'artifacts/realtime.png') });
    await page.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    await page.getByRole('heading', { name: '本地任务统计与使用趋势。' }).waitFor();
    const historyToggle = page.getByRole('checkbox', { name: '启用本地历史记录' });
    assert.equal(await historyToggle.isChecked(), false);
    await page.getByText('本地历史记录未启用。开启上方开关后才会保存任务指标。').waitFor();
    await historyToggle.check();
    await page.getByText('已启用本地统计持久化。').waitFor();
    await page.getByLabel('保留周期').selectOption('7');
    await page.getByText('手动清理阈值已设为 7 天。这不会自动删除记录。').waitFor();
    await page.getByLabel('保留周期').selectOption('90');
    await page.getByText('手动清理阈值已设为 90 天。这不会自动删除记录。').waitFor();
    const historyFile = path.join(temp, 'history', 'task_history.jsonl');
    await fs.mkdir(path.dirname(historyFile), { recursive: true });
    const seeded = Array.from({ length: 3 }, (_, index) => JSON.stringify({
      schemaVersion: 1, id: `smoke-${index}`, requestId: `smoke-${index}`, occurredAt: new Date().toISOString(),
      model: 'Gemini 3.8 Flash', project: 'anti_face', status: 'unknown', outputTokens: index + 1, isComplete: false, provenance: 'real'
    }));
    await fs.writeFile(historyFile, seeded.join('\n') + '\n');
    await page.getByTitle('刷新历史').click();
    await page.getByRole('cell', { name: 'Gemini 3.8 Flash' }).first().waitFor();
    const historyCsv = path.join(temp, 'history.csv');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, historyCsv);
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    await page.getByText(/已成功导出至/).waitFor();
    const csv = await fs.readFile(historyCsv, 'utf8');
    assert.equal(csv.trim().split(/\r?\n/).length, 4);
    await page.screenshot({ path: path.join(root, 'artifacts/history.png') });
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    const themeOnly = path.join(temp, 'theme-only.json');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, themeOnly);
    await page.getByRole('button', { name: '导出', exact: true }).click();
    await page.getByText('主题配置已导出', { exact: true }).waitFor();
    const themeExport = JSON.parse(await fs.readFile(themeOnly, 'utf8'));
    assert.equal(themeExport.themeId, 'aurora');
    assert.equal(Object.hasOwn(themeExport, 'history'), false);
    assert.equal(Object.hasOwn(themeExport, 'autoRestoreOnReload'), false);
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    const detectedWindows = page.getByText('已检测宿主窗口:');
    const absentWindows = page.getByText('未发现已验证的 Antigravity 窗口。');
    await detectedWindows.or(absentWindows).waitFor();
    if (await detectedWindows.count()) {
      await page.getByText(/^状态:/).first().click();
    }
    const autoRestore = page.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ });
    assert.equal(await autoRestore.isChecked(), false);
    await autoRestore.check();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    await waitForSettings(path.join(temp, 'settings.json'), saved =>
      saved.themeId === 'aurora'
      && saved.appearance.blur === 27
      && saved.autoRestoreOnReload === true
      && saved.history?.enabled === true
      && saved.history?.retentionDays === 90);
    assert.deepEqual(errors, []);
    await app.close();
    app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    const revived = await app.firstWindow();
    const revivedErrors = [];
    revived.on('pageerror', error => revivedErrors.push(error.message));
    await revived.getByText('设置已保存到本机', { exact: true }).waitFor();
    assert.equal(await revived.getByRole('button', { name: '选择极光玻璃', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await revived.getByRole('slider', { name: '背景模糊' }).inputValue(), '27');
    await revived.getByRole('button', { name: '连接与兼容', exact: true }).click();
    assert.equal(await revived.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ }).isChecked(), true);
    await revived.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    const revivedHistory = revived.getByRole('checkbox', { name: '启用本地历史记录' });
    const revivedRetention = revived.getByLabel('保留周期');
    await waitUntil(() => revivedHistory.isChecked(), true);
    await waitUntil(() => revivedRetention.inputValue(), '90');
    await revived.getByRole('cell', { name: 'Gemini 3.8 Flash' }).first().waitFor();
    assert.deepEqual(revivedErrors, []);
    console.log('PASS: desktop UI, filtering, persistence, wallpaper, JSON import/export, IPC validation, renderer isolation, telemetry, history export, process restart');
    await app.close();
    app = null;

    const legacy = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-smoke-'));
    temps.push(legacy);
    await fs.writeFile(path.join(legacy, 'settings.json'), JSON.stringify({
      schemaVersion: 1,
      themeId: 'pearl',
      appearance: { blur: 12, opacity: 70, radius: 16, wallpaper: null }
    }));
    const legacyEnv = { ...process.env, ANTI_FACE_TEST_USER_DATA: legacy };
    delete legacyEnv.ELECTRON_RUN_AS_NODE;
    delete legacyEnv.ANTI_FACE_DEV_URL;
    app = await electron.launch({ args: [root], cwd: root, env: legacyEnv, timeout: 30000 });
    const migrated = await app.firstWindow();
    await migrated.getByText('设置已保存到本机', { exact: true }).waitFor();
    assert.equal(await migrated.getByRole('button', { name: '选择珍珠白', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await migrated.getByRole('slider', { name: '背景模糊' }).inputValue(), '12');
    await migrated.getByRole('button', { name: '连接与兼容', exact: true }).click();
    assert.equal(await migrated.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ }).isChecked(), false);
    await migrated.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    assert.equal(await migrated.getByRole('checkbox', { name: '启用本地历史记录' }).isChecked(), false);
    assert.equal(await migrated.getByLabel('保留周期').inputValue(), '30');
    await migrated.getByRole('checkbox', { name: '启用本地历史记录' }).check();
    await migrated.getByLabel('保留周期').selectOption('7');
    await migrated.getByText('手动清理阈值已设为 7 天。这不会自动删除记录。').waitFor();
    await migrated.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await migrated.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ }).check();
    await migrated.getByText('设置已保存到本机', { exact: true }).waitFor();
    await waitForSettings(path.join(legacy, 'settings.json'), saved =>
      saved.themeId === 'pearl'
      && saved.appearance.blur === 12
      && saved.autoRestoreOnReload === true
      && saved.history?.enabled === true
      && saved.history?.retentionDays === 7);
    await app.close();
    app = await electron.launch({ args: [root], cwd: root, env: legacyEnv, timeout: 30000 });
    const migratedAgain = await app.firstWindow();
    await migratedAgain.getByText('设置已保存到本机', { exact: true }).waitFor();
    assert.equal(await migratedAgain.getByRole('button', { name: '选择珍珠白', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await migratedAgain.getByRole('slider', { name: '背景模糊' }).inputValue(), '12');
    await migratedAgain.getByRole('button', { name: '连接与兼容', exact: true }).click();
    assert.equal(await migratedAgain.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ }).isChecked(), true);
    await migratedAgain.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    const migratedHistory = migratedAgain.getByRole('checkbox', { name: '启用本地历史记录' });
    const migratedRetention = migratedAgain.getByLabel('保留周期');
    await waitUntil(() => migratedHistory.isChecked(), true);
    await waitUntil(() => migratedRetention.inputValue(), '7');
    console.log('PASS: old settings migrate, preferences stay off until chosen, then survive process restart');
    await app.close();
    app = null;

    const bare = await electron.launch({ args: [path.join(root, 'scripts/no-preload-shell.cjs')], cwd: root, env, timeout: 30000 });
    app = bare;
    const browser = await bare.firstWindow();
    await browser.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    await browser.getByRole('button', { name: '实时任务状态', exact: true }).click();
    await browser.getByText('实时遥测需要桌面版 Anti Face。浏览器预览不能读取宿主任务。').waitFor();
    assert.equal(await browser.getByText('正在读取实时遥测数据…').count(), 0);
    await browser.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    await browser.getByText('本地历史需要桌面版 Anti Face。浏览器预览不能读写本机历史。').waitFor();
    assert.equal(await browser.getByText('启用本地历史记录').count(), 0);
    console.log('PASS: realtime and history without preload explain that the desktop app is required');
  } finally {
    if (app) await app.close();
    for (const dir of temps) {
      const resolved = path.resolve(dir);
      assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('anti-face-smoke-'));
      await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
