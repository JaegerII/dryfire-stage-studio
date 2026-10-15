import { describe, expect, it } from 'vitest';
import stage001 from '../data/stages/stage_001.json';
import stage101 from '../data/stages/stage_101.json';
import stage203 from '../data/stages/stage_203.json';
import { normalizeStage } from '../utils/stageIO';
import { FROM_2D_SUFFIX, fromStage2D, normalizeStage3D, stage3dRepository } from './repository';
import { ENV3D, parTime3D } from './types';

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

describe('built-in 3D stages', () => {
  it('include every built-in 2D stage, with a fixed id', () => {
    const all2d = Object.keys(import.meta.glob('../data/stages/*.json')).map((p) => p.match(/(\w+)\.json$/)![1]);
    const ids = stage3dRepository.list().map((s) => s.id);
    for (const id of all2d) expect(ids).toContain(`${id}${FROM_2D_SUFFIX}`);
    const s = stage3dRepository.get(`stage_203${FROM_2D_SUFFIX}`)!;
    expect(s.environment).toBe('indoor_03');
    expect(s.positions[0].id).toBe(`stage_203${FROM_2D_SUFFIX}_start`);
    // same conversion twice → same stage
    expect(stage3dRepository.get(`stage_203${FROM_2D_SUFFIX}`)).toEqual(s);
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
      expect(o.x).toBeGreaterThanOrEqual(ENV3D.indoor_01.x0);
      expect(o.x).toBeLessThanOrEqual(ENV3D.indoor_01.x1);
    }
    expect(s3.finalTime).toBe(stage001.parTime);
  });

  it('keeps the environment, motion and activators 1:1', () => {
    const s2 = normalizeStage(stage203);
    const s3 = fromStage2D(s2);
    expect(s3.environment).toBe('indoor_03');
    const room = ENV3D.indoor_03;
    for (const o of s3.objects) expect(o.x).toBeGreaterThanOrEqual(room.x0);
    const popper = s3.objects.find((o) => o.motion?.kind === 'fall')!;
    const appear = s3.objects.find((o) => o.motion?.kind === 'appear')!;
    expect(appear.motion!.trigger).toBe(popper.id);
  });

  it('turns walls the same way as the 2D picture (2D yaw = counter-clockwise from above)', () => {
    const s3 = fromStage2D(normalizeStage(stage101));
    const wall = s3.objects.find((o) => o.type === 'mesh_wall_diagonal')!;
    expect(wall.yaw).toBe(35);
    // outdoor ranges are not in 3D yet: the hall stands in
    expect(s3.environment).toBe('indoor_01');
  });
});
