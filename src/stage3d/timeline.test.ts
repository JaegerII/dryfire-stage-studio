import { describe, expect, it } from 'vitest';
import proto from './stages/proto_01.json';
import { EYE_HEIGHT, alongPath, briefingPose, buildVideoTimeline, frameAt, povPose, segmentAt, shooterAt } from './timeline';
import { type Stage3D, parTime3D } from './types';

const stage = proto as Stage3D;
const tl = buildVideoTimeline(stage, { seed: 'test', voiceLead: 0.85 });

describe('3D stage timing', () => {
  it('par = time at the positions + moves', () => {
    expect(parTime3D(stage)).toBe(4 + 3 + 5);
    expect(tl.asStage.parTime).toBe(12);
  });

  it('orders the video: briefing → fly-in → reps → outro', () => {
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
