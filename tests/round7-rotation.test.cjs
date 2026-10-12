const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {
  validateRotationConfig,
  selectNextCandidate,
  computeNextRotationTime
} = require('../core/wallpaper-rotation-policy.cjs');
const {
  WallpaperRotationService,
  isImageMagic,
  isPathInside
} = require('../desktop/wallpaper-rotation-service.cjs');
const { AssetStore } = require('../desktop/asset-store.cjs');

// 构造有效的 1x1 PNG 二进制
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]);

test('F02: validateRotationConfig 参数约束与边界钳制', () => {
  const defaults = validateRotationConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.folderRef, '');
  assert.equal(defaults.order, 'sequential');
  assert.equal(defaults.intervalSeconds, 900);
  assert.equal(defaults.recursive, false);

  const clamped = validateRotationConfig({
    enabled: true,
    folderRef: ' D:\\Wallpapers ',
    order: 'shuffle',
    intervalSeconds: 10, // 低于 60s
    recursive: true
  });
  assert.equal(clamped.enabled, true);
  assert.equal(clamped.folderRef, 'D:\\Wallpapers');
  assert.equal(clamped.order, 'shuffle');
  assert.equal(clamped.intervalSeconds, 60); // 钳制为 60s
  assert.equal(clamped.recursive, true);
});

test('F02: selectNextCandidate Shuffle Bag 无重复且首尾防撞', () => {
  const items = ['img1.png', 'img2.png', 'img3.png', 'img4.png'];
  let state = { remaining: [], lastItem: null };
  const seenInBag = [];

  // 第一个周期 4 次选择
  for (let i = 0; i < 4; i++) {
    const res = selectNextCandidate(items, -1, 'shuffle', state);
    state = res.nextShuffleState;
    assert.ok(items.includes(res.nextItem));
    assert.ok(!seenInBag.includes(res.nextItem), `Bag 内不应重复出现: ${res.nextItem}`);
    seenInBag.push(res.nextItem);
  }
  assert.equal(seenInBag.length, 4);

  // 跨周期首尾防撞测试
  let last = 'img4.png';
  let badShuffleState = { remaining: [], lastItem: last };
  const riggedRng = () => 0.9999;
  const nextRes = selectNextCandidate(items, -1, 'shuffle', badShuffleState, { rng: riggedRng });
  assert.notEqual(nextRes.nextItem, last, '跨轮首项不应与上一轮最后一项相同');
});

test('F02: computeNextRotationTime 调度与休眠唤醒防堆叠', () => {
  const now = 1700000000000;
  const interval = 300; // 300s = 5m

  // 首次运行 (lastRotationTime = 0)
  const first = computeNextRotationTime(0, interval, now);
  assert.equal(first, now + 300000);

  // 正常未超时
  const pending = computeNextRotationTime(now - 100000, interval, now);
  assert.equal(pending, (now - 100000) + 300000);

  // 休眠唤醒后已大幅超时：立即返回当前时间，不累积连环补发
  const overdue = computeNextRotationTime(now - 86400000, interval, now);
  assert.equal(overdue, now);
});

test('F02: 文件夹扫描、魔数校验、安全边界与有界保护', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-rotation-scan-'));
  const userData = path.join(tempDir, 'user-data');
  const wallpaperDir = path.join(tempDir, 'wallpapers');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(wallpaperDir, { recursive: true });

  // 写入正常图片和伪造图片
  await fs.writeFile(path.join(wallpaperDir, 'valid1.png'), PNG_MAGIC);
  await fs.writeFile(path.join(wallpaperDir, 'valid2.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]));
  await fs.writeFile(path.join(wallpaperDir, 'fake.png'), Buffer.from('NOT AN IMAGE'));
  await fs.writeFile(path.join(wallpaperDir, 'text.txt'), Buffer.from('Hello'));

  const service = new WallpaperRotationService({ userData }, {
    config: { enabled: true, folderRef: wallpaperDir },
    setTimeout: () => null,
    clearTimeout: () => {}
  });

  try {
    const scanned = await service.scanFolder();
    assert.equal(scanned.length, 3); // 包含 valid1.png, valid2.jpg, fake.png

    // 验证魔数检查
    assert.equal(isImageMagic(PNG_MAGIC), true);
    assert.equal(isImageMagic(Buffer.from('NOT AN IMAGE')), false);

    // 越界保护：选择 userData 内部目录抛出错误
    const insideService = new WallpaperRotationService({ userData }, {
      config: { enabled: true, folderRef: userData },
      setTimeout: () => null,
      clearTimeout: () => {}
    });
    await assert.rejects(
      () => insideService.scanFolder(),
      /壁纸轮换文件夹不能位于程序内部数据目录中/
    );
  } finally {
    service.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('F02: 资产租约流转与无引用 GC 释放', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-rotation-lease-'));
  const userData = path.join(tempDir, 'user-data');
  const assetDir = path.join(userData, 'assets');
  const wallpaperDir = path.join(tempDir, 'wallpapers');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(wallpaperDir, { recursive: true });

  const fakeDecode = async (buf) => ({
    format: 'png',
    mime: 'image/png',
    width: 1,
    height: 1,
    data: Buffer.alloc(4)
  });

  const assets = new AssetStore(assetDir, { decodeImage: fakeDecode, retentionMs: 0 });
  await assets.init();

  await fs.writeFile(path.join(wallpaperDir, 'wp1.png'), PNG_MAGIC);
  await fs.writeFile(path.join(wallpaperDir, 'wp2.png'), Buffer.concat([PNG_MAGIC, Buffer.from([0x01])]));

  let appliedTarget = null;
  let appliedPrepared = null;
  const mockStudio = {
    userData,
    assets,
    document: { id: 'test-theme', baseThemeId: 'graphite', wallpaper: { assetId: null } },
    theme: {
      applyDocument: async (doc, targetId, prepared) => {
        appliedTarget = targetId;
        appliedPrepared = prepared;
        return { ok: true, state: 'applied' };
      }
    },
    round5: {
      getTargetState: () => ({ activeDocument: mockStudio.document, manualHold: false }),
      decorateApply: async (doc, targetId, meta) => ({
        stale: false,
        resolved: { wallpaper: { assetId: meta.context?.wallpaperOverride?.assetId } }
      })
    }
  };

  const service = new WallpaperRotationService(mockStudio, {
    config: { enabled: true, folderRef: wallpaperDir, order: 'sequential' },
    setTimeout: () => null,
    clearTimeout: () => {}
  });

  try {
    await service.init({ enabled: true, folderRef: wallpaperDir, order: 'sequential' });

    // 第一次旋转
    const res1 = await service.rotate('target-1');
    assert.equal(res1.ok, true);
    const asset1 = res1.assetId;
    const record1 = assets.get(asset1);
    assert.ok(record1.refs.includes('rotation:target-1'), '应建立 rotation:target-1 租约');
    assert.equal(appliedTarget, 'target-1');
    assert.equal(appliedPrepared.resolved.wallpaper.assetId, asset1);

    // 第二次旋转
    const res2 = await service.rotate('target-1');
    assert.equal(res2.ok, true);
    const asset2 = res2.assetId;
    assert.notEqual(asset1, asset2);

    const updatedRecord1 = assets.get(asset1);
    assert.ok(!updatedRecord1.refs.includes('rotation:target-1'), '旧资产租约应被释放');
    const record2 = assets.get(asset2);
    assert.ok(record2.refs.includes('rotation:target-1'), '新资产租约已建立');

    // 手动保存到主题测试
    let savedDoc = null;
    let recordedRev = null;
    mockStudio.saveDocument = async (doc) => { savedDoc = doc; return doc; };
    mockStudio.round5.setActiveDocument = () => {};
    mockStudio.round5.remember = async (doc, meta) => { recordedRev = meta; return { ok: true }; };

    const saveRes = await service.saveCurrentToTheme('target-1');
    assert.equal(saveRes.ok, true);
    assert.equal(savedDoc.wallpaper.assetId, asset2);
    assert.equal(recordedRev.source, 'rotation-save');
    const permRecord2 = assets.get(asset2);
    assert.ok(permRecord2.refs.includes('appearance'), '保存后应具有 appearance 永久租约');
    assert.ok(!permRecord2.refs.includes('rotation:target-1'), '轮换租约已释放');
  } finally {
    service.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('F02: 安全模式、试穿和手动模式下的暂停保护', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-rotation-pause-'));
  const userData = path.join(tempDir, 'user-data');
  const wallpaperDir = path.join(tempDir, 'wallpapers');
  await fs.mkdir(userData, { recursive: true });
  await fs.mkdir(wallpaperDir, { recursive: true });
  await fs.writeFile(path.join(wallpaperDir, 'wp.png'), PNG_MAGIC);

  const mockStudio = {
    userData,
    safeMode: false,
    migrationActive: false,
    previewActive: () => false,
    selectedTargetId: 'target-1',
    round5: {
      getTargetState: () => ({ manualHold: false })
    }
  };

  const service = new WallpaperRotationService(mockStudio, {
    config: { enabled: true, folderRef: wallpaperDir },
    setTimeout: () => null,
    clearTimeout: () => {}
  });

  try {
    await service.scanFolder();

    // 正常状态无暂停原因
    assert.equal(service.getPauseReason('target-1'), null);

    // 安全模式
    mockStudio.safeMode = true;
    assert.equal(service.getPauseReason('target-1'), 'safe-mode');
    await assert.rejects(() => service.rotate('target-1'), /安全模式下禁止壁纸轮换/);
    mockStudio.safeMode = false;

    // 迁移模式
    mockStudio.migrationActive = true;
    assert.equal(service.getPauseReason('target-1'), 'migration');
    await assert.rejects(() => service.rotate('target-1'), /迁移恢复期间禁止壁纸轮换/);
    mockStudio.migrationActive = false;

    // 试穿中
    mockStudio.previewActive = () => true;
    assert.equal(service.getPauseReason('target-1'), 'previewing');
    mockStudio.previewActive = () => false;

    // 手动操作保全
    mockStudio.round5.getTargetState = () => ({ manualHold: true });
    assert.equal(service.getPauseReason('target-1'), 'manual-hold');
  } finally {
    service.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
