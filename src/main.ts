import "./style.css";
import { Avatar } from "./avatar";
import { Inputs } from "./inputs";
import { contain, moveRect, Rect, clamp } from "./layout";
import { installBlinkControls } from "./blink-controls";
const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `<header><div class="brand">◈ <b>Avatar Studio</b><span>MODEL PREVIEW</span></div><div id="status" role="status">モデルを読み込んでいます…</div></header><main><section class="preview"><div class="toolbar"><span>配信プレビュー <small>1920 × 1080</small></span><button id="clean">出力画面を開く ↗</button></div><div class="canvasWrap"><canvas id="output" width="1920" height="1080" aria-label="配信の合成画面"></canvas><div id="selection"><i></i></div></div><div class="bottom"><span>背景 → 共有画面 → アバター → 文字</span><span id="fps"></span></div><p class="note">映像は端末内で処理します。録画を読み込んで動作を確認できます。</p></section><aside><nav><b>シーンを編集</b><button id="reset">配置を戻す</button></nav><section><h2>入力</h2><div class="buttons"><button id="share">画面を共有</button><button id="camera">カメラを開始</button></div><div class="buttons"><button id="stopShare" disabled>共有を停止</button><button id="stopCamera" disabled>カメラを停止</button></div><label class="file">動作を読み取る録画 <input id="trackingFile" type="file" accept="video/*"></label><label class="file">背景に流す録画 <input id="screenFile" type="file" accept="video/*"></label><div class="buttons"><button id="videoPause">録画を一時停止</button><button id="record">合成を録画</button></div><div id="inputPreview"></div><button id="calibrate">今の姿勢を基準にする</button><p id="trackingStatus"></p><p id="inputStatus">カメラ・共有画面はまだ取得していません。</p></section><section><h2>背景</h2><label>背景色 <input id="background" type="color" value="#eee8f0"></label></section><section><h2>配置</h2><label>編集するもの <select id="layer"><option value="avatar">アバター</option><option value="screen">共有画面</option><option value="text">文字</option></select></label><div id="position"></div><p>ドラッグで移動、右下の点で拡縮できます。配置は自動で保存されます。</p></section><section><h2>文字</h2><label>メッセージ <textarea id="message" rows="2" placeholder="配信タイトルやお知らせ"></textarea></label><label>文字色 <input id="textColor" type="color" value="#422f45"></label><label>文字の大きさ <input id="fontSize" type="range" min="16" max="160" value="52"></label></section><section><h2>アバターの見え方</h2><label>輪郭の太さ <input id="outline" type="range" min=".6" max="3" step=".1" value="1.6"></label><label>髪の光沢 <input id="shine" type="range" min="0" max=".4" step=".01" value=".14"></label><label>上半身を大きく <input id="bust" type="checkbox"></label></section><details><summary>モデルの動作を確認</summary><label>座った姿勢 <input id="seated" type="checkbox" checked></label><button id="demo">大きく動かして確認</button><div id="modelControls"></div><p>手動スライダーで書き出した骨・表情を確認します。全表情の完成版ではありません。</p></details><p class="privacy">映像はこのブラウザ内で処理します。音声の取得・公開配信は行いません。</p></aside></main>`;
const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const canvas = $<HTMLCanvasElement>("#output"),
  ctx = canvas.getContext("2d", { alpha: false })!;
const status = (s: string) => ($("#status").textContent = s);
const avatar = new Avatar();
installBlinkControls(avatar, $("#calibrate"));
const defaults: Record<string, Rect> = {
  screen: { x: 60, y: 65, width: 1360, height: 765 },
  avatar: { x: 1120, y: 160, width: 760, height: 912 },
  text: { x: 90, y: 915, width: 1700, height: 120 },
};
const layers: Record<string, Rect> = structuredClone(defaults);
const cameraAvailable = typeof navigator.mediaDevices?.getUserMedia === "function";
const shareAvailable = typeof navigator.mediaDevices?.getDisplayMedia === "function";
const recordingAvailable = typeof MediaRecorder !== "undefined" && typeof canvas.captureStream === "function";
$<HTMLButtonElement>("#share").disabled = !shareAvailable;
$<HTMLButtonElement>("#record").disabled = !recordingAvailable;
if (!shareAvailable) $("#share").textContent = "画面共有は未対応";
if (!recordingAvailable) $("#record").textContent = "この端末では録画未対応";
const input = new Inputs(
  (p) => {
    avatar.receive(p);
    $("#trackingStatus").textContent = [
      p.face.faceLandmarks.length ? "顔 ○" : "顔 —",
      p.pose.landmarks.length ? "上半身 ○" : "上半身 —",
      p.hand.landmarks.length ? "手 ○" : "手 —",
    ].join("　");
  },
  (s) => ($("#inputStatus").textContent = s),
);
$("#inputPreview").append(input.trackingVideo);
input.trackingVideo.style.cssText =
  "width:100%;max-height:170px;object-fit:contain;border-radius:6px";
let selected = "avatar",
  outputWindow: Window | null = null,
  outputStream: MediaStream | undefined,
  recorder: MediaRecorder | undefined;
const prefIds = ["background", "textColor", "message", "fontSize"];
try {
  const saved = JSON.parse(localStorage.getItem("avatar-layout-v1") ?? "null");
  if (saved) {
    for (const name of Object.keys(layers))
      for (const key of ["x", "y", "width", "height"] as const) {
        const n = saved.layers?.[name]?.[key];
        if (typeof n === "number" && Number.isFinite(n))
          layers[name][key] = clamp(
            n,
            key === "x" || key === "y" ? -2500 : 40,
            4000,
          );
      }
    for (const id of prefIds)
      if (typeof saved[id] === "string")
        $<HTMLInputElement>("#" + id).value = saved[id];
  }
} catch {
  status("保存した配置を読み込めなかったため、初期配置を使います");
}
function save() {
  const preferences: Record<string, unknown> = { layers };
  for (const id of prefIds)
    preferences[id] = $<HTMLInputElement>("#" + id).value;
  try {
    localStorage.setItem("avatar-layout-v1", JSON.stringify(preferences));
  } catch {
    status("このブラウザでは配置を保存できません");
  }
}
for (const id of prefIds) $("#" + id).addEventListener("input", save);
function selection() {
  const r = layers[selected];
  $("#selection").style.cssText =
    `left:${r.x / 19.2}%;top:${r.y / 10.8}%;width:${r.width / 19.2}%;height:${r.height / 10.8}%`;
}
function positions() {
  const r = layers[selected];
  $("#position").innerHTML = ["x", "y", "width", "height"]
    .map(
      (key, i) =>
        `<label>${["横の位置", "縦の位置", "幅", "高さ"][i]}<input aria-label="${["横の位置", "縦の位置", "幅", "高さ"][i]}" data-field="${key}" type="number" min="${i < 2 ? -2500 : 40}" max="4000" value="${Math.round(r[key as keyof Rect])}"></label>`,
    )
    .join("");
  $("#position")
    .querySelectorAll<HTMLInputElement>("input")
    .forEach(
      (el) =>
        (el.oninput = () => {
          if (!Number.isFinite(el.valueAsNumber)) return;
          layers[selected][el.dataset.field as keyof Rect] = clamp(
            el.valueAsNumber,
            Number(el.min),
            4000,
          );
          save();
          selection();
        }),
    );
  selection();
}
positions();
$<HTMLSelectElement>("#layer").onchange = (e) => {
  selected = (e.target as HTMLSelectElement).value;
  positions();
};
$("#reset").onclick = () => {
  Object.assign(layers, structuredClone(defaults));
  save();
  positions();
};
let drag: { x: number; y: number; r: Rect; resize: boolean } | null = null;
const wrap = $(".canvasWrap");
wrap.onpointerdown = (e) => {
  wrap.setPointerCapture(e.pointerId);
  drag = {
    x: e.clientX,
    y: e.clientY,
    r: { ...layers[selected] },
    resize: e.target instanceof HTMLElement && e.target.tagName === "I",
  };
};
wrap.onpointermove = (e) => {
  if (!drag) return;
  const k = 1920 / canvas.getBoundingClientRect().width,
    dx = (e.clientX - drag.x) * k,
    dy = (e.clientY - drag.y) * k;
  if (drag.resize) {
    const width = clamp(drag.r.width + dx, 80, 4000);
    layers[selected] = {
      ...drag.r,
      width,
      height:
        selected === "text"
          ? clamp(drag.r.height + dy, 40, 2000)
          : (width * drag.r.height) / drag.r.width,
    };
  } else layers[selected] = moveRect(drag.r, drag.r.x + dx, drag.r.y + dy);
  positions();
};
wrap.onpointerup = wrap.onpointercancel = () => {
  drag = null;
  save();
};
for (const [key, title, min, max] of [
  ["blinkLeft", "左のまばたき", 0, 1],
  ["blinkRight", "右のまばたき", 0, 1],
  ["jawOpen", "口を開く", 0, 1],
  ["arm", "腕を上げる", 0, 1.4],
  ["fingers", "指を曲げる", 0, 1],
  ["turn", "顔の向き", -0.7, 0.7],
] as const) {
  const label = document.createElement("label");
  label.textContent = title;
  const el = document.createElement("input");
  Object.assign(el, {
    type: "range",
    min: String(min),
    max: String(max),
    step: ".01",
    value: "0",
  });
  el.oninput = () => (avatar.debug[key] = Number(el.value));
  label.append(el);
  $("#modelControls").append(label);
}
$<HTMLInputElement>("#seated").onchange = (e) =>
  (avatar.debug.seated = (e.target as HTMLInputElement).checked);
$("#share").onclick = async () => {
  try {
    await input.startScreen();
    status("選んだ画面を合成しています");
  } catch (e) {
    status(
      e instanceof DOMException && e.name === "NotAllowedError"
        ? "画面共有を開始しませんでした"
        : "画面共有を開始できませんでした",
    );
  }
};
$("#stopShare").onclick = () => {
  input.stopScreen();
  status("背景の映像を停止しました");
};
$("#camera").onclick = async () => {
  avatar.setDemo(false);
  try {
    await input.startCamera();
  } catch {
    status("カメラを開始できませんでした。許可設定を確認してください。");
  }
};
$("#stopCamera").onclick = () => {
  input.stopTracking();
  status("動作の読み取りを停止しました");
};
$<HTMLInputElement>("#trackingFile").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (file)
    try {
      avatar.setDemo(false);
      await input.loadTracking(file);
    } catch {
      status("録画を読み込めませんでした。別の動画形式を選んでください。");
    }
};
$<HTMLInputElement>("#screenFile").onchange = async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (file)
    try {
      await input.loadScreen(file);
      status("録画を背景に再生しています");
    } catch {
      status("背景の録画を読み込めませんでした");
    }
};
$("#videoPause").onclick = () => {
  const v = input.trackingVideo;
  if (input.kind !== "video") return;
  if (v.paused) {
    void v.play();
    $("#videoPause").textContent = "録画を一時停止";
  } else {
    v.pause();
    $("#videoPause").textContent = "録画を再開";
  }
};
$("#clean").onclick = () => {
  outputWindow = window.open(
    "",
    "avatar-output",
    "popup,width=1280,height=720",
  );
  if (!outputWindow) {
    status("出力画面のポップアップを許可してください");
    return;
  }
  outputWindow.document.title = "Avatar Studio — Output";
  outputWindow.document.body.style.cssText =
    "margin:0;background:#000;overflow:hidden";
  outputWindow.document.body.replaceChildren();
  const video = outputWindow.document.createElement("video");
  video.style.cssText = "width:100vw;height:100vh;object-fit:contain";
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  outputStream?.getTracks().forEach((t) => t.stop());
  outputStream = canvas.captureStream(30);
  video.srcObject = outputStream;
  outputWindow.document.body.append(video);
  void video.play();
};
$("#record").onclick = () => {
  if (recorder?.state === "recording") {
    $<HTMLButtonElement>("#record").disabled = true;
    recorder.stop();
    return;
  }
  if (recorder) return;
  let capture: MediaStream | undefined;
  try {
    const stream = (capture = canvas.captureStream(30));
    const mime = [
      "video/mp4;codecs=avc1.640028",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    recorder = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined,
    );
    const activeRecorder = recorder;
    const chunks: Blob[] = [];
    let bytes = 0;
    let interrupted = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size) {
        chunks.push(e.data);
        bytes += e.data.size;
        if (bytes > 256 * 1024 * 1024 && recorder?.state === "recording") {
          recorder.stop();
          status(
            "録画容量の上限に達したため保存します。長時間の録画はOBSをご利用ください。",
          );
        }
      }
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const url = URL.createObjectURL(
        new Blob(chunks, { type: activeRecorder.mimeType }),
      );
      const a = document.createElement("a");
      a.href = url;
      const extension = activeRecorder.mimeType.includes("mp4")
        ? "mp4"
        : "webm";
      a.download = `avatar-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      $("#record").textContent = "合成を録画";
      $<HTMLButtonElement>("#record").disabled = false;
      if (recorder === activeRecorder) recorder = undefined;
      status(
        interrupted
          ? "録画が中断しました。保存された映像を確認してください。"
          : "録画を書き出しました",
      );
    };
    recorder.onerror = () => {
      interrupted = true;
      status("録画が中断しました。保存された映像を確認してください。");
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.start(1000);
    $("#record").textContent = "録画を終了";
  } catch {
    capture?.getTracks().forEach((t) => t.stop());
    recorder = undefined;
    $<HTMLButtonElement>("#record").disabled = false;
    status("録画を開始できませんでした。Chromeで開き直してください。");
  }
};
let last = performance.now(),
  count = 0,
  fpsAt = last;
const metrics = { renderFrames: 0, fps: 0, renderMs: [] as number[] };
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = performance.now();
  avatar.update(dt);
  ctx.fillStyle = $<HTMLInputElement>("#background").value;
  ctx.fillRect(0, 0, 1920, 1080);
  const screen = input.screenVideo;
  if (screen.readyState >= 2) {
    const r = contain(screen.videoWidth, screen.videoHeight, layers.screen);
    ctx.drawImage(screen, r.x, r.y, r.width, r.height);
  }
  if (avatar.vrm) {
    const r = contain(900, 1080, layers.avatar);
    ctx.drawImage(avatar.renderer.domElement, r.x, r.y, r.width, r.height);
  }
  ctx.fillStyle = $<HTMLInputElement>("#textColor").value;
  const size = Number($<HTMLInputElement>("#fontSize").value);
  ctx.font = `600 ${size}px system-ui`;
  ctx.textBaseline = "top";
  $<HTMLTextAreaElement>("#message")
    .value.split("\n")
    .forEach((line, i) => {
      if ((i + 1) * size * 1.3 <= layers.text.height)
        ctx.fillText(
          line,
          layers.text.x,
          layers.text.y + i * size * 1.3,
          layers.text.width,
        );
    });
  input.tick();
  $<HTMLButtonElement>("#stopCamera").disabled = input.kind === null;
  $<HTMLButtonElement>("#camera").disabled = !cameraAvailable || input.kind === "camera";
  $("#demo").textContent = avatar.demoActive ? "動作デモを停止" : "大きく動かして確認";
  $<HTMLButtonElement>("#stopShare").disabled = screen.readyState < 2;
  count++;
  metrics.renderFrames++;
  metrics.renderMs.push(performance.now() - t);
  if (metrics.renderMs.length > 300) metrics.renderMs.shift();
  if (now - fpsAt > 1000) {
    metrics.fps = (count * 1000) / (now - fpsAt);
    $("#fps").textContent = `${Math.round(metrics.fps)} fps`;
    count = 0;
    fpsAt = now;
  }
}
void avatar
  .load()
  .then(() => {
    status("モデルを読み込みました");
    (window as any).__studio = { avatar, layers, canvas, input, metrics };
  })
  .catch((e) => {
    status("モデルを読み込めませんでした");
    console.error(e);
  });
requestAnimationFrame(frame);
window.addEventListener("beforeunload", (event) => {
  if (recorder) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  input.dispose();
  outputStream?.getTracks().forEach((t) => t.stop());
  outputWindow?.close();
});

$<HTMLInputElement>("#outline").oninput = (e) =>
  (avatar.toon.profile.outlinePixels = Number(
    (e.target as HTMLInputElement).value,
  ));
$<HTMLInputElement>("#shine").oninput = (e) =>
  (avatar.toon.profile.hairHighlight = Number(
    (e.target as HTMLInputElement).value,
  ));
$<HTMLInputElement>("#bust").onchange = (e) => {
  const bust = (e.target as HTMLInputElement).checked;
  avatar.camera.position.set(0, bust ? 1.3 : 1.2, bust ? 1.8 : 2.8);
  avatar.camera.lookAt(0, bust ? 1.22 : 1.04, 0);
};

$("#calibrate").onclick = () =>
  status(
    avatar.calibrate()
      ? "現在の顔と上半身の向きを基準にしました"
      : "顔や上半身が映った状態で押してください",
  );

$("#demo").onclick = () => {
  const active = !avatar.demoActive;
  if (active) input.stopTracking();
  avatar.setDemo(active);
  status(active ? "動作デモを再生しています（カメラ不使用）" : "動作デモを停止しました");
};
