// Independent observations with synthetic documents/assets and temporary directories.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {StudioService}=require('../desktop/studio-service.cjs');
const {WallpaperRotationService}=require('../desktop/wallpaper-rotation-service.cjs');
const {AutoBackupService}=require('../desktop/auto-backup-service.cjs');
const {Round5Service}=require('../desktop/round5-service.cjs');
const {stores,seed,doc,png}=require('../tests/fixtures/round6-stores.cjs');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'anti-face-review-060-')),out={};
 try{
  const summaryStudio=Object.create(StudioService.prototype);
  Object.assign(summaryStudio,{selectedTargetId:'A',round5:{getTargetState:()=>({instanceId:'instance-A'}),contextFor:()=>({})},theme:{targets:new Map()},applyPreviewCache:new Map()});
  try{out.summary={ok:true,value:await summaryStudio.previewApply(doc(),'A')};}catch(e){out.summary={ok:false,message:e.message};}
  const dataDir=path.join(root,'data'),s=await stores(dataDir);const seeded=await seed(s,dataDir);
  const resolverStudio={userData:dataDir,assets:s.assets,preview:{state:()=>({phase:'idle'})},theme:{targets:new Map()},_assetUrl:async d=>d.wallpaper.assetId?await s.assets.dataUrl(d.wallpaper.assetId):null};
  const round5=new Round5Service(resolverStudio);
  const prepared=await round5.decorateApply(doc(),'A',{context:{wallpaperOverride:{assetId:seeded.assetId}}});
  out.rotationPipeline={requestedAssetId:seeded.assetId,resolvedAssetId:prepared.resolved.wallpaper.assetId,assetUrlPresent:!!prepared.assetUrl};
  const folder=path.join(root,'wallpapers');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'one.png'),png());
  let release,entered;const blocked=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
  const target={activeDocument:doc(),manualHold:false,instanceId:'A'};let writesAfterRestore=0;
  const rotationStudio={userData:dataDir,assets:s.assets,safeMode:false,migrationActive:false,selectedTargetId:'A',document:doc(),
   round5:{getTargetState:()=>target,decorateApply:async()=>{entered();await blocked;return{};}},
   theme:{applyDocument:async()=>{if(target.manualHold)writesAfterRestore++;return{state:'failed',verification:{status:'failed'}};}}};
  const rotation=new WallpaperRotationService(rotationStudio,{config:{enabled:true,folderRef:folder,intervalSeconds:60,order:'sequential'}});
  await rotation.scanFolder();const pending=rotation.rotate('A');await started;target.manualHold=true;target.activeDocument=null;release();const returned=await pending;
  out.rotation={writesAfterRestore,returnedOk:returned.ok,currentAssetClaimed:!!rotation.getOverride('A')};rotation.stop();
  const backups=path.join(root,'backups');await fs.mkdir(backups);
  const unowned='anti-face-auto_2099-01-01T00-00-00_deadbeef.antiface-backup';await fs.writeFile(path.join(backups,unowned),'corrupt file, not produced by this service');
  const auto=new AutoBackupService({userData:dataDir,backup:s.backup,safeMode:false,migrationActive:false},{config:{enabled:true,directoryRef:backups,retainCount:1,retainDays:365}});
  const backup=await auto.runAutoBackup('force');
  out.retention={returnedOk:backup.ok,newBackupStillExists:!!await fs.stat(backup.filePath).catch(()=>null),corruptUnownedFileKept:!!await fs.stat(path.join(backups,unowned)).catch(()=>null),remaining:await fs.readdir(backups)};
  auto.stop();
 }finally{await fs.rm(root,{recursive:true,force:true});}
 await fs.writeFile(path.join(__dirname,'../artifacts/review-060-results.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
