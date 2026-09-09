import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';

const url = process.env.URL ?? 'http://127.0.0.1:5176/';
const output = path.resolve('../evidence', process.env.PREFIX ?? 'output-local');
const trackingFile = process.env.TRACKING_VIDEO;
const screenFile = process.env.SCREEN_VIDEO;
fs.mkdirSync(output, {recursive: true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-output-'));
// A normal headed browser is essential: Playwright's launch defaults and focus
// emulation keep hidden pages visible and conceal this regression.
const chrome = spawn(process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
  '--no-default-browser-check', '--mute-audio', '--window-size=1280,900', 'about:blank'], {stdio: 'ignore'});
let port;
for (let i = 0; i < 100; i++) {
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!port) { chrome.kill(); throw new Error('Test Chrome did not start'); }
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {noDefaults: true, isLocal: true});
const context = browser.contexts()[0], page = context.pages()[0];
const cdp = await browser.newBrowserCDPSession();
await cdp.send('Browser.setDownloadBehavior', {behavior: 'allowAndName', downloadPath: output, eventsEnabled: true});
const report = {url, browser: browser.version(), scope: 'Native tab/window visibility, actual output video pixels, saved recording, window lifecycle and optional local recorded input. No background-throttling bypass or physical camera.', stages: [], errors: [], failedAssets: []};
page.on('pageerror', e => report.errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) report.failedAssets.push({url: r.url(), status: r.status()}); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function windowId(p) {
  const session = await context.newCDPSession(p);
  const {targetInfo} = await session.send('Target.getTargetInfo');
  const {windowId} = await cdp.send('Browser.getWindowForTarget', {targetId: targetInfo.targetId});
  await session.detach();
  return windowId;
}
async function bounds(id, bounds) { await cdp.send('Browser.setWindowBounds', {windowId: id, bounds}); }
async function openOutput() {
  await page.bringToFront();
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('#clean').click()]);
  popup.on('pageerror', e => report.errors.push(e.message));
  await popup.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await bounds(await windowId(popup), {left: 650, top: 40, width: 850, height: 650});
  return popup;
}
async function snapshot(popup) {
  const editor = await page.evaluate(() => ({visibility: document.visibilityState, frames: window.__studio.metrics.renderFrames, tracking: {...window.__studio.input.stats}}));
  if (!popup) return {editor};
  const video = await popup.evaluate(() => {
    const v = document.querySelector('video'), c = document.createElement('canvas');
    c.width = 160; c.height = 90;
    const x = c.getContext('2d'); x.drawImage(v, 0, 0, 160, 90);
    let hash = 2166136261;
    for (const b of x.getImageData(0, 0, 160, 90).data) hash = Math.imul(hash ^ b, 16777619);
    return {visibility: document.visibilityState, time: v.currentTime, presented: v.getVideoPlaybackQuality().totalVideoFrames, hash: hash >>> 0, width: v.videoWidth, height: v.videoHeight};
  });
  return {editor, video};
}
async function interval(name, popup, seconds, editorVisibility, outputVisibility = 'visible') {
  const start = await snapshot(popup), begin = Date.now(), samples = [];
  for (let i = 0; i < seconds; i++) { await sleep(1000); samples.push(await snapshot(popup)); }
  const end = samples.at(-1), elapsed = (Date.now() - begin) / 1000;
  const stage = {name, seconds: elapsed, start, end,
    renderFps: (end.editor.frames - start.editor.frames) / elapsed,
    outputFps: popup ? (end.video.presented - start.video.presented) / elapsed : undefined,
    uniqueOutputImages: popup ? new Set([start, ...samples].map(s => s.video.hash)).size : undefined};
  report.stages.push(stage);
  for (const s of [start, ...samples]) {
    assert.equal(s.editor.visibility, editorVisibility, `${name}: real editor visibility`);
    if (popup) assert.equal(s.video.visibility, outputVisibility, `${name}: real output visibility`);
  }
  assert(stage.renderFps >= 15, `${name}: render loop stalled`);
  if (popup && outputVisibility === 'visible') {
    assert(stage.outputFps >= 15, `${name}: output video stalled`);
    assert(stage.uniqueOutputImages >= seconds, `${name}: output pixels froze`);
    assert.equal(end.video.width, 1920); assert.equal(end.video.height, 1080);
    for (let i = 0; i < samples.length; i++) {
      const previous = i ? samples[i - 1] : start;
      assert(samples[i].video.presented > previous.video.presented, `${name}: a whole second without an output frame`);
    }
  }
  console.log(JSON.stringify({stage: name, renderFps: stage.renderFps, outputFps: stage.outputFps, uniqueImages: stage.uniqueOutputImages}));
  return stage;
}
function tone() {
  const n = 48000, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24); b.writeUInt32LE(96000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8192 * Math.sin(i * 480 * 2 * Math.PI / 48000)), 44 + i * 2);
  return b;
}
async function saveRecording() {
  const result = new Promise((resolve, reject) => {
    let item;
    const timer = setTimeout(() => { cleanup(); reject(new Error('Recording download timed out')); }, 30000);
    const begin = e => { item = e; };
    const progress = e => { if (item?.guid === e.guid && e.state === 'completed') { cleanup(); resolve(item); } };
    function cleanup() { clearTimeout(timer); cdp.off('Browser.downloadWillBegin', begin); cdp.off('Browser.downloadProgress', progress); }
    cdp.on('Browser.downloadWillBegin', begin); cdp.on('Browser.downloadProgress', progress);
  });
  await page.locator('#record').click();
  const item = await result, file = path.join(output, `background-recording${path.extname(item.suggestedFilename)}`);
  fs.renameSync(path.join(output, item.guid), file);
  return file;
}
try {
  await page.bringToFront();
  await page.goto(url);
  await page.waitForFunction(() => window.__studio?.avatar.vrm, null, {timeout: 60000});
  const editorId = await windowId(page);
  await bounds(editorId, {left: 0, top: 40, width: 900, height: 800});
  if (screenFile) {
    await page.locator('#screenFile').setInputFiles(screenFile);
    await page.waitForFunction(() => window.__studio.input.screenVideo.readyState >= 2);
    report.backgroundFixture = path.basename(screenFile);
  }
  await page.locator('details').filter({has: page.locator('#demo')}).locator('summary').click();
  await page.locator('#demo').click();
  let popup = await openOutput();
  await interval('both-visible', popup, 3, 'visible');
  // Without BGM or a recorder: audible media must not conceal a stopped render loop.
  const cover = await context.newPage();
  await cover.goto('data:text/html,<title>Background test</title><h1>The editor tab is hidden</h1>');
  assert.equal(await windowId(cover), editorId);
  await cover.bringToFront(); await popup.bringToFront(); await sleep(500);
  await interval('hidden-editor-no-audio', popup, 10, 'hidden');
  await popup.screenshot({path: path.join(output, 'hidden-editor-output.png')});

  await page.bringToFront();
  await page.locator('#bgmFile').setInputFiles({name: 'Test tone.wav', mimeType: 'audio/wav', buffer: tone()});
  await page.waitForFunction(() => window.__studio.bgm.audio.readyState >= 2);
  await page.locator('#bgmPlay').click();
  await page.locator('#record').click();
  await page.waitForFunction(() => document.querySelector('#record').textContent === '録画を終了');
  await sleep(700);
  await cover.bringToFront(); await popup.bringToFront(); await sleep(500);
  await interval('hidden-editor-recording-bgm', popup, 10, 'hidden');
  await bounds(editorId, {windowState: 'minimized'}); await sleep(500);
  await interval('minimized-editor-recording', popup, 5, 'hidden');
  await bounds(editorId, {windowState: 'normal'}); await page.bringToFront(); await sleep(500);
  const saved = await saveRecording();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', saved], {encoding: 'utf8'}));
  assert(probe.streams.some(s => s.codec_type === 'audio'));
  const videoFrames = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', saved], {encoding: 'utf8', maxBuffer: 4000000})).frames.map(f => Number(f.best_effort_timestamp_time));
  const gaps = videoFrames.slice(1).map((v, i) => v - videoFrames[i]);
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', saved, '-vf', 'fps=1,scale=160:90', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], {maxBuffer: 10 * 1024 * 1024});
  const pixelFrames = [];
  for (let i = 0; i < pixels.length; i += 160 * 90 * 3) pixelFrames.push(pixels.subarray(i, i + 160 * 90 * 3));
  const changedSeconds = pixelFrames.slice(1).filter((p, i) => !p.equals(pixelFrames[i])).length;
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', saved, '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'], {maxBuffer: 5000000});
  let power = 0; for (let i = 0; i < pcm.length; i += 4) power += pcm.readFloatLE(i) ** 2;
  report.recording = {file: path.basename(saved), duration: Number(probe.format.duration), frames: videoFrames.length, maxFrameGap: Math.max(...gaps), decodedSeconds: pixelFrames.length, changedSeconds, audioRms: Math.sqrt(power / (pcm.length / 4)), codecs: probe.streams.map(s => s.codec_name)};
  assert(report.recording.maxFrameGap < .75, 'Saved recording contains a long frozen gap');
  assert(changedSeconds >= pixelFrames.length - 2, 'Saved recording repeats frozen images');
  assert(report.recording.audioRms > .01, 'BGM missing from saved recording');
  await page.locator('#bgmStop').click();

  const popupId = await windowId(popup);
  await bounds(popupId, {windowState: 'minimized'}); await page.bringToFront(); await sleep(500);
  await interval('minimized-output-editor-visible', popup, 3, 'visible', 'hidden');
  await bounds(popupId, {windowState: 'normal'}); await popup.bringToFront(); await sleep(500);
  await interval('restored-output', popup, 3, 'visible');

  // A popup close must stop its capture track and leave exactly one editor loop.
  for (let i = 0; i < 2; i++) {
    await popup.evaluate(() => {opener.__closedOutputTrack = document.querySelector('video').srcObject.getVideoTracks()[0];});
    await cover.bringToFront(); await popup.bringToFront(); await popup.close();
    await page.bringToFront(); await sleep(400);
    assert.equal(await page.evaluate(() => window.__closedOutputTrack.readyState), 'ended');
    await interval(`closed-output-${i + 1}`, null, 2, 'visible');
    popup = await openOutput();
    await page.bringToFront();
    const tabs = context.pages().length;
    await page.locator('#clean').click();
    assert.equal(context.pages().length, tabs, 'Repeated open creates duplicate windows');
    await cover.bringToFront(); await popup.bringToFront(); await sleep(500);
    await interval(`reopened-output-${i + 1}`, popup, 3, 'hidden');
  }
  await page.bringToFront();
  if (trackingFile) {
    await page.locator('#demo').click();
    await page.locator('#trackingFile').setInputFiles(trackingFile);
    await page.waitForFunction(() => window.__studio.input.ready, null, {timeout: 60000});
    await page.evaluate(() => { const v = window.__studio.input.trackingVideo; v.loop = true; v.currentTime = 0; return v.play(); });
    await page.waitForFunction(() => window.__studio.input.stats.faceFrames >= 3);
    await cover.bringToFront(); await popup.bringToFront(); await sleep(500);
    const stage = await interval('hidden-editor-recorded-face', popup, 6, 'hidden');
    report.tracking = {file: path.basename(trackingFile), faceFrames: stage.end.editor.tracking.faceFrames - stage.start.editor.tracking.faceFrames, errors: stage.end.editor.tracking.errors};
    assert(report.tracking.faceFrames >= 5, 'Recorded face tracking stalled in background');
    assert.equal(report.tracking.errors, 0);
    await page.bringToFront(); await page.locator('#stopCamera').click();
  }
  await page.evaluate(() => { window.__nativeRaf = 0; function tick(){window.__nativeRaf++; requestAnimationFrame(tick);} requestAnimationFrame(tick); });
  const a = await page.evaluate(() => ({raf: window.__nativeRaf, frames: window.__studio.metrics.renderFrames}));
  await sleep(2000);
  const b = await page.evaluate(() => ({raf: window.__nativeRaf, frames: window.__studio.metrics.renderFrames}));
  report.singleLoop = {nativeFrames: b.raf - a.raf, appFrames: b.frames - a.frames};
  assert(Math.abs(report.singleLoop.appFrames - report.singleLoop.nativeFrames) <= 2, 'Duplicate animation loops after window switches');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failedAssets, []);
  report.status = 'PASS';
} catch (e) {report.status = 'FAIL'; report.errors.push(String(e)); process.exitCode = 1;}
finally {
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({status: report.status, recording: report.recording, tracking: report.tracking, singleLoop: report.singleLoop, errors: report.errors}));
  await browser.close(); chrome.kill();
  for (let i = 0; i < 20 && chrome.exitCode === null; i++) await sleep(100);
  if (chrome.exitCode !== null) fs.rmSync(profile, {recursive: true, force: true});
}
