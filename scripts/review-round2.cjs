// Review-only reproductions: isolated files and mocked CDP; never connects to the user's host.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { HistoryStorage } = require('../desktop/history-storage.cjs');
const { TelemetryManager } = require('../desktop/telemetry-sources.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');
const { DEFAULT_APPEARANCE, validateSettings } = require('../core/theme.cjs');
const findings = [];
function record(id, details) { findings.push({ id, ...details }); console.log(JSON.stringify(findings.at(-1))); }
function fixture() {
  const host = { installed: true, path: 'mock.exe', version: 'test', fingerprint: 'test' };
  const windows = Object.fromEntries(['A','B'].map(id => [id, { owner: null, writes: 0 }]));
  let restoreRequested = false, lateWrites = 0, releaseHeartbeat, heartbeatEntered;
  const entered = new Promise(resolve => { heartbeatEntered = resolve; });
  let blockHeartbeat = false;
  const service = new ThemeService({
    inspectHost: async () => host, discoverEndpoint: async () => ({ port: 1234 }),
    getJSON: async () => Object.keys(windows).map(id => ({ id, title: id, type: 'page', url: 'https://127.0.0.1:1235/c/' + id, webSocketDebuggerUrl: 'ws://127.0.0.1:1234/' + id })),
    connect: async address => {
      const w = windows[address.slice(-1)];
      return { close() {}, async evaluate(expression) {
        if (expression.includes('selectors:')) return { title: 'Antigravity', selectors: Object.fromEntries(SELECTORS.map(s => [s,true])), variables: Object.fromEntries(VARIABLES.map(s => [s,true])), supportsBackdropFilter: true, sessionId: w.owner };
        if (expression.includes('style.textContent')) {
          w.writes++; if (restoreRequested) lateWrites++;
          w.owner = expression.match(/owner = "([^"]+)"/)[1];
          return { sessionId: w.owner, rules: 5 };
        }
        if (expression.includes('s.remove()')) { w.owner = null; return true; }
        if (blockHeartbeat) { blockHeartbeat = false; heartbeatEntered(); await new Promise(resolve => { releaseHeartbeat = resolve; }); }
        return !!w.owner;
      }};
    },
    manifest: { adapters: [{ id: 'mock', platform: process.platform, status: 'ready', verifiedHosts: [host] }] },
    autoRestoreOnReload: true,
  });
  return { service, windows, entered, block() { blockHeartbeat = true; }, requestRestore() { restoreRequested = true; return service.restore(); }, release() { releaseHeartbeat(); }, lateWrites: () => lateWrites };
}
(async () => {
  const root = path.resolve(__dirname, '../artifacts');
  await fs.mkdir(root, { recursive: true });
  const temp = await fs.mkdtemp(path.join(root, 'round2-review-'));
  try {
    const storage = new HistoryStorage(path.join(temp, 'history'), { enabled: true });
    await storage.init();
    const records = Array.from({ length: 125 }, (_,i) => ({ schemaVersion:1,id:String(i),requestId:String(i),occurredAt:new Date().toISOString(),outputTokens:1 }));
    await fs.writeFile(storage.historyFile, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    const exported = JSON.parse(await storage.exportJson());
    const csvCount = (await storage.exportCsv()).split('\r\n').length - 1;
    assert.equal(exported.records.length,125);
    assert.equal(exported.totalCount,125);
    assert.equal(csvCount,125);
    record('R1_EXPORT_TRUNCATION',{expected:125,jsonRecords:exported.records.length,jsonTotalCount:exported.totalCount,csvRecords:csvCount,fixed:true});
    const originalLoad = storage.loadAllValidRecords.bind(storage);
    let releaseCleanup;
    let opened;
    const snapReady = new Promise(resolve => { opened = resolve; });
    // 栅栏位于取得写入通道并读完快照之后、原子重写之前。追加只入队，不能在放行前 await，否则会和通道互相等待。
    storage.onRewriteGate = () => {
      opened();
      return new Promise(resolve => { releaseCleanup = resolve; });
    };
    const cleanup = storage.cleanupRecords('older_than_retention');
    await snapReady;
    const appended = storage.appendRecord({ requestId: 'new-during-cleanup' });
    releaseCleanup();
    await cleanup;
    await appended;
    const afterCleanup = await originalLoad();
    assert.equal(afterCleanup.records.some(r => r.requestId === 'new-during-cleanup'),true);
    assert.equal(afterCleanup.records.length,126);
    record('R9_CLEANUP_LOST_WRITE',{expectedRecords:126,actualRecords:afterCleanup.records.length,newRecordLost:false,fixed:true});

    const settings = { schemaVersion:1,themeId:'graphite',appearance:DEFAULT_APPEARANCE };
    const f = fixture();
    await f.service.apply(settings,'A');
    await f.service.apply({ ...settings,themeId:'pearl' },'B');
    assert.equal(f.windows.B.writes,1);
    assert.equal(f.service.session.targetId,'B');
    record('R2_WRONG_TARGET',{requested:'B',actual:f.service.session.targetId,writesA:f.windows.A.writes,writesB:f.windows.B.writes,fixed:true});
    f.windows.A.owner = null;
    f.service.setAutoRestore(false);
    await f.service.tick();
    const targetsAfterRefresh = await f.service.listTargets();
    const targetA = targetsAfterRefresh.find(item => item.id === 'A');
    const targetB = targetsAfterRefresh.find(item => item.id === 'B');
    assert.equal(targetA.state, 'ready');
    assert.equal(targetB.state, 'applied');
    record('R3_STALE_TARGET_STATE',{service:f.service.status.state,targetA:targetA.state,targetB:targetB.state,fixed:true});
    await f.service.dispose();

    const race = fixture();
    await race.service.apply(settings,'A');
    race.windows.A.owner = null;
    race.block();
    const ticking = race.service.tick();
    await race.entered;
    const restoring = race.requestRestore();
    race.release();
    await Promise.all([ticking,restoring]);
    assert.equal(race.lateWrites(),0);
    assert.equal(race.windows.A.owner,null);
    record('R4_RESTORE_RACE',{writesAfterRestoreRequest:race.lateWrites(),finalOwner:race.windows.A.owner,fixed:true});
    await race.service.dispose();

    const manager = new TelemetryManager({ appDataDir:temp,themeService:{ status:{state:'ready'},listTargets:async()=>[{id:'A',isCurrent:true,title:'A',url:'https://127.0.0.1:1234/'}] } });
    manager.setMode('fixture'); manager.setMode('host'); await manager.tick();
    assert.equal(manager.getState().metrics.totalTokens,null);
    assert.equal(manager.getState().metrics.provenance,'real');
    record('R5_FIXTURE_LEAK',{mode:manager.mode,provenance:manager.getState().metrics.provenance,totalTokens:manager.getState().metrics.totalTokens,isStale:manager.getState().metrics.isStale,fixed:true});

    for(const id of ['AAAAAAA1','BBBBBBB2']) {
      const dir = path.join(temp,'brain',id,'.system_generated/logs'); await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,'transcript.jsonl'),JSON.stringify({type:'PLANNER_RESPONSE',status:'DONE',step_index:1,created_at:new Date().toISOString()})+'\n');
    }
    await fs.writeFile(path.join(temp,'antigravity_stats_cache.json'),JSON.stringify({sessions:{AAAAAAA1:{model:'model-A',output_tokens:10},BBBBBBB2:{model:'model-B',output_tokens:90}}}));
    const m = new TelemetryManager({appDataDir:temp});
    await m._pollTranscript('AAAAAAA1'); await m._pollStatsCache('AAAAAAA1');
    await m._pollTranscript('BBBBBBB2'); await m._pollStatsCache('BBBBBBB2');
    assert.equal(m.currentMetrics.model,'model-B');
    assert.equal(m.currentMetrics.outputTokens,90);
    assert.equal(typeof m.currentState.observedStartMs,'number');
    record('R6_CONVERSATION_LEAK',{conversation:m.currentState.conversationId,expectedModel:'model-B',actualModel:m.currentMetrics.model,output:m.currentMetrics.outputTokens,observedStart:m.currentState.observedStartMs,observedSeconds:m.getState().taskState.observedSeconds,fixed:true});
    const file=path.join(temp,'brain/BBBBBBB2/.system_generated/logs/transcript.jsonl');
    await fs.appendFile(file,JSON.stringify({type:'USER_INPUT',step_index:2,created_at:new Date().toISOString()})+'\n');
    await m._pollTranscript('BBBBBBB2');
    assert.equal(m.currentState.phase,'running');
    record('R7_NEW_TURN_STAYS_COMPLETED',{lastEvent:'USER_INPUT',phase:m.currentState.phase,fixed:true});

    const saved = validateSettings({...settings,autoRestoreOnReload:true});
    assert.equal(saved.autoRestoreOnReload,true);
    record('R8_DROPPED_SETTING',{saved,fixed:true});
    await fs.writeFile(path.join(root,'round2-review-results.json'),JSON.stringify({reviewDate:'2026-10-04',findings},null,2));
  } finally {
    assert.ok(path.resolve(temp).startsWith(root + path.sep));
    await fs.rm(temp,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1});
