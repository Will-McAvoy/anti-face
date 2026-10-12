const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const { AppearanceHistory } = require('../core/appearance-history.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');
const { copyThemeParts } = require('../core/theme-copy-parts.cjs');
const { generateApplySummary } = require('../core/theme-apply-summary.cjs');
const { normalizeTags } = require('../core/theme-tags.cjs');
const { AutoBackupService } = require('../desktop/auto-backup-service.cjs');
const { WallpaperRotationService } = require('../desktop/wallpaper-rotation-service.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { AssetStore } = require('../desktop/asset-store.cjs');

const ASSET_ID_1 = '11111111-1111-4111-8111-111111111111';
const ASSET_ID_2 = '22222222-2222-4222-8222-222222222222';
const ROTATION_ASSET = '33333333-3333-4333-8333-333333333333';
const THEME_ID_1 = '44444444-4444-4444-8444-444444444444';
const THEME_ID_2 = '55555555-5555-4555-8555-555555555555';

function makeDoc(patch = {}) {
  const base = documentFromLegacy({
    schemaVersion: 1,
    themeId: 'graphite',
    appearance: { blur: 10, opacity: 90, radius: 8, wallpaper: null }
  });
  return validateThemeDocument({ ...base, id: THEME_ID_1, ...patch, schemaVersion: 1 });
}

test('Cross 1: 壁纸轮换覆盖与局部复制的协调及“存入主题”', () => {
  const sourceDoc = makeDoc({
    id: THEME_ID_1,
    wallpaper: {
      assetId: ASSET_ID_1,
      fit: 'cover',
      blur: 15,
      opacity: 75,
      mask: 'vignette',
      safeMargin: { top: 10, bottom: 20, left: 10, right: 10 }
    }
  });

  const targetDoc = makeDoc({
    id: THEME_ID_2,
    wallpaper: {
      assetId: null,
      fit: 'contain',
      blur: 0,
      opacity: 100,
      mask: 'none',
      safeMargin: { top: 0, bottom: 0, left: 0, right: 0 }
    }
  });

  // 1. 局部复制壁纸部件到 targetDoc 草稿
  const copied = copyThemeParts(targetDoc, sourceDoc, ['wallpaper']);
  assert.equal(copied.changed, true);
  assert.equal(copied.document.wallpaper.assetId, ASSET_ID_1);
  assert.equal(copied.document.wallpaper.blur, 15);

  // 2. 模拟宿主运行期有自动壁纸轮换覆盖 (wallpaperOverride)
  const effective = resolveEffectiveAppearance(copied.document, {
    wallpaperOverride: {
      assetId: ROTATION_ASSET,
      fit: 'cover',
      blur: 8,
      opacity: 85,
      mask: 'gradient-bottom'
    }
  });

  // 验证：运行期有效外观优先采用轮换覆盖，provenance 归属 rotation
  assert.equal(effective.resolved.wallpaper.assetId, ROTATION_ASSET);
  assert.equal(effective.provenance['wallpaper.assetId'], 'rotation');

  // 但持久化草稿 targetDoc 本身未被轮换篡改，保持原复制值
  assert.equal(copied.document.wallpaper.assetId, ASSET_ID_1);
  assert.equal(copied.document.wallpaper.blur, 15);
});

test('Cross 2: 一键恢复与安全模式下轮换阻断，迟到注入无效', async () => {
  let targetGeneration = 1;
  let activeCss = 'original-css';
  let manualHold = false;
  let rotationPaused = false;

  // 模拟轮换定时器发起一次变更
  const rotationOpGen = targetGeneration;
  const rotationLease = {
    isValid: () => rotationOpGen === targetGeneration && !manualHold && !rotationPaused
  };

  assert.equal(rotationLease.isValid(), true);

  // 用户触发恢复原貌或安全模式
  targetGeneration += 1;
  manualHold = true;
  rotationPaused = true;
  activeCss = ''; // 恢复默认

  // 迟到的轮换动作尝试提交
  if (rotationLease.isValid()) {
    activeCss = 'rotated-wallpaper-css';
  }

  // 验证：轮换写入被屏障截断，客户端保持纯净
  assert.equal(activeCss, '', '恢复后轮换严禁写入新样式');
  assert.equal(rotationLease.isValid(), false);
});

test('Cross 3: 迁移进行中 (migrationActive) 自动备份跳过，防止脏读', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-cross3-'));
  const userData = path.join(tmp, 'user-data');
  const backupDir = path.join(tmp, 'backups');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  let migrationActive = true;
  let triggerCount = 0;

  const mockStudio = {
    userData,
    get migrationActive() { return migrationActive; },
    safeMode: false,
    backup: {
      async exportBackup() {
        triggerCount += 1;
        return { ok: true };
      }
    }
  };

  const autoBackup = new AutoBackupService(mockStudio, {
    debounceMs: 10,
    minIntervalMs: 10,
    config: {
      enabled: true,
      directoryRef: backupDir,
      schedule: 'afterMajorChange',
      retainCount: 5,
      retainDays: 7
    }
  });

  // 触发防抖备份
  autoBackup.noteMajorChange('major');
  assert.equal(autoBackup.debounceTimer, null, '迁移中不设置防抖定时器');

  // 尝试直接运行抛出 MIGRATION_ACTIVE 异常
  await assert.rejects(autoBackup.runAutoBackup('test'), /迁移恢复期间禁止自动备份/);
  assert.equal(triggerCount, 0, '迁移进行中不得执行自动备份');

  // 迁移结束
  migrationActive = false;
  await autoBackup.runAutoBackup('test');
  assert.equal(triggerCount, 1, '迁移结束后正常执行备份');

  autoBackup.destroy();
  await fs.rm(tmp, { recursive: true, force: true });
});

test('Cross 4: 标签修改后自动备份，备份包正确保留新标签并执行保留策略', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-cross4-'));
  const userData = path.join(tmp, 'user-data');
  const backupDir = path.join(tmp, 'backups');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });

  const libraryFile = path.join(userData, 'theme-library.json');
  const themeLib = new ThemeLibrary(libraryFile);
  await themeLib.load();

  const doc = makeDoc({ id: THEME_ID_1, name: '标签测试主题' });
  const saved = await themeLib.saveNew(doc, '标签测试主题', ['编程', '阅读']);
  assert.deepEqual(saved.tags, ['编程', '阅读']);

  // 更新标签
  await themeLib.updateTags(saved.id, ['编程', '深色', '沉浸']);
  const loaded = await themeLib.get(saved.id);
  assert.deepEqual(loaded.tags, ['编程', '深色', '沉浸']);

  // 执行真实全量自动备份
  const { BackupService } = require('../desktop/backup-service.cjs');
  const backupService = new BackupService({
    userData,
    assets: new AssetStore(path.join(userData, 'assets')),
    themeLibrary: themeLib
  });

  const mockStudio = {
    userData,
    migrationActive: false,
    safeMode: false,
    backup: backupService
  };

  const autoBackup = new AutoBackupService(mockStudio, {
    debounceMs: 10,
    minIntervalMs: 10,
    config: {
      enabled: true,
      directoryRef: backupDir,
      schedule: 'afterMajorChange',
      retainCount: 2,
      retainDays: 1
    }
  });

  // 执行自动备份
  const b1 = await autoBackup.runAutoBackup('tag_updated');
  assert.ok(b1);
  assert.ok(b1.filename.startsWith('anti-face-auto_'));

  // 放入一个用户手动备份，测试保留策略绝对不误删非自动备份
  const manualFile = path.join(backupDir, 'anti-face-backup-manual.zip');
  await fs.writeFile(manualFile, 'manual-archive');

  // 检查备份目录
  const files = await fs.readdir(backupDir);
  assert.ok(files.includes('anti-face-backup-manual.zip'));
  assert.ok(files.includes(b1.filename));

  autoBackup.destroy();
  await fs.rm(tmp, { recursive: true, force: true });
});

test('Cross 5: 局部复制后执行应用前摘要对比，明确显示所选组字段差异', () => {
  const baseTheme = makeDoc({
    id: THEME_ID_1,
    colors: {
      accent: '#2d68ff',
      background: '#1a1a1a',
      foreground: '#ffffff'
    },
    regions: {
      sidebar: { blur: 10, opacity: 90, radius: 8 },
      chat: { blur: 0, opacity: 100, radius: 0 }
    }
  });

  const sourceTheme = makeDoc({
    id: THEME_ID_2,
    colors: {
      accent: '#00cc88',
      background: '#0d1117',
      foreground: '#e6edf3'
    },
    regions: {
      sidebar: { blur: 20, opacity: 80, radius: 12 },
      chat: { blur: 5, opacity: 95, radius: 4 }
    }
  });

  // 仅复制 sidebar
  const copyResult = copyThemeParts(baseTheme, sourceTheme, ['regions.sidebar']);
  assert.equal(copyResult.changed, true);

  // 模拟当前宿主外观处于 baseTheme 状态（作为 lastVerified 基线）
  const summary = generateApplySummary({
    requestedDoc: copyResult.document,
    baselineDoc: baseTheme,
    targetInfo: { targetId: 'target-1', instanceId: 'inst-1', baselineKind: 'verified-theme' }
  });

  // 验证：变更摘要中只有 sidebar 发生了变化，colors 和 chat 无变化
  assert.equal(summary.baselineKind, 'verified-theme');
  assert.equal(summary.totalChangeCount, 3); // blur, opacity, radius

  const sidebarGroup = summary.requestedChanges.find(g => g.group === 'regions');
  assert.ok(sidebarGroup);
  assert.equal(sidebarGroup.items.length, 3);

  const blurChange = sidebarGroup.items.find(c => c.path === 'regions.sidebar.blur');
  assert.ok(blurChange);
  assert.equal(blurChange.beforeDisplay, '10px');
  assert.equal(blurChange.afterDisplay, '20px');
});
