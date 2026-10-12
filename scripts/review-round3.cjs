// Round 3 correctness regression: synthetic logs and mock CDP; never writes real Antigravity/history.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { TelemetryManager } = require('../desktop/telemetry-sources.cjs');
const { ThemeService } = require('../desktop/theme-service.cjs');
const { HistoryStorage } = require('../desktop/history-storage.cjs');
const { SELECTORS, VARIABLES } = require('../core/runtime.cjs');
const findings = [];
function record(id, value) { const item = {id,...value}; findings.push(item); console.log(JSON.stringify(item)); }
function serviceFixture() {
  const host={installed:true,path:'mock.exe',version:'test',fingerprint:'test'};
  let connected=true;
  const s=new ThemeService({
    inspectHost:async()=>host,discoverEndpoint:async()=>({port:1234}),
    getJSON:async()=>{if(!connected)throw Error('disconnected');return ['A','B'].map(id=>({id,type:'page',title:id,url:'https://127.0.0.1:1235/c/'+id,webSocketDebuggerUrl:'ws://127.0.0.1:1234/'+id}));},
    connect:async()=>({close(){},async evaluate(){return {title:'Antigravity',selectors:Object.fromEntries(SELECTORS.map(s=>[s,true])),variables:Object.fromEntries(VARIABLES.map(s=>[s,true])),supportsBackdropFilter:true,sessionId:null};}}),
    manifest:{adapters:[{id:'test',platform:process.platform,status:'ready',verifiedHosts:[host]}]}
  });
  return {s,disconnect(){connected=false;}};
}
(async()=>{
  const root=path.resolve(__dirname,'../artifacts');
  await fs.mkdir(root,{recursive:true});
  const dir=await fs.mkdtemp(path.join(root,'round3-review-'));
  try {
    const f=serviceFixture();
    await f.s.inspect();
    const windows=await f.s.listTargets();
    await f.s.inspect('B');
    const b=f.s.statusFor('B');
    assert.equal(b.state,'ready');
    record('R3_01_UNPROBED_WINDOW',{listedB:windows.find(w=>w.id==='B').state,statusForB:b.state,uiCanApply:['ready','applied'].includes(b.state)});
    await f.s.inspect('B');
    assert.equal(f.s.focusId,'B');
    record('R3_01_REINSPECT',{focusAfterReinspect:f.s.focusId,statusForB:f.s.statusFor('B').state});
    f.disconnect();await f.s.tick();
    assert.equal(f.s.status.state,'detached');
    record('R3_02_IDLE_DISCONNECT',{actualConnected:false,reportedState:f.s.status.state});
    await f.s.dispose();

    const logdir=path.join(dir,'brain','convo','.system_generated','logs');
    await fs.mkdir(logdir,{recursive:true});
    const transcript=path.join(logdir,'transcript.jsonl');
    const events=[
      {type:'USER_INPUT',step_index:0,created_at:'2020-01-01T00:00:00.000Z'},
      {type:'PLANNER_RESPONSE',step_index:1,status:'DONE',created_at:'2020-01-01T00:00:00.100Z'},
      {type:'USER_INPUT',step_index:2,created_at:'2020-01-01T00:01:00.000Z'},
      {type:'PLANNER_RESPONSE',step_index:3,status:'STREAMING',created_at:'2020-01-01T00:01:02.000Z'}
    ];
    await fs.writeFile(transcript,events.map(e=>JSON.stringify(e)).join('\n'));
    let url='https://127.0.0.1:1234/c/convo';
    const mgr=new TelemetryManager({appDataDir:dir,themeService:{status:{state:'ready'},listTargets:async()=>[{id:'A',isCurrent:true,title:'A',url}]}});
    const cache=path.join(dir,'antigravity_stats_cache.json');
    await fs.writeFile(cache,JSON.stringify({sessions:{convo:{model:'M',input_tokens:100,cached_tokens:50,output_tokens:200,thinking_tokens:40,total_tokens:350,duration_sec:10}}}));
    await mgr.tick();
    assert.equal(mgr.currentMetrics.latencyMs,2000);
    record('R3_03_WRONG_TURN_LATENCY',{task:mgr.currentState.taskId,expectedMs:2000,actualMs:mgr.currentMetrics.latencyMs});
    await fs.writeFile(cache,JSON.stringify({sessions:{convo:{model:'M'}}},null,2));
    await mgr.tick();
    record('R3_04_MISSING_FIELDS',{input:mgr.currentMetrics.inputTokens,output:mgr.currentMetrics.outputTokens,totalInput:mgr.currentMetrics.totalInput,totalOutput:mgr.currentMetrics.totalOutput,cacheRate:mgr.currentMetrics.cacheRate,finalTokens:mgr.getState().capabilities.finalTokens});
    assert.equal(mgr.currentMetrics.totalOutput,null);
    await fs.writeFile(cache,JSON.stringify({sessions:{convo:{model:'M',input_tokens:100,cached_tokens:50,output_tokens:200,thinking_tokens:40,total_tokens:350,duration_sec:10}}}));
    await mgr.tick();
    url='https://127.0.0.1:1234/';
    await mgr.tick();
    record('R3_05_NO_CONVERSATION',{phase:mgr.currentState.phase,output:mgr.currentMetrics.outputTokens,cached:mgr.currentMetrics.cachedInputTokens,cacheRate:mgr.currentMetrics.cacheRate,averageSpeed:mgr.currentMetrics.averageSpeedToks,stale:mgr.currentMetrics.isStale});
    assert.equal(mgr.currentMetrics.cachedInputTokens,null);

    url='https://127.0.0.1:1234/c/convo';
    const staleMgr=new TelemetryManager({appDataDir:dir,themeService:{status:{state:'ready'},listTargets:async()=>[{id:'A',isCurrent:true,title:'A',url}]}});
    await staleMgr.tick();
    await fs.writeFile(cache,'{bad json');
    await staleMgr.tick();
    record('R3_06_CORRUPT_SOURCE',{output:staleMgr.currentMetrics.outputTokens,metricsStale:staleMgr.currentMetrics.isStale,taskStale:staleMgr.currentState.isStale,reason:staleMgr.currentMetrics.unavailableReason});
    assert.equal(staleMgr.currentMetrics.outputTokens,null);
    assert.equal(staleMgr.currentMetrics.isStale,true);

    const history=new HistoryStorage(path.join(dir,'history'),{enabled:true});
    await history.init();
    const archiveEvents=[events[0],events[1],{...events[1],step_index:2},{...events[1],step_index:3},{...events[2],step_index:4}];
    await fs.writeFile(transcript,archiveEvents.map(e=>JSON.stringify(e)).join('\n'));
    const hm=new TelemetryManager({appDataDir:dir,historyStorage:history});
    await hm._pollTranscript('convo','A',hm._generation);
    const rows=await history.queryRecords();
    const today=await history.queryRecords({dateRange:'today'});
    assert.equal(rows.records[0].attempts,null);
    assert.equal(today.totalCount,0);
    record('R3_07_FALSE_RETRY_AND_DATE',{realRetryEvents:0,plannerSteps:3,recordAttempts:rows.records[0].attempts,retryCount:rows.summary.retryCount,eventDate:'2020-01-01',recordDate:rows.records[0].occurredAt,todayCount:today.totalCount});

    const before=await fs.readFile(history.historyFile,'utf8');
    const originalRename=fs.rename,originalCopy=fs.copyFile;
    let failed=false;
    try {
      fs.rename=async(src,dest)=>{if(dest===history.historyFile)throw Object.assign(Error('simulated EPERM'),{code:'EPERM'});return originalRename(src,dest);};
      fs.copyFile=async(src,dest)=>{if(dest===history.historyFile){await fs.writeFile(dest,'partial');throw Object.assign(Error('simulated disk-full'),{code:'ENOSPC'});}return originalCopy(src,dest);};
      try {await history.cleanupRecords('all');} catch {failed=true;}
    } finally {fs.rename=originalRename;fs.copyFile=originalCopy;}
    const after=await fs.readFile(history.historyFile,'utf8');
    assert.ok(failed&&after===before);
    record('R3_08_NONATOMIC_FALLBACK',{operationFailed:failed,originalPreserved:after===before,currentContents:after});
    await fs.writeFile(path.join(root,'round3-fix-results.json'),JSON.stringify({reviewDate:'2026-10-04',correctnessAssertions:true,findings},null,2));
  } finally {
    assert.ok(path.resolve(dir).startsWith(root+path.sep));
    await fs.rm(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
