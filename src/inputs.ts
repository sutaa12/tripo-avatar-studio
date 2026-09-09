export type InputKind = "camera" | "video" | null;
export class Inputs {
  readonly trackingVideo = document.createElement("video");
  readonly screenVideo = document.createElement("video");
  kind: InputKind = null;
  private workers: Worker[] = [];
  get worker() {
    return this.workers[0];
  }
  private initTimeout?: ReturnType<typeof setTimeout>;
  private pending?: {
    time: number;
    mediaTime: number;
    started: number;
    results: Record<string, any>;
    stageMs: Record<string, number>;
  };
  ready = false;
  busy = false;
  generation = 0;
  sequence = 0;
  lastMediaTime = -1;
  camera?: MediaStream;
  screen?: MediaStream;
  private trackingUrl?: string;
  private screenUrl?: string;
  stats = {
    frames: 0,
    lastInferenceMs: 0,
    faceFrames: 0,
    handFrames: 0,
    poseFrames: 0,
    errors: 0,
    delegate: "" as string,
    stageMs: {} as Record<string, number>,
  };
  constructor(
    private onResult: (result: any) => void,
    private onStatus: (text: string) => void,
  ) {
    for (const video of [this.trackingVideo, this.screenVideo]) {
      video.muted = true;
      video.playsInline = true;
    }
  }
  private initWorker() {
    const token = this.generation;
    const ready = new Set<string>();
    const fail = () => {
      if (token !== this.generation) return;
      this.stats.errors++;
      this.stopTracking();
      this.onStatus(
        "解析が停止しました。録画またはカメラを選び直してください。",
      );
    };
    this.initTimeout = setTimeout(fail, 45000);
    for (const channel of ["face", "hand", "pose"]) {
      const worker = new Worker(new URL("tracking/tracker.js", document.baseURI));
      this.workers.push(worker);
      worker.onmessage = ({ data }) => {
        if (token !== this.generation) return;
        if (data.type === "ready") {
          ready.add(channel);
          if (ready.size === 3) {
            clearTimeout(this.initTimeout);
            this.ready = true;
            this.stats.delegate = "CPU-parallel";
            if (this.kind === "video") void this.trackingVideo.play();
            this.onStatus(
              this.kind === "video"
                ? "録画を解析しています。"
                : "カメラを解析しています。",
            );
          }
        } else if (data.type === "result") {
          const batch = this.pending;
          if (!batch || data.time !== batch.time) return;
          batch.results[channel] = data.result;
          batch.stageMs[channel] = data.inferenceMs;
          if (Object.keys(batch.results).length === 3) {
            const packet = {
              type: "result",
              time: batch.time,
              mediaTime: batch.mediaTime,
              inferenceMs: performance.now() - batch.started,
              ...batch.results,
            };
            this.pending = undefined;
            this.busy = false;
            this.stats.frames++;
            this.stats.lastInferenceMs = packet.inferenceMs;
            this.stats.stageMs = batch.stageMs;
            this.stats.faceFrames += batch.results.face.faceLandmarks?.length
              ? 1
              : 0;
            this.stats.handFrames += batch.results.hand.landmarks?.length
              ? 1
              : 0;
            this.stats.poseFrames += batch.results.pose.landmarks?.length
              ? 1
              : 0;
            this.onResult(packet);
          }
        } else if (data.type === "error") {
          console.error(data.message);
          fail();
        }
      };
      worker.onerror = fail;
      worker.postMessage({ type: "init", channel });
    }
  }
  async startCamera() {
    this.stopTracking();
    const token = this.generation;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, frameRate: 30, facingMode: "user" },
        audio: false,
      });
      if (token !== this.generation) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.camera = stream;
      this.kind = "camera";
      this.trackingVideo.srcObject = stream;
      await this.trackingVideo.play();
      if (token !== this.generation) return;
      stream.getVideoTracks()[0].onended = () => this.stopTracking();
      this.initWorker();
      this.onStatus("カメラの解析を準備しています…");
    } catch (error) {
      this.stopTracking();
      throw error;
    }
  }
  async loadTracking(file: File) {
    this.stopTracking();
    const token = this.generation;
    this.kind = "video";
    this.trackingUrl = URL.createObjectURL(file);
    this.trackingVideo.src = this.trackingUrl;
    this.trackingVideo.loop = false;
    this.trackingVideo.onended = () =>
      this.onStatus("録画の再生が終わりました。");
    try {
      await this.trackingVideo.play();
      if (token !== this.generation) return;
      this.trackingVideo.pause();
      this.trackingVideo.currentTime = 0;
      this.initWorker();
      this.onStatus("録画の解析を準備しています…");
    } catch (error) {
      this.stopTracking();
      throw error;
    }
  }
  stopTracking() {
    this.generation++;
    this.camera?.getTracks().forEach((t) => t.stop());
    this.camera = undefined;
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    clearTimeout(this.initTimeout);
    this.pending = undefined;
    this.ready = false;
    this.busy = false;
    this.kind = null;
    this.trackingVideo.pause();
    this.trackingVideo.onended = null;
    this.trackingVideo.srcObject = null;
    this.trackingVideo.removeAttribute("src");
    this.trackingVideo.load();
    if (this.trackingUrl) URL.revokeObjectURL(this.trackingUrl);
    this.trackingUrl = undefined;
    this.lastMediaTime = -1;
  }
  async startScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    this.stopScreen();
    this.screen = stream;
    this.screenVideo.srcObject = stream;
    await this.screenVideo.play();
    stream.getVideoTracks()[0].onended = () => {
      if (this.screen === stream) this.stopScreen();
    };
  }
  async loadScreen(file: File) {
    this.stopScreen();
    this.screenUrl = URL.createObjectURL(file);
    this.screenVideo.src = this.screenUrl;
    this.screenVideo.loop = true;
    try {
      await this.screenVideo.play();
    } catch (error) {
      this.stopScreen();
      throw error;
    }
  }
  stopScreen() {
    this.screen?.getTracks().forEach((t) => t.stop());
    this.screen = undefined;
    this.screenVideo.pause();
    this.screenVideo.srcObject = null;
    this.screenVideo.removeAttribute("src");
    this.screenVideo.load();
    if (this.screenUrl) URL.revokeObjectURL(this.screenUrl);
    this.screenUrl = undefined;
  }
  tick() {
    const video = this.trackingVideo;
    if (this.pending && performance.now() - this.pending.started > 5000) {
      this.stats.errors++;
      this.stopTracking();
      this.onStatus(
        "読み取りが応答しないため停止しました。入力を選び直してください。",
      );
      return;
    }
    if (
      !this.ready ||
      this.busy ||
      video.paused ||
      video.readyState < 2 ||
      video.currentTime === this.lastMediaTime
    )
      return;
    this.busy = true;
    this.lastMediaTime = video.currentTime;
    const token = this.generation;
    this.sequence = Math.max(this.sequence + 1, performance.now());
    const time = this.sequence;
    const mediaTime = video.currentTime;
    void createImageBitmap(video, {
      resizeWidth: 640,
      resizeHeight: Math.round((640 * video.videoHeight) / video.videoWidth),
    })
      .then(async (bitmap) => {
        const copies = await Promise.allSettled([
          createImageBitmap(bitmap),
          createImageBitmap(bitmap),
        ]);
        const bitmaps = [
          bitmap,
          ...copies.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
        ];
        if (bitmaps.length !== 3) {
          bitmaps.forEach((b) => b.close());
          if (token === this.generation) this.busy = false;
          return;
        }
        if (token !== this.generation || this.workers.length !== 3) {
          bitmaps.forEach((b) => b.close());
          return;
        }
        this.pending = {
          time,
          mediaTime,
          started: performance.now(),
          results: {},
          stageMs: {},
        };
        this.workers.forEach((worker, i) =>
          worker.postMessage({ type: "frame", bitmap: bitmaps[i], time }, [
            bitmaps[i],
          ]),
        );
      })
      .catch(() => {
        if (token === this.generation) this.busy = false;
      });
  }
  dispose() {
    this.stopTracking();
    this.stopScreen();
  }
}
