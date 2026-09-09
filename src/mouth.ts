const unit = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0;

export function mouthTargets(scores: Record<string, number>) {
  const pucker = Math.max(unit(scores.mouthPucker), unit(scores.mouthFunnel));
  // Ignore resting detector noise and reach the sculpted shape before saturation.
  const t = Math.max(0, Math.min(1, (pucker - .10) / .62));
  return {
    jawOpen: unit(scores.jawOpen) * (1 - unit(scores.mouthClose)),
    mouthNarrow: t * t * (3 - 2 * t),
  };
}
