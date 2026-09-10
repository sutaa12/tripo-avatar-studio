import {chromium} from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=process.env.URL??'http://127.0.0.1:5176/';
const dir=`../evidence/${process.env.PREFIX??'blush-before'}`;fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
const report={url,model:process.env.MODEL??'adopted model',errors,status:'FAIL'};
page.on('pageerror',e=>errors.push(e.message));
if(process.env.MODEL)await page.route('**/models/avatar.gltf',r=>r.fulfill({path:process.env.MODEL,contentType:'model/gltf-binary'}));
try {
 await page.goto(url);await page.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
 await page.evaluate(()=>{const a=window.__studio.avatar;a.setDemo(false);a.hair.strength=0;a.toon.profile.outlinePixels=1.6;a.camera.position.set(0,1.38,1.12);a.camera.lookAt(0,1.38,0);a.camera.updateProjectionMatrix();Object.assign(a.debug,{arm:0,turn:0,blinkLeft:0,blinkRight:0,jawOpen:0});});
 if(process.env.DIAGNOSTIC)await page.evaluate(async()=>{const T=await import('/node_modules/three/build/three.module.js');window.__faceDiagnostic={T,originals:[]};window.__studio.avatar.vrm.scene.traverse(o=>{if(o.isMesh&&(o.name.startsWith('Head_')&&!o.name.includes('Choker')||o.parent.name==='Head_Face_Loops'))window.__faceDiagnostic.originals.push([o,o.material]);});});
 const modes=process.env.DIAGNOSTIC?['toon','albedo','clay','normal']:['toon'];report.modes=modes;
 for(const mode of modes) {
  if(process.env.DIAGNOSTIC)await page.evaluate(mode=>{const {T,originals}=window.__faceDiagnostic;for(const [o,original] of originals){const convert=m=>m.name==='Eyelash'?m:mode==='toon'?m:mode==='normal'?new T.MeshNormalMaterial({side:T.DoubleSide}):new T.MeshBasicMaterial({map:mode==='albedo'?m.map:null,color:mode==='albedo'?m.color:0xf3c7b5,side:T.DoubleSide});o.material=Array.isArray(original)?original.map(convert):convert(original);}},mode);
  for(const [name,turn,blink,jaw] of [['front',0,0,0],['left',.65,0,0],['right',-.65,0,0],['closed',0,1,0],['half',0,.5,0],['mouth',0,0,1]]) {
   await page.evaluate(({turn,blink,jaw})=>Object.assign(window.__studio.avatar.debug,{turn,blinkLeft:blink,blinkRight:blink,jawOpen:jaw}),{turn,blink,jaw});await page.waitForTimeout(400);
   const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=900;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle='#f5f3f6';ctx.fillRect(0,0,900,1080);ctx.drawImage(window.__studio.avatar.renderer.domElement,0,0);return c.toDataURL()});
   fs.writeFileSync(`${dir}/${mode}-${name}.png`,Buffer.from(data.split(',')[1],'base64'));
   if(mode==='toon'&&name==='front')report.color=await page.evaluate(async data=>{
    const im=new Image();im.src=data;await im.decode();const c=document.createElement('canvas');c.width=900;c.height=1080;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,900,1080).data;
    const channel=(x,y,ch)=>pixels[(y*900+x)*4+ch];
    const cheeks=[[315,365],[535,585]].map(([lo,hi])=>{
     const rows=[];for(let y=646;y<716;y++){let sum=0;for(let x=lo;x<hi;x++)sum+=channel(x,y,0)-channel(x,y,1);rows.push(sum/(hi-lo));}
     return {redMinimum:Math.min(...rows),redMaximum:Math.max(...rows),maxRowStep:Math.max(...rows.slice(1).map((v,i)=>Math.abs(v-rows[i])))};
    });
    const mean=(lo,y)=>{let sum=0;for(let x=lo;x<lo+12;x++)for(let ch=0;ch<3;ch++)sum+=channel(x,y,ch);return sum/36;};
    const contrast=[];for(let y=630;y<658;y++)contrast.push(Math.abs(mean(444,y)-(mean(428,y)+mean(460,y))/2));
    return {cheeks,centerContrast:Math.max(...contrast)};
   },data);
  }
 }
 if(!process.env.DIAGNOSTIC){
  report.roles=await page.evaluate(()=>{const out=[];window.__studio.avatar.vrm.scene.traverse(o=>{if(o.isMesh&&o.parent.name==='Head_Face_Loops')out.push(...(Array.isArray(o.material)?o.material:[o.material]).filter(m=>!m.isOutline).map(m=>({mesh:o.name,material:m.name,role:m.userData.role})));});return out;});
  assert.equal(report.roles.length,3);assert(report.roles.every(m=>m.role===1),'All facial primitives receive the same skin lighting');
  for(const cheek of report.color.cheeks){assert(cheek.maxRowStep<.8,'Blush fades without a sharp row boundary');assert(cheek.redMaximum-cheek.redMinimum>5,'Soft blush remains visible');}
  assert(report.color.centerContrast<1,'No central painted or lighting stripe');
 }
 assert.deepEqual(errors,[]);report.status='PASS';
} catch(error){report.failure=String(error);throw error;} finally {await browser.close();fs.writeFileSync(`${dir}/check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(errors.length)throw Error(errors.join('\n'));
