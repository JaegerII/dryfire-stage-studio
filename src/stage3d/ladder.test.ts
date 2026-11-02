import { describe, expect, it } from 'vitest';
import { snapshotAt } from '../utils/schedule';
import { normalizeStage3D } from './repository';
import ladderStage from './stages/stage_801.json';
import { buildVideoTimeline, stageClock } from './timeline';
import { levelOfRep, repPars, repsOf } from './types';

const stage = normalizeStage3D(ladderStage);

describe('par ladder', () => {
  it('plays every level for its reps, each with its own par', () => {
    expect(repsOf(stage)).toBe(12);
    expect(stage.repetitions).toBe(12);
    expect(repPars(stage).slice(0, 4)).toEqual([1.6, 1.6, 1.4, 1.4]);
    expect([1, 2, 3, 12].map((r) => levelOfRep(stage, r))).toEqual([1, 1, 2, 6]);
    const tl = buildVideoTimeline(stage, { seed: 'x', voiceLead: 0 });
    const reps = tl.schedule.reps;
    expect(reps).toHaveLength(12);
    reps.forEach((r, i) => expect(r.endBeep - r.startBeep).toBeCloseTo(repPars(stage)[i]));
    // in the middle of the last rep the snapshot carries that rep's par
    const last = reps[11];
    const snap = snapshotAt(tl.schedule, (last.startBeep + last.endBeep) / 2, tl.asStage);
    expect(snap.par).toBeCloseTo(0.9);
    expect(snap.parProgress).toBeCloseTo(0.5);
  });

  it('runs the stage clock faster on a shorter par', () => {
    expect(stageClock(stage, 0.45, 0.9)).toBeCloseTo(0.8);
  });

  it('drops a broken ladder and keeps plain repetitions', () => {
    const s = normalizeStage3D({ ...ladderStage, ladder: { pars: ['x'], repsPerLevel: 2 }, repetitions: 4 });
    expect(s.ladder).toBeUndefined();
    expect(s.repetitions).toBe(4);
  });
});
