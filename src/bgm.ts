export class Bgm {
  readonly audio = document.createElement("audio");
  readonly supported = typeof AudioContext !== "undefined";
  volume = .35;
  name = "";
  error = "";
  starting = false;
  private url?: string;
  private context?: AudioContext;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private request = 0;

  constructor(private readonly changed: () => void) {
    this.audio.preload = "metadata";
    this.audio.loop = true;
    for (const event of ["loadedmetadata", "durationchange", "timeupdate", "play", "pause", "ended"])
      this.audio.addEventListener(event, changed);
    this.audio.addEventListener("error", () => {
      if (!this.url) return;
      this.error = "この音楽を読み込めませんでした。別の音楽ファイルを選んでください。";
      changed();
    });
  }

  load(file: File) {
    this.stop();
    if (this.url) URL.revokeObjectURL(this.url);
    this.name = file.name;
    this.error = "";
    this.url = URL.createObjectURL(file);
    this.audio.src = this.url;
    this.audio.load();
    this.changed();
  }

  private async ready() {
    if (!this.context) {
      const context = new AudioContext();
      const source = context.createMediaElementSource(this.audio);
      this.gain = context.createGain();
      this.gain.gain.value = this.volume;
      this.destination = context.createMediaStreamDestination();
      source.connect(this.gain);
      this.gain.connect(context.destination);
      this.gain.connect(this.destination);
      this.context = context;
    }
    await this.context.resume();
    if (this.context.state !== "running")
      throw new Error("音声を開始できませんでした。もう一度再生を押してください。");
  }

  async play() {
    if (!this.url || this.audio.error || !this.supported) return;
    const request = ++this.request;
    this.error = "";
    this.starting = true;
    this.changed();
    try {
      await this.ready();
      if (request !== this.request) return;
      await this.audio.play();
    } catch {
      if (request === this.request)
        this.error = "音楽を再生できませんでした。もう一度再生を押してください。";
    } finally {
      if (request === this.request) this.starting = false;
      this.changed();
    }
  }

  pause() {
    this.request++;
    this.starting = false;
    this.audio.pause();
    this.changed();
  }

  stop() {
    this.pause();
    if (this.audio.readyState > 0) this.audio.currentTime = 0;
    this.changed();
  }

  setVolume(value: number) {
    this.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : .35;
    if (this.context && this.gain) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setTargetAtTime(this.volume, this.context.currentTime, .015);
    }
    this.changed();
  }

  async recordingTrack() {
    if (!this.supported) return undefined;
    await this.ready();
    // Keep one source alive so changing songs cannot change a recorder's track set.
    // Consumers stop their own clone; finishing a recording must not stop the BGM.
    return this.destination!.stream.getAudioTracks()[0].clone();
  }

  dispose() {
    this.stop();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = undefined;
    this.destination?.stream.getTracks().forEach(track => track.stop());
    void this.context?.close();
  }
}

const time = (seconds: number) => {
  const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

export function installBgmControls(after: HTMLElement) {
  const panel = document.createElement("section");
  panel.id = "bgmControls";
  panel.innerHTML = `<h2>BGM</h2>
    <button id="bgmChoose">音楽ファイルを選ぶ</button>
    <input id="bgmFile" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac" hidden>
    <p id="bgmName">音楽ファイルを選んでください</p>
    <div class="buttons"><button id="bgmPlay" disabled>再生</button><button id="bgmStop" disabled>停止</button></div>
    <input id="bgmSeek" aria-label="BGMの再生位置" type="range" min="0" max="1" step=".01" value="0" disabled>
    <div id="bgmTime">0:00 / 0:00</div>
    <label class="bgm-volume">音量 <input id="bgmVolume" type="range" min="0" max="100" step="1" value="35"><output id="bgmVolumeValue" for="bgmVolume">35%</output></label>
    <label>ループ再生 <input id="bgmLoop" type="checkbox" checked></label>
    <p id="bgmStatus" role="status">再生中のBGMは、合成の録画にも入ります。</p>`;
  after.after(panel);
  const get = <T extends HTMLElement>(id: string) => panel.querySelector<T>("#" + id)!;
  const play = get<HTMLButtonElement>("bgmPlay");
  const stop = get<HTMLButtonElement>("bgmStop");
  const seek = get<HTMLInputElement>("bgmSeek");
  const volume = get<HTMLInputElement>("bgmVolume");
  const loop = get<HTMLInputElement>("bgmLoop");
  let preferenceWarning = "";
  function refresh() {
    const audio = bgm.audio;
    const ready = audio.readyState > 0 && !audio.error;
    play.disabled = !bgm.supported || !ready || bgm.starting;
    stop.disabled = !ready;
    play.textContent = audio.paused ? "再生" : "一時停止";
    seek.disabled = !ready || !Number.isFinite(audio.duration);
    seek.max = String(Number.isFinite(audio.duration) ? audio.duration : 1);
    seek.value = String(audio.currentTime);
    get("bgmTime").textContent = `${time(audio.currentTime)} / ${time(audio.duration)}`;
    get("bgmName").textContent = bgm.name || "音楽ファイルを選んでください";
    get("bgmVolumeValue").textContent = `${Math.round(bgm.volume * 100)}%`;
    get("bgmStatus").textContent = !bgm.supported
      ? "このブラウザではBGMを使えません。別のブラウザで開いてください。"
      : bgm.error || preferenceWarning || (bgm.starting ? "再生を準備しています…"
        : audio.ended ? "再生が終わりました。再生を押すと先頭から流れます。"
        : "再生中のBGMは、合成の録画にも入ります。");
  }
  const bgm = new Bgm(refresh);
  try {
    const saved = JSON.parse(localStorage.getItem("avatar-bgm-v1") ?? "null");
    if (typeof saved?.volume === "number") bgm.volume = Math.min(1, Math.max(0, saved.volume));
    if (typeof saved?.loop === "boolean") bgm.audio.loop = saved.loop;
  } catch {
    preferenceWarning = "保存したBGM設定を読み込めなかったため、初期設定を使います。";
  }
  volume.value = String(Math.round(bgm.volume * 100));
  loop.checked = bgm.audio.loop;
  bgm.setVolume(bgm.volume);
  const save = () => {
    try {
      localStorage.setItem("avatar-bgm-v1", JSON.stringify({volume: bgm.volume, loop: bgm.audio.loop}));
      preferenceWarning = "";
    } catch {
      preferenceWarning = "BGM設定を保存できません。この画面ではそのまま使えます。";
    }
    refresh();
  };
  get<HTMLButtonElement>("bgmChoose").onclick = () => get<HTMLInputElement>("bgmFile").click();
  get<HTMLInputElement>("bgmFile").onchange = event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) bgm.load(file);
  };
  play.onclick = () => bgm.audio.paused ? void bgm.play() : bgm.pause();
  stop.onclick = () => bgm.stop();
  seek.oninput = () => {
    if (Number.isFinite(bgm.audio.duration))
      bgm.audio.currentTime = Math.max(0, Math.min(bgm.audio.duration, seek.valueAsNumber));
  };
  volume.oninput = () => { bgm.setVolume(volume.valueAsNumber / 100); save(); };
  loop.onchange = () => { bgm.audio.loop = loop.checked; save(); };
  return bgm;
}
