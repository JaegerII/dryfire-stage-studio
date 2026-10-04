/**
 * Playback schedule: everything the player does is a pure function of the
 * stage + options, expressed in seconds from the moment "Start" is pressed.
 *
 *   [lead-in, shown as MAKE READY] → per rep: RESET/prep → STAND BY (+voice) +
 *   random delay → start beep → par window → end beep → … → final reset → COMPLETE
 *
 * Times are relative to the start of the stage; matchSchedule.ts places
 * several stages (plus brand / safety / title screens) on one timeline.
 */
import type { Stage } from '../types/stage';
import { seededRandom } from './random';

export interface RepSchedule {
  index: number; // 1-based
  prepStart: number;
  standbyStart: number;
  startBeep: number;
  endBeep: number;
}

export interface Schedule {
  leadEnd: number;
  reps: RepSchedule[];
  completeAt: number;
}

export interface ScheduleOptions {
  seed: string;
  /** Extra seconds before the first rep's prep (camera push-in while MAKE READY shows). */
  lead: number;
  /** Seconds the spoken "Stand by" takes before the random delay begins (0 = no voice). */
  voiceLead: number;
}

export const buildSchedule = (stage: Stage, opts: ScheduleOptions): Schedule => {
  const rand = seededRandom(`${opts.seed}:${stage.id}`);
  const { min, max } = stage.standbyDelay;
  const reps: RepSchedule[] = [];
  let t = opts.lead;
  for (let i = 1; i <= stage.repetitions; i++) {
    const prepStart = t;
    const standbyStart = prepStart + stage.resetTime;
    const startBeep = standbyStart + opts.voiceLead + min + rand() * Math.max(0, max - min);
    const endBeep = startBeep + stage.parTime;
    reps.push({ index: i, prepStart, standbyStart, startBeep, endBeep });
    t = endBeep;
  }
  return { leadEnd: opts.lead, reps, completeAt: t + stage.resetTime };
};

export type Phase = 'ready' | 'reset' | 'standby' | 'active' | 'complete';

export interface PlayerSnapshot {
  phase: Phase;
  rep: number; // 1-based, 0 before the first rep
  /** Seconds into the par window (clamped). */
  elapsed: number;
  /** 0..1 progress through the par window. */
  parProgress: number;
  /** Seconds since the start beep of the current rep (negative before it). */
  sinceStart: number;
  /** Seconds until the next STAND BY (Infinity when no rep follows). */
  untilStandby: number;
}

export const snapshotAt = (s: Schedule, t: number, stage: Stage): PlayerSnapshot => {
  if (t >= s.completeAt) return { phase: 'complete', rep: stage.repetitions, elapsed: stage.parTime, parProgress: 1, sinceStart: Infinity, untilStandby: Infinity };
  // current rep = last rep whose prep has started
  let idx = 0;
  s.reps.forEach((rep, i) => {
    if (t >= rep.prepStart) idx = i;
  });
  const r = s.reps[idx];
  if (t >= r.endBeep || t < r.standbyStart) {
    // reset after a rep still belongs to that rep (TIME → RESET); before rep 1 it is MAKE READY
    const done = t >= r.endBeep ? r : s.reps[idx - 1];
    const next = t >= r.endBeep ? s.reps[idx + 1] : r;
    const untilStandby = next ? next.standbyStart - t : Infinity;
    if (!done) return { phase: 'ready', rep: 1, elapsed: 0, parProgress: 0, sinceStart: t - r.startBeep, untilStandby };
    return { phase: 'reset', rep: done.index, elapsed: stage.parTime, parProgress: 1, sinceStart: t - done.startBeep, untilStandby };
  }
  const sinceStart = t - r.startBeep;
  if (t < r.startBeep) return { phase: 'standby', rep: r.index, elapsed: 0, parProgress: 0, sinceStart, untilStandby: 0 };
  return { phase: 'active', rep: r.index, elapsed: sinceStart, parProgress: sinceStart / stage.parTime, sinceStart, untilStandby: Infinity };
};

/** Stage length in seconds (average standby delay). */
export const estimateDuration = (stage: Stage, lead: number, voiceLead: number) =>
  lead +
  stage.repetitions * (stage.resetTime + voiceLead + (stage.standbyDelay.min + stage.standbyDelay.max) / 2 + stage.parTime) +
  stage.resetTime;
