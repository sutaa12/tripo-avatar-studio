import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mouthTargets } from '../src/mouth';
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
  assert.deepEqual(mouthTargets({ jawOpen: .8, mouthClose: .75, mouthPucker: .72 }),
    { jawOpen: .2, mouthNarrow: 1 });
  assert.equal(mouthTargets({ jawOpen: 1, mouthClose: 1 }).jawOpen, 0);
});

test('invalid detector values cannot corrupt the avatar geometry', () => {
  for (const value of [NaN, Infinity, -Infinity, -10, 10]) {
    const result = mouthTargets({ jawOpen: value, mouthClose: value, mouthPucker: value, mouthFunnel: value });
    assert(Object.values(result).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  }
});
