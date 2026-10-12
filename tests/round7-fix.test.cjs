const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { StudioService } = require('../desktop/studio-service.cjs');
const { WallpaperRotationService } = require('../desktop/wallpaper-rotation-service.cjs');
const { AutoBackupService } = require('../desktop/auto-backup-service.cjs');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { generateApplySummary } = require('../core/theme-apply-summary.cjs');
const { copyThemeParts, ALLOWED_COPY_GROUPS } = require('../core/theme-copy-parts.cjs');
const { stores, seed, doc, png } = require('./fixtures/round6-stores.cjs');

test('R01: 应用摘要接口支持对象与位置参数，结构对齐，确认令牌可安全消费', async () => {
  const testDoc = doc();
  const baselineDoc = { ...doc(), colors: { ...doc().colors, accent: '#001122' } };

  // 1. 位置参数调用兼容性
  const summaryPos = generateApplySummary(testDoc, baselineDoc, { performanceTier: 'powersave' }, { baselineKind: 'lastVerified', targetId: 'T1', instanceId: 'I1' });
  assert.equal(summaryPos.targetId, 'T1');
  assert.equal(summaryPos.instanceId, 'I1');
  assert.equal(summaryPos.baseline.kind, 'lastVerified');
  assert.ok(summaryPos.groups);
  assert.ok(Array.isArray(summaryPos.groups.colors));
  assert.ok(Array.isArray(summaryPos.groups.auto));
  assert.ok(summaryPos.totalChanges > 0);

  // 2. 对象参数调用兼容性
  const summaryObj = generateApplySummary({
    requestedDoc: testDoc,
    baselineDoc,
    targetInfo: { targetId: 'T1', instanceId: 'I1', baselineKind: 'lastVerified' },
    runtimeContext: { performanceTier: 'powersave' }
  });
  assert.equal(summaryObj.baseline.kind, 'lastVerified');
  assert.equal(summaryObj.documentHash, summaryPos.documentHash);

  // 3. StudioService previewApply 与 confirmApply 流程
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r01-'));
  try {
    const s = await stores(tempDir);
    const mockTheme = {
      targets: new Map([['T1', { state: 'ready' }]]),
      applyDocument: async (d, id, prep) => ({ ok: true, state: 'applied', verification: { status: 'verified' } })
    };
    const targetState = { instanceId: 'inst-1', activeDocument: baselineDoc, manualHold: false };
    const studio = new StudioService({
      userData: tempDir,
      assets: s.assets,
      themeService: mockTheme,
      preferenceStore: s.prefs,
      round5: {
        getTargetState: () => targetState,
        contextFor: () => ({ performanceTier: 'normal' }),
        decorateApply: async (doc, id, meta) => ({ stale: false, ...meta }),
        setActiveDocument: () => {},
        remember: async () => ({ ok: true, operationId: 'op-1' })
      }
    });

    const preview = await studio.previewApply(testDoc, 'T1');
    assert.ok(preview.previewId);
    assert.equal(preview.targetId, 'T1');

    // 确认令牌消费
    const confirmed = await studio.confirmApply(preview.previewId);
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.state, 'applied');

    // 二次消费应被拒绝（防重复提交）
    const second = await studio.confirmApply(preview.previewId);
    assert.equal(second.ok, false);
    assert.equal(second.code, 'EXPIRED_OR_NOT_FOUND');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('R02: 轮换覆盖正确进入有效外观链，生成对应资产URL与图像分析', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r02-'));
  try {
    const s = await stores(tempDir);
    const seeded = await seed(s, tempDir);
    const resolverStudio = {
      userData: tempDir,
      assets: s.assets,
      preview: { state: () => ({ phase: 'idle' }) },
      theme: { targets: new Map() },
      _assetUrl: async d => d.wallpaper?.assetId ? await s.assets.dataUrl(d.wallpaper.assetId) : null
    };
    const round5 = new Round5Service(resolverStudio);
    const prepared = await round5.decorateApply(doc(), 'A', {
      context: { wallpaperOverride: { assetId: seeded.assetId } }
    });

    assert.equal(prepared.resolved.wallpaper.assetId, seeded.assetId);
    assert.equal(typeof prepared.assetUrl, 'string');
    assert.ok(prepared.assetUrl.startsWith('data:image/'));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('R03: 迟到轮换遇到 manualHold 或恢复时安全取消，失败不提交租约与状态', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r03-'));
  try {
    const dataDir = path.join(tempDir, 'data');
    const folder = path.join(tempDir, 'wallpapers');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(folder, { recursive: true });

    const s = await stores(dataDir);
    await fs.writeFile(path.join(folder, 'test.png'), png());

    let release, entered;
    const blocked = new Promise(r => { release = r; });
    const started = new Promise(r => { entered = r; });
    const target = { activeDocument: doc(), manualHold: false, instanceId: 'A' };
    let writesAfterRestore = 0;

    const rotationStudio = {
      userData: dataDir,
      assets: s.assets,
      safeMode: false,
      migrationActive: false,
      selectedTargetId: 'A',
      document: doc(),
      round5: {
        getTargetState: () => target,
        decorateApply: async () => {
          entered();
          await blocked;
          return { stale: false };
        }
      },
      theme: {
        applyDocument: async () => {
          if (target.manualHold) writesAfterRestore++;
          return { state: 'failed', verification: { status: 'failed' } };
        }
      }
    };

    const rotation = new WallpaperRotationService(rotationStudio, {
      config: { enabled: true, folderRef: folder, intervalSeconds: 60, order: 'sequential' }
    });
    await rotation.scanFolder();

    const pending = rotation.rotate('A');
    await started;
    // 模拟用户在轮换执行期间执行了恢复
    target.manualHold = true;
    target.activeDocument = null;
    release();

    const returned = await pending;
    assert.equal(writesAfterRestore, 0, '恢复后不应产生任何宿主写入');
    assert.equal(returned.ok, false, '状态改变应返回失败');
    assert.equal(rotation.getOverride('A'), null, '不应持有未生效的覆盖');

    rotation.stop();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('R04: 自动备份托管索引严格保护刚导出的备份，决不删除未托管或异常文件', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r04-'));
  try {
    const dataDir = path.join(tempDir, 'data');
    const backups = path.join(tempDir, 'backups');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.mkdir(backups, { recursive: true });

    const s = await stores(dataDir);

    // 预置未托管文件（异常未来年份）
    const unowned = 'anti-face-auto_2099-01-01T00-00-00_deadbeef.antiface-backup';
    await fs.writeFile(path.join(backups, unowned), 'corrupt unowned content');

    const auto = new AutoBackupService({
      userData: dataDir,
      backup: s.backup,
      safeMode: false,
      migrationActive: false
    }, {
      config: { enabled: true, directoryRef: backups, retainCount: 1, retainDays: 365 }
    });

    const backup = await auto.runAutoBackup('force');
    assert.equal(backup.ok, true);

    // 核心断言：刚生成的备份必须完整存在，未托管的外部文件决不触碰
    const newStat = await fs.stat(backup.filePath).catch(() => null);
    const unownedStat = await fs.stat(path.join(backups, unowned)).catch(() => null);
    assert.ok(newStat != null, '刚导出的备份绝不能被保留清理误删');
    assert.ok(unownedStat != null, '未托管文件绝不能被误删');

    // 检查托管状态落盘
    const stateFile = path.join(dataDir, 'auto-backup-state.json');
    const stateContent = await fs.readFile(stateFile, 'utf8');
    const stateJson = JSON.parse(stateContent);
    assert.ok(Array.isArray(stateJson.managedBackups));
    assert.equal(stateJson.managedBackups.length, 1);
    assert.equal(stateJson.managedBackups[0].filePath, backup.filePath);

    auto.stop();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('R05: 局部复制导出组别完整，支持主进程资源可访问性预检', async () => {
  assert.ok(Array.isArray(ALLOWED_COPY_GROUPS));
  assert.ok(ALLOWED_COPY_GROUPS.includes('colors'));
  assert.ok(ALLOWED_COPY_GROUPS.includes('wallpaper'));

  const { randomUUID } = require('node:crypto');
  const validUuid = randomUUID();
  const source = doc();
  source.wallpaper = { ...source.wallpaper, assetId: validUuid };
  const target = doc();

  // 纯函数复制
  const copied = copyThemeParts(target, source, ['wallpaper']);
  assert.equal(copied.changed, true);
  assert.equal(copied.document.wallpaper.assetId, validUuid);
});
