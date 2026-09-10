import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MouthCorrection, defaultMouthProfile, mouthTargets, smoothMouth, validMouthProfile } from '../src/mouth';
import { lashArcWeight } from '../src/blink';

test('lash clearance peaks midway and preserves the adopted open and closed shapes', () => {
  assert.equal(lashArcWeight(0), 0);
  assert.equal(lashArcWeight(1), 0);
  assert.equal(lashArcWeight(.5), 1);
  assert.equal(lashArcWeight(.25), lashArcWeight(.75));
  assert.equal(lashArcWeight(NaN), 0);
});

test('resting noise keeps the gentle base smile without narrowing', () => {
  assert.deepEqual(mouthTargets({}), { jawOpen: 0, mouthNarrow: 0 });
  assert.equal(mouthTargets({ mouthPucker: .10, mouthFunnel: .08 }).mouthNarrow, 0);
});

test('pursed and funnelled lips progressively narrow an open or closed mouth', () => {
  let previous = 0;
  for (let score = 0; score <= 1; score += .025) {
    for (const channel of ['mouthPucker', 'mouthFunnel']) {
      const closed = mouthTargets({ [channel]: score });
      const open = mouthTargets({ [channel]: score, jawOpen: 1 });
      assert(closed.mouthNarrow >= previous - 1e-12);
      assert.equal(open.mouthNarrow, closed.mouthNarrow);
      assert.equal(open.jawOpen, 1);
    }
    previous = mouthTargets({ mouthPucker: score }).mouthNarrow;
  }
  assert.equal(mouthTargets({ mouthPucker: .72 }).mouthNarrow, 1);
  assert.equal(mouthTargets({ mouthFunnel: .72 }).mouthNarrow, 1);
});

test('pressed lips become thinner without forcing a wider mouth', () => {
  const result = mouthTargets({ jawOpen: .8, mouthClose: .75, mouthPucker: .72 });
  assert(result.jawOpen > .2 && result.jawOpen < .3);
  assert.equal(result.mouthNarrow, 1);
  assert.equal(mouthTargets({ jawOpen: 1, mouthClose: 1 }).jawOpen, 0);
});

const face = (jawOpen: number, mouthClose = 0) => ({ faceLandmarks: [[]], faceBlendshapes: [{ categories: [
  { categoryName: 'jawOpen', score: jawOpen }, { categoryName: 'mouthClose', score: mouthClose },
] }] });
test('quiet lips stay closed while modest detected openings can reach the full mouth', () => {
  const profile = defaultMouthProfile();
  assert.equal(mouthTargets({ jawOpen: .03 }, profile).jawOpen, 0);
  assert.equal(mouthTargets({ jawOpen: .65 }, profile).jawOpen, 1);
  const middle = mouthTargets({ jawOpen: .3 }, profile).jawOpen;
  profile.strength = 80;
  assert(mouthTargets({ jawOpen: .3 }, profile).jawOpen > middle);
  assert.equal(mouthTargets({ jawOpen: .03 }, profile).jawOpen, 0);
  for (const fps of [30,60]) {
    let value = 1;
    for (let i=0;i<fps*2/15;i++) value = smoothMouth(value,0,1/fps);
    assert.equal(value,0,'Closed lips settle within 134ms');
  }
});
test('individual closed/open calibration uses only fresh inference packets', () => {
  const mouth = new MouthCorrection();
  mouth.observe(face(.09,.2),0); assert(mouth.beginCapture('closed',0));
  for (let t=1000;t<=2500;t+=100) mouth.observe(face(.09,.2),t);
  assert(mouth.finishCapture(2550).ok);
  assert.equal(mouth.map({jawOpen:.09,mouthClose:.2}).jawOpen,0);
  mouth.observe(face(.09,.2),3000); assert(mouth.beginCapture('open',3000));
  for (let t=3000;t<6000;t+=100) mouth.observe(face(.09),t);
  for (let t=6000;t<=7500;t+=100) mouth.observe(face(.42),t);
  assert(mouth.finishCapture(7550).ok);
  assert.equal(mouth.map({jawOpen:.42}).jawOpen,1);
  assert.equal(mouth.map({jawOpen:.06}).jawOpen,0);
});
test('loss, unstable samples and insufficient range leave the valid mouth profile untouched', () => {
  for (const kind of ['missing','unstable','range']) {
    const m = new MouthCorrection();assert.equal(m.beginCapture('open',0),false);
    m.observe(face(.04),0);assert(m.beginCapture('open',0));
    if (kind!=='missing') for (let t=3000;t<=4500;t+=100) m.observe(face(kind==='unstable' ? (t%200===0?.7:.2) : .04),t);
    assert.deepEqual(m.finishCapture(4550),{ok:false,reason:kind});
    assert.deepEqual(m.profile,defaultMouthProfile());
  }
  for (const value of [null,{}, {closed:.4,open:.3,strength:50},{closed:0,open:1,strength:NaN},{closed:-1,open:1,strength:50}])
    assert(!validMouthProfile(value));
});

test('invalid detector values cannot corrupt the avatar geometry', () => {
  for (const value of [NaN, Infinity, -Infinity, -10, 10]) {
    const result = mouthTargets({ jawOpen: value, mouthClose: value, mouthPucker: value, mouthFunnel: value });
    assert(Object.values(result).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  }
});
