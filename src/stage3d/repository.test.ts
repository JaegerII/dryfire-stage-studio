import { describe, expect, it } from 'vitest';
import stage001 from '../data/stages/stage_001.json';
import { normalizeStage } from '../utils/stageIO';
import { fromStage2D, normalizeStage3D } from './repository';
import { HALL, parTime3D } from './types';

describe('normalizeStage3D', () => {
  it('fills defaults, keeps one leg per position change and drops unknown objects', () => {
    const s = normalizeStage3D({
      name: 'X',
      positions: [{ x: 1, d: 0 }, { x: 3, d: 4 }, { x: 5, d: 6 }],
      legs: [{ after: 2, duration: 1, reload: true }],
      objects: [{ type: 'paper_full', x: 1, d: 9 }, { type: 'spaceship', x: 0, d: 0 }],
    });
    expect(s.positions.map((p) => p.label)).toEqual(['START', 'P2', 'P3']);
    expect(s.legs).toHaveLength(2);
    expect(s.legs[0]).toMatchObject({ after: 2, duration: 1, reload: true });
    expect(s.legs[1]).toMatchObject({ after: 3, duration: 2.5, reload: false });
    expect(s.objects.map((o) => o.type)).toEqual(['paper_full']);
    expect(parTime3D(s)).toBe(2 + 1 + 3 + 2.5 + 5);
  });

  it('always has a start position', () => {
    expect(normalizeStage3D({}).positions).toHaveLength(1);
  });
});

describe('fromStage2D', () => {
  it('places the 2D objects on the 3D floor, in front of the start position', () => {
    const s3 = fromStage2D(normalizeStage(stage001));
    expect(s3.objects.length).toBe(stage001.objects.length - 1); // the start box becomes the start position
    const start = s3.positions[0];
    expect(start.d).toBeLessThan(2);
    for (const o of s3.objects) {
      expect(o.d).toBeGreaterThan(start.d);
      expect(o.x).toBeGreaterThanOrEqual(HALL.x0);
      expect(o.x).toBeLessThanOrEqual(HALL.x1);
    }
    expect(s3.finalTime).toBe(stage001.parTime);
  });
});
