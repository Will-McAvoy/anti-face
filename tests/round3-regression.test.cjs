const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TelemetryManager } = require('../desktop/telemetry-sources.cjs');
const { HistoryStorage } = require('../desktop/history-storage.cjs');
async function cleanup(dir) {
  const resolved = path.resolve(dir);
  assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('anti-face-r3-'));
  await fs.rm(resolved, { recursive: true, force: true });
}


test('round 3: all eight original reproduction scenarios assert corrected behavior', () => {
  execFileSync(process.execPath, [path.join(__dirname, '../scripts/review-round3.cjs')], { timeout: 20000 });
});

test('source freshness is independent; unchanged logs never refresh statistics', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r3-fresh-'));
  try {
    const logDir = path.join(dir, 'brain/c/.system_generated/logs');
    await fs.mkdir(logDir, { recursive: true });
    const log = path.join(logDir, 'transcript.jsonl');
    const cache = path.join(dir, 'antigravity_stats_cache.json');
    await fs.writeFile(log, JSON.stringify({ type: 'USER_INPUT', created_at: '2020-01-01T00:00:00Z' }));
    await fs.writeFile(cache, JSON.stringify({ sessions: { c: { model: 'm', output_tokens: 22 } } }));
    let now = 100;
    const manager = new TelemetryManager({ appDataDir: dir, monotonicNow: () => now, staleAfterMs: 1000,
      themeService: { status: { state: 'ready' }, listTargets: async () => [{ id: 'A', url: 'https://127.0.0.1/c/c' }] } });
    const initial = await manager.tick();
    now = 1200;
    const stale = await manager.tick();
    assert.equal(stale.metrics.isStale, true);
    assert.equal(stale.taskState.isStale, true);
    assert.equal(stale.metrics.lastUpdated, initial.metrics.lastUpdated);
    assert.equal(stale.taskState.lastUpdateIso, initial.taskState.lastUpdateIso);
    await fs.appendFile(log, '\n' + JSON.stringify({ type: 'PLANNER_RESPONSE', status: 'STREAMING', step_index: 1, created_at: '2020-01-01T00:00:02Z' }));
    const freshTask = await manager.tick();
    assert.equal(freshTask.taskState.isStale, false);
    assert.equal(freshTask.metrics.isStale, true);
    await fs.rm(cache);
    assert.equal((await manager.tick()).metrics.outputTokens, null);
    await fs.writeFile(cache, JSON.stringify({ sessions: { c: { model: 'm', output_tokens: 7 } } }));
    assert.equal((await manager.tick()).metrics.outputTokens, 7);
    assert.equal(manager.getState().metrics.isStale, false);
  } finally { await cleanup(dir); }
});

test('each archived turn owns its time and latency; restart does not append duplicates', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r3-archive-'));
  try {
    const history = new HistoryStorage(dir, { enabled: true });
    const manager = new TelemetryManager({ historyStorage: history });
    const turn = (id, start, end) => ({ id, events: [
      { type: 'USER_INPUT', created_at: start },
      { type: 'TOOL', created_at: start },
      { type: 'PLANNER_RESPONSE', created_at: end }
    ] });
    const a = turn('c:turn:0', '2020-01-01T00:00:00Z', '2020-01-01T00:00:01Z');
    const b = turn('c:turn:1', '2020-01-02T00:00:00Z', '2020-01-02T00:00:03Z');
    await manager._archiveTurn(a, 'c');
    await manager._archiveTurn(b, 'c');
    const restarted = new TelemetryManager({ historyStorage: history });
    await restarted._archiveTurn(a, 'c');
    assert.equal((await history.loadAllValidRecords()).records.length, 2);
    const result = await history.queryRecords();
    assert.deepEqual(result.records.map(r => r.latencyMs), [1000, 3000]);
    assert.equal((await history.queryRecords({ dateRange: 'today' })).totalCount, 0);
    assert.equal(manager._turnLatency(turn('none', 'invalid', 'invalid')), null);
    assert.equal(manager._turnLatency(turn('reverse', '2020-01-02', '2020-01-01')), null);
    assert.equal(manager._turnLatency({ events: [{ type: 'USER_INPUT' }] }), null);
    await history.appendRecord({ requestId: 'unknown-time' });
    await history.appendRecord({ requestId: 'known-retry', attempts: 3 });
    const all = await history.queryRecords();
    assert.equal(all.summary.retryCount, 2);
    assert.equal(all.summary.missingAttemptsCount, 3);
    assert.equal((await history.queryRecords({ dateRange: '7d' })).totalCount, 0);
    await history.cleanupRecords('older_than_retention');
    assert.equal((await history.queryRecords()).totalCount, 2); // unknown dates are not silently deleted
    assert.match(await history.exportCsv(), /ObservedAt/);
    assert.equal(JSON.parse(await history.exportJson()).records[0].occurredAt, null);
  } finally { await cleanup(dir); }
});

test('failed temporary write preserves history and cleanup queue recovers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r3-disk-'));
  const original = fs.writeFile;
  try {
    const history = new HistoryStorage(dir, { enabled: true });
    await history.appendRecord({ requestId: 'keep' });
    const before = await fs.readFile(history.historyFile, 'utf8');
    fs.writeFile = async (file, ...args) => {
      if (path.dirname(file) === dir && path.basename(file).startsWith('task_history_tmp_')) {
        await original(file, 'partial');
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      }
      return original(file, ...args);
    };
    await assert.rejects(history.cleanupRecords('all'), /disk full/);
    assert.equal(await fs.readFile(history.historyFile, 'utf8'), before);
    fs.writeFile = original;
    assert.equal((await history.cleanupRecords('all')).deletedCount, 1);
    assert.equal((await history.queryRecords()).totalCount, 0);
    assert.equal((await fs.readdir(dir)).some(f => f.startsWith('task_history_tmp_')), false);
  } finally { fs.writeFile = original; await cleanup(dir); }
});

test('legacy transcript dates and retries are unknown without changing the source file', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anti-face-r3-legacy-'));
  try {
    const history = new HistoryStorage(dir, { enabled: true });
    const source = JSON.stringify({ schemaVersion: 1, requestId: 'c:turn:0', occurredAt: new Date().toISOString(), attempts: 4 });
    await fs.writeFile(history.historyFile, source);
    const result = await history.queryRecords();
    assert.equal(result.records[0].occurredAt, null);
    assert.equal(result.records[0].attempts, null);
    assert.equal((await history.queryRecords({ dateRange: 'today' })).totalCount, 0);
    assert.equal(await fs.readFile(history.historyFile, 'utf8'), source);
  } finally { await cleanup(dir); }
});
