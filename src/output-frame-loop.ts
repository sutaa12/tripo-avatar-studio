/** Keep one render loop on a visible window when the editor is in a background tab. */
export class OutputFrameLoop {
  private output: Window | null = null;
  private pending: { host: Window; id: number } | null = null;
  private running = false;

  constructor(
    private readonly editor: Window,
    private readonly render: (now: number) => void,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.editor.document.addEventListener("visibilitychange", this.schedule);
    this.schedule();
  }

  setOutput(output: Window | null) {
    this.output?.document?.removeEventListener("visibilitychange", this.schedule);
    this.output?.removeEventListener("pagehide", this.outputClosed);
    this.output = output;
    output?.document.addEventListener("visibilitychange", this.schedule);
    output?.addEventListener("pagehide", this.outputClosed);
    this.schedule();
  }

  stop() {
    this.running = false;
    this.cancel();
    this.editor.document.removeEventListener("visibilitychange", this.schedule);
    this.setOutput(null);
  }

  private readonly outputClosed = () => this.setOutput(null);

  private cancel() {
    if (this.pending) {
      this.pending.host.cancelAnimationFrame(this.pending.id);
      this.pending = null;
    }
  }

  private readonly schedule = () => {
    if (!this.running) return;
    const host = this.editor.document.visibilityState === "hidden" &&
      this.output && !this.output.closed &&
      this.output.document.visibilityState === "visible"
      ? this.output : this.editor;
    if (this.pending?.host === host) return;
    this.cancel();
    this.pending = { host, id: host.requestAnimationFrame(this.tick) };
  };

  private readonly tick = () => {
    this.pending = null;
    if (!this.running) return;
    try {
      // Keep one time origin across window switches so animation and smoothing stay continuous.
      this.render(this.editor.performance.now());
    } finally {
      this.schedule();
    }
  };
}
