const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { DEFAULT_APPEARANCE } = require('../core/theme.cjs');
const { decodeImage } = require('../core/image-decode.cjs');
const { migrateV1Settings, validateThemeDocument, resetRegion, parseColor, documentFromLegacy } = require('../core/theme-schema.cjs');
const { resolveDocument } = require('../core/theme-resolver.cjs');
const { buildDocumentCSS } = require('../core/theme-css.cjs');
const { AppearanceHistory } = require('../core/appearance-history.cjs');
const { PreviewSession } = require('../core/preview-session.cjs');
const { activeRule, decideAutomation } = require('../core/schedule.cjs');
const { AutomationService } = require('../desktop/automation-service.cjs');
const { NotificationPolicy, isQuiet } = require('../core/notification-policy.cjs');
const { ShortcutService } = require('../desktop/shortcut-service.cjs');
const { authorize } = require('../core/ipc-policy.cjs');
const { decideWindowClose } = require('../desktop/tray-service.cjs');
const { clampBounds } = require('../core/bounds.cjs');
const { wallpaperBox, wallpaperOffset, focalPointOnView, extractPalette } = require('../core/wallpaper.cjs');
const { AssetStore } = require('../desktop/asset-store.cjs');
const { ThemeLibrary } = require('../desktop/theme-library.cjs');
const { SettingsStore } = require('../desktop/settings.cjs');
const { assertPayloadSize, assertTargetId } = require('../core/theme-schema.cjs');

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKXcAAAAASUVORK5CYII=', 'base64');

function legacy(themeId = 'graphite', appearance = {}, extra = {}) {
  return { schemaVersion: 1, themeId, appearance: { ...DEFAULT_APPEARANCE, ...appearance }, ...extra };
}

function draft(patch = {}) {
  return validateThemeDocument({ ...documentFromLegacy(legacy()), ...patch, schemaVersion: 1 });
}

function solidPng(red, green, blue) {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < 4; i += 1) {
    png.data[i * 4] = red;
    png.data[i * 4 + 1] = green;
    png.data[i * 4 + 2] = blue;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

test('T01 旧 schema 1 迁移保留外观和偏好', () => {
  const migrated = migrateV1Settings(legacy('aurora', { blur: 12, opacity: 70, radius: 16 }, {
    autoRestoreOnReload: true,
    history: { enabled: true, retentionDays: 90 }
  }));
  assert.equal(migrated.settings.themeId, 'aurora');
  assert.equal(migrated.settings.autoRestoreOnReload, true);
  assert.equal(migrated.settings.history.enabled, true);
  assert.equal(migrated.settings.history.retentionDays, 90);
  assert.equal(migrated.preferences.autoRestoreOnReload, true);
  assert.equal(migrated.preferences.history.retentionDays, 90);
  assert.equal(migrated.document.baseThemeId, 'aurora');
  assert.equal(migrated.document.regions.global.blur, 12);
  assert.equal(migrated.document.history, undefined);
});

test('T02 blur=0 保留，非法透明度被拒绝', () => {
  const zero = resolveDocument(draft({ regions: { global: { blur: 0, opacity: 40, radius: 0 } } }));
  assert.equal(zero.regions.global.blur, 0);
  assert.equal(zero.regions.sidebar.blur, 0);
  for (const opacity of [0, Number.NaN, 39, 101]) {
    assert.throws(() => draft({ regions: { global: { opacity } } }), /超出范围|无效/);
  }
});

test('T03 重置单个区域只恢复该区域继承', () => {
  const wallpaper = { ...draft().wallpaper, blur: 8, maskStrength: 20 };
  const original = draft({
    wallpaper,
    regions: { global: { opacity: 60, blur: 4 }, sidebar: { opacity: 50 }, composer: { radius: 2 } }
  });
  const next = resetRegion(original, 'composer');
  assert.equal(next.regions.composer, null);
  assert.equal(next.regions.sidebar.opacity, 50);
  assert.equal(next.regions.global.opacity, 60);
  assert.equal(next.wallpaper.blur, 8);
  const resolved = resolveDocument(next);
  assert.equal(resolved.regions.composer.radius, resolved.regions.global.radius);
});

test('T04 未知未来 schema 不覆盖原文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-future-'));
  try {
    const file = path.join(dir, 'settings.json');
    const body = JSON.stringify({ schemaVersion: 99, themeId: 'keep-me', secret: 'stay' });
    await fs.writeFile(file, body);
    const store = new SettingsStore(dir);
    const loaded = await store.load();
    assert.equal(loaded.errorCode, 'UNSUPPORTED_SCHEMA');
    await assert.rejects(() => store.save(legacy()), /保留原文件/);
    assert.equal(await fs.readFile(file, 'utf8'), body);
    const libraryFile = path.join(dir, 'library.json');
    const libraryBody = JSON.stringify({ schemaVersion: 9, themes: [{ id: 'x' }] });
    await fs.writeFile(libraryFile, libraryBody);
    const library = new ThemeLibrary(libraryFile);
    const snapshot = await library.load();
    assert.equal(snapshot.errorCode, 'UNSUPPORTED_SCHEMA');
    await assert.rejects(library.saveNew(draft(), '不会写入'), /停止写入|版本过新/);
    assert.equal(await fs.readFile(libraryFile, 'utf8'), libraryBody);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function manualPreview() {
  const jobs = [];
  const shown = [];
  const restored = [];
  let pending = null;
  const session = new PreviewSession({
    debounceMs: 0,
    schedule(fn) {
      pending = fn;
      return fn;
    },
    clear(fn) {
      if (pending === fn) pending = null;
    },
    async apply(job) {
      if (job.isCurrent && !job.isCurrent()) return { ok: false, stale: true };
      jobs.push(JSON.parse(JSON.stringify(job)));
      return { ok: true };
    },
    async restore(job) {
      restored.push(job);
      return { ok: true };
    },
    async show(job) {
      shown.push(JSON.parse(JSON.stringify({ targetId: job.targetId, mode: job.mode, name: job.document?.name || null })));
      return { ok: true };
    }
  });
  return { session, jobs, shown, restored, flushTimer() { const fn = pending; pending = null; return fn ? fn() : null; } };
}

test('T05 连续草稿只保留最后一次并且没有无界队列', async () => {
  const { session, jobs, flushTimer } = manualPreview();
  const base = draft({ name: '起点' });
  await session.begin('A', { kind: 'original', document: null }, base);
  for (let index = 0; index < 100; index += 1) {
    session.updateDraft('A', draft({ name: `第${index}次` }));
  }
  assert.equal(session.state('A').pending, true);
  await flushTimer();
  const updates = jobs.filter(job => job.revision > 0);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].document.name, '第99次');
  assert.equal(updates[0].targetId, 'A');
});

test('T06 慢应用返回时不能盖过取消', async () => {
  let release;
  const writes = [];
  const session = new PreviewSession({
    debounceMs: 0,
    schedule(fn) { fn(); return fn; },
    clear() {},
    apply(job) {
      if (job.revision === 0) return Promise.resolve({ ok: true });
      return new Promise(resolve => {
        release = () => {
          if (!job.isCurrent()) return resolve({ ok: false, stale: true });
          writes.push(job.document.name);
          resolve({ ok: true });
        };
      });
    },
    async restore() { return { ok: true }; }
  });
  await session.begin('A', { kind: 'theme', document: draft({ name: '原来' }) }, draft({ name: '原来' }));
  session.updateDraft('A', draft({ name: '新的' }));
  const cancelling = session.cancel('A');
  release();
  await cancelling;
  assert.deepEqual(writes, []);
  assert.equal(session.state('A').phase, 'idle');
});

test('T07 取消分别恢复无样式和已有主题', async () => {
  const { session, restored } = manualPreview();
  const themed = draft({ name: '已有' });
  await session.begin('A', { kind: 'original', document: null }, draft({ name: '试' }));
  await session.cancel('A');
  await session.begin('B', { kind: 'theme', document: themed }, draft({ name: '试二' }));
  await session.cancel('B');
  assert.equal(restored[0].baseline.kind, 'original');
  assert.equal(restored[1].baseline.kind, 'theme');
  assert.equal(restored[1].baseline.document.name, '已有');
});

test('T08 撤销栈有界，新分支清掉重做', () => {
  const history = new AppearanceHistory(draft({ name: '基线' }));
  for (let index = 0; index < 60; index += 1) history.push(draft({ name: `步骤${index}` }));
  assert.ok(history.undoStack.length <= 50);
  history.undo();
  assert.equal(history.canRedo, true);
  history.push(draft({ name: '新分支' }));
  assert.equal(history.canRedo, false);
  assert.equal(history.snapshot().name, '新分支');
});

test('T09 一次拖动里的多次事件只占一个撤销步骤', () => {
  const history = new AppearanceHistory(draft());
  history.beginGesture('slider');
  for (let blur = 0; blur < 30; blur += 1) {
    history.push(draft({ regions: { global: { blur, opacity: 80, radius: 10 } } }), 'slider');
  }
  history.endGesture();
  assert.equal(history.undoStack.length, 1);
  const undone = history.undo();
  assert.equal(undone.regions.global.blur, draft().regions.global.blur);
});

test('T10 比较中失焦回到最新草稿', async () => {
  const { session, shown } = manualPreview();
  await session.begin('A', { kind: 'theme', document: draft({ name: '之前' }) }, draft({ name: '之前' }));
  session.updateDraft('A', draft({ name: '最新' }));
  await session.compare('A', true);
  await session.blur('A');
  assert.equal(shown.at(-2).mode, 'baseline');
  assert.equal(shown.at(-1).mode, 'draft');
  assert.equal(shown.at(-1).name, '最新');
  assert.equal(session.state('A').phase, 'active');
});

test('T11 延迟的 A 响应不会写到 B', async () => {
  const writes = [];
  let release;
  const session = new PreviewSession({
    debounceMs: 0,
    schedule(fn) { fn(); return fn; },
    clear() {},
    apply(job) {
      if (job.targetId === 'A' && job.revision > 0) {
        return new Promise(resolve => {
          release = () => {
            if (!job.isCurrent()) return resolve({ ok: false, stale: true });
            writes.push(`${job.targetId}:${job.document.name}`);
            resolve({ ok: true });
          };
        });
      }
      writes.push(`${job.targetId}:${job.document.name}`);
      return Promise.resolve({ ok: true });
    },
    async restore() { return { ok: true }; }
  });
  await session.begin('A', { kind: 'original', document: null }, draft({ name: 'A0' }));
  session.updateDraft('A', draft({ name: 'A1' }));
  session.focus('B');
  await session.begin('B', { kind: 'original', document: null }, draft({ name: 'B0' }));
  release();
  assert.equal(writes.some(item => item.startsWith('B:') && item.endsWith('A1')), false);
  assert.equal(writes.includes('B:B0'), true);
});

test('T12 磁盘失败不表示保存成功，baseline 还在', async () => {
  const { session } = manualPreview();
  await session.begin('A', { kind: 'original', document: null }, draft({ name: '试穿' }));
  await assert.rejects(session.commit('A', async () => { throw new Error('磁盘已满'); }), error => error.code === 'SAVE_FAILED');
  assert.equal(session.state('A').phase, 'active');
  assert.equal(session.state('A').message, '已试穿但未保存');
  assert.equal(session.targets.get('A').baseline.kind, 'original');
});

test('T13 损坏、超像素和超大小的图片被拒绝', async () => {
  await assert.rejects(decodeImage(Buffer.from('not-an-image')), /仅支持|无法解码/);
  const huge = Buffer.from(TINY_PNG);
  huge.writeUInt32BE(20000, 16);
  huge.writeUInt32BE(20000, 20);
  await assert.rejects(decodeImage(huge), /像素/);
  await assert.rejects(decodeImage(Buffer.alloc(5 * 1024 * 1024 + 1, 1)), /5 MB/);
  const decoded = await decodeImage(TINY_PNG);
  assert.equal(decoded.width, 1);
  const jpg = jpeg.encode({ data: Buffer.from([255, 0, 0, 255]), width: 1, height: 1 }, 90).data;
  const jpegDecoded = await decodeImage(jpg);
  assert.equal(jpegDecoded.format, 'jpeg');
});

test('T14 慢解码不能覆盖后选择的图片', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-assets-'));
  try {
    const waits = [];
    const store = new AssetStore(dir, {
      async decodeImage(buffer) {
        return new Promise(resolve => waits.push(() => decodeImage(buffer).then(resolve)));
      }
    });
    await store.init();
    const first = solidPng(255, 0, 0);
    const second = solidPng(0, 0, 255);
    const genA = store.beginImport();
    const pendingA = store.importImage(first, genA);
    const genB = store.beginImport();
    const pendingB = store.importImage(second, genB);
    waits[1]();
    const resultB = await pendingB;
    waits[0]();
    const resultA = await pendingA;
    assert.equal(resultA.stale, true);
    assert.equal(resultB.stale, false);
    assert.equal(store.latestImportId, resultB.record.id);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('T15 两个主题共用资产时删除一个不会删掉文件', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-share-'));
  try {
    const store = new AssetStore(dir);
    await store.init();
    const imported = await store.importImage(solidPng(10, 20, 30));
    await store.addRef(imported.record.id, 'theme:a');
    await store.addRef(imported.record.id, 'theme:b');
    await store.release(imported.record.id, 'theme:a');
    const record = store.get(imported.record.id);
    assert.deepEqual(record.refs, ['theme:b']);
    const file = path.join(dir, 'files', record.file);
    assert.equal((await fs.stat(file)).isFile(), true);
    assert.ok((await store.read(imported.record.id)).length > 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('T16 导入主题 ID 冲突时生成新 ID', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-lib-'));
  try {
    const library = new ThemeLibrary(path.join(dir, 'library.json'));
    await library.load();
    const saved = await library.saveNew(draft({ name: '海岸' }), '海岸');
    const pack = { schemaVersion: 1, kind: 'anti-face-theme-pack', history: { enabled: true }, themes: [{ name: '海岸', document: saved.document }], assets: [] };
    const imported = await library.importPack(JSON.stringify(pack));
    assert.notEqual(imported.created[0].id, saved.id);
    assert.equal(library.data.themes.filter(theme => theme.id === saved.id).length, 1);
    assert.equal(imported.created[0].document.history, undefined);
    assert.equal(library.data.themes.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('T17 导入中途失败不会留下半个主题', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-import-'));
  try {
    const assets = new AssetStore(path.join(dir, 'assets'));
    await assets.init();
    const library = new ThemeLibrary(path.join(dir, 'library.json'), { assets });
    await library.load();
    const assetId = '11111111-1111-4111-8111-111111111111';
    const badId = '22222222-2222-4222-8222-222222222222';
    const base = draft({ name: '第一' });
    const pack = {
      schemaVersion: 1,
      kind: 'anti-face-theme-pack',
      themes: [
        { name: '第一', document: { ...base, wallpaper: { ...base.wallpaper, assetId } } },
        { name: '第二', document: { ...base, name: '第二', wallpaper: { ...base.wallpaper, assetId: badId } } }
      ],
      assets: [
        { id: assetId, mime: 'image/png', data: TINY_PNG.toString('base64') },
        { id: badId, mime: 'image/png', data: Buffer.from('this is not a png').toString('base64') }
      ]
    };
    await assert.rejects(library.importPack(JSON.stringify(pack)), /无法解码|仅支持|无效/);
    assert.equal(library.data.themes.length, 0);
    assert.deepEqual(await fs.readdir(path.join(dir, 'assets', 'incoming')), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('T18 凌晨使用前一天最后一条规则', () => {
  const rules = [
    { id: 'morning', time: '07:00', themeId: 'pearl', enabled: true },
    { id: 'night', time: '23:00', themeId: 'ink', enabled: true }
  ];
  const rule = activeRule(rules, { hour: 1, minute: 0 });
  assert.equal(rule.themeId, 'ink');
  assert.equal(activeRule(rules, { hour: 12, minute: 0 }).themeId, 'pearl');
});

test('T19 休眠跨过多个边界只应用当前结果一次', async () => {
  const applied = [];
  const clock = { value: new Date('2026-10-04T00:30:00+08:00') };
  const service = new AutomationService({
    clock: () => clock.value,
    timeZone: 'Asia/Shanghai',
    async hostAvailable() { return true; },
    async apply(job) { applied.push(job.themeId); return { ok: true }; }
  });
  service.setConfig({
    mode: 'schedule',
    rules: [
      { id: 'a', time: '01:00', themeId: 'pearl', enabled: true },
      { id: 'b', time: '07:00', themeId: 'aurora', enabled: true },
      { id: 'c', time: '23:00', themeId: 'ink', enabled: true }
    ]
  });
  clock.value = new Date('2026-10-04T18:00:00+08:00');
  await service.tick();
  await service.tick();
  assert.deepEqual(applied, ['aurora']);
});

test('T20 手动切换后旧定时事件不会覆盖', async () => {
  const applied = [];
  const service = new AutomationService({
    clock: () => new Date('2026-10-04T12:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    async apply(job) { applied.push(job.themeId); return { ok: true }; }
  });
  service.setConfig({ mode: 'schedule', rules: [{ id: 'noon', time: '07:00', themeId: 'pearl', enabled: true }] });
  const oldEvent = service.eventSeq;
  service.noteManual('ink');
  const result = await service.tick(oldEvent);
  assert.equal(result.action, 'ignore');
  assert.deepEqual(applied, []);
});

test('T21 试穿中定时和托盘切换不会静默覆盖', async () => {
  const applied = [];
  const service = new AutomationService({
    clock: () => new Date('2026-10-04T12:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    previewing: () => true,
    async apply(job) { applied.push(job); return { ok: true }; }
  });
  service.setConfig({ mode: 'schedule', rules: [{ id: 'noon', time: '07:00', themeId: 'pearl', enabled: true }] });
  const scheduled = await service.tick();
  const tray = await service.requestSwitch('ink', 'tray');
  assert.equal(scheduled.action, 'defer');
  assert.equal(tray.code, 'PREVIEW_CONFLICT');
  assert.deepEqual(applied, []);
});

test('T22 恢复原样后自动规则不会马上再上色', async () => {
  const applied = [];
  const service = new AutomationService({
    clock: () => new Date('2026-10-04T12:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    async apply(job) { applied.push(job.themeId); return { ok: true }; }
  });
  service.setConfig({ mode: 'system', lightThemeId: 'pearl', darkThemeId: 'ink' });
  service.systemScheme = 'dark';
  service.pause('restore');
  const result = await service.tick();
  assert.equal(result.reason, 'paused-restore');
  assert.deepEqual(applied, []);
});

test('T23 快捷键冲突时保留旧绑定', () => {
  const registered = new Map();
  const shortcut = {
    register(accelerator) {
      if (accelerator === 'Ctrl+Shift+K' || registered.has(accelerator)) return false;
      registered.set(accelerator, true);
      return true;
    },
    unregister(accelerator) { registered.delete(accelerator); }
  };
  const service = new ShortcutService({ globalShortcut: shortcut });
  const first = service.register({ toggleWindow: 'Ctrl+Shift+J' });
  const second = service.register({ toggleWindow: 'Ctrl+Shift+K' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'SHORTCUT_UNAVAILABLE');
  assert.equal(second.active.toggleWindow, 'Ctrl+Shift+J');
  assert.equal(registered.has('Ctrl+Shift+J'), true);
  assert.equal(registered.has('Ctrl+Shift+K'), false);
});

test('T24 反复启动和停止不会累加监听器', () => {
  const registered = new Map();
  const shortcut = new ShortcutService({
    globalShortcut: {
      register(accelerator, handler) {
        if (registered.has(accelerator)) return false;
        registered.set(accelerator, handler);
        return true;
      },
      unregister(accelerator) { registered.delete(accelerator); }
    }
  });
  const automation = new AutomationService({ schedule(fn) { return fn; }, clear() {} });
  const timers = [];
  const mini = {
    openCount: 0,
    close() { this.openCount = Math.max(0, this.openCount - 1); },
    open() { this.openCount += 1; timers.push(1); }
  };
  for (let index = 0; index < 20; index += 1) {
    shortcut.apply({ shortcuts: { enabled: true, bindings: { toggleWindow: 'Ctrl+Shift+J' } } });
    shortcut.stop();
    automation.setConfig({ mode: 'schedule', rules: [{ id: 'a', time: '07:00', themeId: 'ink', enabled: true }] });
    automation.stop();
    mini.open();
    mini.close();
  }
  assert.equal(shortcut.handlerCount, 0);
  assert.equal(registered.size, 0);
  assert.equal(automation.activeTimers, 0);
  assert.equal(mini.openCount, 0);
});

test('T25 重复 completed 和多窗口只提醒一次', () => {
  const policy = new NotificationPolicy({ now: () => 1000, cooldownMs: 0 });
  const prefs = { onComplete: true, sound: true, desktop: true };
  const local = { hour: 12, minute: 0 };
  const first = policy.consider({ type: 'completed', taskId: 'task-1', windowId: 'A' }, prefs, local);
  const second = policy.consider({ type: 'completed', taskId: 'task-1', windowId: 'B' }, prefs, local);
  assert.equal(first.play, true);
  assert.equal(second.reason, 'duplicate');
});

test('T26 中途接入、回放和模拟不触发正式提醒', () => {
  const policy = new NotificationPolicy({ now: () => 1000, cooldownMs: 0 });
  const prefs = { onComplete: true, onFailed: true, sound: true };
  const local = { hour: 12, minute: 0 };
  assert.equal(policy.consider({ type: 'completed', taskId: 'a', midJoin: true }, prefs, local).reason, 'replay');
  assert.equal(policy.consider({ type: 'completed', taskId: 'b', replay: true }, prefs, local).reason, 'replay');
  assert.equal(policy.consider({ type: 'completed', taskId: 'c', provenance: 'fixture' }, prefs, local).reason, 'simulated');
  assert.equal(policy.consider({ type: 'completed', taskId: 'd', channel: 'preview' }, prefs, local).reason, 'simulated');
});

test('T27 静音时段跨午夜', () => {
  const prefs = { quietEnabled: true, quietStart: '22:00', quietEnd: '08:00' };
  assert.equal(isQuiet({ hour: 23, minute: 0 }, prefs), true);
  assert.equal(isQuiet({ hour: 7, minute: 0 }, prefs), true);
  assert.equal(isQuiet({ hour: 9, minute: 0 }, prefs), false);
  const policy = new NotificationPolicy({ now: () => 1000, cooldownMs: 0 });
  const decision = policy.consider({ type: 'failed', taskId: 'night' }, { ...prefs, onFailed: true, sound: true }, { hour: 23, minute: 0 });
  assert.equal(decision.reason, 'quiet');
  assert.equal(decision.play, false);
});

test('T28 断线不误报完成或失败', () => {
  const policy = new NotificationPolicy({ now: () => 5000, cooldownMs: 0 });
  const prefs = { onComplete: true, onFailed: true, sound: true, desktop: true };
  const decision = policy.consider({ type: 'disconnected', taskId: 'x' }, prefs, { hour: 12, minute: 0 });
  assert.equal(decision.play, false);
  assert.equal(decision.reason, 'not-terminal');
  assert.equal(policy.seen.size, 0);
});

test('T29 迷你窗口不能调用主题修改', () => {
  assert.equal(authorize('mini', 'theme:apply'), false);
  assert.equal(authorize('mini', 'preview:update'), false);
  assert.equal(authorize('mini', 'library:delete'), false);
  assert.equal(authorize('mini', 'mini:snapshot'), true);
  assert.equal(authorize('main', 'theme:apply'), true);
  assert.equal(authorize('main', 'mini:snapshot'), false);
  assert.equal(authorize(null, 'theme:apply'), false);
});

test('试穿未保存时关闭窗口会询问，即使没有开托盘', () => {
  assert.equal(decideWindowClose({ closeToTray: false, quitting: false, previewActive: true }), 'prompt');
  assert.equal(decideWindowClose({ closeToTray: false, quitting: false, previewActive: false }), 'quit');
  assert.equal(decideWindowClose({ closeToTray: true, quitting: false, previewActive: false }), 'hide');
  assert.equal(decideWindowClose({ closeToTray: true, quitting: true, previewActive: true }), 'quit');
});

test('T30 掉线显示器上的窗口回到可见工作区', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const next = clampBounds({ x: 4000, y: -2000, width: 320, height: 220 }, displays);
  assert.ok(next.x >= 0 && next.x + next.width <= 1920);
  assert.ok(next.y >= 0 && next.y + next.height <= 1080);
});

test('恶意颜色、路径和目标被拒绝', () => {
  for (const color of ['#fff; } body { display:none', 'url(https://evil.test)', 'var(--x)', { r: '1); color:red', g: 0, b: 0 }]) {
    assert.throws(() => parseColor(color), /颜色|样式|通道|无效/);
  }
  assert.equal(parseColor('#AABBCC'), '#aabbcc');
  assert.equal(parseColor({ r: 0, g: 0, b: 0 }), '#000000');
  assert.throws(() => assertTargetId('../secret'), /窗口目标无效/);
  assert.throws(() => assertTargetId('ok'.repeat(80)), /窗口目标无效/);
  assert.throws(() => assertPayloadSize('x'.repeat(13 * 1024 * 1024)), /请求过大/);
  const plain = buildDocumentCSS(draft({ regions: { global: { blur: 0 }, sidebar: { opacity: 60 } } })).css;
  assert.match(plain, /--af-sidebar-opacity:60%/);
  assert.match(plain, /--af-global-blur:0px/);
  assert.doesNotMatch(plain, /html body \{[^}]*filter:/);
  const withImage = buildDocumentCSS(draft({
    regions: { sidebar: { opacity: 60 } },
    wallpaper: { legacyDataUrl: `data:image/png;base64,${TINY_PNG.toString('base64')}`, blur: 4 }
  })).css;
  assert.match(withImage, /pointer-events:none/);
  assert.match(withImage, /filter:blur\(4px\)/);
  assert.doesNotMatch(withImage, /html body \{[^}]*filter:/);
  const palette = extractPalette({ width: 2, height: 2, data: Buffer.from([10, 20, 30, 255, 200, 10, 10, 255, 10, 20, 30, 255, 10, 180, 90, 255]) });
  assert.ok(palette.length >= 1);
  assert.match(palette[0].hex, /^#[0-9a-f]{6}$/);
  const box = wallpaperBox(400, 200, 200, 200, 'cover', 100);
  const offset = wallpaperOffset(box, 200, 200, 0, 50);
  const focal = focalPointOnView(box, offset, 0, 50);
  assert.equal(Math.round(focal.x), 0);
  assert.equal(Math.round(focal.y), 100);
});

test('跟随系统主题只在深浅色变化时应用一次', async () => {
  const applied = [];
  const service = new AutomationService({
    clock: () => new Date('2026-10-04T12:00:00+08:00'),
    timeZone: 'Asia/Shanghai',
    async apply(job) { applied.push(job.themeId); return { ok: true }; }
  });
  service.setConfig({ mode: 'system', lightThemeId: 'pearl', darkThemeId: 'ink' });
  await service.setScheme('dark');
  await service.setScheme('dark');
  await service.setScheme('light');
  assert.deepEqual(applied, ['ink', 'pearl']);
});

test('定时决策在系统模式下手动暂停不会含糊恢复', () => {
  const decision = decideAutomation({
    mode: 'system',
    lightThemeId: 'pearl',
    darkThemeId: 'ink',
    pauseReason: 'manual-until-resume'
  }, { systemScheme: 'dark', local: { hour: 1, minute: 0 }, nowIso: '2026-10-04T01:00:00.000Z' });
  assert.equal(decision.action, 'none');
  assert.equal(decision.reason, 'paused-manual');
});
