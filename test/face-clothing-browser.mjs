import { chromium } from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=`../evidence/${process.env.PREFIX??'face-clothing-local'}`;fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-angle=metal']});
const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('INFO: Created TensorFlow Lite XNNPACK delegate for CPU.'))errors.push(m.text())});
if(process.env.MODEL)await p.route('**/models/avatar.gltf',r=>r.fulfill({path:process.env.MODEL,contentType:'model/gltf-binary'}));
const report={url:process.env.URL??'http://127.0.0.1:5176/',errors,status:'FAIL'};
try {
 await p.goto(report.url);await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
 await p.evaluate(()=>{const a=window.__studio.avatar;a.hair.strength=0;a.camera.position.set(0,1.35,1.45);a.camera.lookAt(0,1.3,0);a.camera.updateProjectionMatrix()});await p.waitForTimeout(500);
 report.clothing=await p.evaluate(()=>{
  const a=window.__studio.avatar,c=document.createElement('canvas');c.width=900;c.height=1080;const ctx=c.getContext('2d');
  function capture(value){a.toon.profile.clothingShadow=value;a.update(0);ctx.clearRect(0,0,900,1080);ctx.drawImage(a.renderer.domElement,0,0);return {data:ctx.getImageData(0,0,900,1080).data,image:c.toDataURL()}}
  const before=capture(0),after=capture(1);let changed=0,faceChanged=0,skinChanged=0,skinCount=0,clothCount=0,clothBefore=0,clothAfter=0;
  for(let i=0;i<before.data.length;i+=4){const x=i/4%900,y=Math.floor(i/4/900);if(before.data[i+3]<250)continue;
   const delta=Math.max(...[0,1,2].map(k=>Math.abs(before.data[i+k]-after.data[i+k])));
   if(delta>2){changed++;if(y<620)faceChanged++;}
   const [r,g,b]=before.data.slice(i,i+3);
   if(y>680&&r>180&&g-b>18){skinCount++;if(delta>3)skinChanged++;}
   if(y>680&&b-g>12&&r>130&&delta>2){clothCount++;clothBefore+=(r+g+b)/3;clothAfter+=(after.data[i]+after.data[i+1]+after.data[i+2])/3;}
  }
  return {changed,faceChanged,skinChanged,skinCount,clothCount,clothBefore:clothBefore/clothCount,clothAfter:clothAfter/clothCount,before:before.image,after:after.image};
 });
 for(const name of ['before','after']){fs.writeFileSync(`${dir}/clothing-${name}.png`,Buffer.from(report.clothing[name].split(',')[1],'base64'));delete report.clothing[name];}
 report.closedCoverage=[];
 for(const turn of [0,.65,-.65]){
  await p.evaluate(turn=>{const a=window.__studio.avatar;Object.assign(a.debug,{blinkLeft:1,blinkRight:1,turn});a.camera.position.set(0,1.4,1.0);a.camera.lookAt(0,1.4,0);a.camera.updateProjectionMatrix()},turn);await p.waitForTimeout(550);
  const result=await p.evaluate(()=>{
   const a=window.__studio.avatar,c=document.createElement('canvas');c.width=900;c.height=1080;const ctx=c.getContext('2d'),eyes=[];a.vrm.scene.traverse(o=>{if(o.isMesh&&/^Eye_(Left|Right)/.test(o.name))eyes.push(o)});
   const capture=()=>{a.update(0);ctx.clearRect(0,0,900,1080);ctx.drawImage(a.renderer.domElement,0,0);return ctx.getImageData(0,0,900,1080).data};
   const before=capture(),image=c.toDataURL();for(const eye of eyes)eye.visible=false;const after=capture();for(const eye of eyes)eye.visible=true;
   let pixels=0,max=0;for(let i=0;i<before.length;i+=4){const delta=Math.max(...[0,1,2].map(k=>Math.abs(before[i+k]-after[i+k])));if(delta>3)pixels++;max=Math.max(max,delta)}
   return {pixels,max,eyes:eyes.length,blink:{...a.faceValues},image};
  });fs.writeFileSync(`${dir}/closed-${turn}.png`,Buffer.from(result.image.split(',')[1],'base64'));delete result.image;report.closedCoverage.push({turn,...result});
 }
 await p.evaluate(()=>Object.assign(window.__studio.avatar.debug,{blinkLeft:0,blinkRight:0,turn:0}));
 // Exercise the real controls and Avatar.receive path with reproducible packets.
 await p.locator('#mouthSettings').evaluate(el=>el.open=true);
 await p.evaluate(()=>{window.__mouthFixture=.07;window.__mouthTimer=setInterval(()=>{
  const categories=Object.entries({jawOpen:window.__mouthFixture,mouthClose:0,eyeBlinkLeft:0,eyeBlinkRight:0}).map(([categoryName,score])=>({categoryName,score}));
  window.__studio.avatar.receive({face:{faceLandmarks:[[]],faceBlendshapes:[{categories}]},pose:{},hands:{}});
 },65)});await p.waitForTimeout(200);
 await p.locator('#mouthClosed').click();await p.waitForFunction(()=>!document.querySelector('#mouthClosed').disabled,null,{timeout:7000});
 report.closedCapture=await p.locator('#mouthStatus').textContent();
 await p.evaluate(()=>{window.__mouthFixture=.45});await p.locator('#mouthOpen').click();
 await p.waitForFunction(()=>!document.querySelector('#mouthOpen').disabled,null,{timeout:8000});
 report.openCapture=await p.locator('#mouthStatus').textContent();
 report.calibrated=await p.evaluate(()=>({...window.__studio.avatar.mouth.profile}));
 await p.waitForTimeout(350);report.openValue=await p.evaluate(()=>window.__studio.avatar.faceValues.jawOpen);
 await p.evaluate(()=>{window.__mouthFixture=.07});await p.waitForTimeout(500);report.closedValue=await p.evaluate(()=>window.__studio.avatar.faceValues.jawOpen);
 await p.locator('#mouthStrength').fill('72');await p.locator('#clothingShadow').fill('0.83');
 await p.evaluate(()=>clearInterval(window.__mouthTimer));await p.reload();await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
 report.restored=await p.evaluate(()=>({mouth:{...window.__studio.avatar.mouth.profile},clothing:window.__studio.avatar.toon.profile.clothingShadow}));
 await p.locator('#mouthSettings').evaluate(el=>el.open=true);await p.locator('#mouthOpen').click();report.noFace=await p.locator('#mouthStatus').textContent();
 await p.locator('#mouthReset').click();report.reset=await p.evaluate(()=>({...window.__studio.avatar.mouth.profile}));
 // A real face recording confirms that calibration drives the existing model.
 await p.locator('#trackingFile').setInputFiles('../evidence/fixtures/tfjs-face-crop.mp4');
 await p.waitForFunction(()=>window.__studio.input.ready,null,{timeout:60000});
 report.recording=await p.evaluate(async()=>{const a=window.__studio.avatar,v=window.__studio.input.trackingVideo;v.loop=true;v.currentTime=0;await v.play();const rows=[],start=performance.now();
  while(performance.now()-start<6500){await new Promise(r=>setTimeout(r,100));rows.push({raw:a.mouth.latest,mapped:a.mouth.latest===null?0:a.mouth.map({jawOpen:a.mouth.latest}).jawOpen,shown:a.faceValues.jawOpen,narrow:a.faceValues.mouthNarrow});}
  return {stats:{...window.__studio.input.stats},rows};
 });
 report.quietRecording=report.recording;
 await p.locator('#trackingFile').setInputFiles('../evidence/fixtures/openface-default.mp4');
 await p.waitForFunction(()=>window.__studio.input.ready,null,{timeout:60000});
 report.recording=await p.evaluate(async()=>{const a=window.__studio.avatar,v=window.__studio.input.trackingVideo;v.loop=false;v.currentTime=0;await v.play();const rows=[],start=performance.now();
  while(performance.now()-start<19200){await new Promise(r=>setTimeout(r,100));rows.push({time:v.currentTime,raw:a.mouth.latest,shown:a.faceValues.jawOpen,narrow:a.faceValues.mouthNarrow});}
  return {fixture:'OpenFace samples/default.wmv, converted to MP4',stats:{...window.__studio.input.stats},rows};
 });
 await p.locator('#stopCamera').click();await p.waitForTimeout(900);report.lost=await p.evaluate(()=>window.__studio.avatar.faceValues.jawOpen);
 await p.setViewportSize({width:390,height:844});report.mobile=await p.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));await p.screenshot({path:`${dir}/mobile.png`,fullPage:true});
 await p.addInitScript(()=>{localStorage.setItem('avatar-mouth-v1',JSON.stringify({closed:1,open:0,strength:'broken'}))});
 await p.reload();await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
 report.invalidSave=await p.evaluate(()=>({...window.__studio.avatar.mouth.profile}));
 await p.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Test quota failure','QuotaExceededError')}});
 await p.locator('#mouthSettings').evaluate(el=>el.open=true);await p.locator('#mouthStrength').fill('64');
 report.blockedSave=await p.locator('#mouthStatus').textContent();
 assert(report.clothing.changed>1000);assert.equal(report.clothing.faceChanged,0);assert(report.clothing.skinCount>100);assert(report.clothing.skinChanged/report.clothing.skinCount<.02);
 assert(report.clothing.clothAfter<report.clothing.clothBefore*.95);
 for(const c of report.closedCoverage){assert.equal(c.eyes,2);assert(c.pixels<8,`Closed eyes exposed at turn ${c.turn}: ${c.pixels} pixels`);}
 assert(report.closedCapture.includes('記録しました'));assert(report.openCapture.includes('合わせました'));
 assert.equal(report.openValue,1);assert.equal(report.closedValue,0);assert.equal(report.lost,0);
 assert.deepEqual(report.restored,{mouth:{...report.calibrated,strength:72},clothing:.83});assert(report.noFace.includes('顔が映った状態'));
 assert.deepEqual(report.reset,{closed:.035,open:.65,strength:50});
 assert.deepEqual(report.invalidSave,report.reset);assert(report.blockedSave.includes('保存できません'));
 assert(Math.max(...report.quietRecording.rows.map(r=>r.shown))<.03,'A quiet-mouth recording should stay closed');
 assert(report.recording.stats.faceFrames>=8);assert(Math.max(...report.recording.rows.map(r=>r.shown))-Math.min(...report.recording.rows.map(r=>r.shown))>.15,'Actual recorded mouth motion must drive the model');
 assert.equal(report.mobile.width,report.mobile.scroll);assert.deepEqual(errors,[]);report.status='PASS';
}catch(e){report.failure=String(e);throw e;}finally{await browser.close();fs.writeFileSync(`${dir}/check.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,quietRecording:report.quietRecording?{stats:report.quietRecording.stats}:undefined,recording:report.recording?{stats:report.recording.stats,samples:report.recording.rows.length}:undefined},null,2));}
