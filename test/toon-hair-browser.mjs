import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=`../evidence/${process.env.PREFIX??'toon-hair-spike'}`;fs.mkdirSync(dir,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-angle=metal']});
const p=await b.newPage({viewport:{width:1440,height:1000}}), errors=[];
if(process.env.MODEL) await p.route('**/models/avatar.gltf',r=>r.fulfill({path:process.env.MODEL,contentType:'model/gltf-binary'}));
if(process.env.FALLBACK==='1') await p.addInitScript(()=>{
 const original=WebGL2RenderingContext.prototype.getExtension;
 WebGL2RenderingContext.prototype.getExtension=function(name){return name==='EXT_color_buffer_float'?null:original.call(this,name)};
});
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await p.goto(process.env.URL??'http://127.0.0.1:5176/');await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
const initial=await p.evaluate(()=>{const a=window.__studio.avatar;return {hair:a.hair?.stats,chains:a.hair?.chains.map(c=>c.name),programs:a.renderer.info.programs.length,draw:a.toon.outline?.stats}});
async function shot(name,view='front',outline=1.6,blink=0){
 await p.evaluate(({view,outline,blink})=>{const a=window.__studio.avatar;if(a.hair)a.hair.strength=0;a.setDemo(false);Object.assign(a.debug,{turn:0,arm:0,blinkLeft:blink,blinkRight:blink});a.toon.profile.outlinePixels=outline;
 const y=view==='chest'?1.1:1.38; const z=view==='chest'?.95:1.12;
 a.camera.position.set(view==='side'?.95:0,y,view==='back'?-z:view==='side'?.65:z);a.camera.lookAt(0,y,0);a.camera.updateProjectionMatrix();},{view,outline,blink});
 await p.waitForTimeout(450);
 const image=await p.evaluate(()=>window.__studio.avatar.renderer.domElement.toDataURL());
 fs.writeFileSync(`${dir}/${name}.png`,Buffer.from(image.split(',')[1],'base64'));
 for(const [suffix,background] of [['light','#f5f3f6'],['dark','#181624']]) {
   const image=await p.evaluate(background=>{const a=window.__studio.avatar,c=document.createElement('canvas');c.width=900;c.height=1080;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,900,1080);ctx.drawImage(a.renderer.domElement,0,0);return c.toDataURL()},background);
   fs.writeFileSync(`${dir}/${name}-${suffix}.png`,Buffer.from(image.split(',')[1],'base64'));
 }
}
for(const [name,view,line,blink] of [['front','front',1.6,0],['front-no-outline','front',0,0],['closed','front',1.6,1],['half','front',1.6,.5],['chest','chest',1.6,0],['chest-no-outline','chest',0,0],['side','side',1.6,0],['back','back',1.6,0]])await shot(name,view,line,blink);
await p.evaluate(()=>{window.__studio.avatar.debug.jawOpen=.8});await shot('mouth','front',1.6,.5);await p.evaluate(()=>{window.__studio.avatar.debug.jawOpen=0});
if(process.env.BASELINE==='1') {fs.writeFileSync(`${dir}/check.json`,JSON.stringify({initial,errors,status:errors.length?'FAIL':'PASS'},null,2));await b.close();process.exit(errors.length?1:0);}
const motion=await p.evaluate(async()=>{
 const a=window.__studio.avatar; a.hair.strength=.65;a.toon.profile.outlinePixels=1.6;
 a.camera.position.set(0,1.3,1.55);a.camera.lookAt(0,1.3,0);a.camera.updateProjectionMatrix();
 const series=[];a.setDemo(true);const start=performance.now();
 while(performance.now()-start<5500){await new Promise(r=>setTimeout(r,100));series.push({t:performance.now()-start,angles:a.hair.chains.map(c=>c.bones[0].quaternion.angleTo(c.bones[0].quaternion.clone().identity()))});}
 a.setDemo(false);Object.assign(a.debug,{turn:0,arm:0});
 await new Promise(r=>setTimeout(r,4000));
 return {series,settled:a.hair.chains.map(c=>({name:c.name,angle:c.bones[0].quaternion.angleTo(c.bones[0].quaternion.clone().identity())})),fps:window.__studio.metrics.fps,renderP95:window.__studio.metrics.renderMs.slice().sort((a,b)=>a-b)[Math.floor(window.__studio.metrics.renderMs.length*.95)]};
});
const stress=await p.evaluate(async()=>{
 const a=window.__studio.avatar, head=a.vrm.humanoid.getRawBoneNode('head'), mesh=a.vrm.scene.getObjectByName('Hair_Spike');
 const pos=mesh.geometry.getAttribute('position'), indices=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
 const selected=a.hair.chains.map(c=>{let best=-1,id=0;for(let i=0;i<pos.count;i++){let w=0;for(let j=0;j<4;j++)if(c.indices.includes(indices.getComponent(i,j)))w+=weights.getComponent(i,j);if(w>best){best=w;id=i;}}return id});
 const headIndex=mesh.skeleton.bones.indexOf(head), rigidMatrix=head.matrixWorld.clone();
 const sample=()=>{
   rigidMatrix.multiplyMatrices(head.matrixWorld,mesh.skeleton.boneInverses[headIndex]);
   return selected.map(i=>{const q=head.position.clone().fromBufferAttribute(pos,i);const rigid=q.clone().applyMatrix4(mesh.bindMatrix).applyMatrix4(rigidMatrix).applyMatrix4(mesh.bindMatrixInverse);return mesh.applyBoneTransform(i,q).distanceTo(rigid);});
 };
 const runs=[];
 for(const fps of [60,30]){
   const update=a.update.bind(a);let accumulated=0;
   a.update=dt=>{accumulated+=dt;if(accumulated>=1/fps){update(accumulated);accumulated=0;}};
   a.hair.strength=1.5;a.setDemo(false);const samples=[];const start=performance.now();
   while(performance.now()-start<3600){const t=(performance.now()-start)/1000;a.debug.turn=.65*Math.sin(t*5);await new Promise(r=>setTimeout(r,40));samples.push(sample());}
   a.debug.turn=0;await new Promise(r=>setTimeout(r,4000));
   runs.push({fps,peak:selected.map((_,i)=>Math.max(...samples.map(s=>s[i]))),settled:sample(),finite:samples.flat().every(Number.isFinite)});a.update=update;
 }
 a.hair.update(.5);
 const afterPause=a.hair.chains.map(c=>c.bones[0].quaternion.angleTo(c.bones[0].quaternion.clone().identity()));
 a.hair.strength=0; a.debug.turn=.65;await new Promise(r=>setTimeout(r,300));const off=sample();a.debug.turn=0;
 return {runs,afterPause,off};
});
const persistence={};
for(const [id,value] of [['hairSway','1.15'],['shadow','.77'],['rim','.31']])await p.locator('#'+id).evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}))},value);
await p.reload();await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
Object.assign(persistence,await p.evaluate(()=>({sway:window.__studio.avatar.hair.strength,shadow:window.__studio.avatar.toon.profile.shadowStrength,rim:window.__studio.avatar.toon.profile.rimStrength})));
await p.setViewportSize({width:390,height:844});await p.waitForTimeout(300);
const mobile=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
await p.screenshot({path:`${dir}/mobile.png`,fullPage:true});
const report={initial,motion,stress,persistence,mobile,errors,status:'FAIL'};
fs.writeFileSync(`${dir}/check.json`,JSON.stringify(report,null,2));
await b.close();
assert.ok(initial.hair.restError<1e-5);assert.ok(initial.hair.maxWeightError<1e-6);assert.ok(initial.hair.fixedVertices>5000);
for(const run of stress.runs){assert.ok(run.finite);assert.ok(run.peak[0]>.001,'Bangs must visibly move');assert.ok(run.peak[7]>.001,'Back must move');assert.ok(Math.max(...run.peak)<.14,'Hair excursion stays bounded');assert.ok(Math.max(...run.settled)<.001,'Settles after stopping');}
assert.ok(Math.max(...stress.off)<1e-5);assert.ok(Math.max(...stress.afterPause)<1e-5);
assert.deepEqual(persistence,{sway:1.15,shadow:.77,rim:.31});assert.equal(mobile.scroll,mobile.width);assert.deepEqual(errors,[]);
report.status='PASS';
fs.writeFileSync(`${dir}/check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({initial,motion:{max:initial.chains.map((name,i)=>({name,max:Math.max(...motion.series.map(s=>s.angles[i]))})),settled:motion.settled,fps:motion.fps,renderP95:motion.renderP95},errors},null,2));
await b.close();if(errors.length)process.exitCode=1;
