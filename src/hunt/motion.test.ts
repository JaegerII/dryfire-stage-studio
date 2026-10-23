import { describe, expect, it } from 'vitest';
import { mulberry, poseAt, rotteLayout, scenarioTracks } from './motion';
import type { HuntScenario } from './types';

describe('driven hunt motion (mirrors hunt.py)', () => {
  it('draws the same numbers as the Python mulberry32', () => {
    const r = mulberry(5);
    expect([r.random(), r.random(), r.random(), r.random()].map((v) => +v.toFixed(10))).toEqual([0.6897749109, 0.7727432733, 0.2197630103, 0.6231788222]);
    const q = mulberry(123456);
    expect([q.random(), q.random(), q.random()].map((v) => +v.toFixed(10))).toEqual([0.3823330435, 0.7972629075, 0.9965302374]);
  });

  it('puts the sow in front of the sounder, young before yearlings', () => {
    const l = rotteLayout(['ueberlaeufer', 'frischling', 'bache', 'frischling'], mulberry(3));
    expect(l.map((a) => a.kind)).toEqual(['bache', 'frischling', 'frischling', 'ueberlaeufer']);
    expect(l[0].back).toBe(0);
    expect(l[3].back).toBeGreaterThan(l[1].back);
  });

  it('parks animals before their start and after they have crossed', () => {
    const s = { crossings: [{ id: 'a', at: 5, animals: ['keiler'], gait: 'trot', speed: 4, distance: 30, direction: 'rtl', seed: 1 }] } as unknown as HuntScenario;
    const [a] = scenarioTracks(s, '16x9');
    expect(a.dir).toBe(-1);
    expect(poseAt(a, 4).visible).toBe(false);
    expect(poseAt(a, 7).visible).toBe(true);
    expect(poseAt(a, 7).x).toBeLessThan(a.x0);
    expect(poseAt(a, 60).visible).toBe(false);
  });
});
