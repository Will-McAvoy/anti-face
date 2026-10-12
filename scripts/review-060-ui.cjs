const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
(async()=>{const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'anti-face-review-060-ui-'));let app;try{
 const env={...process.env,ANTI_FACE_TEST_USER_DATA:dir};delete env.ELECTRON_RUN_AS_NODE;delete env.ANTI_FACE_DEV_URL;
 app=await electron.launch({args:[root],cwd:root,env,timeout:30000});const page=await app.firstWindow();
 await page.getByText('设置已保存到本机',{exact:true}).waitFor({timeout:30000});
 const result=await page.evaluate(async()=>{const s=await window.antiFace.studioState();try{return{previewOk:true,summary:await window.antiFace.previewApply(s.document,null)};}catch(e){return{previewOk:false,message:e.message};}});
 await fs.writeFile(path.join(root,'artifacts/review-060-ui.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{if(app)await app.close();await fs.rm(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
