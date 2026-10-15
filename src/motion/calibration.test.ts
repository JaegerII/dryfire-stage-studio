import { describe, expect, it } from 'vitest';
import { assessQuality } from '../pose/quality';
import { calibrate } from './calibration';
import { toBodyFrame } from './features';
import { PRESENT, REST, hold, makeFrames, sequence, tween } from './testing/syntheticPose';

const bodies = (frames: ReturnType<typeof makeFrames>) => frames.map((f) => toBodyFrame(f, assessQuality(f), 0.5));

describe('calibrate', () => {
  it('accepts a still, well tracked athlete and measures the jitter', () => {
    const r = calibrate(bodies(makeFrames(hold(REST), 0, 3000, { fps: 30, noise: 0.004 })));
    expect(r.ok).toBe(true);
    expect(r.usable).toBe(1);
    expect(r.noiseFloor).toBeGreaterThan(0.01);
    expect(r.noiseFloor).toBeLessThan(0.4);
    expect(r.torsoPx).toBeCloseTo(180, -1);
  });

  it('rejects movement during calibration', () => {
    const r = calibrate(bodies(makeFrames(sequence([0, hold(REST)], [500, tween(REST, PRESENT, 500, 1200)], [1200, hold(PRESENT)]), 0, 3000, { fps: 30 })));
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/movement/);
  });

  it('rejects missing tracking', () => {
    const r = calibrate(bodies(makeFrames((t) => (t % 300 < 100 ? { ...REST, missing: true } : REST), 0, 3000, { fps: 30 })));
    expect(r.ok).toBe(false);
    expect(r.usable).toBeLessThan(0.9);
  });
});
