import type { Avatar } from "./avatar";
import { defaultBlinkProfile, validBlinkProfile } from "./blink";

export function installBlinkControls(avatar: Avatar, anchor: HTMLElement) {
  const panel = document.createElement("details");
  panel.id = "blinkSettings";
  panel.innerHTML = `<summary>まばたきの補正</summary>
    <label for="blinkStrength">閉じやすさ <output id="blinkStrengthValue">50</output></label>
    <input id="blinkStrength" type="range" min="0" max="100" step="1" value="50" aria-describedby="blinkHelp">
    <p id="blinkHelp">薄目が残るときは右へ。開いた目まで閉じるときは左へ動かしてください。</p>
    <div class="buttons"><button id="blinkOpen">開いた目を記録</button><button id="blinkClosed">閉じた目を記録</button></div>
    <p id="blinkStatus" role="status">カメラを開始して、開いた目→閉じた目の順に記録すると、左右の目に合わせられます。</p>
    <button id="blinkReset">まばたきの補正を戻す</button>`;
  anchor.after(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>("#" + id)!;
  const slider = get<HTMLInputElement>("blinkStrength");
  const message = get<HTMLElement>("blinkStatus");
  const storageKey = "avatar-blink-v1";
  let generation = 0;
  const sync = () => {
    slider.value = String(avatar.blink.profile.strength);
    get<HTMLOutputElement>("blinkStrengthValue").value = slider.value;
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(avatar.blink.profile)); }
    catch { message.textContent += " このブラウザでは補正を保存できません。"; }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (validBlinkProfile(saved)) avatar.blink.profile = saved;
  } catch { /* Keep the usable default if browser storage is unavailable. */ }
  sync();
  const busy = (active: boolean) => {
    get<HTMLButtonElement>("blinkOpen").disabled = active;
    get<HTMLButtonElement>("blinkClosed").disabled = active;
    slider.disabled = active;
  };
  slider.oninput = () => {
    avatar.blink.profile.strength = Number(slider.value);
    sync();
    message.textContent = "まばたきをして、開いた目と閉じた目を確認してください。補正はこのブラウザに保存します。";
    save();
  };
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function capture(kind: "open" | "closed") {
    if (!avatar.blink.beginCapture(kind, performance.now())) {
      message.textContent = "カメラや録画に顔が映った状態で押してください。";
      return;
    }
    const token = ++generation;
    busy(true);
    message.textContent = kind === "closed"
      ? "3秒後に測ります。目を閉じて、そのまま5秒ほど待ってください。"
      : "1秒後に測ります。目を自然に開いたまま3秒ほど待ってください。";
    await delay(kind === "closed" ? 3000 : 1000);
    if (token !== generation) return;
    message.textContent = kind === "closed" ? "閉じた目を測っています…" : "開いた目を測っています…";
    await delay(1550);
    if (token !== generation) return;
    const result = avatar.blink.finishCapture(performance.now());
    busy(false);
    if (result.ok) {
      sync();
      message.textContent = kind === "closed"
        ? "左右の閉眼を合わせました。目を開けて、まばたきを確認してください。"
        : "開いた目を記録しました。次に「閉じた目を記録」を押してください。";
      save();
    } else message.textContent = result.reason === "missing"
      ? "顔の読み取りが足りませんでした。顔が映った状態でもう一度記録してください。"
      : result.reason === "unstable"
        ? "目の開き方が途中で変わりました。同じ状態を保ってもう一度記録してください。"
        : "開いた目と閉じた目の差を読み取れませんでした。開いた目から記録し直してください。";
  }
  get<HTMLButtonElement>("blinkOpen").onclick = () => void capture("open");
  get<HTMLButtonElement>("blinkClosed").onclick = () => void capture("closed");
  get<HTMLButtonElement>("blinkReset").onclick = () => {
    generation++;
    avatar.blink.cancelCapture();
    avatar.blink.profile = defaultBlinkProfile();
    busy(false); sync();
    message.textContent = "まばたきの補正を初期設定に戻しました。";
    save();
  };
  window.addEventListener("pagehide", () => { generation++; avatar.blink.cancelCapture(); });
}
