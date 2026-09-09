import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const url = process.env.URL ?? 'http://127.0.0.1:5176/';
const output = path.resolve('../evidence', process.env.PREFIX ?? 'settings-crop-local');
fs.mkdirSync(output, {recursive: true});
const fixture = path.join(output, 'crop-pattern.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
  'color=c=0x8d52b2:s=640x360:r=30:d=4,drawbox=x=0:y=0:w=640:h=36:c=red:t=fill,drawbox=x=0:y=288:w=640:h=72:c=blue:t=fill,drawbox=x=0:y=0:w=128:h=360:c=yellow:t=fill,drawbox=x=576:y=0:w=64:h=360:c=lime:t=fill,drawbox=x=300:y=150:w=40:h=40:c=white:t=fill',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture]);
const browser = await chromium.launch({headless: true,
  ...(process.platform === 'darwin' ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}),
  args: ['--enable-gpu', '--use-angle=metal', '--mute-audio']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const report = {url, errors: [], failedAssets: [], checks: [], scope: 'Appearance restored into the actual avatar, source video cropping, popup video, decoded saved recording, legacy settings and narrow-screen controls. The local test pattern is synthetic; no physical share picker or private media.'};
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => {if(r.status() >= 400) report.failedAssets.push({url: r.url(), status: r.status()});});
async function ready() { await page.waitForFunction(() => window.__studio?.avatar.vrm, null, {timeout: 60000}); }
async function fill(selector, value) { await page.locator(selector).fill(String(value)); await page.locator(selector).dispatchEvent('input'); }
async function load() {
  await page.locator('#screenFile').setInputFiles(fixture);
  await page.waitForFunction(() => window.__studio.input.screenVideo.readyState >= 2);
  await page.waitForTimeout(200);
}
async function margins(values) {
  for (const [side, value] of Object.entries(values)) await fill(`#crop-${side}`, value);
  await page.waitForTimeout(150);
}
function inspectPixels(bytes, width = 960, height = 540, channels = 4) {
  const counts = {red: 0, blue: 0, yellow: 0, green: 0, purple: 0, white: 0};
  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y=0; y<height; y++) for(let x=0; x<width; x++) {
    const i=(y*width+x)*channels, r=bytes[i], g=bytes[i+1], b=bytes[i+2];
    if(r>180 && g<75 && b<75) counts.red++;
    if(b>180 && r<75 && g<75) counts.blue++;
    if(r>180 && g>180 && b<75) counts.yellow++;
    if(g>180 && r<75 && b<75) counts.green++;
    if(r>100 && r<175 && g>50 && g<120 && b>140 && b<215) counts.purple++;
    if(r>230 && g>230 && b>230) {
      counts.white++; minX=Math.min(minX,x); maxX=Math.max(maxX,x); minY=Math.min(minY,y); maxY=Math.max(maxY,y);
    }
  }
  return {counts, square: {width: maxX-minX+1, height: maxY-minY+1}};
}
async function pixels(popup) {
  const data = popup ? await popup.evaluate(() => {
    const c=document.createElement('canvas');c.width=1920;c.height=1080;
    const x=c.getContext('2d');x.drawImage(document.querySelector('video'),0,0);
    return Array.from(x.getImageData(100,100,960,540).data);
  }) : await page.evaluate(() => Array.from(window.__studio.canvas.getContext('2d').getImageData(100,100,960,540).data));
  return inspectPixels(data);
}
function cropped(result, name) {
  for(const color of ['red','blue','yellow','green']) assert(result.counts[color] < 100, `${name}: ${color} edge leaked`);
  assert(result.counts.purple > 500000, `${name}: center was not retained`);
  assert(Math.abs(result.square.width-result.square.height) <= 2, `${name}: crop stretched the image`);
  assert(result.square.width >= 82 && result.square.width <= 87, `${name}: crop scale is incorrect`);
}
async function appearance() {
  return page.evaluate(() => ({
    bust: document.querySelector('#bust').checked,
    seated: window.__studio.avatar.debug.seated,
    camera: window.__studio.avatar.camera.position.toArray(),
    outline: window.__studio.avatar.toon.profile.outlinePixels,
    shine: window.__studio.avatar.toon.profile.hairHighlight,
    selected: document.querySelector('#layer').value,
    layout: structuredClone(window.__studio.layers),
    saved: JSON.parse(localStorage.getItem('avatar-layout-v1')),
  }));
}
try {
  await page.goto(url); await ready();
  await page.locator('#bust').check();
  await fill('#outline', 2.4); await fill('#shine', .28);
  await page.locator('details').filter({has: page.locator('#demo')}).locator('summary').click();
  await page.locator('#seated').uncheck();
  await page.locator('#layer').selectOption('screen');
  for (const [key, value] of Object.entries({x:100,y:100,width:960,height:540})) await fill(`[data-field=${key}]`, value);
  await fill('#background', '#203040'); await fill('#message', 'Crop and saved view');
  await page.locator('#screenCrop > summary').click();
  await load();
  const before = await appearance();
  const original = await pixels();
  for(const color of ['red','blue','yellow','green']) assert(original.counts[color] > 10000, `Fixture missing ${color}`);
  report.original = original;
  for (const [side, value, color] of [['top',10,'red'],['bottom',20,'blue'],['left',20,'yellow'],['right',10,'green']]) {
    await page.locator('#cropReset').click(); await margins({[side]:value});
    const image = await pixels();
    assert(image.counts[color] < 100, `${side} was not cropped from the composite`);
    assert(Math.abs(image.square.width-image.square.height)<=2, `${side} stretched the square`);
    report.checks.push(`${side} source edge removed without stretching`);
  }
  await page.locator('#cropReset').click();
  await margins({top:10,bottom:20,left:20,right:10});
  report.composite = await pixels(); cropped(report.composite, 'Composite');
  const after = await appearance();
  assert.deepEqual(after.layout, before.layout, 'Cropping changed layer placement');
  assert.deepEqual(after.camera, [0,1.3,1.8]); assert.equal(after.seated,false);
  report.saved = after;
  await page.locator('#screenCrop').screenshot({path:path.join(output,'crop-controls.png')});
  await page.locator('#bust').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'appearance.png')});

  // Exercise the existing stream input path with a local live canvas source too.
  await page.evaluate(() => {
    const v=window.__studio.input.screenVideo,c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;
    c.getContext('2d').drawImage(v,0,0);
    window.__cropShareCanvas=c;
    const frame=c.getContext('2d').getImageData(0,0,c.width,c.height);
    navigator.mediaDevices.getDisplayMedia=async()=>{
      const stream=c.captureStream(30);
      window.__cropShareTimer=setInterval(()=>c.getContext('2d').putImageData(frame,0,0),33);
      return stream;
    };
  });
  await page.locator('#share').click();
  await page.waitForFunction(()=>window.__studio.input.screen && window.__studio.input.screenVideo.readyState>=2);
  await page.waitForTimeout(200);
  report.shared=await pixels(); cropped(report.shared, 'Shared stream');
  assert(await page.evaluate(() => !!window.__studio.input.screen));
  report.checks.push('Live local stream cropped through the share input path');
  await page.locator('#stopShare').click();
  await page.evaluate(()=>clearInterval(window.__cropShareTimer));
  await load();

  const [popup]=await Promise.all([page.waitForEvent('popup'),page.locator('#clean').click()]);
  await popup.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.waitForTimeout(300);
  report.output = await pixels(popup); cropped(report.output,'Output window');
  await page.locator('#record').click(); await page.waitForTimeout(2500);
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#record').click()]);
  const recording=path.join(output,'cropped-recording'+path.extname(download.suggestedFilename()));
  await download.saveAs(recording);
  const data=execFileSync('ffmpeg',['-v','error','-ss','1','-i',recording,'-frames:v','1','-vf','crop=960:540:100:100','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],{maxBuffer:3000000});
  report.recorded = inspectPixels(data,960,540,3); cropped(report.recorded,'Saved recording');
  await popup.close();

  await page.reload(); await ready();
  const restored=await appearance();
  assert.equal(restored.bust,true);assert.equal(restored.seated,false);
  assert.deepEqual(restored.camera,[0,1.3,1.8]); assert.equal(restored.outline,2.4);assert.equal(restored.shine,.28);
  assert.equal(restored.selected,'screen');assert.deepEqual(restored.layout,before.layout);
  assert.deepEqual(restored.saved.screenCrop,{top:10,bottom:20,left:20,right:10});
  assert.equal(await page.locator('#background').inputValue(),'#203040');
  assert.equal(await page.locator('#message').inputValue(),'Crop and saved view');
  report.restored = restored;
  await page.locator('#screenCrop > summary').click(); await load();
  cropped(await pixels(),'Restored crop');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#screenCrop').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  report.mobile=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
  assert(report.mobile.document<=report.mobile.width,'Horizontal overflow');
  await page.locator('#cropReset').click(); await margins({left:80,right:80});
  assert.equal(await page.locator('#crop-right').inputValue(),'15');
  await page.locator('#cropReset').click();
  const reset=await appearance(); assert.deepEqual(reset.layout,before.layout); assert.deepEqual(reset.saved.screenCrop,{top:0,bottom:0,left:0,right:0});
  assert.equal(reset.bust,true);assert.equal(reset.outline,2.4);
  report.checks.push('Safe crop limits, independent reset, 390px controls');

  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>localStorage.setItem('avatar-layout-v1',JSON.stringify({layers:{screen:{x:250,y:100,width:960,height:540}},message:'Earlier settings',background:'#345678',fontSize:'64'})));
  await page.reload();await ready();
  const legacy=await appearance();assert.equal(legacy.layout.screen.x,250);assert.equal(legacy.bust,false);assert.equal(legacy.outline,1.6);assert.equal(legacy.shine,.14);assert.equal(legacy.seated,true);
  assert.equal(await page.locator('#message').inputValue(),'Earlier settings');
  report.checks.push('Existing layout settings retained without new appearance or crop fields');

  await page.evaluate(()=>localStorage.setItem('avatar-layout-v1',JSON.stringify({bust:true,seated:false,outline:'999',shine:'-5',screenCrop:{left:999,right:999,top:-10,bottom:'invalid'}})));
  await page.reload();await ready();
  const bounded=await appearance();assert.equal(bounded.outline,3);assert.equal(bounded.shine,0);assert.deepEqual(bounded.camera,[0,1.3,1.8]);
  await page.locator('#screenCrop > summary').click();
  assert.equal(await page.locator('#crop-left').inputValue(),'95');assert.equal(await page.locator('#crop-right').inputValue(),'0');assert.equal(await page.locator('#crop-top').inputValue(),'0');assert.equal(await page.locator('#crop-bottom').inputValue(),'0');
  await load();
  await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await page.locator('#cropReset').click();
  assert((await page.locator('#status').textContent()).includes('設定を保存できません'));
  assert.equal(await page.locator('#crop-left').inputValue(),'0');
  await page.locator('#bust').uncheck();assert.deepEqual((await appearance()).camera,[0,1.2,2.8]);
  report.checks.push('Invalid stored values bounded; storage failure preserves live controls and reports failure');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.failedAssets,[]);report.status='PASS';
} catch(e) {report.status='FAIL';report.errors.push(String(e));process.exitCode=1;}
finally {await browser.close();fs.writeFileSync(path.join(output,'check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
