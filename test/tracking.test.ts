import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackingState, trackingDirection } from "../src/tracking-state.ts";
const hand = (x: number) => [{ x, y: 0.5, z: 0 }];
test("camera coordinates keep horizontal directions and invert vertical/depth axes", () => {
  assert.deepEqual(
    trackingDirection({ x: 0, y: 0, z: 0 }, { x: 1, y: 2, z: 3 }),
    { x: 1, y: -2, z: -3 },
  );
});
test("face loss does not remain fresh when unrelated packets arrive", () => {
  const s = new TrackingState();
  s.ingest({ face: { faceLandmarks: [[]] } }, 0);
  s.ingest({}, 400);
  assert.equal(s.weights(150).face, 1);
  assert.equal(s.weights(350).face, 0.5);
  assert.equal(s.weights(551).face, 0);
});
test("hands associate to pose wrists rather than an ambiguous classifier label", () => {
  const s = new TrackingState();
  const pose = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
  pose[15].x = 0.8;
  pose[16].x = 0.2;
  s.ingest(
    {
      pose: { worldLandmarks: [pose], landmarks: [pose] },
      hand: {
        landmarks: [hand(0.79)],
        worldLandmarks: [hand(0)],
        handedness: [[{ categoryName: "Right" }]],
      },
    },
    100,
  );
  assert(s.hands.has("left"));
  assert(!s.hands.has("right"));
});
