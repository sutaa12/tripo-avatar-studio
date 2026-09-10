import type { Avatar } from './avatar';
import { defaultMouthProfile, validMouthProfile } from './mouth';

export function installMouthControls(avatar: Avatar, anchor: HTMLElement) {
  const panel = document.createElement('details');
  panel.id = 'mouthSettings';
  panel.innerHTML = `<summary>口の開閉の補正</summary>
    <label for="mouthStrength">開きやすさ <output id="mouthStrengthValue">50</output></label>
    <input id="mouthStrength" type="range" min="0" max="100" step="1" value="50" aria-describedby="mouthHelp">
    <p id="mouthHelp">少ししか開かないときは右へ。開きすぎるときは左へ動かしてください。口の横幅は、すぼめる動きに合わせて変わります。</p>
    <div class="buttons"><button id="mouthClosed">閉じた口を記録</button><button id="mouthOpen">開いた口を記録</button></div>
    <p id="mouthStatus" role="status">口を自然に閉じた状態と、無理なく開いた状態を記録して合わせられます。補正はこのブラウザに保存します。</p>
    <button id="mouthReset">口の補正を戻す</button>`;
  anchor.after(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#' + id)!;
  const slider = get<HTMLInputElement>('mouthStrength'), message = get<HTMLElement>('mouthStatus');
  const storageKey = 'avatar-mouth-v1';
  let generation = 0;
  const sync = () => {
    slider.value = String(avatar.mouth.profile.strength);
    get<HTMLOutputElement>('mouthStrengthValue').value = slider.value;
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(avatar.mouth.profile)); }
    catch { message.textContent += ' このブラウザでは補正を保存できません。'; }
  };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (validMouthProfile(saved)) avatar.mouth.profile = saved;
  } catch { /* A blocked or invalid save must not prevent live adjustment. */ }
  sync();
  const busy = (active: boolean) => {
    get<HTMLButtonElement>('mouthClosed').disabled = active;
    get<HTMLButtonElement>('mouthOpen').disabled = active;
    slider.disabled = active;
  };
  slider.oninput = () => {
    avatar.mouth.profile.strength = Number(slider.value); sync();
    message.textContent = '話しながら口の開き方を確認してください。補正はこのブラウザに保存します。'; save();
  };
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function capture(kind: 'closed' | 'open') {
    if (!avatar.mouth.beginCapture(kind, performance.now())) {
      message.textContent = 'カメラや録画に顔が映った状態で押してください。'; return;
    }
    const token = ++generation; busy(true);
    message.textContent = kind === 'closed'
      ? '1秒後に測ります。口を自然に閉じたまま3秒ほど待ってください。'
      : '3秒後に測ります。口を無理なく開いて、そのまま5秒ほど待ってください。';
    await delay(kind === 'open' ? 3000 : 1000);
    if (token !== generation) return;
    message.textContent = kind === 'closed' ? '閉じた口を測っています…' : '開いた口を測っています…';
    await delay(1550);
    if (token !== generation) return;
    const result = avatar.mouth.finishCapture(performance.now()); busy(false);
    if (result.ok) {
      sync(); message.textContent = kind === 'closed'
        ? '閉じた口を記録しました。次に「開いた口を記録」を押してください。'
        : '口の開閉を合わせました。話しながら確認してください。'; save();
    } else message.textContent = result.reason === 'missing'
      ? '顔の読み取りが足りませんでした。顔が映った状態でもう一度記録してください。'
      : result.reason === 'unstable'
        ? '口の開き方が途中で変わりました。同じ状態を保ってもう一度記録してください。'
        : '開いた口と閉じた口の差を読み取れませんでした。閉じた口から記録し直してください。';
  }
  get<HTMLButtonElement>('mouthClosed').onclick = () => void capture('closed');
  get<HTMLButtonElement>('mouthOpen').onclick = () => void capture('open');
  get<HTMLButtonElement>('mouthReset').onclick = () => {
    generation++; avatar.mouth.cancelCapture(); avatar.mouth.profile = defaultMouthProfile(); busy(false); sync();
    message.textContent = '口の補正を初期設定に戻しました。'; save();
  };
  window.addEventListener('pagehide', () => { generation++; avatar.mouth.cancelCapture(); busy(false); });
}
