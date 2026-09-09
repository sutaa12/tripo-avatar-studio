export type Rect = { x: number; y: number; width: number; height: number };
export const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));
export function contain(sw: number, sh: number, r: Rect): Rect {
  const k = Math.min(r.width / sw, r.height / sh);
  return {
    x: r.x + (r.width - sw * k) / 2,
    y: r.y + (r.height - sh * k) / 2,
    width: sw * k,
    height: sh * k,
  };
}
export function trackingWeight(age: number) {
  return clamp(1 - (age - 150) / 400, 0, 1);
}
export function moveRect(r: Rect, x: number, y: number): Rect {
  return {
    ...r,
    x: clamp(x, -r.width + 40, 1880),
    y: clamp(y, -r.height + 40, 1040),
  };
}
