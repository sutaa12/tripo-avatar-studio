export type EyeSide = "Left" | "Right";
export type BlinkPair = Record<EyeSide, number>;
export type BlinkProfile = {
  open: BlinkPair;
  closed: BlinkPair;
  strength: number;
};
type Capture = {
  kind: "open" | "closed";
  from: number;
  until: number;
  samples: BlinkPair[];
};
const sides: EyeSide[] = ["Left", "Right"];
const unit = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function lashArcWeight(blink: number) {
  const b = unit(blink);
  return 4 * b * (1 - b);
}
export const defaultBlinkProfile = (): BlinkProfile => ({
  open: { Left: .04, Right: .04 },
  closed: { Left: .5, Right: .5 },
  strength: 50,
});
export function validBlinkProfile(p: any): p is BlinkProfile {
  return p && Number.isFinite(p.strength) && p.strength >= 0 && p.strength <= 100 &&
    sides.every(side => Number.isFinite(p.open?.[side]) && Number.isFinite(p.closed?.[side]) &&
      p.open[side] >= 0 && p.closed[side] <= 1 && p.closed[side] - p.open[side] >= .12);
}
export function mapBlink(raw: number, side: EyeSide, profile: BlinkProfile) {
  const open = profile.open[side];
  const span = (profile.closed[side] - open) * 2 ** ((50 - profile.strength) / 50);
  const closed = Math.min(1, open + Math.max(.12, span));
  return unit((unit(raw) - open) / (closed - open));
}
export function smoothBlink(previous: number, target: number, dt: number) {
  previous = unit(previous); target = unit(target);
  if (!Number.isFinite(dt) || dt <= 0) return previous;
  // Brief blinks need a faster response than the head/body smoothing.
  const rate = target > previous ? 60 : 28;
  const next = previous + (target - previous) * (1 - Math.exp(-dt * rate));
  if (target === 1 && next > .97) return 1;
  if (target === 0 && next < .005) return 0;
  return next;
}
export class BlinkCorrection {
  profile = defaultBlinkProfile();
  latest: BlinkPair | null = null;
  latestAt = -Infinity;
  private capture: Capture | null = null;
  observe(face: any, now: number) {
    if (!face?.faceLandmarks?.length) return;
    const categories = face.faceBlendshapes?.[0]?.categories ?? [];
    const raw = Object.fromEntries(categories.map((c: any) => [c.categoryName, c.score]));
    if (!sides.every(side => Number.isFinite(raw["eyeBlink" + side]))) return;
    const pair = { Left: unit(raw.eyeBlinkLeft), Right: unit(raw.eyeBlinkRight) };
    this.latest = pair;
    this.latestAt = now;
    const capture = this.capture;
    // Only actual inference packets count, never repeated render frames.
    if (capture && now >= capture.from && now <= capture.until) capture.samples.push(pair);
  }
  beginCapture(kind: "open" | "closed", now: number) {
    if (now - this.latestAt > 300 || !this.latest) return false;
    const delay = kind === "closed" ? 3000 : 1000;
    this.capture = { kind, from: now + delay, until: now + delay + 1500, samples: [] };
    return true;
  }
  cancelCapture() { this.capture = null; }
  finishCapture(now: number): { ok: boolean; reason?: "missing" | "unstable" | "range" } {
    const capture = this.capture;
    this.capture = null;
    if (!capture || now < capture.until || capture.samples.length < 8 || now - this.latestAt > 300)
      return { ok: false, reason: "missing" };
    const next = structuredClone(this.profile);
    for (const side of sides) {
      const sorted = capture.samples.map(s => s[side]).sort((a, b) => a - b);
      const quantile = (q: number) => sorted[Math.floor((sorted.length - 1) * q)];
      if (quantile(.8) - quantile(.2) > .18) return { ok: false, reason: "unstable" };
      const median = quantile(.5);
      if (capture.kind === "open") {
        next.open[side] = Math.min(1, quantile(.25) + .02);
        next.closed[side] = Math.min(1, Math.max(next.closed[side], next.open[side] + .2));
      }
      else {
        if (median - next.open[side] < .15) return { ok: false, reason: "range" };
        // Leave a margin below the measured closure to tolerate small score changes.
        next.closed[side] = next.open[side] + (median - next.open[side]) * .9;
      }
    }
    if (!validBlinkProfile(next)) return { ok: false, reason: "range" };
    next.strength = 50;
    this.profile = next;
    return { ok: true };
  }
  map(raw: number, side: EyeSide) { return mapBlink(raw, side, this.profile); }
}
