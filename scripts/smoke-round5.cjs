const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');

async function pollJsonFile(filePath, predicate, options = {}) {
  const maxAttempts = options.maxAttempts ?? 40;
  const intervalMs = options.intervalMs ?? 250;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content);
      if (predicate(parsed)) return parsed;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        lastError = err;
      }
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (lastError) throw lastError;
  return null;
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-round5-'));
  const env = { ...process.env, ANTI_FACE_TEST_USER_DATA: temp };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ANTI_FACE_DEV_URL;
  let app;
  try {
    app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('button', { name: '阅读与精选' }).click();
    await page.getByRole('heading', { name: '阅读保护', exact: true }).waitFor();
    for (const [tab, heading] of [
      ['场景', '首页氛围 / 聊天专注'],
      ['构图', '壁纸构图'],
      ['真实对比', '真实窗口对比'],
      ['整套配色', '一张图片生成整套主题'],
      ['项目外观', '项目外观'],
      ['版本', '版本历史']
    ]) {
      await page.getByRole('tab', { name: tab }).click();
      await page.getByRole('heading', { name: heading }).waitFor();
    }
    await page.getByRole('tab', { name: '诊断' }).click();
    await page.getByRole('button', { name: '重新检查' }).click();
    await page.getByText('只做被动检查', { exact: false }).waitFor();
    await page.getByRole('tab', { name: '精选' }).click();
    await page.getByRole('heading', { name: '内置精选' }).waitFor();
    await page.getByText('远程源未配置', { exact: false }).waitFor();
    await page.getByRole('button', { name: /石墨夜读/ }).click();
    await page.getByRole('heading', { name: '石墨夜读' }).waitFor();
    await page.getByRole('button', { name: '加入个人库' }).click();

    // 等待 UI 明确提示已加入状态
    await page.getByText('已加入个人库', { exact: false }).waitFor({ timeout: 15000 });

    const libraryFile = path.join(temp, 'theme-library.json');
    const library = await pollJsonFile(libraryFile, data => data?.themes?.some?.(t => t.sourceItemId === 'curated-01'), { maxAttempts: 40, intervalMs: 250 });

    assert.ok(library, 'theme-library.json must exist and contain curated-01');
    assert.ok(library.themes.some(theme => theme.sourceItemId === 'curated-01'));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: round5 readability page, diagnostics, offline catalog install');
  } finally {
    if (app) await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
