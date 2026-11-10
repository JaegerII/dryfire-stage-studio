/**
 * One-Euro filter (Casiez et al. 2012): low cutoff at rest (kills jitter), the
 * cutoff rises with speed (little lag while moving). Time-based, so it works at
 * any (and varying) frame rate. Pure, no browser dependencies.
 */
export interface OneEuroParams {
  /** Hz — smoothing at rest. Lower = calmer, more lag at slow speed. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast movement. */
  beta: number;
  /** Hz — cutoff of the speed estimate. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.2, beta: 0.6, dCutoff: 1.0 };

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(public params: OneEuroParams = DEFAULT_ONE_EURO) {}

  /** `t` in seconds, strictly increasing. */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, t - this.t);
    this.t = t;
    const raw = (value - this.x) / dt;
    this.dx += alpha(this.params.dCutoff, dt) * (raw - this.dx);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  get value() {
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}
