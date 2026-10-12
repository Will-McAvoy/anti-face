const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'anti-face-v062-ui-'));let app;
 try{
  const env={...process.env,ANTI_FACE_TEST_USER_DATA:dir};delete env.ELECTRON_RUN_AS_NODE;delete env.ANTI_FACE_DEV_URL;
  const packed=process.argv.includes('--packed');
  const unpacked=process.env.ANTI_FACE_UNPACKED_DIR || path.join(root,'release/win-unpacked');
  app=await electron.launch(packed?{executablePath:path.join(unpacked,'Anti Face.exe'),cwd:root,env,timeout:30000}:{args:[root],cwd:root,env,timeout:30000});
  const page=await app.firstWindow();await page.getByText('设置已保存到本机',{exact:true}).waitFor({timeout:30000});
  const result=await page.evaluate(async()=>{
   const state=await window.antiFace.studioState();
   const summary=await window.antiFace.previewApply(state.document,null);
   const changed={...state.document,name:'changed after summary'};
   const rejected=await window.antiFace.confirmApply(summary.previewId,{currentDocument:changed,targetId:null});
   const repeated=await window.antiFace.confirmApply(summary.previewId);
   return{rejected,repeated,version:await window.antiFace.version()};
  });
  assert.equal(result.rejected.code,'DOCUMENT_CHANGED');assert.equal(result.repeated.code,'EXPIRED_OR_NOT_FOUND');
  assert.equal(result.version,JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version);
  console.log(JSON.stringify({passed:true,packed,...result},null,2));
 }finally{if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
