import { test } from "node:test";
import assert from "node:assert/strict";
import { contain, trackingWeight, moveRect } from "../src/layout.ts";
test("wide and tall shared screens retain their aspect ratio", () => {
  const r = { x: 10, y: 20, width: 100, height: 100 };
  assert.deepEqual(contain(200, 100, r), {
    x: 10,
    y: 45,
    width: 100,
    height: 50,
  });
  assert.deepEqual(contain(100, 200, r), {
    x: 35,
    y: 20,
    width: 50,
    height: 100,
  });
});
test("lost tracking holds briefly and returns to neutral by 550ms", () => {
  assert.equal(trackingWeight(0), 1);
  assert.equal(trackingWeight(150), 1);
  assert.equal(trackingWeight(350), 0.5);
  assert.equal(trackingWeight(550), 0);
  assert.equal(trackingWeight(Infinity), 0);
});
test("moving a layer preserves its size and original configuration", () => {
  const r = { x: 10, y: 20, width: 100, height: 200 };
  assert.deepEqual(moveRect(r, 30, 40), {
    x: 30,
    y: 40,
    width: 100,
    height: 200,
  });
  assert.equal(r.x, 10);
  assert.equal(moveRect(r, 9999, -9999).y, -160);
});
