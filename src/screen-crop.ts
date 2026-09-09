import { clamp, contain, type Rect } from "./layout";

const sides = ["top", "bottom", "left", "right"] as const;
type Side = (typeof sides)[number];
export type ScreenCrop = Record<Side, number>;
const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
const labels: Record<Side, string> = { top: "上", bottom: "下", left: "左", right: "右" };
const emptyCrop = (): ScreenCrop => ({ top: 0, bottom: 0, left: 0, right: 0 });

/** Percentages keep the same crop when the shared window changes resolution. */
export function normalizeCrop(saved: unknown): ScreenCrop {
  const crop = emptyCrop();
  if (!saved || typeof saved !== "object") return crop;
  for (const side of sides) {
    const n = (saved as Record<string, unknown>)[side];
    if (typeof n === "number" && Number.isFinite(n))
      crop[side] = clamp(n, 0, 95 - crop[opposite[side]]);
  }
  return crop;
}

export function cropSource(width: number, height: number, crop: ScreenCrop): Rect {
  return {
    x: width * crop.left / 100,
    y: height * crop.top / 100,
    width: width * (100 - crop.left - crop.right) / 100,
    height: height * (100 - crop.top - crop.bottom) / 100,
  };
}

export function installScreenCrop(anchor: HTMLElement, onChange: () => void) {
  const panel = document.createElement("details");
  panel.id = "screenCrop";
  panel.innerHTML = `<summary>共有画面のトリミング</summary>
    <p>上下左右の不要な部分を切り取ります。背景の録画にも使えます。</p>
    <canvas id="cropPreview" width="560" height="315" hidden aria-label="トリミングする範囲の確認"></canvas>
    <p id="cropPreviewHint">画面共有か背景の録画を選ぶと、範囲を確認できます。</p>
    <div id="cropMargins"></div>
    <button id="cropReset" type="button">トリミングを戻す</button>
    <p>白い枠の内側を表示します。設定は自動で保存されます。</p>`;
  anchor.after(panel);
  const preview = panel.querySelector<HTMLCanvasElement>("#cropPreview")!;
  const ctx = preview.getContext("2d")!;
  const hint = panel.querySelector<HTMLElement>("#cropPreviewHint")!;
  const controls: Record<string, HTMLInputElement[]> = {};
  let crop = emptyCrop();
  function sync(editing?: HTMLInputElement) {
    for (const side of sides) {
      for (const control of controls[side]) {
        control.max = String(95 - crop[opposite[side]]);
        if (control !== editing) control.value = String(crop[side]);
      }
    }
  }
  for (const side of sides) {
    const row = document.createElement("div");
    row.className = "crop-margin";
    row.innerHTML = `<label for="crop-${side}">${labels[side]}</label>
      <input id="crop-${side}-range" type="range" min="0" max="95" step="0.1" value="0" aria-label="${labels[side]}から切り取る割合">
      <input id="crop-${side}" type="number" min="0" max="95" step="0.1" value="0" aria-label="${labels[side]}から切り取る割合（%）"><span>%</span>`;
    const inputs = [...row.querySelectorAll<HTMLInputElement>("input")];
    controls[side] = inputs;
    for (const control of inputs) {
      control.oninput = () => {
        if (!Number.isFinite(control.valueAsNumber)) return;
        crop[side] = Math.round(clamp(control.valueAsNumber, 0, 95 - crop[opposite[side]]) * 10) / 10;
        sync(control.valueAsNumber === crop[side] ? control : undefined);
        onChange();
      };
      control.onchange = () => sync();
    }
    panel.querySelector("#cropMargins")!.append(row);
  }
  panel.querySelector<HTMLButtonElement>("#cropReset")!.onclick = () => {
    crop = emptyCrop(); sync(); onChange();
  };
  return {
    get value() { return { ...crop }; },
    restore(saved: unknown) { crop = normalizeCrop(saved); sync(); },
    source(width: number, height: number) { return cropSource(width, height, crop); },
    preview(video: HTMLVideoElement) {
      if (!panel.open) return;
      const ready = video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
      hint.hidden = ready;
      preview.hidden = !ready;
      if (!ready) return;
      ctx.fillStyle = "#100e16"; ctx.fillRect(0, 0, preview.width, preview.height);
      const full = contain(video.videoWidth, video.videoHeight, { x: 0, y: 0, width: preview.width, height: preview.height });
      ctx.drawImage(video, full.x, full.y, full.width, full.height);
      const source = cropSource(full.width, full.height, crop);
      const x = full.x + source.x, y = full.y + source.y;
      ctx.fillStyle = "#100e16b8";
      ctx.fillRect(full.x, full.y, full.width, source.y);
      ctx.fillRect(full.x, y + source.height, full.width, full.height - source.y - source.height);
      ctx.fillRect(full.x, y, source.x, source.height);
      ctx.fillRect(x + source.width, y, full.width - source.x - source.width, source.height);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, Math.max(1, source.width - 3), Math.max(1, source.height - 3));
    },
  };
}
