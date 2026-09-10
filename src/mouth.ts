const unit = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;

export type MouthProfile = { closed: number; open: number; strength: number };
export const defaultMouthProfile = (): MouthProfile => ({ closed: .035, open: .65, strength: 50 });
export function validMouthProfile(p: any): p is MouthProfile {
  return p && Number.isFinite(p.closed) && Number.isFinite(p.open) && Number.isFinite(p.strength)
    && p.closed >= 0 && p.open <= 1 && p.open - p.closed >= .12 && p.strength >= 0 && p.strength <= 100;
}
export function mouthOpening(scores: Record<string, number>) {
  return unit(scores.jawOpen) * (1 - unit(scores.mouthClose));
}
export function mouthTargets(scores: Record<string, number>, profile = defaultMouthProfile()) {
  const pucker = Math.max(unit(scores.mouthPucker), unit(scores.mouthFunnel));
  // Ignore resting detector noise and reach the sculpted shape before saturation.
  const t = Math.max(0, Math.min(1, (pucker - .10) / .62));
  const span = Math.max(.12, (profile.open - profile.closed) * 2 ** ((50 - profile.strength) / 50));
  return {
    jawOpen: unit((mouthOpening(scores) - profile.closed) / Math.min(1 - profile.closed, span)),
    mouthNarrow: t * t * (3 - 2 * t),
  };
}

export function smoothMouth(previous: number, target: number, dt: number) {
  previous = unit(previous); target = unit(target);
  if (!Number.isFinite(dt) || dt <= 0) return previous;
  const next = previous + (target - previous) * (1 - Math.exp(-dt * (target < previous ? 40 : 24)));
  return target === 0 && next < .007 ? 0 : target === 1 && next > .995 ? 1 : next;
}

export class MouthCorrection {
  profile = defaultMouthProfile();
  latest: number | null = null;
  latestAt = -Infinity;
  private capture: { kind: 'closed' | 'open'; from: number; until: number; samples: number[] } | null = null;
  observe(face: any, now: number) {
    if (!face?.faceLandmarks?.length) return;
    const scores = Object.fromEntries((face.faceBlendshapes?.[0]?.categories ?? []).map((c: any) => [c.categoryName, c.score]));
    if (!Number.isFinite(scores.jawOpen) || !Number.isFinite(scores.mouthClose)) return;
    this.latest = mouthOpening(scores); this.latestAt = now;
    const c = this.capture;
    // Calibration samples come from inference packets, not repeated display frames.
    if (c && now >= c.from && now <= c.until) c.samples.push(this.latest);
  }
  beginCapture(kind: 'closed' | 'open', now: number) {
    if (this.latest === null || now - this.latestAt > 300) return false;
    const from = now + (kind === 'open' ? 3000 : 1000);
    this.capture = { kind, from, until: from + 1500, samples: [] };
    return true;
  }
  cancelCapture() { this.capture = null; }
  finishCapture(now: number): { ok: boolean; reason?: 'missing' | 'unstable' | 'range' } {
    const c = this.capture; this.capture = null;
    if (!c || now < c.until || c.samples.length < 8 || now - this.latestAt > 300)
      return { ok: false, reason: 'missing' };
    const sorted = c.samples.sort((a, b) => a - b), q = (v: number) => sorted[Math.floor((sorted.length - 1) * v)];
    if (q(.8) - q(.2) > .12) return { ok: false, reason: 'unstable' };
    const next = { ...this.profile, strength: 50 };
    if (c.kind === 'closed') {
      next.closed = q(.75) + .015;
      next.open = Math.min(1, Math.max(next.open, next.closed + .2));
    } else {
      if (q(.5) - next.closed < .15) return { ok: false, reason: 'range' };
      next.open = next.closed + (q(.5) - next.closed) * .9;
    }
    if (!validMouthProfile(next)) return { ok: false, reason: 'range' };
    this.profile = next;
    return { ok: true };
  }
  map(scores: Record<string, number>) { return mouthTargets(scores, this.profile); }
}
