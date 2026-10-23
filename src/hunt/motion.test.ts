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
    const s = { map: 'buche_herbst', stand: 0, crossings: [{ id: 'a', at: 5, animals: ['keiler'], gait: 'trot', speed: 4, distance: 30, direction: 'rtl', seed: 1 }] } as unknown as HuntScenario;
    const [a] = scenarioTracks(s, '16x9');
    expect(a.dir).toBe(-1);
    expect(poseAt(a, 4).visible).toBe(false);
    expect(poseAt(a, 7).visible).toBe(true);
    expect(poseAt(a, 7).x).toBeLessThan(a.x0);
    expect(poseAt(a, 60).visible).toBe(false);
  });
});

describe('stands and maps', () => {
  it('crosses the lane at the given distance from any stand, "from the left" as the hunter sees it', async () => {
    const { crossingLine } = await import('./rules');
    const { standView, laneX } = await import('./maps');
    for (const stand of [0, 1, 2] as const) {
      const st = standView('buche_herbst', stand);
      const l = crossingLine('buche_herbst', stand, 40);
      expect(Math.hypot(laneX('buche_herbst', l.y) - st.x, l.y - st.y)).toBeCloseTo(40, 1);
    }
    // stand 3 looks back down the lane: from the left = towards −x
    const back = { map: 'buche_herbst', stand: 2, crossings: [{ id: 'a', at: 0, animals: ['keiler'], gait: 'trot', speed: 4, distance: 30, direction: 'ltr', seed: 1 }] } as unknown as HuntScenario;
    expect(scenarioTracks(back, '16x9')[0].dir).toBe(-1);
  });
});

describe('gait parity with hunt.py gait_pose', () => {
  it('poses a galloping animal exactly as Blender does', () => {
    // reference values computed by hunt.py gait_pose(GAITS['gallop'], 'gallop', 0.95, -20, 20, 40, 8, 1, 1, 0.3, 0.25, 1.1, 2.2, 3.3, 2.37)
    const a = { kind: 'keiler', size: 1, scale: 0.95, gait: 'gallop', t0: 1, x0: -20, x1: 20, y: 40, speed: 8, dir: 1, phase0: 0.3, surge: 0.25, sp: 1.1, wp: 2.2, vp: 3.3 } as const;
    const p = poseAt({ ...a }, 2.37);
    expect(p.x).toBeCloseTo(-9.720557, 5);
    expect(p.y).toBeCloseTo(40.111789, 5);
    expect(p.heading).toBeCloseTo(-0.019656, 5);
    expect(p.body.bob).toBeCloseTo(-0.033459, 5);
    expect(p.body.ry).toBeCloseTo(-0.025972, 5);
    expect(p.neck).toBeCloseTo(0.059897, 5);
    expect(p.legs.FL.up).toBeCloseTo(-0.645176, 5);
    expect(p.legs.FR.lo).toBeCloseTo(1.272204, 5);
    expect(p.legs.HL.up).toBeCloseTo(0.60741, 5);
  });
});
