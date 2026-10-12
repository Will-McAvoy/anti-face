const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { HistoryStorage } = require('../desktop/history-storage.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { TelemetryManager } = require('../desktop/telemetry-sources.cjs');
const { SettingsStore } = require('../desktop/settings.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');
const { DEFAULT_APPEARANCE, validateSettings, exportableTheme } = require('../core/theme.cjs');
const { taskStateReducer, createInitialTaskState } = require('../core/state-machine.cjs');

const settings = { schemaVersion: 1, themeId: 'graphite', appearance: { ...DEFAULT_APPEARANCE } };
const host = { installed: true, path: 'mock.exe', version: '1', fingerprint: 'fp' };

function record(id, extra = {}) {
  return {
    schemaVersion: 1,
    id: `id-${id}`,
    requestId: `req-${id}`,
    occurredAt: new Date().toISOString(),
    model: extra.model || 'model-A',
    project: 'hermes',
    outputTokens: 1,
    ...extra
  };
}

test('导出不受分页上限影响，摘要与去重口径一致', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-export-'));
  try {
    const storage = new HistoryStorage(dir, { enabled: true });
    await storage.init();
    const rows = Array.from({ length: 125 }, (_, i) => record(i, { model: i < 25 ? 'other' : 'model-A' }));
    await fs.writeFile(storage.historyFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const all = JSON.parse(await storage.exportJson());
    const csvCount = (await storage.exportCsv()).split('\r\n').length - 1;
    assert.equal(all.records.length, 125);
    assert.equal(all.totalCount, 125);
    assert.equal(all.summary.totalRecords, 125);
    assert.equal(csvCount, 125);
    const filtered = JSON.parse(await storage.exportJson({ model: 'model-A' }));
    const query = await storage.queryRecords({ model: 'model-A', page: 1, pageSize: 1000000 });
    assert.equal(filtered.records.length, 100);
    assert.equal(filtered.totalCount, 100);
    assert.equal(filtered.summary.totalRecords, 100);
    assert.equal(query.totalCount, 100);
    assert.equal(query.pageSize, 100);
    assert.equal(query.records.length, 100);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('一万条唯一记录的导出数量与筛选结果一致', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-export-10k-'));
  try {
    const storage = new HistoryStorage(dir, { enabled: true });
    await storage.init();
    const lines = Array.from({ length: 10000 }, (_, i) => JSON.stringify(record(i)));
    await fs.writeFile(storage.historyFile, lines.join('\n') + '\n');
    const exported = JSON.parse(await storage.exportJson());
    assert.equal(exported.records.length, 10000);
    assert.equal(exported.totalCount, 10000);
    assert.equal(exported.summary.totalRecords, 10000);
    assert.equal((await storage.exportCsv()).split('\r\n').length - 1, 10000);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('清理与追加串行，已提交记录不会被旧快照覆盖', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-cleanup-race-'));
  try {
    const storage = new HistoryStorage(dir, { enabled: true, retentionDays: 30 });
    await storage.init();
    const rows = Array.from({ length: 125 }, (_, i) => record(i));
    await fs.writeFile(storage.historyFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let opened;
    const openedGate = new Promise(resolve => { opened = resolve; });
    storage.onRewriteGate = () => {
      opened();
      return gate;
    };
    const cleaning = storage.cleanupRecords('older_than_retention');
    await openedGate;
    const appended = storage.appendRecord({ requestId: 'new-during-cleanup', outputTokens: 7 });
    release();
    await cleaning;
    await appended;
    const after = await storage.loadAllValidRecords();
    assert.equal(after.records.length, 126);
    assert.equal(after.records.some(row => row.requestId === 'new-during-cleanup'), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('单次写入失败后队列可以恢复，坏尾不会清空历史', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-write-recover-'));
  try {
    const storage = new HistoryStorage(dir, { enabled: true, maxRecords: 3 });
    await storage.init();
    storage._appendLine = async () => { throw new Error('disk full'); };
    await assert.rejects(storage.appendRecord({ requestId: 'failed' }), /disk full/);
    storage._appendLine = async line => fs.appendFile(storage.historyFile, line, 'utf8');
    await storage.appendRecord({ requestId: 'recovered', outputTokens: 3 });
    let loaded = await storage.loadAllValidRecords();
    assert.deepEqual(loaded.records.map(row => row.requestId), ['recovered']);

    for (const id of ['a', 'b', 'c', 'd']) await storage.appendRecord({ requestId: id, outputTokens: 1 });
    loaded = await storage.loadAllValidRecords();
    assert.deepEqual(loaded.records.map(row => row.requestId), ['b', 'c', 'd']);

    await fs.appendFile(storage.historyFile, '{"schemaVersion":1,"id":"bad",\n', 'utf8');
    const first = await storage.loadAllValidRecords();
    const logOnce = await fs.readFile(storage.corruptLogFile, 'utf8');
    const second = await storage.loadAllValidRecords();
    const logTwice = await fs.readFile(storage.corruptLogFile, 'utf8');
    assert.equal(first.records.length, 3);
    assert.equal(second.records.length, 3);
    assert.equal(logOnce, logTwice);

    const kept = await storage.cleanupRecords('older_than_retention');
    assert.equal(kept.remainingCount, 3);
    assert.equal((await storage.loadAllValidRecords()).records.length, 3);

    storage.setRetentionDays(7);
    await storage.appendRecord({ requestId: 'ancient', occurredAt: new Date(Date.now() - 10 * 86400000).toISOString() });
    assert.ok((await storage.queryRecords()).totalCount >= 1);
    const removed = await storage.cleanupRecords('older_than_retention');
    assert.equal(removed.deletedCount >= 1, true);
    assert.equal((await storage.loadAllValidRecords()).records.some(row => row.requestId === 'ancient'), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function multiWindow(options = {}) {
  const windows = {
    A: { owner: null, writes: 0, dom: true },
    B: { owner: null, writes: 0, dom: true }
  };
  let release = () => {};
  let entered = () => {};
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const stateHost = { ...host };
  const service = new ThemeService({
    autoRestoreOnReload: options.autoRestore !== false,
    retryDelayMs: 20,
    inspectHost: async () => stateHost,
    discoverEndpoint: async () => ({ port: 9 }),
    getJSON: async () => (options.ids || ['A', 'B']).map(id => ({
      id,
      title: id,
      type: 'page',
      url: `https://127.0.0.1:1235/c/${id}`,
      webSocketDebuggerUrl: `ws://127.0.0.1/${id}`
    })),
    connect: async address => {
      const id = address.endsWith('/A') ? 'A' : 'B';
      const win = windows[id];
      return {
        close() {},
        async evaluate(expression) {
          if (!win.dom) throw new Error('dom unavailable');
          if (expression.includes('selectors:')) {
            if (options.arm === 'probe') {
              options.arm = null;
              entered();
              await new Promise(resolve => { release = resolve; });
            }
            return {
              title: 'Antigravity',
              selectors: Object.fromEntries(SELECTORS.map(name => [name, true])),
              variables: Object.fromEntries(VARIABLES.map(name => [name, true])),
              supportsBackdropFilter: true,
              sessionId: win.owner
            };
          }
          if (expression.includes('style.textContent')) {
            if (options.arm === 'inject') {
              options.arm = null;
              win.writes += 1;
              win.owner = expression.match(/owner = "([^"]+)"/)[1];
              entered();
              await new Promise(resolve => { release = resolve; });
              return { sessionId: win.owner, rules: 5 };
            }
            win.writes += 1;
            win.owner = expression.match(/owner = "([^"]+)"/)[1];
            return { sessionId: win.owner, rules: 5 };
          }
          if (expression.includes('s.remove()')) {
            win.owner = null;
            return true;
          }
          if (options.blockHeartbeat) {
            options.blockHeartbeat = false;
            entered();
            await new Promise(resolve => { release = resolve; });
          }
          return !!win.owner;
        }
      };
    },
    manifest: { adapters: [{ id: 'mock', platform: process.platform, status: 'ready', verifiedHosts: [host] }] }
  });
  return {
    service,
    windows,
    stateHost,
    entered: enteredPromise,
    release: () => release(),
    arm(kind) { options.arm = kind; }
  };
}

test('两个窗口分别应用和恢复，关闭一个不影响另一个', async () => {
  const fx = multiWindow({ autoRestore: false });
  const appliedA = await fx.service.apply(settings, 'A');
  const appliedB = await fx.service.apply({ ...settings, themeId: 'pearl' }, 'B');
  assert.equal(appliedA.state, 'applied');
  assert.equal(appliedB.state, 'applied');
  assert.equal(fx.windows.A.writes, 1);
  assert.equal(fx.windows.B.writes, 1);
  assert.notEqual(fx.windows.A.owner, fx.windows.B.owner);
  const ownerA = fx.windows.A.owner;
  await fx.service.apply({ ...settings, themeId: 'ink' }, 'B');
  assert.equal(fx.windows.A.writes, 1);
  assert.equal(fx.windows.A.owner, ownerA);
  assert.equal(fx.windows.B.writes, 2);
  await fx.service.restore('A');
  assert.equal(fx.windows.A.owner, null);
  assert.ok(fx.windows.B.owner);
  fx.windows.A.owner = null;
  await fx.service.tick();
  const listed = await fx.service.listTargets();
  assert.equal(listed.find(item => item.id === 'A').state, 'ready');
  assert.notEqual(listed.find(item => item.id === 'A').state, 'applied');
  const onlyB = multiWindow({ autoRestore: false, ids: ['B'] });
  await onlyB.service.apply(settings, 'B');
  onlyB.service.getJSON = async () => [];
  const gone = await onlyB.service.listTargets();
  assert.equal(gone.length, 0);
  assert.equal(onlyB.service.targets.has('B'), false);
  await fx.service.dispose();
  assert.equal(fx.windows.B.owner, null);
});

test('手动恢复在注入前取消自动恢复，关闭自动恢复和宿主升级也不会写入', async () => {
  const beforeSend = multiWindow({ autoRestore: true });
  await beforeSend.service.apply(settings, 'A');
  const writes = beforeSend.windows.A.writes;
  beforeSend.windows.A.owner = null;
  beforeSend.arm('probe');
  const ticking = beforeSend.service.tick();
  await beforeSend.entered;
  const restoring = beforeSend.service.restore('A');
  beforeSend.release();
  await Promise.all([ticking, restoring]);
  assert.equal(beforeSend.windows.A.writes, writes);
  assert.equal(beforeSend.windows.A.owner, null);

  const heartbeat = multiWindow({ autoRestore: true, blockHeartbeat: true });
  await heartbeat.service.apply(settings, 'A');
  const before = heartbeat.windows.A.writes;
  heartbeat.windows.A.owner = null;
  const tickPromise = heartbeat.service.tick();
  await heartbeat.entered;
  const restorePromise = heartbeat.service.restore('A');
  heartbeat.release();
  await Promise.all([tickPromise, restorePromise]);
  assert.equal(heartbeat.windows.A.writes, before);
  assert.equal(heartbeat.windows.A.owner, null);

  const autoOff = multiWindow({ autoRestore: true });
  await autoOff.service.apply(settings, 'A');
  await autoOff.service.apply({ ...settings, themeId: 'pearl' }, 'B');
  const bOwner = autoOff.windows.B.owner;
  autoOff.windows.A.owner = null;
  autoOff.arm('probe');
  const autoTick = autoOff.service.tick();
  await autoOff.entered;
  autoOff.service.setAutoRestore(false);
  autoOff.release();
  await autoTick;
  assert.equal(autoOff.windows.A.writes, 1);
  assert.equal(autoOff.windows.B.owner, bOwner);

  const upgraded = multiWindow({ autoRestore: true });
  await upgraded.service.apply(settings, 'A');
  upgraded.windows.A.owner = null;
  upgraded.arm('probe');
  const upgradeTick = upgraded.service.tick();
  await upgraded.entered;
  upgraded.stateHost.fingerprint = 'changed';
  upgraded.release();
  const status = await upgradeTick;
  assert.equal(upgraded.windows.A.writes, 1);
  assert.equal(status.state, 'suspended');

  const sent = multiWindow({ autoRestore: true });
  await sent.service.apply(settings, 'A');
  sent.windows.A.owner = null;
  sent.arm('inject');
  const lateTick = sent.service.tick();
  await sent.entered;
  const lateRestore = sent.service.restore('A');
  sent.release();
  await Promise.all([lateTick, lateRestore]);
  assert.equal(sent.windows.A.owner, null);

  const dom = multiWindow({ autoRestore: true });
  await dom.service.apply(settings, 'A');
  dom.windows.A.dom = false;
  dom.windows.A.owner = null;
  const recovering = dom.service.tick();
  await new Promise(resolve => setTimeout(resolve, 30));
  dom.windows.A.dom = true;
  const recovered = await recovering;
  assert.equal(recovered.state, 'applied');
  assert.ok(dom.windows.A.writes >= 2);
});

test('终态耗时冻结在单调时钟上，不跟随系统时间', () => {
  let now = 1000;
  let state = createInitialTaskState();
  state = taskStateReducer(state, { type: 'task_started', taskId: 't1', sequence: 1 }, now);
  now += 5000;
  state = taskStateReducer(state, { phase: 'failed', sequence: 2, taskId: 't1' }, now);
  assert.equal(state.frozenElapsedMs, 5000);
  now += 9000;
  state = taskStateReducer(state, { phase: 'generating', sequence: 1, taskId: 't1' }, now);
  assert.equal(state.phase, 'failed');
  assert.equal(state.frozenElapsedMs, 5000);
});

test('遥测切换来源、窗口、会话和请求时不串数据', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-telemetry-fix-'));
  try {
    let now = 10000;
    const targets = [
      { id: 'A', isCurrent: true, title: 'A', url: 'https://127.0.0.1:1234/c/AAAAAAA1' },
      { id: 'B', isCurrent: false, title: 'B', url: 'https://127.0.0.1:1234/c/BBBBBBB2' }
    ];
    const themeService = {
      status: { state: 'ready' },
      listTargets: async () => targets.filter(item => item.live !== false)
    };
    const saved = [];
    let failArchive = true;
    const history = {
      enabled: true,
      appendRecord: async record => {
        if (failArchive) {
          failArchive = false;
          throw new Error('archive failed');
        }
        saved.push(record);
        return record;
      }
    };
    for (const id of ['AAAAAAA1', 'BBBBBBB2']) {
      const folder = path.join(dir, 'brain', id, '.system_generated', 'logs');
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(path.join(folder, 'transcript.jsonl'), JSON.stringify({
        type: 'PLANNER_RESPONSE', status: 'DONE', step_index: 1, created_at: '2026-10-04T00:00:00.000Z'
      }) + '\n');
    }
    await fs.writeFile(path.join(dir, 'antigravity_stats_cache.json'), JSON.stringify({
      sessions: {
        AAAAAAA1: { model: 'model-A', output_tokens: 10, input_tokens: 1, cached_tokens: 1, total_tokens: 12 },
        BBBBBBB2: { model: 'model-B', output_tokens: 90, input_tokens: 2, cached_tokens: 2, total_tokens: 94 }
      }
    }));
    const manager = new TelemetryManager({
      appDataDir: dir,
      themeService,
      historyStorage: history,
      monotonicNow: () => now
    });
    manager.setMode('fixture');
    assert.equal(manager.getState().metrics.totalTokens, 2200);
    assert.equal(manager.getState().metrics.provenance, 'fixture');
    manager.setMode('host');
    let state = await manager.tick();
    assert.equal(state.metrics.provenance, 'real');
    assert.equal(state.metrics.totalTokens, 12);
    assert.equal(state.metrics.model, 'model-A');
    assert.equal(state.metrics.isStale, false);
    assert.equal(state.taskState.phase, 'unknown');
    assert.match(state.taskState.unavailableReason, /整个任务/);
    assert.equal(typeof manager.currentState.observedStartMs, 'number');
    assert.equal(state.taskState.durationKind, 'observed');
    const firstObserved = state.taskState.observedSeconds;
    now += 5000;
    assert.equal(manager.getState().taskState.observedSeconds, firstObserved + 5);

    manager.setTarget('B');
    state = await manager.tick();
    assert.equal(state.metrics.model, 'model-B');
    assert.equal(state.metrics.outputTokens, 90);
    assert.equal(state.taskState.conversationId, 'BBBBBBB2');
    manager.setTarget('A');
    state = await manager.tick();
    assert.equal(state.metrics.model, 'model-A');
    assert.equal(state.metrics.outputTokens, 10);
    assert.equal(state.capabilities.finalTokens, true);

    const file = path.join(dir, 'brain', 'BBBBBBB2', '.system_generated', 'logs', 'transcript.jsonl');
    await fs.appendFile(file, JSON.stringify({ type: 'USER_INPUT', step_index: 2, created_at: '2026-10-04T00:00:02.000Z' }) + '\n');
    manager.setTarget('B');
    state = await manager._pollTranscript('BBBBBBB2', 'B').then(() => manager.getState());
    assert.equal(state.taskState.phase, 'running');
    assert.notEqual(state.taskState.phase, 'completed');
    assert.match(state.taskState.taskId, /turn:1/);
    assert.equal(saved.length, 0);
    await manager._pollTranscript('BBBBBBB2', 'B');
    assert.equal(saved.length, 1);
    assert.match(saved[0].requestId, /turn:0/);
    await manager._pollTranscript('BBBBBBB2', 'B');
    assert.equal(saved.length, 1);

    themeService.status = { state: 'detached' };
    state = await manager.tick();
    assert.equal(state.taskState.isStale, true);
    assert.equal(state.metrics.isStale, true);
    const staleUpdated = state.metrics.lastUpdated;
    themeService.status = { state: 'ready' };
    state = await manager.tick();
    assert.equal(state.taskState.isStale, false);
    assert.equal(state.metrics.isStale, false);
    assert.notEqual(state.metrics.lastUpdated, staleUpdated);

    targets.forEach(item => { item.live = item.id === 'B'; });
    manager.setTarget('A');
    state = await manager.tick();
    assert.equal(state.metrics.totalTokens, null);
    assert.equal(state.metrics.provenance, 'real');
    assert.match(state.taskState.unavailableReason, /消失/);

    const half = path.join(dir, 'brain', 'BBBBBBB2', '.system_generated', 'logs', 'transcript.jsonl');
    await fs.writeFile(half, '{"type":"USER_INPUT","step_index":3,"created_at":"2026-10-04T00:00:03.000Z"}\n{"type":"PLANNER"\n');
    manager.transcriptKey = null;
    await manager._pollTranscript('BBBBBBB2', 'B');
    assert.equal(manager.currentState.phase, 'running');
    assert.match(manager.currentMetrics.unavailableReason, /损坏/);

    let releaseRead;
    let sawBlock;
    const blocked = new Promise(resolve => { releaseRead = resolve; });
    const started = new Promise(resolve => { sawBlock = resolve; });
    const originalRead = manager._readFile;
    let blockedOnce = false;
    manager._readFile = async file => {
      if (!blockedOnce && String(file).endsWith('transcript.jsonl')) {
        blockedOnce = true;
        sawBlock();
        await blocked;
      }
      return originalRead(file);
    };
    targets.forEach(item => { item.live = true; });
    manager.setTarget('B');
    const late = manager.tick();
    await started;
    manager.setMode('fixture');
    manager.setMode('host');
    releaseRead();
    await late;
    assert.equal(manager.getState().metrics.provenance, 'real');
    assert.equal(manager.getState().metrics.totalTokens, null);
    assert.notEqual(manager.getState().metrics.totalTokens, 2200);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('应用偏好会保留，旧配置不会被自动打开历史', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-prefs-'));
  try {
    const appearance = { ...DEFAULT_APPEARANCE };
    await fs.writeFile(path.join(dir, 'settings.json'), JSON.stringify({
      schemaVersion: 1,
      themeId: 'aurora',
      appearance
    }));
    const store = new SettingsStore(dir);
    const old = await store.load();
    assert.equal(old.settings.themeId, 'aurora');
    assert.equal(old.settings.autoRestoreOnReload, undefined);
    assert.equal(old.settings.history, undefined);
    const saved = await store.save({
      ...old.settings,
      autoRestoreOnReload: true,
      history: { enabled: true, retentionDays: 7 }
    });
    assert.equal(saved.autoRestoreOnReload, true);
    assert.equal(saved.history.retentionDays, 7);
    await store.save({ schemaVersion: 1, themeId: 'ink', appearance });
    const again = await store.load();
    assert.equal(again.settings.themeId, 'ink');
    assert.equal(again.settings.autoRestoreOnReload, true);
    assert.equal(again.settings.history.enabled, true);
    assert.equal(again.settings.history.retentionDays, 7);
    assert.equal(validateSettings({ ...settings, autoRestoreOnReload: true }).autoRestoreOnReload, true);
    assert.equal(exportableTheme({ ...settings, autoRestoreOnReload: true, history: { enabled: true, retentionDays: 90 } }).history, undefined);
    assert.equal(exportableTheme(settings).autoRestoreOnReload, undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
