import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const url = process.env.URL ?? 'http://127.0.0.1:5176/';
const prefix = process.env.PREFIX ?? 'bgm-local';
const output = path.resolve('../evidence', prefix);
fs.mkdirSync(output, { recursive: true });
function tone(frequency, duration = 1.2) {
  const samples = Math.round(48000 * duration), wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(8192 * Math.sin(i * frequency * 2 * Math.PI / 48000)), 44 + i * 2);
  return wav;
}
const wav = tone(480);
fs.writeFileSync(path.join(output, 'tone.wav'), wav);
fs.writeFileSync(path.join(output, 'second.wav'), tone(880));
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(output, 'second.wav'), path.join(output, 'second.mp3')]);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(output, 'tone.wav'), path.join(output, 'third.m4a')]);
const browser = await chromium.launch({ headless: true,
  ...(process.platform === 'darwin' ? {executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'} : {}),
  args: ['--enable-gpu', '--use-angle=metal', '--mute-audio'] });
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, acceptDownloads: true});
const report = {url, errors: [], marks: {}, scope: 'Local user-selected audio through the actual app, UI controls and saved audiovisual recordings. Synthetic tones measure gain and silence; no private music is uploaded.'};
page.on('pageerror', e => report.errors.push(e.message));
async function mark(name) {
  report.marks[name] = await page.evaluate(() => (performance.now() - window.__bgmRecordStarted) / 1000);
}
async function load(fileName, buffer, mimeType = 'audio/wav') {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#bgmChoose').click()]);
  await chooser.setFiles({name: fileName, mimeType, buffer});
  await page.waitForFunction(() => window.__studio.bgm.audio.readyState >= 2);
}
async function volume(value) {
  await page.locator('#bgmVolume').fill(String(value));
  await page.locator('#bgmVolume').dispatchEvent('input');
}
async function saveRecording(name) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#record').click()]);
  const target = path.join(output, name + path.extname(download.suggestedFilename()));
  await download.saveAs(target);
  await page.waitForFunction(() => document.querySelector('#record').textContent === '合成を録画');
  return target;
}
function inspect(file) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {encoding: 'utf8'}));
  assert(probe.streams.some(s => s.codec_type === 'video'));
  assert(probe.streams.some(s => s.codec_type === 'audio'));
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', 'pipe:1'], {maxBuffer: 20 * 1024 * 1024});
  return {probe, pcm};
}
function rms(pcm, start, end) {
  let power = 0, count = 0;
  for (let i = Math.max(0, Math.round(start * 48000)); i < Math.min(pcm.length / 4, Math.round(end * 48000)); i++) {
    power += pcm.readFloatLE(i * 4) ** 2; count++;
  }
  assert(count > 0); return Math.sqrt(power / count);
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__studio?.bgm, null, {timeout: 60000});
  assert(await page.locator('#bgmPlay').isDisabled());
  assert(await page.locator('#bgmLoop').isChecked());
  assert.equal(await page.locator('#bgmVolume').inputValue(), '35');
  await page.evaluate(() => {
    window.__bgmRecordStarted = 0;
    window.__bgmTimes = [];
    const original = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function(...args) {
      window.__bgmRecordStarted = performance.now();
      return original.apply(this, args);
    };
    window.__bgmTimer = setInterval(() => {
      const a = window.__studio.bgm.audio;
      if (!a.paused) window.__bgmTimes.push({time: a.currentTime, clock: performance.now()});
    }, 25);
  });
  await page.locator('#record').click();
  await page.waitForFunction(() => document.querySelector('#record').textContent === '録画を終了');
  await page.waitForTimeout(650);
  await mark('silenceEnd');
  await load('お気に入り <BGM>.wav', wav);
  assert.equal(await page.locator('#bgmName').textContent(), 'お気に入り <BGM>.wav');
  assert.equal(await page.locator('#bgmName > *').count(), 0);
  await volume(80);
  await page.locator('#bgmPlay').click();
  await mark('loudStart');
  await page.waitForTimeout(3000);
  report.firstLoopReturns = await page.evaluate(() => window.__bgmTimes.filter((v, i, a) => i && v.time + .3 < a[i - 1].time).length);
  assert(report.firstLoopReturns >= 2);
  await mark('quietStart');
  await volume(20);
  await page.waitForTimeout(1400);
  await page.locator('#bgmPlay').click();
  await mark('pauseStart');
  const pausedAt = await page.evaluate(() => window.__studio.bgm.audio.currentTime);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.__studio.bgm.audio.currentTime), pausedAt);
  await mark('resumeStart');
  await page.locator('#bgmPlay').click();
  await page.waitForTimeout(800);
  await volume(0);
  await mark('muteStart');
  await page.waitForTimeout(800);
  await mark('muteEnd');
  assert(!await page.evaluate(() => window.__studio.bgm.audio.paused));
  await page.locator('#bgmStop').click();
  assert.equal(await page.evaluate(() => window.__studio.bgm.audio.currentTime), 0);
  assert(await page.evaluate(() => window.__studio.bgm.audio.paused));
  await page.locator('#bgmSeek').fill('0.6');
  await page.locator('#bgmSeek').dispatchEvent('input');
  assert(Math.abs(await page.evaluate(() => window.__studio.bgm.audio.currentTime) - .6) < .02);
  await page.locator('#bgmLoop').uncheck();
  await page.locator('#bgmPlay').click();
  await page.waitForFunction(() => window.__studio.bgm.audio.ended, null, {timeout: 4000});
  await load('second.mp3', fs.readFileSync(path.join(output, 'second.mp3')), 'audio/mpeg');
  await page.locator('#bgmLoop').check();
  await volume(40);
  await mark('replacementStart');
  await page.locator('#bgmPlay').click();
  await page.waitForTimeout(1600);
  const first = await saveRecording('with-bgm');
  assert(!await page.evaluate(() => window.__studio.bgm.audio.paused));
  await page.locator('#record').click();
  await page.waitForTimeout(1600);
  const second = await saveRecording('second-recording');
  report.loopReturns = await page.evaluate(() => window.__bgmTimes.filter((v, i, a) => i && v.time + .3 < a[i - 1].time).length);
  assert(report.loopReturns >= 3);
  const a = inspect(first), b = inspect(second), m = report.marks;
  report.audio = {
    firstStreams: a.probe.streams.map(s => ({type: s.codec_type, codec: s.codec_name, channels: s.channels})),
    silence: rms(a.pcm, .15, m.silenceEnd - .1),
    loud: rms(a.pcm, m.loudStart + .25, m.quietStart - .15),
    quiet: rms(a.pcm, m.quietStart + .25, m.pauseStart - .15),
    paused: rms(a.pcm, m.pauseStart + .25, m.resumeStart - .15),
    muted: rms(a.pcm, m.muteStart + .25, m.muteEnd - .15),
    replacement: rms(a.pcm, m.replacementStart + .3, m.replacementStart + 1.3),
    secondRecording: rms(b.pcm, .3, 1.3),
  };
  report.audio.quietToLoud = report.audio.quiet / report.audio.loud;
  assert(report.audio.loud > .1);
  assert(report.audio.silence < .001 && report.audio.paused < .001 && report.audio.muted < .001);
  assert(Math.abs(report.audio.quietToLoud - .25) < .04);
  assert(report.audio.replacement > .04 && report.audio.secondRecording > .04);
  await page.locator('#bgmStop').click();
  await page.locator('#bgmFile').setInputFiles({name: 'broken.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('invalid audio')});
  await page.waitForFunction(() => document.querySelector('#bgmStatus').textContent.includes('読み込めません'));
  assert(await page.locator('#bgmPlay').isDisabled());
  await load('recovered.m4a', fs.readFileSync(path.join(output, 'third.m4a')), 'audio/mp4');
  assert(await page.locator('#bgmPlay').isEnabled());
  await page.evaluate(() => {
    const a = window.__studio.bgm.audio, play = a.play.bind(a);
    let once = true;
    a.play = () => { if (once) { once = false; return Promise.reject(new DOMException('Blocked once', 'NotAllowedError')); } return play(); };
  });
  await page.locator('#bgmPlay').click();
  await page.waitForFunction(() => document.querySelector('#bgmStatus').textContent.includes('もう一度再生'));
  assert(await page.locator('#bgmPlay').isEnabled());
  await page.locator('#bgmPlay').click();
  await page.waitForFunction(() => !window.__studio.bgm.audio.paused);
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__studio.bgm.audio.currentTime > 0));
  await page.locator('#bgmStop').click();
  await volume(26); await page.locator('#bgmLoop').uncheck();
  await page.locator('#bgmControls').screenshot({path: path.join(output, 'controls.png')});
  await page.setViewportSize({width: 390, height: 844});
  report.mobile = await page.evaluate(() => ({width: innerWidth, documentWidth: document.documentElement.scrollWidth}));
  assert(report.mobile.documentWidth <= report.mobile.width);
  await page.locator('#bgmControls').screenshot({path: path.join(output, 'mobile-controls.png')});
  await page.reload();
  await page.waitForFunction(() => window.__studio?.bgm, null, {timeout: 60000});
  assert.equal(await page.locator('#bgmVolume').inputValue(), '26');
  assert(!await page.locator('#bgmLoop').isChecked());
  assert(await page.locator('#bgmPlay').isDisabled());
  assert(await page.evaluate(() => window.__studio.bgm.audio.paused));
  assert.deepEqual(report.errors, []);
  report.status = 'PASS';
} catch (e) {
  report.status = 'FAIL'; report.errors.push(String(e)); process.exitCode = 1;
} finally {
  await browser.close();
  fs.writeFileSync(path.join(output, 'check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
