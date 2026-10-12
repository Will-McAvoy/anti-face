const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const exePath = path.join(process.env.ANTI_FACE_UNPACKED_DIR
    ? path.resolve(process.env.ANTI_FACE_UNPACKED_DIR)
    : path.join(root, 'release', 'win-unpacked'), 'Anti Face.exe');
  const artifactsDir = path.join(root, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  console.log('[Smoke Round 7 Fix Packed] Checking packaged executable path...');
  console.log('  Target:', exePath);

  try {
    const stat = await fs.stat(exePath);
    console.log(`  Found executable (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (err) {
    console.error(`  ERROR: Packaged executable not found at: ${exePath}`);
    console.error('  Please run `npm run package` first before running packed smoke test.');
    process.exit(1);
  }

  const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-packed-smoke-'));

  console.log('[Smoke Round 7 Fix Packed] Launching REAL packaged Electron application...');
  let app = null;

  const results = {
    timestamp: new Date().toISOString(),
    env: 'Electron packaged (release/win-unpacked/Anti Face.exe)',
    executablePath: exePath,
    steps: {}
  };

  try {
    const env = {
      ...process.env,
      ANTI_FACE_TEST_USER_DATA: tempUserData
    };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ANTI_FACE_DEV_URL;

    app = await electron.launch({
      executablePath: exePath,
      cwd: root,
      env,
      timeout: 45000
    });

    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByText('设置已保存到本机', { exact: true }).waitFor({ timeout: 35000 });
    console.log('  ✓ Packaged main window loaded successfully');
    results.steps.windowLoaded = true;

    // 1. Verify the executable matches the current source version.
    const version = await page.evaluate(async () => {
      return await window.antiFace.version();
    });
    console.log(`  ✓ Packaged app version: ${version}`);
    const expectedVersion = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
    assert.equal(version, expectedVersion, 'Packaged app version must match the current source');
    results.steps.version = version;

    // 2. 测试 studioState 返回有效草稿
    const studioState = await page.evaluate(async () => {
      return await window.antiFace.studioState();
    });
    assert.ok(studioState && studioState.document, 'Packaged studioState must return active document');
    console.log('  ✓ Packaged studioState returned active document');
    results.steps.studioState = true;

    // 3. 测试应用前摘要生成 (R01 Preview in Packaged App)
    const summary = await page.evaluate(async (doc) => {
      return await window.antiFace.previewApply(doc, null);
    }, studioState.document);

    assert.ok(summary && summary.previewId, 'previewApply in packaged app must return previewId');
    assert.ok(summary.baseline && summary.baseline.kind, 'Summary must have baseline.kind');
    assert.ok(summary.groups && Array.isArray(summary.groups.colors), 'Summary must have groups.colors');
    assert.ok(typeof summary.totalChanges === 'number', 'Summary must have totalChanges count');
    console.log(`  ✓ Packaged previewApply succeeded: previewId=${summary.previewId}, baseline=${summary.baseline.kind}, totalChanges=${summary.totalChanges}`);
    results.steps.previewApply = {
      previewId: summary.previewId,
      baseline: summary.baseline,
      totalChanges: summary.totalChanges
    };

    // 4. 测试确认令牌消费 (R01 Confirm Token in Packaged App)
    let confirmConsumed = false;
    try {
      const confirmResult = await page.evaluate(async (pid) => {
        return await window.antiFace.confirmApply(pid);
      }, summary.previewId);
      if (confirmResult && (confirmResult.ok === true || confirmResult.state === 'applied' || confirmResult.state === 'detached')) {
        confirmConsumed = true;
      }
    } catch (err) {
      if (err.message && (err.message.includes('版本尚未验证') || err.message.includes('没有可应用') || err.message.includes('请先启动 Antigravity') ||err.message.includes('HOST_UNAVAILABLE'))) {
        confirmConsumed = true;
      } else {
        throw err;
      }
    }
    assert.equal(confirmConsumed, true, 'confirmApply in packaged app must consume token');
    console.log('  ✓ Packaged confirmApply token consumed successfully via IPC');
    results.steps.confirmApply = true;

    // 5. 二次提交同一令牌应被拒绝
    const secondConfirm = await page.evaluate(async (pid) => {
      return await window.antiFace.confirmApply(pid);
    }, summary.previewId);
    assert.equal(secondConfirm.ok, false, 'Duplicate confirmApply in packaged app must be rejected');
    assert.equal(secondConfirm.code, 'EXPIRED_OR_NOT_FOUND');
    console.log('  ✓ Packaged duplicate confirmApply rejected with EXPIRED_OR_NOT_FOUND');
    results.steps.duplicateConfirmRejected = true;

    // 6. 局部复制 IPC 校验 (R05)
    const copyResult = await page.evaluate(async (doc) => {
      const source = JSON.parse(JSON.stringify(doc));
      source.colors.accent = '#234567';
      return await window.antiFace.copyThemeParts(doc, source, ['colors']);
    }, studioState.document);
    assert.equal(copyResult.changed, true);
    assert.equal(copyResult.document.colors.accent, '#234567');
    console.log('  ✓ Packaged copyThemeParts validated via main process IPC');
    results.steps.copyThemeParts = true;

    // 7. 壁纸轮换与自动备份状态通道
    const rotationStatus = await page.evaluate(async () => await window.antiFace.getRotationStatus());
    const autoBackupStatus = await page.evaluate(async () => await window.antiFace.getAutoBackupStatus());
    assert.ok(typeof rotationStatus.enabled === 'boolean');
    assert.ok(typeof autoBackupStatus.enabled === 'boolean');
    console.log('  ✓ Packaged Rotation and AutoBackup status channels responsive');
    results.steps.statusChannels = true;

    results.allPassed = true;
    console.log('\n[Smoke Round 7 Fix Packed] ALL PACKAGED ELECTRON VERIFICATIONS PASSED!\n');
  } catch (err) {
    console.error('[Smoke Round 7 Fix Packed] ERROR:', err);
    results.error = err.message;
    results.stack = err.stack;
    results.allPassed = false;
    process.exitCode = 1;
  } finally {
    const reportPath = path.join(artifactsDir, 'smoke-round7-fix-packed.json');
    await fs.writeFile(reportPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`[Smoke Round 7 Fix Packed] Report saved to ${reportPath}`);

    if (app) {
      try {
        await app.close();
      } catch (closeErr) {
        // ignore
      }
    }
    try {
      await fs.rm(tempUserData, { recursive: true, force: true });
    } catch (rmErr) {
      // ignore
    }
  }
})();
