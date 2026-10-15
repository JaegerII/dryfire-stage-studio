import { describe, expect, it } from 'vitest';
import { FrameStats } from './frameLoop';

describe('FrameStats', () => {
  it('measures fps, interval and dropped frames', () => {
    const s = new FrameStats(1000);
    let presented = 0;
    for (let i = 0; i < 60; i++) {
      presented += i === 30 ? 3 : 1; // two frames lost once
      s.add(i * (1000 / 30), 12, presented);
    }
    expect(s.fps).toBeCloseTo(30, 0);
    expect(s.frameIntervalMs).toBeCloseTo(33.3, 0);
    expect(s.dropped).toBe(2);
    expect(s.inferenceMs).toBe(12);
    expect(s.processed).toBe(60);
  });

  it('is zero before two frames', () => {
    const s = new FrameStats();
    expect(s.fps).toBe(0);
    s.add(0, 5);
    expect(s.fps).toBe(0);
  });
});
