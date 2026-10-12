const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const root = path.join(__dirname, '..');

async function closeMain(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed());
    const win = wins.sort((a, b) => (b.getSize()[0] * b.getSize()[1]) - (a.getSize()[0] * a.getSize()[1]))[0];
    if (!win) throw new Error('没有可关闭的窗口');
    win.close();
    return win.getTitle();
  });
}

function readLight() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', "(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize').AppsUseLightTheme"], { encoding: 'utf8' }).trim();
  return Number(output);
}

function writeLight(light) {
  const value = light ? 1 : 0;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    $path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'
    Set-ItemProperty $path AppsUseLightTheme -Type DWord -Value ${value}
    Set-ItemProperty $path SystemUsesLightTheme -Type DWord -Value ${value}
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ThemeNotify { [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, int Msg, IntPtr wParam, string lParam, int flags, int timeout, out IntPtr result); }'
    $result = [IntPtr]::Zero
    [void][ThemeNotify]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [IntPtr]::Zero, 'ImmersiveColorSet', 2, 2000, [ref]$result)
  `], { encoding: 'utf8' });
}

(async () => {
  const originalLight = readLight();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-click-'));
  const png = new PNG({ width: 4, height: 1 });
  [[180, 40, 40], [40, 140, 80], [40, 70, 180], [230, 180, 40]].forEach((pixel, index) => {
    png.data[index * 4] = pixel[0];
    png.data[index * 4 + 1] = pixel[1];
    png.data[index * 4 + 2] = pixel[2];
    png.data[index * 4 + 3] = 255;
  });
  const image = path.join(temp, 'swatch.png');
  await fs.writeFile(image, PNG.sync.write(png));
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  let app;
  const report = { palette: false, closeContinue: false, closeCancel: false, closeSave: false, systemTheme: false };
  try {
    app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => { throw error; });
    await page.getByRole('heading', { name: '让工作空间，有你的风格。' }).waitFor();
    await page.getByText('设置已保存到本机', { exact: true }).waitFor();

    await page.getByRole('button', { name: '聊天内容区', exact: true }).click();
    await page.getByRole('checkbox', { name: '字号跟随宿主' }).uncheck();
    await page.getByRole('slider', { name: '聊天字号' }).fill('18');
    assert.equal(await page.getByRole('slider', { name: '聊天字号' }).inputValue(), '18');
    await page.getByRole('button', { name: '全局基础', exact: true }).click();

    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, image);
    await page.getByRole('button', { name: /选择一张喜欢的图片/ }).click();
    await page.getByRole('button', { name: '移除壁纸', exact: true }).waitFor();
    const extract = page.getByRole('button', { name: '提取强调色', exact: true });
    await extract.waitFor();
    assert.equal(await extract.isEnabled(), true);
    await extract.click();
    const swatch = page.getByRole('button', { name: /采用强调色/ }).first();
    await swatch.waitFor();
    const chosen = await swatch.getAttribute('aria-label');
    await swatch.click();
    const saved = JSON.parse(await fs.readFile(path.join(temp, 'appearance.json'), 'utf8'));
    assert.equal(`采用强调色 ${saved.document.colors.accent}`, chosen);
    report.palette = true;

    await page.getByRole('button', { name: '连接与兼容', exact: true }).click();
    await page.getByLabel('自动切换模式').selectOption('system');
    await page.getByLabel('浅色主题').selectOption('pearl');
    await page.getByLabel('深色主题').selectOption('ink');
    const before = originalLight === 1 ? '浅色' : '深色';
    const after = originalLight === 1 ? '深色' : '浅色';
    await page.getByText(`当前系统外观：${before}`).waitFor();
    writeLight(originalLight === 1 ? 0 : 1);
    await page.getByText(`当前系统外观：${after}`).waitFor({ timeout: 8000 });
    writeLight(originalLight);
    await page.getByText(`当前系统外观：${before}`).waitFor({ timeout: 8000 });
    report.systemTheme = true;
    await page.getByLabel('自动切换模式').selectOption('off');

    await page.getByRole('button', { name: '主题与外观', exact: true }).click();
    await page.getByRole('button', { name: '实时试穿', exact: true }).click();
    await page.getByRole('button', { name: '保存并结束试穿', exact: true }).waitFor({ timeout: 20000 });
    await closeMain(app);
    await page.getByRole('dialog', { name: '试穿未保存' }).waitFor();
    await page.getByRole('button', { name: '继续编辑', exact: true }).click();
    await page.getByRole('dialog', { name: '试穿未保存' }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: '保存并结束试穿', exact: true }).isVisible(), true);
    report.closeContinue = true;

    await closeMain(app);
    await page.getByRole('button', { name: '取消试穿并隐藏', exact: true }).click();
    await page.getByRole('button', { name: '实时试穿', exact: true }).waitFor({ timeout: 20000 });
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(item => !item.isDestroyed()).map(item => ({ title: item.getTitle(), visible: item.isVisible(), size: item.getSize() })));
    console.log('windows-after-cancel', JSON.stringify(windows));
    assert.equal(windows.every(item => item.visible === false), true);
    report.closeCancel = true;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed());
      wins.sort((a, b) => (b.getSize()[0] * b.getSize()[1]) - (a.getSize()[0] * a.getSize()[1]))[0]?.show();
    });

    await page.getByRole('button', { name: '实时试穿', exact: true }).click();
    await page.getByRole('button', { name: '保存并结束试穿', exact: true }).waitFor({ timeout: 20000 });
    await closeMain(app);
    await page.getByRole('button', { name: '保存并隐藏', exact: true }).click();
    await page.getByRole('button', { name: '实时试穿', exact: true }).waitFor({ timeout: 20000 });
    report.closeSave = true;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().filter(item => !item.isDestroyed());
      wins.sort((a, b) => (b.getSize()[0] * b.getSize()[1]) - (a.getSize()[0] * a.getSize()[1]))[0]?.show();
    });
    await page.getByRole('button', { name: '恢复原样', exact: true }).click({ timeout: 10000 }).catch(() => {});
    console.log(JSON.stringify(report));
    assert.deepEqual(report, { palette: true, closeContinue: true, closeCancel: true, closeSave: true, systemTheme: true });
  } finally {
    try { writeLight(originalLight); } catch (error) { console.error('restore theme', error.message); }
    if (app) await app.close().catch(() => {});
    const host = new ThemeService();
    try {
      await host.restoreAll();
    } catch { /* 宿主不在时不额外改动 */ }
    finally { await host.dispose().catch(() => {}); }
    await fs.writeFile(path.join(root, 'artifacts', 'round4', 'click-through.json'), JSON.stringify({ ...report, windowsLightRestored: readLight() === originalLight }, null, 2)).catch(() => {});
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
