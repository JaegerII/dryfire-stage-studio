/**
 * Mapping between the performance clock (ms, used for camera frames and the
 * session) and an AudioContext clock (s, used to schedule beeps).
 *
 * getOutputTimestamp() tells which context time is reaching the speaker at
 * which performance time — so it already includes the output latency the
 * browser knows about. Latency added after that (HDMI, TV sound processing,
 * Bluetooth) is invisible to the browser and is NOT included.
 */

export interface AudioClockLike {
  currentTime: number;
  baseLatency?: number;
  outputLatency?: number;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
}

export interface ClockMapping {
  /** Audio time (s) whose sample is heard at performance time 0. */
  audioAtPerfZero: number;
  /** How the mapping was obtained — 'estimate' when the output timestamp is unavailable. */
  source: 'output-timestamp' | 'estimate';
  /** Output latency the browser reports, ms (null = unknown). */
  latencyMs: number | null;
}

export const clockMapping = (ctx: AudioClockLike, perfNow: number): ClockMapping => {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
    const latency = ctx.outputLatency ?? null;
    return { audioAtPerfZero: ts.contextTime - ts.performanceTime / 1000, source: 'output-timestamp', latencyMs: latency === null ? null : latency * 1000 };
  }
  // fallback: currentTime is "now" at the graph; the speaker lags by base + output latency
  const lat = (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0);
  return { audioAtPerfZero: ctx.currentTime - perfNow / 1000 - lat, source: 'estimate', latencyMs: ctx.outputLatency !== undefined ? lat * 1000 : null };
};

/** Audio-context time at which a sound must start to be heard at `perfMs`. */
export const perfToAudio = (m: ClockMapping, perfMs: number) => m.audioAtPerfZero + perfMs / 1000;
export const audioToPerf = (m: ClockMapping, audioS: number) => (audioS - m.audioAtPerfZero) * 1000;
