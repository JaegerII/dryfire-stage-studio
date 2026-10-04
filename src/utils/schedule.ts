/**
 * Playback schedule: everything the player does is a pure function of the
 * stage + options, expressed in seconds from the moment "Start" is pressed.
 *
 *   [intro] → per rep: RESET/prep → STAND BY (+voice) + random delay →
 *   start beep → par window → end beep → … → final reset → COMPLETE
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
  introEnd: number;
  reps: RepSchedule[];
  completeAt: number;
}

export interface ScheduleOptions {
  seed: string;
  /** Seconds for safety + brand screens before the first rep (0 = none). */
  intro: number;
  /** Seconds the spoken "Stand by" takes before the random delay begins (0 = no voice). */
  voiceLead: number;
}

export const INTRO_SECONDS = { safety: 6, brand: 4 };
export const INTRO_TOTAL = INTRO_SECONDS.safety + INTRO_SECONDS.brand;

export const buildSchedule = (stage: Stage, opts: ScheduleOptions): Schedule => {
  const rand = seededRandom(`${opts.seed}:${stage.id}`);
  const { min, max } = stage.standbyDelay;
  const reps: RepSchedule[] = [];
  let t = opts.intro;
  for (let i = 1; i <= stage.repetitions; i++) {
    const prepStart = t;
    const standbyStart = prepStart + stage.resetTime;
    const startBeep = standbyStart + opts.voiceLead + min + rand() * Math.max(0, max - min);
    const endBeep = startBeep + stage.parTime;
    reps.push({ index: i, prepStart, standbyStart, startBeep, endBeep });
    t = endBeep;
  }
  return { introEnd: opts.intro, reps, completeAt: t + stage.resetTime };
};

export type Phase = 'intro-safety' | 'intro-brand' | 'ready' | 'reset' | 'standby' | 'active' | 'complete';

export interface PlayerSnapshot {
  phase: Phase;
  rep: number; // 1-based, 0 before the first rep
  /** Seconds into the par window (clamped). */
  elapsed: number;
  /** 0..1 progress through the par window. */
  parProgress: number;
  /** Seconds since the start beep of the current rep (negative before it). */
  sinceStart: number;
}

export const snapshotAt = (s: Schedule, t: number, stage: Stage): PlayerSnapshot => {
  if (t < s.introEnd) {
    const phase: Phase = t < INTRO_SECONDS.safety ? 'intro-safety' : 'intro-brand';
    return { phase, rep: 0, elapsed: 0, parProgress: 0, sinceStart: -1 };
  }
  if (t >= s.completeAt) return { phase: 'complete', rep: stage.repetitions, elapsed: stage.parTime, parProgress: 1, sinceStart: Infinity };
  // current rep = last rep whose prep has started
  let idx = 0;
  s.reps.forEach((rep, i) => {
    if (t >= rep.prepStart) idx = i;
  });
  const r = s.reps[idx];
  if (t >= r.endBeep || t < r.standbyStart) {
    // reset after a rep still belongs to that rep (TIME → RESET); before rep 1 it is MAKE READY
    const done = t >= r.endBeep ? r : s.reps[idx - 1];
    if (!done) return { phase: 'ready', rep: 1, elapsed: 0, parProgress: 0, sinceStart: t - r.startBeep };
    return { phase: 'reset', rep: done.index, elapsed: stage.parTime, parProgress: 1, sinceStart: t - done.startBeep };
  }
  const sinceStart = t - r.startBeep;
  if (t < r.startBeep) return { phase: 'standby', rep: r.index, elapsed: 0, parProgress: 0, sinceStart };
  return { phase: 'active', rep: r.index, elapsed: sinceStart, parProgress: sinceStart / stage.parTime, sinceStart };
};

/** Session length in seconds (for the setup screen). */
export const estimateDuration = (stage: Stage, intro: number, voiceLead: number) =>
  intro +
  stage.repetitions * (stage.resetTime + voiceLead + (stage.standbyDelay.min + stage.standbyDelay.max) / 2 + stage.parTime) +
  stage.resetTime;
