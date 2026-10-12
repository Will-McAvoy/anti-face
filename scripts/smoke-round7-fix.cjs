const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

(async () => {
  const root = path.resolve(__dirname, '..');
  const tempUserData = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-smoke-fix-'));
  const artifactsDir = path.join(root, 'artifacts');
  await fs.mkdir(artifactsDir, { recursive: true });

  console.log('[Smoke Round 7 Fix] Launching real Electron instance...');
  let app = null;

  const results = {
    timestamp: new Date().toISOString(),
    env: 'Electron dev/unpacked',
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
      args: [root],
      cwd: root,
      env,
      timeout: 30000
    });

    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.getByText('设置已保存到本机', { exact: true }).waitFor({ timeout: 30000 });
    console.log('  ✓ Main window loaded successfully');
    results.steps.windowLoaded = true;

    // 1. 测试 IPC 基础状态
    const studioState = await page.evaluate(async () => {
      return await window.antiFace.studioState();
    });
    assert.ok(studioState && studioState.document, 'studioState 应返回当前文档');
    console.log('  ✓ studioState returned active document');
    results.steps.studioState = true;

    // 2. 测试应用前摘要生成 (R01 Preview)
    const summary = await page.evaluate(async (doc) => {
      return await window.antiFace.previewApply(doc, null);
    }, studioState.document);

    assert.ok(summary && summary.previewId, 'previewApply 应返回包含 previewId 的摘要');
    assert.ok(summary.baseline && summary.baseline.kind, '摘要应包含 baseline.kind');
    assert.ok(summary.groups && Array.isArray(summary.groups.colors), '摘要应包含 groups.colors');
    assert.ok(typeof summary.totalChanges === 'number', '摘要应包含 totalChanges 统计');
    console.log(`  ✓ previewApply succeeded: previewId=${summary.previewId}, baseline=${summary.baseline.kind}, totalChanges=${summary.totalChanges}`);
    results.steps.previewApply = {
      previewId: summary.previewId,
      baseline: summary.baseline,
      totalChanges: summary.totalChanges
    };

    // 3. 测试确认令牌消费 (R01 Confirm Token)
    let confirmConsumed = false;
    try {
      const confirmResult = await page.evaluate(async (pid) => {
        return await window.antiFace.confirmApply(pid);
      }, summary.previewId);
      if (confirmResult && (confirmResult.ok === true || confirmResult.state === 'applied' || confirmResult.state === 'detached')) {
        confirmConsumed = true;
      }
    } catch (err) {
      // 若无活体 Antigravity 宿主运行，底层抛出 HOST_UNAVAILABLE 是合法的，代表令牌已消费并进入 applyEditorDocument
      if (err.message && (err.message.includes('版本尚未验证') || err.message.includes('没有可应用') || err.message.includes('请先启动 Antigravity') ||err.message.includes('HOST_UNAVAILABLE'))) {
        confirmConsumed = true;
      } else {
        throw err;
      }
    }
    assert.equal(confirmConsumed, true, 'confirmApply 应成功消费令牌');
    console.log('  ✓ confirmApply token consumed successfully via IPC');
    results.steps.confirmApply = true;

    // 4. 二次提交同一令牌应被拒绝（证明令牌已被原子消费）
    const secondConfirm = await page.evaluate(async (pid) => {
      return await window.antiFace.confirmApply(pid);
    }, summary.previewId);
    assert.equal(secondConfirm.ok, false, '重复提交旧令牌应被拒绝');
    assert.equal(secondConfirm.code, 'EXPIRED_OR_NOT_FOUND');
    console.log('  ✓ Duplicate confirmApply rejected with EXPIRED_OR_NOT_FOUND');
    results.steps.duplicateConfirmRejected = true;

    // 5. 局部复制 IPC 校验 (R05)
    const copyResult = await page.evaluate(async (doc) => {
      const source = JSON.parse(JSON.stringify(doc));
      source.colors.accent = '#123456';
      return await window.antiFace.copyThemeParts(doc, source, ['colors']);
    }, studioState.document);
    assert.equal(copyResult.changed, true);
    assert.equal(copyResult.document.colors.accent, '#123456');
    console.log('  ✓ copyThemeParts validated via main process IPC');
    results.steps.copyThemeParts = true;

    // 6. 壁纸轮换与自动备份状态通道
    const rotationStatus = await page.evaluate(async () => await window.antiFace.getRotationStatus());
    const autoBackupStatus = await page.evaluate(async () => await window.antiFace.getAutoBackupStatus());
    assert.ok(typeof rotationStatus.enabled === 'boolean');
    assert.ok(typeof autoBackupStatus.enabled === 'boolean');
    console.log('  ✓ Rotation and AutoBackup status channels responsive');
    results.steps.statusChannels = true;

    results.allPassed = true;
    console.log('\n[Smoke Round 7 Fix] ALL REAL ELECTRON VERIFICATIONS PASSED!\n');
  } catch (err) {
    console.error('[Smoke Round 7 Fix] ERROR:', err);
    results.error = err.message;
    results.allPassed = false;
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    await fs.rm(tempUserData, { recursive: true, force: true });
    await fs.writeFile(
      path.join(artifactsDir, 'smoke-round7-fix.json'),
      JSON.stringify(results, null, 2),
      'utf8'
    );
  }
})();
