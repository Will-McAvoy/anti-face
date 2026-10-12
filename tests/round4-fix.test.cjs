const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PreviewSession } = require('../core/preview-session.cjs');
const { AutomationService } = require('../desktop/automation-service.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { StudioService } = require('../desktop/studio-service.cjs');
const { NotificationService } = require('../desktop/notification-service.cjs');
const { NotificationPolicy } = require('../core/notification-policy.cjs');
const { AudioPlayer, soundPath } = require('../desktop/audio-player.cjs');
const { documentFromLegacy, validateThemeDocument } = require('../core/theme-schema.cjs');

const sampleDoc = documentFromLegacy({
  schemaVersion: 1,
  themeId: 'graphite',
  appearance: { blur: 18, opacity: 88, radius: 14, wallpaper: null }
});

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('R01: PreviewSession - apply 返回失败或异常时不能执行 save 提交，必须保留 baseline', async () => {
  let saveCalls = 0;
  let applyCalls = 0;
  const preview = new PreviewSession({
    apply: async () => {
      applyCalls++;
      if (applyCalls === 1) return { ok: true };
      return { ok: false, code: 'HOST_ERROR', message: 'injected host failure' };
    },
    schedule: () => 1,
    clear: () => {}
  });

  await preview.begin('target-1', { kind: 'original', document: null }, sampleDoc);
  preview.updateDraft('target-1', { ...sampleDoc, name: 'draft-modified' });

  // 尝试 commit
  let commitError = null;
  let committedState = null;
  try {
    committedState = await preview.commit('target-1', async () => {
      saveCalls++;
    });
  } catch (err) {
    commitError = err;
  }

  // 断言：save 回调绝对不能被执行
  assert.equal(saveCalls, 0, 'apply 失败时 save 回调不能被调用');
  // phase 不能是 idle（不能误报已完成）
  const state = preview.state('target-1');
  assert.notEqual(state.phase, 'idle', 'apply 失败后试穿状态不能变成 idle');
  // baseline 必须保留
  const entry = preview.targets.get('target-1');
  assert.ok(entry.baseline, 'baseline 必须保留以供重试或恢复');
});

test('R02: AutomationService - tick 在等待 hostAvailable 期间发生手动操作或模式变更，旧决策必须失效', async () => {
  const gate = deferred();
  const applied = [];
  const auto = new AutomationService({
    hostAvailable: () => gate.promise,
    apply: async job => {
      applied.push(job.themeId);
      return { ok: true };
    },
    schedule: () => 1,
    clear: () => {}
  });

  auto.setConfig({ mode: 'system', lightThemeId: 'pearl', darkThemeId: 'graphite' });
  auto.systemScheme = 'dark';

  const tickPromise = auto.tick();
  // 期间用户手动选择 rose
  auto.noteManual('rose');
  // 宿主稍后才变为可用
  gate.resolve(true);
  await tickPromise;
  auto.stop();

  assert.equal(applied.length, 0, '旧自动决策 graphite 不得写入宿主');
});

test('R03: ThemeLibrary - 写磁盘失败不能污染内存，下一次成功保存不得将失败项一同落盘', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r03-'));
  try {
    const libFile = path.join(temp, 'library.json');
    const lib = new ThemeLibrary(libFile);
    await lib.load();

    const realPersist = lib._persist.bind(lib);
    // 注入磁盘故障
    lib._persist = async () => {
      throw new Error('injected disk failure');
    };

    await assert.rejects(async () => {
      await lib.saveNew(sampleDoc, 'failed-save');
    }, /injected disk failure/);

    // 检查内存状态：query 不能查出 failed-save
    const memQuery = lib.query({ search: 'failed-save' });
    assert.equal(memQuery.total, 0, '内存不能保留失败的主题');

    // 恢复持久化并保存有效主题
    lib._persist = realPersist;
    await lib.saveNew(sampleDoc, 'valid-save');

    // 检查磁盘内容
    const diskContent = JSON.parse(await fs.readFile(libFile, 'utf8'));
    assert.equal(diskContent.themes.some(t => t.name === 'failed-save'), false, '磁盘不得含有失败主题');
    assert.equal(diskContent.themes.some(t => t.name === 'valid-save'), true, '磁盘应含有成功保存的主题');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('R04: StudioService - 未知未来 schema 的 appearance.json 必须冻结写入并报错，不得静默覆盖', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r04-'));
  try {
    const appFile = path.join(temp, 'appearance.json');
    const futureContent = { schemaVersion: 99, secretKey: 'future-data', name: 'Future' };
    await fs.writeFile(appFile, JSON.stringify(futureContent), 'utf8');

    const studio = new StudioService({
      userData: temp,
      themeService: { targets: new Map(), listTargets: async () => [] },
      settings: { load: async () => ({ settings: {} }), save: async () => {} }
    });

    const doc = await studio._loadDocument();
    assert.equal(doc, null, '未来版本无法直接加载为当前格式文档');
    assert.equal(studio.documentFrozen, true, '未来 schema 必须标记为 frozen');

    // 尝试保存当前格式文档
    await assert.rejects(async () => {
      await studio.saveDocument(sampleDoc);
    }, /UNSUPPORTED_SCHEMA/);

    // 验证磁盘文件内容未被更改
    const disk = JSON.parse(await fs.readFile(appFile, 'utf8'));
    assert.equal(disk.schemaVersion, 99, '磁盘文件必须完好保留原 schemaVersion');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test('R05: NotificationService - 生产默认构造必须使用真实单调时钟，不同任务在冷却期后能正常触发', async () => {
  const notifications = new NotificationService({
    player: { play: async () => ({ ok: true }) }
  });
  const prefs = { onFailed: true, sound: true };

  const first = notifications.handle({ type: 'failed', taskId: 'task-1', provenance: 'real' }, prefs);
  assert.equal(first.reason, 'accepted', '首个任务应被接受');

  // 等待超过 3000ms 冷却时间
  await new Promise(resolve => setTimeout(resolve, 3100));

  const second = notifications.handle({ type: 'failed', taskId: 'task-2', provenance: 'real' }, prefs);
  assert.equal(second.reason, 'accepted', '3.1秒后不同任务必须被接受，不能误判定为 cooldown');
});

test('R06: StudioService - applyEditorDocument 必须触发 noteManual 暂停自动切换', async () => {
  let manualNotedThemeId = null;
  const fakeStudio = {
    selectedTargetId: 'target-1',
    saveDocument: async x => x,
    preview: { state: () => ({ phase: 'idle' }) },
    _assetUrl: async () => null,
    theme: { applyDocument: async () => ({ state: 'applied' }) },
    automation: {
      noteManual: id => { manualNotedThemeId = id; }
    }
  };

  await StudioService.prototype.applyEditorDocument.call(fakeStudio, sampleDoc, 'target-1');
  assert.equal(manualNotedThemeId, sampleDoc.baseThemeId, 'applyEditorDocument 必须调用 noteManual 记录手动优先');
});

test('R07: StudioService - cancelPreview 取消试穿后必须同步回填 studio.document', async () => {
  const cancelPreview = new PreviewSession({
    apply: async () => ({ ok: true }),
    restore: async () => ({ ok: true }),
    schedule: () => 1,
    clear: () => {}
  });
  await cancelPreview.begin('target-1', { kind: 'theme', document: sampleDoc }, sampleDoc);

  const changed = { ...sampleDoc, name: 'unsaved-changes' };
  const studio = {
    selectedTargetId: 'target-1',
    document: sampleDoc,
    preview: cancelPreview
  };

  StudioService.prototype.updateDraft.call(studio, changed, 'target-1');
  assert.equal(studio.document.name, 'unsaved-changes');

  await StudioService.prototype.cancelPreview.call(studio, 'target-1');
  assert.equal(studio.document.name, sampleDoc.name, '取消试穿后 studio.document 必须恢复为 baseline 内容');
});

test('Sound Path: 预置音效文件必须存在且在真实文件系统中可读', async () => {
  for (const name of ['completed', 'failed', 'waiting_user', 'preview']) {
    const file = soundPath(name);
    assert.ok(typeof file === 'string' && file.endsWith('.wav'), `soundPath(${name}) 必须返回有效 wav 路径`);
    // 检查源码环境文件存在
    await fs.access(file);
    const stat = await fs.stat(file);
    assert.ok(stat.size > 0, `${file} 文件大小必须大于 0`);
  }
});
