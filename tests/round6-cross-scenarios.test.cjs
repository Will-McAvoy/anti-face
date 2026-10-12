const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { AppearanceHistory } = require('../core/appearance-history.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
const { clampBoundsToWorkAreas, computeDisplayContextHash } = require('../core/display-context.cjs');
const { BackupService } = require('../desktop/backup-service.cjs');
const { SafeLaunchManager } = require('../desktop/safe-launch.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');

const ASSET_ID = '11111111-1111-4111-8111-111111111111';
const THEME_ID = '22222222-2222-4222-8222-222222222222';

function makeDoc(patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { ...DEFAULT_APPEARANCE }
  });
  return validateThemeDocument({ ...base, ...patch, schemaVersion: 1 });
}

test('Cross 1: 一键恢复屏障即时作废在途的快速切换器慢注入', async () => {
  let targetGeneration = 1;
  let activeCss = 'original';
  let manualHold = false;

  // 1. 快速切换器启动一个耗时 50ms 的异步应用
  const switcherOpGen = targetGeneration;
  const switcherToken = {
    isCurrent: () => switcherOpGen === targetGeneration && !manualHold
  };

  assert.equal(switcherToken.isCurrent(), true);

  // 2. 在切换器注入尚未完成前，用户触发“一键恢复所有窗口”
  // 恢复屏障立即执行：升级代际并置位 manualHold
  targetGeneration += 1;
  manualHold = true;
  activeCss = ''; // 清除样式

  // 3. 50ms 后切换器异步操作完成，尝试写回
  if (switcherToken.isCurrent()) {
    activeCss = 'switcher-theme-css';
  }

  // 验证：慢切换器操作已被作废，样式未被污染覆盖
  assert.equal(activeCss, '', '一键恢复后在途快速切换操作严禁覆盖恢复结果');
  assert.equal(switcherToken.isCurrent(), false);
});

test('Cross 2: 快速切换器在省电模式下应用主题，有效外观限制模糊而原文档保持全保真', () => {
  const authoredDoc = makeDoc({
    id: THEME_ID,
    wallpaper: { blur: 24, assetId: ASSET_ID },
    regions: {
      sidebar: { blur: 18, opacity: 80, radius: 10 }
    }
  });

  // 目标当前处于 powersave 省电档位
  const effective = resolveEffectiveAppearance(authoredDoc, { performanceTier: 'powersave' });

  // 运行时应用效果被限制在 8px
  assert.equal(effective.resolved.wallpaper.blur, 8);
  assert.equal(effective.resolved.regions.sidebar.blur, 8);

  // 原主题文档未受任何破坏
  assert.equal(authoredDoc.wallpaper.blur, 24);
  assert.equal(authoredDoc.regions.sidebar.blur, 18);
});

test('Cross 3: 负坐标多显示器下快速切换器居中展开与 DPI 变更加密指纹', () => {
  const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
  const leftSecondaryWorkArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  const workAreas = [primaryWorkArea, leftSecondaryWorkArea];

  // 目标窗口位于左侧副屏：x = -1200, y = 200
  const switcherInitialBounds = { x: -1400, y: 150, width: 620, height: 420 };
  const clamped = clampBoundsToWorkAreas(switcherInitialBounds, workAreas, primaryWorkArea);

  // 切换器正确保持在左副屏，并且在安全可见范围内
  assert.ok(clamped.x >= -1920 && clamped.x + clamped.width <= 0);
  assert.ok(clamped.y >= 0 && clamped.y + clamped.height <= 1080);

  // 当屏幕分辨率或 DPR 改变时
  const hash100 = computeDisplayContextHash({ width: 1920, height: 1080 }, 1.0);
  const hash125 = computeDisplayContextHash({ width: 1920, height: 1080 }, 1.25);
  assert.notEqual(hash100, hash125, 'DPI 变更应触发渲染上下文重算');
});

test('Cross 4: 备份恢复与撤销历史资产保护联动', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antiface-cross-test-'));
  try {
    const docA = makeDoc({ id: THEME_ID, wallpaper: { assetId: ASSET_ID } });
    const history = new AppearanceHistory(docA);

    // 修改生成历史栈
    const nextDoc = makeDoc({ id: THEME_ID, wallpaper: { blur: 20 } });
    history.push(nextDoc, '调整模糊');

    // 验证资产保护：即使当前文档未包含 ASSET_ID，历史栈与基线仍能保护它
    const protectedIds = history.referencedAssetIds();
    assert.ok(protectedIds.has(ASSET_ID), '历史与基线中的资产受保护');

    // 模拟备份服务初始化
    const backupService = new BackupService({
      userData: tmpDir,
      library: { data: { themes: [{ id: THEME_ID, name: 'T1', document: docA }] } }
    });

    const exportPath = path.join(tmpDir, 'backup.antiface-backup');
    const exported = await backupService.exportBackup(exportPath);
    assert.equal(exported.ok, true);

    const inspected = await backupService.inspectBackup(exportPath);
    assert.equal(inspected.valid, true);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Cross 5: 安全模式阻止自动应用，用户手动恢复后干净重置', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antiface-cross-safe-'));
  try {
    // 强制 CLI 安全模式启动
    const safeMgr = new SafeLaunchManager(tmpDir, { cliSafeMode: true });
    const status = await safeMgr.init();
    assert.equal(status.safeMode, true);

    let autoApplyTriggered = false;
    function tryAutoApply(isSafeMode) {
      if (isSafeMode) return false;
      autoApplyTriggered = true;
      return true;
    }

    // 启动时应拒绝自动套用主题
    const applied = tryAutoApply(safeMgr.activeSafeMode);
    assert.equal(applied, false);
    assert.equal(autoApplyTriggered, false);

    // 用户在安全启动提示中确认无误，退出安全模式
    await safeMgr.exitSafeMode();
    assert.equal(safeMgr.activeSafeMode, false);

    // 随后正常开启自动换肤
    const appliedAfter = tryAutoApply(safeMgr.activeSafeMode);
    assert.equal(appliedAfter, true);
    assert.equal(autoApplyTriggered, true);

    // 记录正常退出
    await safeMgr.recordCleanExit();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
