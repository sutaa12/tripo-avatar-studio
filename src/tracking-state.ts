import { trackingWeight } from "./layout";
export class TrackingState {
  face: any = null;
  pose: any = null;
  hands = new Map<string, { data: any; at: number }>();
  faceAt = -Infinity;
  poseAt = -Infinity;
  ingest(packet: any, now: number) {
    if (packet.face?.faceLandmarks?.length) {
      this.face = packet.face;
      this.faceAt = now;
    }
    if (
      packet.pose?.worldLandmarks?.length &&
      packet.pose.landmarks?.[0]?.[11]?.visibility > 0.5 &&
      packet.pose.landmarks?.[0]?.[12]?.visibility > 0.5
    ) {
      this.pose = packet.pose;
      this.poseAt = now;
    }
    const pose = packet.pose?.landmarks?.[0];
    const used = new Set<string>();
    for (let i = 0; i < (packet.hand?.worldLandmarks?.length ?? 0); i++) {
      const wrist = packet.hand.landmarks[i][0];
      let side: string;
      if (pose && pose[15].visibility > 0.5 && pose[16].visibility > 0.5) {
        const dist = (n: number) =>
          Math.hypot(wrist.x - pose[n].x, wrist.y - pose[n].y);
        side = dist(15) < dist(16) ? "left" : "right";
      } else {
        const label =
          packet.hand.handedness[i]?.[0]?.categoryName?.toLowerCase();
        side = label === "left" ? "right" : "left";
      }
      if (used.has(side)) continue;
      used.add(side);
      this.hands.set(side, { data: packet.hand.worldLandmarks[i], at: now });
    }
  }
  weights(now: number) {
    return {
      face: trackingWeight(now - this.faceAt),
      pose: trackingWeight(now - this.poseAt),
    };
  }
}
export const trackingDirection = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
) => ({ x: b.x - a.x, y: -(b.y - a.y), z: -(b.z - a.z) });
