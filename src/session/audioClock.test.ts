import { describe, expect, it } from 'vitest';
import { audioToPerf, clockMapping, perfToAudio } from './audioClock';

describe('audio clock mapping', () => {
  it('uses the output timestamp when available', () => {
    // sample of context time 10.0 s is heard at performance time 25 000 ms
    const m = clockMapping({ currentTime: 10.05, outputLatency: 0.04, getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 25000 }) }, 25050);
    expect(m.source).toBe('output-timestamp');
    expect(perfToAudio(m, 26000)).toBeCloseTo(11, 6);
    expect(audioToPerf(m, 11)).toBeCloseTo(26000, 6);
    expect(m.latencyMs).toBeCloseTo(40, 6);
  });

  it('falls back to currentTime minus reported latency', () => {
    const m = clockMapping({ currentTime: 5, baseLatency: 0.01, outputLatency: 0.02 }, 1000);
    expect(m.source).toBe('estimate');
    // to be heard at perf 2000 (1 s from now) the sound starts at 5 + 1 − 0.03
    expect(perfToAudio(m, 2000)).toBeCloseTo(5.97, 6);
  });

  it('ignores an empty output timestamp (context not running yet)', () => {
    const m = clockMapping({ currentTime: 0, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }, 500);
    expect(m.source).toBe('estimate');
    expect(m.latencyMs).toBeNull();
  });
});
