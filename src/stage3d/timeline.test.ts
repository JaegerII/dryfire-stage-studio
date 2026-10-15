import { describe, expect, it } from 'vitest';
import proto from './stages/proto_01.json';
import { EYE_HEIGHT, alongPath, briefingPose, buildVideoTimeline, frameAt, moveProfile, povPose, segmentAt, shooterAt, smoothPath } from './timeline';
import { type Stage3D, parTime3D } from './types';

const stage = proto as Stage3D;
const tl = buildVideoTimeline(stage, { seed: 'test', voiceLead: 0.85 });

describe('3D stage timing', () => {
  it('par = time at the positions + moves', () => {
    expect(parTime3D(stage)).toBe(4 + 3 + 5);
    expect(tl.asStage.parTime).toBe(12);
  });

  it('orders the video: briefing â†’ fly-in â†’ reps â†’ outro', () => {
    expect(segmentAt(tl, 0)).toBe('briefing');
    expect(segmentAt(tl, tl.briefingEnd + 0.1)).toBe('flyin');
    expect(segmentAt(tl, tl.flyInEnd + 0.1)).toBe('stage');
    expect(segmentAt(tl, tl.end - 0.1)).toBe('outro');
    expect(tl.schedule.reps).toHaveLength(3);
  });
});

describe('shooter path', () => {
  it('stands, walks the leg (through the corner point), arrives', () => {
    expect(shooterAt(stage, 1)).toMatchObject({ x: -3.2, d: 0, leg: -1 });
    const mid = shooterAt(stage, 5.5);
    expect(mid.leg).toBe(0);
    expect(mid.reloading).toBe(true);
    expect(mid.speed).toBeGreaterThan(0.9);
    expect(shooterAt(stage, 7.01)).toMatchObject({ x: 2.8, d: 3.4, heading: 2, leg: -1 });
    expect(shooterAt(stage, 99)).toMatchObject({ x: 2.8, d: 3.4 });
  });

  it('walks a polyline by length', () => {
    const pts = [{ x: 0, d: 0 }, { x: 3, d: 0 }, { x: 3, d: 1 }];
    expect(alongPath(pts, 0.5)).toEqual({ x: 2, d: 0 });
    expect(alongPath(pts, 1)).toEqual({ x: 3, d: 1 });
  });
});

describe('movement feel', () => {
  it('smooths corners but keeps start and end', () => {
    const pts = smoothPath([{ x: 0, d: 0 }, { x: 2, d: 0 }, { x: 2, d: 2 }]);
    expect(pts[0]).toEqual({ x: 0, d: 0 });
    expect(pts.at(-1)!.x).toBeCloseTo(2, 6);
    expect(pts.at(-1)!.d).toBeCloseTo(2, 6);
    expect(pts.length).toBeGreaterThan(20);
    // no point jumps: even sampling, no spikes at the corner
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i].x - pts[i - 1].x, pts[i].d - pts[i - 1].d)).toBeLessThan(0.12);
  });

  it('starts briskly and glides into the box (longer braking than acceleration)', () => {
    const at = (t: number) => moveProfile(t);
    expect(at(0).u).toBe(0);
    expect(at(1).u).toBeCloseTo(1, 6);
    expect(at(0).v).toBe(0);
    expect(at(1).v).toBe(0);
    for (let t = 0.01; t <= 1; t += 0.01) expect(at(t).u).toBeGreaterThanOrEqual(at(t - 0.01).u);
    // at 25 % of the time the start ramp is nearly done; at 75 % the shooter is already braking
    expect(at(0.25).v).toBeGreaterThan(0.95);
    expect(at(0.75).v).toBeLessThan(0.9);
    expect(at(0.15).a).toBeGreaterThan(0);
    expect(at(0.85).a).toBeLessThan(0);
  });

  it('bobs only while moving', () => {
    const still = povPose(shooterAt(stage, 1), 0);
    expect(still.y).toBe(EYE_HEIGHT);
    expect(still.roll).toBe(0);
    const ys = Array.from({ length: 40 }, (_, k) => povPose(shooterAt(stage, 4.6 + k * 0.03), 0).y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.03);
  });
});

describe('camera', () => {
  it('starts high above the stage and ends the fly-in in the eyes at the start', () => {
    const top = briefingPose(stage, 3);
    expect(top.y).toBeGreaterThan(8);
    expect(top.pitch).toBeLessThan(-45);
    const before = frameAt(stage, tl, tl.flyInEnd - 1e-6).camera;
    const after = frameAt(stage, tl, tl.flyInEnd + 1e-6).camera;
    expect(before.x).toBeCloseTo(after.x, 3);
    expect(before.y).toBeCloseTo(after.y, 2);
    expect(before.z).toBeCloseTo(after.z, 3);
    expect(after.y).toBeCloseTo(EYE_HEIGHT, 1);
    expect(after.z).toBeCloseTo(-0, 3);
  });

  it('draws the arrows during the briefing', () => {
    expect(frameAt(stage, tl, 0.5).arrows).toEqual([0]);
    expect(frameAt(stage, tl, tl.briefingEnd - 0.1).arrows).toEqual([1]);
  });

  it('moves the camera along the path during a rep and fades for the walk back', () => {
    const rep = tl.schedule.reps[0];
    const beep = tl.flyInEnd + rep.startBeep;
    expect(frameAt(stage, tl, beep + 1).camera.x).toBeCloseTo(povPose(shooterAt(stage, 1), beep + 1).x, 6);
    expect(frameAt(stage, tl, beep + 9).camera.x).toBeCloseTo(2.8, 1);
    // one second after the end beep: black, then back at the start
    expect(frameAt(stage, tl, beep + 12 + 1 - 1e-3).camera.fade).toBeGreaterThan(0.95);
    expect(frameAt(stage, tl, beep + 12 + 1.05).camera.x).toBeCloseTo(-3.2, 1);
    expect(frameAt(stage, tl, beep + 12 + 2).camera.fade).toBe(0);
  });
});
