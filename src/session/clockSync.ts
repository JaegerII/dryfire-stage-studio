/**
 * Clock synchronisation between two devices (NTP-style).
 *
 * The TV sends `ping {t0}` (its clock), the phone answers `pong {t0, t1}` (t1 =
 * phone clock when it answered), the TV receives it at t2 (its clock):
 *
 *   rtt    = t2 − t0
 *   offset = t1 − (t0 + t2) / 2        (phone clock − TV clock)
 *
 * The estimate assumes a symmetric path; the error is at most rtt / 2. Wi-Fi
 * jitter is one-sided (packets are delayed, never early), so the samples with
 * the smallest round trip are the most trustworthy.
 */

export interface ClockSample {
  rtt: number;
  offset: number;
}

export interface ClockEstimate {
  /** remote clock − local clock, ms. */
  offset: number;
  /** Worst-case error of `offset` under the symmetric-path assumption, ms. */
  uncertainty: number;
  /** Smallest round trip seen, ms. */
  rtt: number;
  samples: number;
}

export const sampleFrom = (t0: number, t1: number, t2: number): ClockSample => ({ rtt: t2 - t0, offset: t1 - (t0 + t2) / 2 });

/** Median offset of the fastest quarter of the samples (at least 3 when available). */
export const estimateOffset = (samples: ClockSample[]): ClockEstimate | null => {
  const valid = samples.filter((s) => Number.isFinite(s.rtt) && s.rtt >= 0 && Number.isFinite(s.offset));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a.rtt - b.rtt);
  const best = sorted.slice(0, Math.max(Math.min(3, sorted.length), Math.ceil(sorted.length / 4)));
  const offsets = best.map((s) => s.offset).sort((a, b) => a - b);
  const mid = offsets.length >> 1;
  const offset = offsets.length % 2 ? offsets[mid] : (offsets[mid - 1] + offsets[mid]) / 2;
  const rtt = sorted[0].rtt;
  // half the best round trip bounds the path asymmetry; the spread of the kept offsets adds jitter
  const spread = offsets[offsets.length - 1] - offsets[0];
  return { offset, uncertainty: rtt / 2 + spread / 2, rtt, samples: valid.length };
};

/** Keeps the latest N samples (clock drift makes old samples stale). */
export class ClockSync {
  private samples: ClockSample[] = [];
  constructor(private readonly window = 24) {}

  add(t0: number, t1: number, t2: number) {
    this.samples.push(sampleFrom(t0, t1, t2));
    if (this.samples.length > this.window) this.samples.shift();
  }

  get estimate() {
    return estimateOffset(this.samples);
  }

  reset() {
    this.samples = [];
  }
}
