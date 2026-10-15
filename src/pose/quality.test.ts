import { describe, expect, it } from 'vitest';
import { PRESENT, REST, hold, makeFrames } from '../motion/testing/syntheticPose';
import { LM } from './landmarks';
import { assessQuality } from './quality';

const one = (o: Parameters<typeof makeFrames>[3] = { fps: 30 }) => makeFrames(hold(REST), 0, 0, o)[0];

describe('assessQuality', () => {
  it('rates a fully visible athlete as good', () => {
    const q = assessQuality(one(), { luma: 120, fps: 30 });
    expect(q.level).toBe('good');
    expect(q.issues).toEqual([]);
    expect(q.torsoFraction).toBeCloseTo(0.25, 2);
  });

  it('reports no person', () => {
    const f = { ...one(), points: null };
    expect(assessQuality(f).level).toBe('none');
    expect(assessQuality(f).issues).toContain('no_person');
  });

  it('flags occluded wrists as blocking', () => {
    const f = one();
    f.points![LM.leftWrist].visibility = 0.1;
    f.points![LM.rightWrist].visibility = 0.2;
    const q = assessQuality(f);
    expect(q.issues).toContain('occluded_wrists');
    expect(q.level).not.toBe('good');
    expect(q.level).not.toBe('partial');
  });

  it('flags a hidden head only as partial (not needed for the draw analysis)', () => {
    const f = makeFrames(hold(PRESENT), 0, 0, { fps: 30 })[0];
    for (const i of [LM.nose, LM.leftEye, LM.rightEye]) f.points![i].visibility = 0.2;
    expect(assessQuality(f).level).toBe('partial');
  });

  it('flags a small athlete, darkness and low fps', () => {
    const q = assessQuality(one({ fps: 30, scale: 0.3 }), { luma: 20, fps: 9 });
    expect(q.issues).toEqual(expect.arrayContaining(['too_small', 'too_dark', 'low_fps']));
  });

  it('flags body parts outside the frame', () => {
    const f = one();
    f.points![LM.leftHip].y = 1.2;
    expect(assessQuality(f).issues).toContain('out_of_frame');
  });
});
