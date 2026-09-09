import { test } from "node:test";
import assert from "node:assert/strict";
import { BlinkCorrection, defaultBlinkProfile, mapBlink, smoothBlink, validBlinkProfile } from "../src/blink.ts";

const face = (left: number, right = left) => ({ faceLandmarks: [[]], faceBlendshapes: [{ categories: [
  { categoryName: "eyeBlinkLeft", score: left }, { categoryName: "eyeBlinkRight", score: right },
] }] });
test("a half-strength detector closure reaches full VRM closure, independently for each eye", () => {
  const p = defaultBlinkProfile();
  assert.equal(mapBlink(.5, "Left", p), 1);
  assert.equal(mapBlink(.025, "Right", p), 0);
  const middle = mapBlink(.25, "Left", p);
  assert(middle > .4 && middle < .6);
  assert.equal(mapBlink(NaN, "Left", p), 0);
  assert.equal(mapBlink(-1, "Left", p), 0);
  assert.equal(mapBlink(2, "Left", p), 1);
});
test("brief closures reach exactly one within 67 ms at 30 and 60 fps", () => {
  for (const fps of [30, 60]) {
    let value = 0;
    for (let i = 0; i < fps / 15; i++) value = smoothBlink(value, 1, 1 / fps);
    assert.equal(value, 1);
    for (let i = 0; i < fps; i++) value = smoothBlink(value, 0, 1 / fps);
    assert.equal(value, 0);
  }
  assert.equal(smoothBlink(.5, 1, 0), .5);
});
test("personal calibration measures actual new packets after the countdown", () => {
  const blink = new BlinkCorrection();
  blink.observe(face(.07, .09), 0);
  assert(blink.beginCapture("open", 0));
  for (let t = 1000; t <= 2500; t += 100) blink.observe(face(.07, .09), t);
  assert(blink.finishCapture(2550).ok);
  blink.observe(face(.08), 3000);
  assert(blink.beginCapture("closed", 3000));
  for (let t = 3000; t < 6000; t += 100) blink.observe(face(.05), t);
  for (let t = 6000; t <= 7500; t += 100) blink.observe(face(.39, .52), t);
  assert(blink.finishCapture(7550).ok);
  assert.equal(blink.map(.38, "Left"), 1);
  assert.equal(blink.map(.50, "Right"), 1);
  assert.equal(blink.map(.07, "Left"), 0);
  assert.equal(blink.map(.09, "Right"), 0);
  assert.notEqual(blink.profile.closed.Left, blink.profile.closed.Right);
});
test("face loss, too few samples, and unchanged open eyes cannot replace a valid profile", () => {
  const blink = new BlinkCorrection();
  assert.equal(blink.beginCapture("closed", 0), false);
  blink.observe(face(.05), 0); assert(blink.beginCapture("closed", 0));
  blink.observe(face(.55), 4000);
  assert.equal(blink.finishCapture(4550).ok, false);
  blink.observe(face(.05), 5000); assert(blink.beginCapture("closed", 5000));
  for (let t = 8000; t <= 9500; t += 100) blink.observe(face(.05), t);
  assert.deepEqual(blink.finishCapture(9550), { ok: false, reason: "range" });
  assert.deepEqual(blink.profile, defaultBlinkProfile());
  assert(!validBlinkProfile({ open: { Left: .5, Right: .5 }, closed: { Left: .4, Right: .8 }, strength: 50 }));
});
test("stronger correction closes sooner without forcing neutral eyes closed", () => {
  const p = defaultBlinkProfile();
  const standard = mapBlink(.3, "Left", p);
  p.strength = 80;
  assert(mapBlink(.3, "Left", p) > standard);
  assert.equal(mapBlink(.04, "Left", p), 0);
});
test("an elevated open-eye baseline can be measured before measuring closure", () => {
  const blink = new BlinkCorrection();
  blink.observe(face(.42), 0); assert(blink.beginCapture("open", 0));
  for (let t = 1000; t <= 2500; t += 100) blink.observe(face(.42), t);
  assert(blink.finishCapture(2550).ok);
  assert.equal(blink.map(.42, "Left"), 0);
});
