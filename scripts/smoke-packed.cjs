// Launches the freshly unpacked EXE. Uses an isolated userData directory and does not theme the live host.
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const exe = path.join(root, 'release', 'win-unpacked', 'Anti Face.exe');

(async () => {
  await fs.access(exe);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-packed-'));
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  let app;
  try {
    app = await electron.launch({ executablePath: exe, env, cwd: root, timeout: 30000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    for (const name of ['实时任务状态', '本地历史与趋势', '连接与兼容', '主题与外观']) {
      await page.getByRole('button', { name, exact: true }).click();
      if (name === '实时任务状态') await page.getByRole('heading', { name: '实时状态与 Token 监控。' }).waitFor();
      if (name === '本地历史与趋势') await page.getByRole('heading', { name: '本地任务统计与使用趋势。' }).waitFor();
      if (name === '连接与兼容') await page.getByRole('heading', { name: '与 Antigravity 连接。' }).waitFor();
      if (name === '主题与外观') await page.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    }
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: /宿主刷新后自动恢复主题/ }).isChecked(), false);
    await page.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    const historyToggle = page.getByRole('checkbox', { name: '启用本地历史记录' });
    assert.equal(await historyToggle.isChecked(), false);
    assert.equal(await page.getByLabel('保留周期').inputValue(), '30');
    await assert.rejects(page.evaluate(() => window.antiFace.saveSettings({ schemaVersion: 1, themeId: 'bad', appearance: {} })), /主题不存在/);
    await page.getByRole('button', { name: '实时任务状态', exact: true }).click();
    await page.getByRole('button', { name: '切换为测试模拟数据', exact: true }).click();
    await page.getByText('Gemini 3.8 Flash (High) [模拟数据]').waitFor();
    await page.getByRole('button', { name: '切换为真实宿主数据', exact: true }).click();
    await page.getByText('真实 Antigravity 宿主观测').waitFor();
    assert.equal(await page.getByText('Gemini 3.8 Flash (High) [模拟数据]').count(), 0);
    await page.getByRole('button', { name: '本地历史与趋势', exact: true }).click();
    await historyToggle.check();
    await page.getByText('已启用本地统计持久化。').waitFor();
    const historyFile = path.join(temp, 'history', 'task_history.jsonl');
    await fs.mkdir(path.dirname(historyFile), { recursive: true });
    const lines = Array.from({ length: 125 }, (_, index) => JSON.stringify({
      schemaVersion: 1, id: `packed-${index}`, requestId: `packed-${index}`, occurredAt: new Date().toISOString(), outputTokens: 1, provenance: 'real'
    }));
    await fs.writeFile(historyFile, lines.join('\n') + '\n');
    await page.getByTitle('刷新历史').click();
    await page.getByRole('cell', { name: '1' }).first().waitFor();
    const csvFile = path.join(temp, 'packed-history.csv');
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, csvFile);
    await page.getByRole('button', { name: '导出 CSV', exact: true }).click();
    await page.getByText(/已成功导出至/).waitFor();
    const csvLines = (await fs.readFile(csvFile, 'utf8')).trim().split(/\r?\n/);
    assert.equal(csvLines.length, 126);
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    await page.getByText(`v${version}`, { exact: true }).waitFor();
    await page.getByRole('button', { name: '实时试穿', exact: true }).waitFor();
    await page.getByRole('button', { name: '侧边栏', exact: true }).click();
    await page.getByRole('button', { name: '重置此区域', exact: true }).waitFor();
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    assert.equal(await page.getByLabel('自动切换模式').inputValue(), 'off');
    assert.equal(await page.getByRole('checkbox', { name: '关闭窗口时保留在托盘（默认仍是退出）' }).isChecked(), false);
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('heading', { name: '阅读保护', exact: true }).waitFor();
    await page.getByRole('tab', { name: '诊断' }).click();
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.getByText('只做被动检查', { exact: false }).waitFor();
    await page.getByRole('tab', { name: '版本' }).click();
    await page.getByRole('heading', { name: '版本历史' }).waitFor();
    await page.getByRole('tab', { name: '精选' }).click();
    await page.getByRole('heading', { name: '内置精选' }).waitFor();
    await page.getByText('远程源未配置', { exact: false }).waitFor();
    await page.getByRole('button', { name: /石墨夜读/ }).click();
    await page.getByRole('heading', { name: '石墨夜读' }).waitFor();
    await page.getByRole('button', { name: '加入个人库' }).click();
    const libraryFile = path.join(temp, 'theme-library.json');
    let packedLibrary = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        packedLibrary = JSON.parse(await fs.readFile(libraryFile, 'utf8'));
        if (packedLibrary.themes.some(theme => theme.sourceItemId === 'curated-01')) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await page.waitForTimeout(250);
    }
    if (!packedLibrary?.themes?.some(theme => theme.sourceItemId === 'curated-01')) {
      const body = await page.locator('body').innerText();
      const listing = await fs.readdir(temp).catch(error => [error.message]);
      assert.fail(`${JSON.stringify(packedLibrary)}\n${listing.join(',')}\n${body.slice(0, 1800)}`);
    }
    const packedRead = await app.evaluate(async ({ app: electronApp }) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      const preview = path.join(electronApp.getAppPath(), 'assets', 'catalog', 'previews', '01.png');
      const wallpaper = path.join(electronApp.getAppPath(), 'assets', 'catalog', 'wallpapers', '01.png');
      const previewBytes = fs.readFileSync(preview);
      const wallpaperBytes = fs.readFileSync(wallpaper);
      const worker = path.join(process.resourcesPath, 'app.asar.unpacked', 'desktop', 'workers', 'image-analysis.cjs');
      const workerText = fs.readFileSync(worker, 'utf8');
      return {
        previewBytes: previewBytes.length,
        previewSig: previewBytes.subarray(0, 8).toString('hex'),
        wallpaperBytes: wallpaperBytes.length,
        workerReady: workerText.includes('parentPort')
      };
    });
    assert.ok(packedRead.previewBytes > 32);
    assert.equal(packedRead.previewSig, '89504e470d0a1a0a');
    assert.ok(packedRead.wallpaperBytes > 32);
    assert.equal(packedRead.workerReady, true);
    const bright = path.join(temp, 'packed-bright.png');
    const { PNG } = require('pngjs');
    const image = new PNG({ width: 32, height: 32 });
    for (let index = 0; index < image.data.length; index += 4) {
      image.data[index] = 250;
      image.data[index + 1] = 250;
      image.data[index + 2] = 245;
      image.data[index + 3] = 255;
    }
    await fs.writeFile(bright, PNG.sync.write(image));
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, bright);
    await page.getByRole('button', { name: '选择一张喜欢的图片' }).click();
    await page.getByRole('button', { name: '更换壁纸' }).waitFor();
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('tab', { name: '整套配色' }).click();
    await page.getByRole('button', { name: '生成整套主题' }).click();
    await page.getByRole('button', { name: '采用整套' }).first().waitFor();
    await page.getByRole('button', { name: '采用整套' }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByLabel('新主题名称').fill('打包生成');
    await page.getByRole('button', { name: '另存为我的主题' }).click();
    let savedName = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const library = JSON.parse(await fs.readFile(libraryFile, 'utf8'));
        savedName = library.themes.some(theme => theme.name === '打包生成');
        if (savedName) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await page.waitForTimeout(250);
    }
    assert.equal(savedName, true);
    assert.deepEqual(errors, []);
    console.log('PASS: unpacked EXE panels, IPC rejection, in-package catalog bytes, generate and save, 125-row export');
  } finally {
    if (app) await app.close();
    const resolved = path.resolve(temp);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('anti-face-packed-'));
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
