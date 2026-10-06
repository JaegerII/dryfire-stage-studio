/**
 * Pausable clock on the audio clock (AudioContext.currentTime), so what you see and the
 * signals you hear can never drift apart.
 */
export class Timer {
  private startedAt = 0; // audio time at which elapsed was 0 (while running)
  private pausedElapsed = 0;
  running = false;

  constructor(private readonly clock: () => number) {}

  /** Seconds since start (frozen while paused). */
  get elapsed() {
    return this.running ? this.clock() - this.startedAt : this.pausedElapsed;
  }

  start(from = 0) {
    this.startedAt = this.clock() - from;
    this.running = true;
  }

  pause() {
    if (!this.running) return;
    this.pausedElapsed = this.elapsed;
    this.running = false;
  }

  resume() {
    if (this.running) return;
    this.start(this.pausedElapsed);
  }

  reset() {
    this.running = false;
    this.pausedElapsed = 0;
  }
}
