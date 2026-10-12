const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Round5Service } = require('../desktop/round5-service.cjs');
const { CaptureService } = require('../desktop/capture-service.cjs');
const { AssetStore } = require('../desktop/asset-store.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { ThemeRevisionStore } = require('../desktop/theme-revision-store.cjs');
const { encodePng } = require('../core/image-decode.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { resolveEffectiveAppearance } = require('../core/effective-appearance.cjs');
const { partialRestore } = require('../core/theme-diff.cjs');

function makePng(r, g, b, alpha = 255) {
  const data = Buffer.alloc(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = alpha;
  }
  return encodePng(16, 16, data);
}

const doc = () => documentFromLegacy({ schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE } });

test('R01: 阅读保护不依赖配色生成，独立从 asset 读取并分析图像', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r5-fix-r01-'));
  try {
    const assets = new AssetStore(path.join(dir, 'assets'));
    await assets.init();
    const imported = await assets.importImage(makePng(240, 240, 240), assets.beginImport());

    const r = Object.create(Round5Service.prototype);
    r.studio = { assets, theme: { targets: new Map() }, preview: { state: () => ({ phase: 'idle' }) } };
    r.pixelCache = new Map();
    r.viewports = new Map();
    r.manualHolds = new Map();
    r.scenes = { current: () => 'unknown' };

    const d = doc();
    d.wallpaper.assetId = imported.record.id;
    d.readability.mode = 'auto';

    await r.prepareImageAnalysis(d);
    const analysis = r.analysisFor(d);
    assert.ok(analysis, 'analysis must not be null');
    assert.ok(analysis.image, 'image samples must be prepared without running generate');

    const effective = resolveEffectiveAppearance(d, { viewport: { width: 1280, height: 800 } }, analysis);
    assert.notEqual(effective.readability.measurement.reason, 'missing-image', 'Reason must not be missing-image');
    assert.equal(effective.readability.measurement.status, 'estimated', 'Status must be estimated');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('R02: 自动场景异步等待期间发生 manual hold，旧任务必须作废且不注入', async () => {
  const scene = Object.create(Round5Service.prototype);
  const sceneDoc = doc();
  sceneDoc.sceneAppearance.mode = 'auto';

  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const writes = [];

  scene.studio = {
    document: sceneDoc,
    preview: { state: () => ({ phase: 'idle' }) },
    theme: {
      applyDocument: async (document, target, meta) => {
        if (meta && typeof meta.isCurrent === 'function' && !meta.isCurrent()) {
          return { state: 'cancelled' };
        }
        writes.push({ target, theme: document.baseThemeId, guarded: typeof meta.isCurrent === 'function' });
        return { state: 'applied' };
      }
    }
  };
  scene.manualHolds = new Map();
  scene.lastSceneApply = new Map();
  scene.targetStates = new Map();
  scene.targetStates.set('A', {
    targetId: 'A',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: sceneDoc,
    manualHold: false
  });

  scene.decorateApply = async () => {
    await blocked;
    return { effective: { effectiveHash: 'test' } };
  };

  const pending = scene.onAutoScene('A', 'chat');
  scene.hold('A');
  release();
  await pending;

  assert.equal(writes.length, 0, 'Writes must be 0 after manual hold');
});

test('R03: 每个目标窗口使用自己的 activeDocument，场景切换不串用全局草稿', async () => {
  const scene = Object.create(Round5Service.prototype);
  const docA = doc(); // graphite
  const docB = { ...doc(), baseThemeId: 'pearl' };
  docA.sceneAppearance.mode = 'auto';
  docB.sceneAppearance.mode = 'auto';

  const writes = [];
  scene.studio = {
    document: docB,
    preview: { state: () => ({ phase: 'idle' }) },
    theme: {
      applyDocument: async (document, target, meta) => {
        writes.push({ target, theme: document.baseThemeId });
        return { state: 'applied' };
      }
    }
  };
  scene.manualHolds = new Map();
  scene.lastSceneApply = new Map();
  scene.targetStates = new Map();
  scene.targetStates.set('A', {
    targetId: 'A',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: docA,
    manualHold: false
  });
  scene.targetStates.set('B', {
    targetId: 'B',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: docB,
    manualHold: false
  });

  scene.decorateApply = async (document) => ({ effective: { effectiveHash: `hash-${document.baseThemeId}` } });

  await scene.onAutoScene('A', 'chat');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].target, 'A');
  assert.equal(writes[0].theme, 'graphite', 'Window A must apply graphite, not pearl from global document');
});

test('R04: 截图清除或切换窗口使在途截图失效，替换 after 正确计算字节', async () => {
  const captures = new CaptureService();
  let finish;
  const shot = new Promise(resolve => { finish = resolve; });
  const taking = captures.take({
    targetId: 'A',
    groupId: 'one',
    phase: 'before',
    viewport: { width: 100, height: 100 },
    client: { captureScreenshot: () => shot },
    isCurrent: () => true
  });
  captures.clear('A');
  finish({ png: Buffer.from('synthetic'), width: 100, height: 100 });
  const result = await taking;

  assert.equal(result.ok, false, 'Late capture after clear must fail/be ignored');
  assert.equal(captures.list('A').length, 0, 'Groups after clear must remain 0');

  const png1 = Buffer.alloc(100);
  const png2 = Buffer.alloc(150);
  await captures.take({
    targetId: 'B',
    groupId: 'group-b',
    phase: 'before',
    viewport: { width: 10, height: 10 },
    client: { captureScreenshot: async () => ({ png: png1, width: 10, height: 10 }) }
  });
  await captures.take({
    targetId: 'B',
    groupId: 'group-b',
    phase: 'after',
    viewport: { width: 10, height: 10 },
    client: { captureScreenshot: async () => ({ png: png1, width: 10, height: 10 }) }
  });
  assert.equal(captures.bytes, 200);

  await captures.take({
    targetId: 'B',
    groupId: 'group-b',
    phase: 'after',
    viewport: { width: 10, height: 10 },
    client: { captureScreenshot: async () => ({ png: png2, width: 10, height: 10 }) }
  });
  assert.equal(captures.bytes, 250, 'Bytes must accurately reflect replaced after image: 100 + 150 = 250');
});

test('R05: 恢复与保存主题遇到历史记录磁盘错误时，返回明确失败/事务状态，不报整体成功', async () => {
  const restore = Object.create(Round5Service.prototype);
  restore.studio = {
    document: doc(),
    saveDocument: async document => document
  };
  restore.revisions = {
    read: async () => ({ document: doc() }),
    record: async () => { throw new Error('simulated disk full'); }
  };
  const result = await restore.restoreRevision('synthetic-revision', null, true);
  assert.equal(result.ok, false, 'Transaction must report ok: false when revision fails');
  assert.equal(result.code, 'SAVE_FAILED');
  assert.equal(result.revisionSaved, false);
});

test('R06: 配色 Worker 超时与取消使用 settle-once，Promise 正确结束且 jobs 彻底清空', async () => {
  class SilentWorker extends EventEmitter {
    postMessage() {}
    async terminate() { this.emit('exit', 1); }
  }

  const generation = Object.create(Round5Service.prototype);
  generation.cancelled = new Set();
  generation.jobs = new Map();
  generation.studio = { assets: { read: async () => Buffer.from('fake') } };
  generation._createWorker = () => new SilentWorker();
  generation.workerTimeoutMs = 15;

  const res = await generation.generate('image-id', {}, 'req-1');
  assert.equal(res.ok, false, 'Worker timeout must resolve or reject with error');
  assert.equal(res.code, 'TIMEOUT');
  assert.equal(generation.jobs.size, 0, 'Jobs must be 0 after timeout');
});

// ==========================================
// X01 - X10 Integration Scenarios
// ==========================================

test('X01: 导入图 -> 直接开启保护 -> 重启 -> 再开启（不依赖配色生成）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r5-x01-'));
  try {
    const assets = new AssetStore(path.join(dir, 'assets'));
    await assets.init();
    const imported = await assets.importImage(makePng(200, 200, 200), assets.beginImport());

    const studio = {
      userData: dir,
      assets,
      theme: { targets: new Map() },
      preview: { state: () => ({ phase: 'idle' }) },
      async _assetUrl() { return null; }
    };

    // First session: import image and explain readability directly
    const r1 = new Round5Service(studio);
    await r1.start();
    const d = doc();
    d.wallpaper.assetId = imported.record.id;
    d.readability.mode = 'auto';

    const explain1 = await r1.explain(d, 'target-1', { viewport: { width: 1280, height: 800 } });
    assert.equal(explain1.readability.measurement.status, 'estimated');
    assert.notEqual(explain1.readability.measurement.reason, 'missing-image');

    // Simulate restart: create new Round5Service instance with same storage
    const r2 = new Round5Service(studio);
    await r2.start();
    const explain2 = await r2.explain(d, 'target-1', { viewport: { width: 1280, height: 800 } });
    assert.equal(explain2.readability.measurement.status, 'estimated');
    assert.notEqual(explain2.readability.measurement.reason, 'missing-image');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('X02: 场景慢计算 -> 手动恢复 -> 旧结果返回（零旧注入，不覆盖恢复）', async () => {
  const scene = Object.create(Round5Service.prototype);
  const sceneDoc = doc();
  sceneDoc.sceneAppearance.mode = 'auto';

  let releaseSlow;
  const slowPromise = new Promise(resolve => { releaseSlow = resolve; });
  const writes = [];

  scene.studio = {
    document: sceneDoc,
    preview: { state: () => ({ phase: 'idle' }) },
    theme: {
      applyDocument: async (document, target, meta) => {
        if (meta?.isCurrent && !meta.isCurrent()) return { state: 'cancelled' };
        writes.push({ target, theme: document.baseThemeId });
        return { state: 'applied' };
      }
    }
  };
  scene.manualHolds = new Map();
  scene.lastSceneApply = new Map();
  scene.targetStates = new Map();
  const stateA = {
    targetId: 'A',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: sceneDoc,
    manualHold: false
  };
  scene.targetStates.set('A', stateA);

  scene.decorateApply = async () => {
    await slowPromise;
    return { effective: { effectiveHash: 'hash-slow' } };
  };

  const task = scene.onAutoScene('A', 'chat');
  // Manual restore occurs while task is in flight
  stateA.activeDocument = null;
  stateA.operationGeneration += 1;
  scene.manualHolds.set('A', true);

  releaseSlow();
  await task;

  assert.equal(writes.length, 0, 'No theme must be written after manual restore');
});

test('X03: A/B 不同主题 -> 各自导航 -> 切界面（各目标文档、场景、样式一致）', async () => {
  const scene = Object.create(Round5Service.prototype);
  const docA = { ...doc(), baseThemeId: 'graphite' };
  const docB = { ...doc(), baseThemeId: 'amber' };
  docA.sceneAppearance.mode = 'auto';
  docB.sceneAppearance.mode = 'auto';

  const writes = [];
  scene.studio = {
    document: docB, // Global document was set to amber
    preview: { state: () => ({ phase: 'idle' }) },
    theme: {
      applyDocument: async (document, target) => {
        writes.push({ target, theme: document.baseThemeId });
        return { state: 'applied' };
      }
    }
  };
  scene.manualHolds = new Map();
  scene.lastSceneApply = new Map();
  scene.targetStates = new Map();
  scene.targetStates.set('A', {
    targetId: 'A',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: docA,
    manualHold: false
  });
  scene.targetStates.set('B', {
    targetId: 'B',
    targetEpoch: 1,
    operationGeneration: 1,
    activeDocument: docB,
    manualHold: false
  });

  scene.decorateApply = async (d) => ({ effective: { effectiveHash: `h-${d.baseThemeId}` } });

  // A navigates -> scene auto triggers
  await scene.onAutoScene('A', 'chat');
  assert.equal(writes.at(-1).target, 'A');
  assert.equal(writes.at(-1).theme, 'graphite');

  // B navigates -> scene auto triggers
  await scene.onAutoScene('B', 'chat');
  assert.equal(writes.at(-1).target, 'B');
  assert.equal(writes.at(-1).theme, 'amber');
});

test('X04: 截图 -> 清除/切目标 -> 旧返回（UI 和后台缓存都不复活）', async () => {
  const captures = new CaptureService();
  let deliverShot;
  const pendingShot = new Promise(resolve => { deliverShot = resolve; });

  const taking = captures.take({
    targetId: 'target-a',
    groupId: 'grp-1',
    phase: 'before',
    viewport: { width: 800, height: 600 },
    client: { captureScreenshot: () => pendingShot }
  });

  captures.clear('target-a');
  deliverShot({ png: Buffer.alloc(1024), width: 800, height: 600 });
  const result = await taking;

  assert.equal(result.ok, false);
  assert.equal(captures.list('target-a').length, 0);
  assert.equal(captures.image('grp-1', 'before'), null);
});

test('X05: 版本保存磁盘失败 -> 重启 -> 重试（文档与历史状态明确、幂等）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r5-x05-'));
  try {
    const revStore = new ThemeRevisionStore(path.join(dir, 'revisions'));
    await revStore.load();
    const d = doc();
    const recorded = await revStore.record({ document: d, themeId: d.id, source: 'manual' });
    const revId = recorded.revision.revisionId;

    // First attempt fails during disk write
    let failDisk = true;
    const service = Object.create(Round5Service.prototype);
    service.studio = { document: d, saveDocument: async doc => doc };
    service.revisions = revStore;
    service.remember = async (document, meta) => {
      if (failDisk) return { ok: false, code: 'SAVE_FAILED', message: 'disk failure' };
      const rec = await revStore.record({ document, themeId: document.id, source: meta.source });
      return { ok: true, ...rec };
    };

    const firstTry = await service.restoreRevision(revId, null, true);
    assert.equal(firstTry.ok, false);
    assert.equal(firstTry.revisionSaved, false);

    // Second attempt succeeds
    failDisk = false;
    const secondTry = await service.restoreRevision(revId, null, true);
    assert.equal(secondTry.ok, true);
    assert.equal(secondTry.revisionSaved, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('X06: 静默 worker -> 超时 -> 再生成（请求结束，第二次正常工作）', async () => {
  class MockWorker extends EventEmitter {
    constructor(silent = false) {
      super();
      this.silent = silent;
    }
    postMessage() {
      if (!this.silent) {
        setTimeout(() => {
          this.emit('message', { ok: true, themes: { schemes: [{ id: 's1', label: '方案1', colors: { accent: '#ffffff' } }] } });
        }, 5);
      }
    }
    async terminate() { this.emit('exit', 0); }
  }

  const gen = Object.create(Round5Service.prototype);
  gen.cancelled = new Set();
  gen.jobs = new Map();
  gen.studio = { assets: { read: async () => Buffer.from('img') } };
  gen.workerTimeoutMs = 15;

  let mode = 'silent';
  gen._createWorker = () => new MockWorker(mode === 'silent');

  // Attempt 1: silent worker times out
  const res1 = await gen.generate('asset-1', {}, 'req-timeout');
  assert.equal(res1.ok, false);
  assert.equal(res1.code, 'TIMEOUT');
  assert.equal(gen.jobs.size, 0);

  // Attempt 2: normal worker succeeds immediately
  mode = 'normal';
  const res2 = await gen.generate('asset-1', {}, 'req-success');
  assert.equal(res2.ok, true);
  assert.equal(res2.schemes.length, 1);
  assert.equal(gen.jobs.size, 0);
});

test('X07: 阅读保护＋场景＋主体构图同时开（有效模型与锁定生效）', () => {
  const d = doc();
  d.wallpaper.composition = {
    policy: 'protect-subject',
    subjectRect: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
    textSafeRect: { x: 0.5, y: 0.5, width: 0.4, height: 0.4 }
  };
  d.sceneAppearance = {
    mode: 'auto',
    chat: { opacity: 70, maskStrength: 40 },
    home: { opacity: 50, maskStrength: 10 }
  };
  d.readability = {
    mode: 'auto',
    targetContrast: 4.5,
    locks: ['wallpaper.maskStrength'] // maskStrength is locked
  };

  const context = {
    scene: 'chat',
    viewport: { width: 1280, height: 800 }
  };
  const analysis = {
    dimensions: { width: 1920, height: 1080 }
  };

  const effective = resolveEffectiveAppearance(d, context, analysis);
  assert.ok(effective.resolved);
  assert.equal(effective.scene.scene, 'chat');
  // Mask strength was locked, so readability or scene does not override locked limit
  assert.ok(effective.warnings.some(w => w.code === 'LOCKED_LIMIT' || w.message.includes('锁定')));
});

test('X08: 用户改过精选主题 -> 更新失败（用户副本与资产不丢，明确提示）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r5-x08-'));
  try {
    const assets = new AssetStore(path.join(dir, 'assets'));
    await assets.init();
    const library = new ThemeLibrary(path.join(dir, 'lib.json'), { assets });
    await library.load();

    const d = doc();
    const saved = await library.saveNew(d, '精选石墨夜读');
    await library.attachSource(saved.id, {
      sourceItemId: 'curated-01',
      sourceVersion: '1.0.0',
      sourceHash: 'sha-old',
      dirty: true // user edited
    });

    const catalog = {
      getBundled: async () => ({
        itemId: 'curated-01',
        version: '1.1.0',
        sha256: 'sha-new',
        name: '石墨夜读',
        payload: doc()
      })
    };

    const service = Object.create(Round5Service.prototype);
    service.studio = { library, assets };
    service.catalog = catalog;

    await assert.rejects(
      async () => service.catalogInstall('curated-01', 'install'),
      err => err.code === 'CATALOG_DIRTY'
    );

    // Verify user theme is still intact
    const found = library.get(saved.id);
    assert.ok(found);
    assert.equal(found.dirty, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('X09: 项目识别变 unknown -> 原 targetId 复用（不沿用旧项目和截图）', async () => {
  const r = Object.create(Round5Service.prototype);
  r.identified = new Map();
  r.manualHolds = new Map();
  r.lastSceneApply = new Map();
  r.targetStates = new Map();
  r.viewports = new Map();
  r.captures = new CaptureService();

  // Initial target connection
  r.rememberProject('target-1', { workspaceId: 'ws-alpha' });
  assert.ok(r.identified.has('target:target-1'));

  // Target disconnects / drops
  r.dropTarget('target-1');
  assert.equal(r.identified.has('target:target-1'), false);
  assert.equal(r.targetStates.has('target-1'), false);
  assert.equal(r.captures.list('target-1').length, 0);

  // Target reconnects as unknown
  const state = r.getTargetState('target-1', true);
  assert.equal(state.projectIdentity, null);
  assert.equal(r.identified.has('target:target-1'), false);
});

test('X10: 只恢复某区域 -> 其他区域不变，基线完全保留', () => {
  const baseline = doc();
  baseline.regions.sidebar = { opacity: 40, blur: 5, radius: 6 };
  baseline.regions.chat = { opacity: 85, blur: 0, radius: 10 };
  baseline.colors.foreground = '#ffffff';

  const modified = doc();
  modified.regions.sidebar = { opacity: 90, blur: 20, radius: 20 };
  modified.regions.chat = { opacity: 20, blur: 15, radius: 4 };
  modified.colors.foreground = '#000000';

  // Restore only sidebar
  const restored = partialRestore(modified, baseline, { regions: ['sidebar'] });

  assert.deepEqual(restored.regions.sidebar, baseline.regions.sidebar, 'Sidebar must be restored to baseline');
  assert.deepEqual(restored.regions.chat, modified.regions.chat, 'Chat region must remain modified');
  assert.equal(restored.colors.foreground, modified.colors.foreground, 'Colors must remain modified');
});
