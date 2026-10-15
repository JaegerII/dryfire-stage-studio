import { describe, expect, it } from 'vitest';
import { ClockSync, estimateOffset, sampleFrom } from './clockSync';

describe('clock sync', () => {
  it('recovers the offset from a symmetric exchange', () => {
    // remote clock = local + 5000; 10 ms each way
    const t0 = 100;
    const t1 = t0 + 10 + 5000;
    const t2 = t0 + 20;
    expect(sampleFrom(t0, t1, t2)).toEqual({ rtt: 20, offset: 5000 });
  });

  it('prefers the fastest round trips over jittery ones', () => {
    const offset = 1234;
    const samples = [
      // fast, symmetric
      { up: 4, down: 4 },
      { up: 5, down: 4 },
      { up: 4, down: 5 },
      // Wi-Fi jitter: one direction delayed a lot
      { up: 80, down: 4 },
      { up: 4, down: 120 },
      { up: 60, down: 5 },
    ].map(({ up, down }, i) => {
      const t0 = i * 1000;
      return sampleFrom(t0, t0 + up + offset, t0 + up + down);
    });
    const est = estimateOffset(samples)!;
    expect(Math.abs(est.offset - offset)).toBeLessThanOrEqual(1);
    expect(est.rtt).toBe(8);
    expect(est.uncertainty).toBeGreaterThanOrEqual(4);
    expect(est.uncertainty).toBeLessThan(6);
  });

  it('returns null without samples and ignores invalid ones', () => {
    expect(estimateOffset([])).toBeNull();
    expect(estimateOffset([{ rtt: -1, offset: 3 }, { rtt: NaN, offset: 1 }])).toBeNull();
  });

  it('keeps a sliding window', () => {
    const c = new ClockSync(3);
    for (let i = 0; i < 10; i++) c.add(i, i + 1 + 50, i + 2);
    expect(c.estimate!.samples).toBe(3);
    expect(c.estimate!.offset).toBe(50);
  });
});
