const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {stores,seed}=require('../tests/fixtures/round6-stores.cjs');
const {captureIdentity,forceStopRecorded}=require('./round6-process.cjs');
const root=path.resolve(__dirname,'..');
const packed=process.argv.includes('--packed');
const out=path.join(root,'artifacts','round6-fix');
const results={kind:packed?'final-win-unpacked':'real-Electron-controlled-host',startedAt:new Date().toISOString(),checks:[]};
const record=(name,details={})=>{results.checks.push({name,status:'passed',...details});console.log('PASS',name);};
let app,page,dir;const errors=[];
async function launch(userData){const env={...process.env,ANTI_FACE_TEST_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;delete env.ANTI_FACE_DEV_URL;
 app=await electron.launch(packed?{executablePath:path.join(root,'release','win-unpacked','Anti Face.exe'),env,cwd:root,timeout:30000}:{args:[path.join(root,'tests','fixtures','desktop-round5-host.cjs')],env,cwd:root,timeout:30000});
 page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.getByText('设置已保存到本机',{exact:true}).waitFor();
 const proto=Object.getPrototypeOf(page.locator('body'));if(!proto.round6Click){const original=proto.click;proto.click=function(options={}){return original.call(this,{noWaitAfter:true,...options});};proto.round6Click=true;}
 await rememberIdentity(userData);
 return page;
}
async function close(){if(app){await app.close().catch(()=>{});app=null;}}
let recordedIdentity=null;
function lockLaunchError(error){return /ECONNRESET|Lock file|singleton|WebSocket/i.test(String(error&&(error.stack||error.message)||error));}
async function rememberIdentity(userData){
 const rootPid=app.process().pid,mainPid=await app.evaluate(()=>process.pid);let last;
 for(let attempt=0;attempt<8;attempt++){
  try{recordedIdentity=await captureIdentity({rootPid,mainPid,userData});app.__identity=recordedIdentity;return;}
  catch(error){last=error;await new Promise(r=>setTimeout(r,250));}
 }
 throw last;
}
async function killUnclean(userData){
 if(!recordedIdentity||path.resolve(recordedIdentity.userData)!==path.resolve(userData))throw new Error('forced exit has no recorded test identity');
 const current=app;app=null;
 try{await forceStopRecorded(recordedIdentity);}
 catch(error){if(current)await current.close().catch(()=>{});throw error;}
}
async function launchAfterRelease(userData){
 try{await launch(userData);return;}
 catch(error){await close();if(!lockLaunchError(error)||!recordedIdentity)throw error;}
 await forceStopRecorded(recordedIdentity);
 await launch(userData);
}
async function tools(tab){await page.getByRole('button',{name:'实用功能 (F01–F07)',exact:true}).click();await page.getByRole('button',{name:tab,exact:true}).click();}
async function waitNotice(text){await page.getByText(text,{exact:false}).first().waitFor();}
async function closeSwitcher(w){const closed=w.waitForEvent('close');void w.evaluate(()=>window.quickSwitcher.close()).catch(()=>{});await closed;}
async function openSwitcher(){const existing=app.windows().find(w=>w.url().includes('switcher.html'));if(existing){await page.evaluate(()=>window.antiFace.openQuickSwitcher());return existing;}const next=app.waitForEvent('window');await page.evaluate(()=>window.antiFace.openQuickSwitcher());return await next;}
async function computedBlur(){return app.evaluate(async({BrowserWindow})=>{const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});try{await w.loadURL('about:blank');await w.webContents.executeJavaScript('document.body.innerHTML='+JSON.stringify('<div class="monaco-workbench"><div class="flex-1 min-h-0">合成内容</div></div>'));await w.webContents.insertCSS(global.round5Mock.windows.A.css);return await w.webContents.executeJavaScript('getComputedStyle(document.body,"::before").filter');}finally{w.destroy();}});}

(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'anti-face-r6-electron-'));await fs.mkdir(out,{recursive:true});
 const sourceDir=path.join(dir,'source'),destDir=path.join(dir,'dest');const source=await stores(sourceDir);const seedData=await seed(source,sourceDir);const archive=path.join(dir,'export.antiface-backup');
 await launch(sourceDir);await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},archive);
 await tools('F05 完整备份与迁移');await page.getByRole('button',{name:/导出完整备份/}).click();await waitNotice('备份导出成功');await fs.access(archive);record('UI backup export through main dialog and preload');await close();
 await launch(destDir);await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},archive);
 await tools('F05 完整备份与迁移');await page.getByRole('button',{name:'选择备份包并检验',exact:true}).click();await page.getByText('备份包已通过安全检查',{exact:true}).waitFor();
 record('renderer → preload → main inspect → renderer → main preview');
 await page.getByRole('button',{name:'确认执行事务恢复',exact:true}).click();await waitNotice('备份恢复成功');
 const state=await page.evaluate(()=>window.antiFace.studioState());assert.equal(state.library.total,1);assert.equal(state.preferences.shortcuts.enabled,false);assert.equal(state.preferences.automation.mode,'off');assert.equal(state.document.id,seedData.theme.id);
 record('UI transaction commit restores selected sections and disables automatic actions');
 const restartStores=await stores(destDir);const restored=restartStores.library.data.themes[0];assert.ok(await restartStores.assets.read(restored.document.wallpaper.assetId));assert.ok(await restartStores.assets.read(restored.thumbnailAssetId));assert.equal(restartStores.revisions.list(restored.id).length,1);
 record('real image/thumbnail/revision readable in new Store');
 await tools('F06 性能自适应');await page.locator('input[name="perfMode"][value="auto"]').check();await waitNotice('性能策略已更新');assert.equal((await page.evaluate(()=>window.antiFace.getPerformanceSummary(null))).mode,'auto');record('UI performance auto persists through preferences IPC');
 await page.evaluate(()=>window.antiFace.enterSafeMode('E2E'));assert.equal((await page.evaluate(()=>window.antiFace.applyDocument(window.__doc || {invalid:true},'A'))).code,'SAFE_MODE');
 record('safe mode blocks real editor IPC even before document validation');
 if(!packed){
  await page.evaluate(()=>window.antiFace.exitSafeMode());await page.evaluate(()=>window.antiFace.inspect('A'));
  await app.evaluate(()=>{const s=global.round5Mock.studio;s.selectTarget('A');s.round5.releaseHold('A');});
  const themeDoc=(await page.evaluate(id=>window.antiFace.getLibraryTheme(id),restored.id)).document;themeDoc.wallpaper.blur=28;themeDoc.regions.global.blur=28;
  await app.evaluate(()=>{const s=global.round5Mock.studio;global.round5Mock.battery=true;s.performance.powerMonitor.isOnBatteryPower=()=>global.round5Mock.battery;});
  await page.evaluate(d=>window.antiFace.applyDocument(d,'A'),themeDoc);
  await page.evaluate(()=>window.antiFace.setPerformancePrefs({mode:'auto',batteryAware:true}));
  assert.match(await computedBlur(),/blur\(8px\)/);record('real service resolver applies battery blur, Chromium computed filter = 8px');
  await app.evaluate(()=>{global.round5Mock.battery=false;global.round5Mock.studio.performance.getTargetState('A').lastAdjustedAt=0;global.round5Require('electron').powerMonitor.emit('on-ac');});
  await page.waitForFunction(async()=>{const v=await window.antiFace.getPerformanceSummary('A');return v.tier==='normal';});assert.match(await computedBlur(),/blur\(28px\)/);
  const saved=JSON.parse(await fs.readFile(path.join(destDir,'appearance.json')));assert.equal(saved.document.wallpaper.blur,28);record('AC event restores computed blur without mutating original document');
  await page.evaluate(()=>window.antiFace.enterSafeMode('E2E'));const before=await app.evaluate(()=>global.round5Mock.windows.A.writes);
  let switcher=await openSwitcher();
  await switcher.locator('#searchInput').waitFor();const blocked=await switcher.evaluate(()=>window.quickSwitcher.applyTheme('graphite','A'));assert.equal(blocked.code,'SAFE_MODE');assert.equal(await app.evaluate(()=>global.round5Mock.windows.A.writes),before);record('safe mode + real switcher window injects zero');await closeSwitcher(switcher);
  await page.evaluate(()=>window.antiFace.exitSafeMode());await page.evaluate(()=>window.antiFace.beginPreview('A'));await page.evaluate(d=>window.antiFace.updatePreview(d,'A'),themeDoc);await app.evaluate(async()=>{await global.round5Mock.studio.preview.flush('A');});
  switcher=await openSwitcher();await switcher.locator('#searchInput').waitFor();
  const conflict=await switcher.evaluate(()=>window.quickSwitcher.applyTheme('graphite','A'));assert.equal(conflict.conflict,true);
  await app.evaluate(()=>{const s=global.round5Mock.studio;global.round5Mock.savedCommit=s.commitPreview;s.commitPreview=async()=>{throw new Error('E2E disk full');};});
  const failed=await switcher.evaluate(()=>window.quickSwitcher.resolveConflict('save','A'));assert.equal(failed.ok,false);assert.notEqual(failed.resolved,'saved');assert.equal((await page.evaluate(()=>window.antiFace.studioState())).preview.phase,'active');record('switcher save rejection preserves active draft and reports failure');
  await app.evaluate(()=>{global.round5Mock.studio.commitPreview=global.round5Mock.savedCommit;});
  const resolved=await switcher.evaluate(()=>window.quickSwitcher.resolveConflict('save','A'));assert.equal(resolved.ok,true);await closeSwitcher(switcher);
  switcher=await openSwitcher();await switcher.locator('#searchInput').waitFor();await switcher.locator('#searchInput').fill('石墨');const enterClosed=switcher.waitForEvent('close');await switcher.locator('#searchInput').press('Enter',{noWaitAfter:true}).catch(e=>{if(!switcher.isClosed())throw e;});await enterClosed;await page.waitForFunction(async()=>{const s=await window.antiFace.status('A');return s.state==='applied';});record('real switcher keyboard search and Enter application');
  switcher=await openSwitcher();await switcher.locator('#searchInput').waitFor();const escapeClosed=switcher.waitForEvent('close');await switcher.locator('#searchInput').press('Escape',{noWaitAfter:true}).catch(e=>{if(!switcher.isClosed())throw e;});await escapeClosed;record('real switcher Escape closes');
  await page.evaluate(()=>window.antiFace.getDisplayContext('A'));const c1=await page.evaluate(()=>window.antiFace.getDisplayContext('A'));await app.evaluate(()=>{global.round5Mock.windows.A.viewport={width:700,height:500,dpr:2};global.round5Require('electron').screen.emit('display-metrics-changed');});await page.waitForFunction(async v=>(await window.antiFace.getDisplayContext('A')).version>v,c1.version);record('host DPR/viewport observed through actual controller and Electron screen event');
  await page.evaluate(()=>window.antiFace.openMini());await app.evaluate(()=>{const s=global.round5Mock.studio;for(const w of [s.mini.window,s.quickSwitcher?.window,global.round5Require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('dist/index.html'))])if(w)w.setBounds({x:20000,y:20000,width:480,height:500});global.round5Require('electron').screen.emit('display-removed');});
  await page.waitForTimeout(250);const visible=await app.evaluate(()=>{const s=global.round5Mock.studio;return [s.mini.window,global.round5Require('electron').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('dist/index.html'))].map(w=>w.getBounds().x<20000);});assert.ok(visible.every(Boolean));record('real main and mini windows rescued after screen event');
 }
 await tools('F01 一键恢复与安全模式');
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('dist/index.html'));if(w){if(w.isMinimized())w.restore();w.show();w.focus();}});
 await page.screenshot({path:path.join(out,packed?'packed.png':'electron.png'),timeout:60000,animations:'disabled'});
 await close();await launch(destDir);assert.equal((await page.evaluate(()=>window.antiFace.getPerformanceSummary(null))).mode,'auto');record('performance and restored images persist after Electron restart');
 const forcedIdentity=recordedIdentity;await killUnclean(destDir);await launchAfterRelease(destDir);await page.getByRole('dialog',{name:'异常启动选择'}).waitFor();assert.equal((await page.evaluate(()=>window.antiFace.safeModeStatus())).safeMode,true);await page.getByRole('button',{name:'保持安全模式',exact:true}).click();record('forced Electron exit → next launch shows choice with safety barrier active',{cleanup:'recorded-pid-only',killedRootPid:forcedIdentity&&forcedIdentity.rootPid,killedMainPid:forcedIdentity&&forcedIdentity.mainPid,parentPid:forcedIdentity&&forcedIdentity.parentPid});
 assert.deepEqual(errors,[]);record('no renderer page errors');results.ok=true;
})().catch(error=>{results.ok=false;results.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{await close().catch(()=>{});results.finishedAt=new Date().toISOString();await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,packed?'packed-results.json':'electron-results.json'),JSON.stringify(results,null,2));if(dir)await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});});



