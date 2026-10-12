const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {AutoBackupService}=require('../desktop/auto-backup-service.cjs');
const {WallpaperRotationService}=require('../desktop/wallpaper-rotation-service.cjs');
const {StudioService}=require('../desktop/studio-service.cjs');
const {stores,doc,png}=require('./fixtures/round6-stores.cjs');
async function temporary(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'anti-face-v062-'));try{await run(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}

test('auto backup: failed verification never commits success or prunes old files',()=>temporary(async dir=>{
 const dest=path.join(dir,'backups');await fs.mkdir(dest);const old=path.join(dest,'keep.antiface-backup');await fs.writeFile(old,'existing');
 const service=new AutoBackupService({userData:path.join(dir,'data'),backup:{exportBackup:async file=>{await fs.writeFile(file,'bad');return{ok:true};},inspectBackup:async()=>{throw new Error('decode failed');}}},{config:{enabled:true,directoryRef:dest,retainCount:1}});
 await assert.rejects(service.runAutoBackup('force'),/校验/);
 assert.equal(service.lastBackupTime,0);assert.equal(service.managedBackups.length,0);assert.deepEqual(await fs.readdir(dest),['keep.antiface-backup']);
}));

test('auto backup: an empty index does not claim matching user files',()=>temporary(async dir=>{
 const dest=path.join(dir,'backups');await fs.mkdir(dest);
 const names=['anti-face-auto_2026-01-01T00-00-00_a1.antiface-backup','anti-face-auto_2026-01-02T00-00-00_a2.antiface-backup'];
 for(const name of names)await fs.writeFile(path.join(dest,name),'user file');
 const service=new AutoBackupService({userData:dir},{config:{directoryRef:dest,retainCount:1}});
 assert.deepEqual(await service.pruneOldBackups(dest),[]);assert.deepEqual((await fs.readdir(dest)).sort(),names);assert.equal(service.managedBackups.length,0);
}));

for(const cause of ['stop','generation','document','throw'])test(`rotation: ${cause} does not leave stale writes or asset leases`,()=>temporary(async dir=>{
 const s=await stores(dir);const folder=path.join(dir,'wallpapers');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'one.png'),png());
 const target={activeDocument:doc(),operationGeneration:1,instanceId:'A',manualHold:false};
 let release,enter,writes=0;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{enter=r;});
 const studio={assets:s.assets,userData:path.join(dir,'other'),safeMode:false,migrationActive:false,
  round5:{getTargetState:()=>target,decorateApply:async()=>{enter();await gate;return{};}},
  theme:{applyDocument:async()=>{writes++;if(cause==='throw')throw new Error('host failed');return{state:'applied',verification:{status:'verified'}};}}};
 const rotation=new WallpaperRotationService(studio,{config:{enabled:true,folderRef:folder}});await rotation.scanFolder();
 const pending=rotation.rotate('A');await started;
 if(cause==='stop')rotation.stop();if(cause==='generation')target.operationGeneration++;if(cause==='document')target.activeDocument=doc();release();
 if(cause==='throw')await assert.rejects(pending,/host failed/);else assert.equal((await pending).ok,false);
 assert.equal(writes,cause==='throw'?1:0);assert.equal(rotation.getOverride('A'),null);
 for(const record of s.assets.records.values())assert.equal(record.refs.includes('rotation:A'),false);
 rotation.stop();
}));

test('rotation: a native window never inherits the editor document',()=>temporary(async dir=>{
 const target={activeDocument:null,manualHold:false};const service=new WallpaperRotationService({document:doc(),round5:{getTargetState:()=>target}},{config:{enabled:true}});
 assert.equal((await service.rotate('A')).code,'NO_DOCUMENT');
}));

test('rotation: a failed repeat of the same image retains the confirmed asset lease',()=>temporary(async dir=>{
 const s=await stores(dir),folder=path.join(dir,'wallpapers');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'one.png'),png());
 const target={activeDocument:doc(),operationGeneration:1,instanceId:'A',manualHold:false};let fail=false;
 const studio={assets:s.assets,userData:path.join(dir,'other'),round5:{getTargetState:()=>target,decorateApply:async()=>({})},theme:{applyDocument:async()=>{if(fail)throw new Error('temporary failure');return{state:'applied',verification:{status:'verified'}};}}};
 const service=new WallpaperRotationService(studio,{config:{enabled:true,folderRef:folder}});await service.scanFolder();const first=await service.rotate('A');fail=true;
 await assert.rejects(service.rotate('A'),/temporary failure/);assert.equal(service.getOverride('A').assetId,first.assetId);
 const record=s.assets.get(first.assetId);assert.ok(record.refs.includes('rotation:A'));assert.equal(record.refs.some(r=>r.startsWith('rotation-pending:')),false);service.stop();
}));

for(const change of ['draft','generation','target','disconnect'])test(`summary: ${change} invalidates confirmation without applying`,async()=>{
 const target={instanceId:'instance-A',operationGeneration:1,activeDocument:doc()};let live=target,writes=0;
 const studio=Object.create(StudioService.prototype);Object.assign(studio,{selectedTargetId:'A',applyPreviewCache:new Map(),theme:{targets:new Map()},round5:{getTargetState:()=>live,contextFor:()=>({})},applyEditorDocument:async()=>{writes++;return{state:'applied'};}});
 const draft=doc(),summary=await studio.previewApply(draft,'A');const options={currentDocument:draft,targetId:'A'};
 if(change==='draft')options.currentDocument={...draft,name:'changed'};if(change==='generation')target.operationGeneration++;if(change==='target')options.targetId='B';if(change==='disconnect')live=null;
 const result=await studio.confirmApply(summary.previewId,options);assert.equal(result.ok,false);assert.equal(writes,0);assert.equal(studio.applyPreviewCache.size,0);
});
