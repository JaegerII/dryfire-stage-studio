import { describe, expect, it } from 'vitest';
import { stage3dRepository } from './repository';
import { applyBodyOffset, bodyFrame, smoothingAlpha } from './bodyCam';
import { povPose, standing } from './timeline';

const ZERO = { dx: 0, dz: 0, dy: 0, yaw: 0 };

describe('body camera on the stage view', () => {
  it('zero offset = the stage view; right moves along the heading', () => {
    const base = povPose(standing({ x: 0, d: 0, heading: 0 }), 0, 0);
    expect(applyBodyOffset(base, ZERO, 0)).toEqual(base);
    const r = applyBodyOffset(base, { dx: 0.5, dz: 0, dy: 0, yaw: 10 }, 0);
    expect(r.x).toBeCloseTo(base.x + 0.5);
    expect(r.yaw).toBeCloseTo(base.yaw + 10);
    // heading 90° (looking along +x): the shooter's right is −z in three.js (towards the viewer's back)
    const q = applyBodyOffset(base, { dx: 0.5, dz: 0, dy: 0, yaw: 0 }, 90);
    expect(q.x).toBeCloseTo(base.x, 5);
    expect(q.z).toBeCloseTo(base.z + 0.5, 5);
    // forward at heading 0 is −z
    expect(applyBodyOffset(base, { dx: 0, dz: 0.3, dy: 0, yaw: 0 }, 0).z).toBeCloseTo(base.z - 0.3);
    expect(applyBodyOffset(base, { dx: 0, dz: 0, dy: -0.2, yaw: 0 }, 0).y).toBeCloseTo(base.y - 0.2);
  });
  it('works on every built-in stage and every position', () => {
    const all = stage3dRepository.list().map((x) => stage3dRepository.get(x.id)!);
    expect(all.length).toBeGreaterThan(5);
    for (const s of all) {
      for (let i = 0; i < s.positions.length; i++) {
        const f = bodyFrame(s, i, { dx: 0.4, dz: 0.1, dy: -0.1, yaw: 12 });
        expect(Number.isFinite(f.camera.x + f.camera.y + f.camera.z + f.camera.yaw)).toBe(true);
      }
    }
    expect(stage3dRepository.get('stage_101')).toBeTruthy();
    expect(all.some((s) => s.positions.length > 2)).toBe(true);
  });
  it('out-of-range position index falls back safely', () => {
    const s = stage3dRepository.get(stage3dRepository.list()[0].id)!;
    expect(() => bodyFrame(s, 99, { dx: 0, dz: 0, dy: 0, yaw: 0 })).not.toThrow();
    expect(() => bodyFrame(s, -3, { dx: 0, dz: 0, dy: 0, yaw: 0 })).not.toThrow();
  });
  it('smoothing alpha: 0 at dt 0, → 1 for a long dt, 1 without smoothing', () => {
    expect(smoothingAlpha(0, 0.05)).toBe(0);
    expect(smoothingAlpha(10, 0.05)).toBeCloseTo(1);
    expect(smoothingAlpha(0.016, 0)).toBe(1);
  });
});
