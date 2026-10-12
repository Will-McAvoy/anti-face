// Synthetic host boundary, real PerformanceService. No user window is changed.
const fs=require('node:fs/promises'),path=require('node:path');
const {PerformanceService}=require('../desktop/performance-service.cjs');
const {documentFromLegacy}=require('../core/theme-schema.cjs');
(async()=>{
 const document=documentFromLegacy({schemaVersion:1,themeId:'graphite',appearance:{opacity:80,blur:28,radius:8,wallpaper:null}});
 const state={activeDocument:document,instanceId:'review-instance',disposed:false};
 let attempts=0,appliedTier='normal',fail=true;
 const studio={safeMode:false,migrationActive:false,preview:{state:()=>({phase:'idle'})},_assetUrl:async()=>null,
  round5:{targetStates:new Map([['A',state]]),captureIntent:()=>({instanceId:state.instanceId}),intentCurrent:()=>true,decorateApply:async()=>({})},
  theme:{applyDocument:async()=>{attempts++;if(fail)throw new Error('synthetic temporary host failure');appliedTier='powersave';return{state:'applied'};}}};
 const service=new PerformanceService(studio,{powerMonitor:{isOnBatteryPower:()=>true},prefs:{mode:'auto',batteryAware:true,maxTier:'powersave'}});
 let firstError;try{await service.refresh();}catch(e){firstError=e.message;}
 fail=false;await service.refresh();await service.refresh();
 const result={firstError,applyAttempts:attempts,reportedTier:service.summary('A').tier,actualHostTier:appliedTier,recoveredAfterTwoRefreshes:appliedTier==='powersave'};
 await fs.writeFile(path.join(__dirname,'../artifacts/review-051-performance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
