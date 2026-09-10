import {chromium} from '@playwright/test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=process.env.URL??'http://127.0.0.1:5176/';
const dir=`../evidence/${process.env.PREFIX??'toon-hair-video'}`;fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--enable-gpu','--use-angle=metal']});
const report={url,source:'Application motion demo and manual head-turn controls, no camera',chapters:[],samples:[],errors:[]};
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
 p.on('pageerror',e=>report.errors.push(e.message));p.on('console',m=>{if(m.type()==='error')report.errors.push(m.text())});
 await p.goto(url);await p.waitForFunction(()=>window.__studio?.avatar.vrm,null,{timeout:60000});
 await p.evaluate(()=>{const s=window.__studio;s.layers.avatar={x:870,y:0,width:900,height:1080};s.layers.text={x:80,y:180,width:760,height:720};s.avatar.hair.strength=.65;document.querySelector('#message').value='トゥーンと髪の揺れ\n\n前髪・横の束・後ろ髪\n頭の動きに遅れて揺れます\n\nカメラ不使用の動作デモ';});
 await p.locator('#record').click();
 const start=Date.now();
 for(const [name,position,text,bg] of [
  ['front',[0,1.37,1.35],'前髪と横の束\n\n頭の動きに追従\n髪の光沢と輪郭も変形\n\nカメラ不使用の動作デモ','#f5f3f6'],
  ['back',[.4,1.35,-1.45],'後ろ髪と長い束\n\n根元を固定して毛先を揺らす\n\nカメラ不使用の動作デモ','#181624'],
  ['quick-turn',[0,1.38,1.3],'速い首振り\n\n揺れる範囲を制限\n最後は止まって収まります\n\nカメラ不使用の動作デモ','#f5f3f6']]){
   report.chapters.push({name,start:(Date.now()-start)/1000});
   await p.evaluate(({name,position,text,bg})=>{const a=window.__studio.avatar;a.camera.position.set(...position);a.camera.lookAt(0,1.35,0);a.setDemo(name!=='quick-turn');document.querySelector('#message').value=text;document.querySelector('#background').value=bg;document.querySelector('#textColor').value=bg==='#181624'?'#f6ecf5':'#422f45';Object.assign(a.debug,{arm:0,turn:0,blinkLeft:0,blinkRight:0,jawOpen:0});},{name,position,text,bg});
   for(let i=0;i<80;i++){
    await p.waitForTimeout(100);
    report.samples.push(await p.evaluate(({i,name})=>{const a=window.__studio.avatar;if(name==='quick-turn')a.debug.turn=i<45?.60*Math.sin(i*.42):0;return {chapter:name,frame:i,fps:window.__studio.metrics.fps,head:a.bone('head').quaternion.toArray(),hair:a.hair.chains.map(c=>c.bones[0].quaternion.toArray())};},{i,name}));
    if(i===20||i===55)await p.locator('#output').screenshot({path:`${dir}/${name}-${i}.png`});
   }
   console.log(`Recorded ${name}`);
 }
 const ready=p.waitForEvent('download');await p.locator('#record').click();const download=await ready;
 assert.ok(download.suggestedFilename().endsWith('.mp4'));await download.saveAs(`${dir}/toon-hair-motion.mp4`);
 assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.errors.push(String(e));process.exitCode=1;}finally{await browser.close();fs.writeFileSync(`${dir}/check.json`,JSON.stringify(report,null,2));console.log({status:report.status,errors:report.errors});}
