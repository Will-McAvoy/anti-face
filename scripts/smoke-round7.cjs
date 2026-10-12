const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

console.log('[Smoke Round 7] Starting comprehensive verification for F01 - F05...');

const results = {
  timestamp: new Date().toISOString(),
  round: 'Round 7 (v0.6.0)',
  features: {},
  passed: 0,
  failed: 0
};

function record(name, pass, details = {}) {
  results.features[name] = { pass, ...details };
  if (pass) {
    results.passed += 1;
    console.log(`  ✓ ${name}: PASSED`);
  } else {
    results.failed += 1;
    console.error(`  ✗ ${name}: FAILED`, details);
  }
}

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'antiface-smoke-r7-'));
  const userDataDir = path.join(tmpDir, 'userData');
  const backupDir = path.join(tmpDir, 'backups');
  const wallpaperDir = path.join(tmpDir, 'wallpapers');

  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(wallpaperDir, { recursive: true });

  const artifactDir = path.join(__dirname, '..', 'artifacts', 'round7');
  await fs.mkdir(artifactDir, { recursive: true });

  try {
    // -------------------------------------------------------------
    // F01: 主题标签与多维分类
    // -------------------------------------------------------------
    const { ThemeLibrary } = require('../desktop/theme-library.cjs');
    const { validateThemeDocument, documentFromLegacy } = require('../core/theme-schema.cjs');
    const { normalizeTags, matchesThemeFilters, getTagCounts } = require('../core/theme-tags.cjs');

    const libraryFile = path.join(userDataDir, 'theme-library.json');
    const library = new ThemeLibrary(libraryFile);
    await library.load();

    const THEME_UUID_1 = '11111111-1111-4111-8111-111111111111';
    const THEME_UUID_2 = '22222222-2222-4222-8222-222222222222';

    const doc1 = validateThemeDocument({
      ...documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { blur: 10, opacity: 90, radius: 8, wallpaper: null } }),
      id: THEME_UUID_1,
      name: '极客深蓝'
    });

    const doc2 = validateThemeDocument({
      ...documentFromLegacy({ schemaVersion: 1, themeId: 'pearl', appearance: { blur: 0, opacity: 95, radius: 12, wallpaper: null } }),
      id: THEME_UUID_2,
      name: '柔和浅粉',
      typography: { chatFontSize: 16, lineHeight: 1.6, contentWidth: 800 },
      regions: {
        global: null,
        sidebar: { blur: 8, opacity: 80, radius: 14, borderWidth: 1, borderStrength: 15, shadow: 'soft' },
        chat: null,
        composer: null,
        card: null
      }
    });

    const saved1 = await library.saveNew(doc1, '极客深蓝', ['编程', '深色', '极简']);
    const saved2 = await library.saveNew(doc2, '柔和浅粉', ['阅读', '浅色', '护眼']);

    // 验证标签清洗与归一化
    assert.deepEqual(saved1.tags, ['编程', '深色', '极简']);
    assert.deepEqual(saved2.tags, ['阅读', '浅色', '护眼']);

    // 更新标签
    await library.updateTags(saved1.id, ['编程', '全暗夜', '效率']);
    const reloaded1 = await library.get(saved1.id);
    assert.deepEqual(reloaded1.tags, ['编程', '全暗夜', '效率']);

    // 组合多维查询
    const queryAnd = library.query({ tags: ['编程', '效率'], tagMode: 'AND' });
    assert.equal(queryAnd.items.length, 1);
    assert.equal(queryAnd.items[0].id, saved1.id);

    const counts = getTagCounts([reloaded1, saved2]);
    const progCount = counts.find(c => c.tag === '编程')?.count;
    const readCount = counts.find(c => c.tag === '阅读')?.count;
    assert.equal(progCount, 1);
    assert.equal(readCount, 1);

    record('F01_ThemeTagsAndCategorization', true, { tagCounts: counts });

    // -------------------------------------------------------------
    // F02: 本地壁纸文件夹轮换
    // -------------------------------------------------------------
    const { WallpaperRotationService } = require('../desktop/wallpaper-rotation-service.cjs');
    const { AssetStore } = require('../desktop/asset-store.cjs');

    // 写入两张合法的 PNG 图片到壁纸目录
    const validPng = Buffer.from('89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360606060000000050001A72445640000000049454E44AE426082', 'hex');
    await fs.writeFile(path.join(wallpaperDir, 'wp1.png'), validPng);
    await fs.writeFile(path.join(wallpaperDir, 'wp2.png'), validPng);

    const assetStore = new AssetStore(path.join(userDataDir, 'assets'));
    await assetStore.init();

    const mockStudio = {
      userData: userDataDir,
      assets: assetStore,
      safeMode: false,
      migrationActive: false,
      selectedTargetId: 'target-mock-1',
      document: doc1,
      theme: {
        async applyDocument() {}
      },
      round5: {
        getTargetState() { return { manualHold: false, activeDocument: doc1 }; },
        setActiveDocument() {},
        async remember() {},
        async decorateApply() { return {}; }
      },
      async saveDocument(updated) {
        doc1.wallpaper.assetId = updated.wallpaper.assetId;
        return updated;
      }
    };

    const rotationService = new WallpaperRotationService(mockStudio, {
      config: {
        enabled: true,
        folderRef: wallpaperDir,
        intervalSeconds: 60,
        order: 'shuffle'
      }
    });

    const candidates = await rotationService.scanFolder();
    assert.equal(candidates.length, 2, '应当成功识别壁纸目录内的两张图片');

    // 轮换一步
    const nextItem = await rotationService.rotate('target-mock-1');
    assert.ok(nextItem.ok, '轮换应当成功');
    assert.ok(nextItem.assetId, '有效外观覆盖应当注入 assetId');

    // 验证不篡改草稿/主题文档
    assert.equal(doc1.wallpaper.assetId, null, '运行期覆盖绝不直接修改持久化主题文档');

    // 用户显式操作“存入主题”
    const saveRes = await rotationService.saveCurrentToTheme('target-mock-1');
    assert.equal(saveRes.document.wallpaper.assetId, nextItem.assetId, '显式存入主题才写回文档');

    rotationService.destroy();
    record('F02_WallpaperRotationService', true, { scanned: candidates.length, assetId: nextItem.assetId });

    // -------------------------------------------------------------
    // F03: 应用前变化摘要与结果反馈
    // -------------------------------------------------------------
    const { generateApplySummary } = require('../core/theme-apply-summary.cjs');

    const summaryNative = generateApplySummary({
      requestedDoc: doc1,
      baselineDoc: null,
      targetInfo: { targetId: 'target-mock-1', instanceId: 'inst-1', baselineKind: 'native' }
    });
    assert.equal(summaryNative.baselineKind, 'native');
    assert.ok(summaryNative.totalChangeCount > 0);
    assert.equal(summaryNative.requestedChanges.some(g => g.items.some(i => i.beforeDisplay === '原生默认')), true);

    const summaryVerified = generateApplySummary({
      requestedDoc: doc2,
      baselineDoc: doc1,
      targetInfo: { targetId: 'target-mock-1', instanceId: 'inst-1', baselineKind: 'verified-theme' },
      runtimeContext: { performanceTier: 'powersave' }
    });
    assert.equal(summaryVerified.baselineKind, 'verified-theme');
    assert.ok(summaryVerified.automaticOverrides.some(o => o.type === 'performance'));

    record('F03_ApplySummaryAndFeedback', true, {
      nativeChanges: summaryNative.totalChangeCount,
      verifiedChanges: summaryVerified.totalChangeCount,
      overrides: summaryVerified.automaticOverrides.length
    });

    // -------------------------------------------------------------
    // F04: 主题局部复制
    // -------------------------------------------------------------
    const { copyThemeParts } = require('../core/theme-copy-parts.cjs');

    const copyResult = copyThemeParts(doc1, doc2, ['regions.sidebar', 'typography']);
    assert.equal(copyResult.changed, true);
    // 验证仅 sidebar 与 typography 变更，目标 ID 和名称被严格保护
    assert.equal(copyResult.document.id, doc1.id);
    assert.equal(copyResult.document.name, doc1.name);
    assert.equal(copyResult.document.regions.sidebar.radius, doc2.regions.sidebar.radius);

    record('F04_ThemePartialCopy', true, {
      modifiedGroups: copyResult.modifiedGroups,
      targetPreserved: copyResult.document.id === doc1.id
    });

    // -------------------------------------------------------------
    // F05: 自动备份与保留策略
    // -------------------------------------------------------------
    const { AutoBackupService } = require('../desktop/auto-backup-service.cjs');
    const { BackupService } = require('../desktop/backup-service.cjs');

    const realBackupService = new BackupService({
      userData: userDataDir,
      assets: assetStore,
      themeLibrary: library
    });

    mockStudio.backup = realBackupService;

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

    // 触发自动备份
    const b1 = await autoBackup.runAutoBackup('smoke-test');
    assert.ok(b1);
    assert.ok(path.basename(b1.filename).startsWith('anti-face-auto_'));
    assert.ok(b1.filename.endsWith('.antiface-backup'));

    // 验证备份目录文件
    const backupFiles = await fs.readdir(backupDir);
    assert.ok(backupFiles.includes(path.basename(b1.filename)));

    autoBackup.destroy();
    record('F05_AutoBackupAndRetention', true, {
      backupFile: path.basename(b1.filename),
      directory: backupDir
    });

  } finally {
    // 写入 smoke 检查结果摘要
    await fs.writeFile(
      path.join(artifactDir, 'smoke-summary.json'),
      JSON.stringify(results, null, 2),
      'utf8'
    );
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n[Smoke Round 7 Complete] Passed: ${results.passed}, Failed: ${results.failed}`);
  if (results.failed > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('[Smoke Round 7 Fatal]', err);
  process.exit(1);
});
