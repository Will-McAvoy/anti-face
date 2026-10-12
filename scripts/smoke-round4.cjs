const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const version = JSON.parse(require('node:fs').readFileSync(path.join(root, 'package.json'), 'utf8')).version;

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-round4-'));
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  let app;
  const shots = path.join(root, 'artifacts', 'round4');
  await fs.mkdir(shots, { recursive: true });
  try {
    app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();
    await page.getByText(`v${version}`, { exact: true }).waitFor();
    const live = page.getByRole('button', { name: '实时试穿', exact: true });
    await live.waitFor();
    assert.equal(await page.getByRole('button', { name: '保存并结束试穿', exact: true }).count(), 0);
    await page.getByRole('button', { name: '侧边栏', exact: true }).click();
    await page.getByRole('button', { name: '重置此区域', exact: true }).waitFor();
    await page.getByRole('button', { name: '全局基础', exact: true }).click();
    await page.getByRole('slider', { name: '背景模糊' }).fill('9');
    await page.getByLabel('新主题名称').fill('晨雾');
    await page.getByRole('button', { name: '另存为我的主题', exact: true }).click();
    await page.getByText('已保存个人主题 晨雾').waitFor();
    await page.getByRole('button', { name: '复制', exact: true }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).first().click();
    const bad = path.join(temp, 'bad-theme.json');
    await fs.writeFile(bad, '{"schemaVersion":1,"kind":"anti-face-theme-pack","themes":[{"name":"坏","document":{"schemaVersion":1,"baseThemeId":"nope"}}]}');
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, bad);
    await page.getByRole('button', { name: '导入主题包', exact: true }).click();
    await page.getByRole('alert').waitFor();
    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    const auto = page.getByLabel('自动切换模式');
    await auto.waitFor();
    assert.equal(await auto.inputValue(), 'off');
    assert.equal(await page.getByRole('checkbox', { name: '关闭窗口时保留在托盘（默认仍是退出）' }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: /启用全局快捷键/ }).isChecked(), false);
    await page.getByRole('button', { name: '打开迷你窗', exact: true }).click();
    let mini = null;
    for (let i = 0; i < 30; i++) {
      mini = app.windows().find(item => item !== page);
      if (mini) break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert.ok(mini, '迷你窗必须成功创建');
    await mini.waitForLoadState('domcontentloaded');
    await mini.getByRole('button', { name: '关闭迷你窗', exact: true }).click();
    assert.equal(app.windows().length >= 1, true);
    await page.screenshot({ path: path.join(shots, 'studio.png') });
    assert.deepEqual(errors, []);
    const library = JSON.parse(await fs.readFile(path.join(temp, 'theme-library.json'), 'utf8'));
    assert.ok(library.themes.some(theme => theme.name === '晨雾'));
    console.log('PASS: round4 desktop defaults, region editor, library, import error, mini window');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});