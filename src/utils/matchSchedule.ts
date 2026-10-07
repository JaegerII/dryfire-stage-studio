/**
 * Match timeline: one audio-clock timeline for a whole video.
 *
 *   [FORTH TRACE logo] → [Attention / safety] → per stage: title card →
 *   stage (camera push-in during MAKE READY, then all reps) → … → MATCH COMPLETE
 *
 * A single stage is played as a match of one (usually without the intro).
 */
import type { Stage } from '../types/stage';
import { type PlayerSnapshot, type Schedule, buildSchedule, estimateDuration, snapshotAt } from './schedule';

/** Default match timing (seconds); every match can override it in its settings. */
export const MATCH_TIMING = {
  brand: 5,
  safety: 7,
  /** Stage title card ("Stage 2 / 3"). */
  title: 4,
  /** MAKE READY lead-in while the camera pushes into the stage. */
  lead: 2,
};

export type Segment =
  | { kind: 'brand' | 'safety'; start: number; end: number }
  | { kind: 'title'; stageIndex: number; start: number; end: number }
  | { kind: 'stage'; stageIndex: number; start: number; end: number; schedule: Schedule };

export interface MatchSchedule {
  segments: Segment[];
  end: number;
}

export type MatchTiming = typeof MATCH_TIMING;

export interface MatchOptions {
  seed: string;
  intro: boolean;
  voiceLead: number;
  /** Match-specific times (defaults: MATCH_TIMING). */
  timing?: Partial<MatchTiming>;
}

export const resolveTiming = (t?: Partial<MatchTiming>): MatchTiming => ({ ...MATCH_TIMING, ...t });

export const buildMatchSchedule = (stages: Stage[], opts: MatchOptions): MatchSchedule => {
  const T = resolveTiming(opts.timing);
  const segments: Segment[] = [];
  let t = 0;
  if (opts.intro) {
    if (T.brand > 0) segments.push({ kind: 'brand', start: t, end: (t += T.brand) });
    if (T.safety > 0) segments.push({ kind: 'safety', start: t, end: (t += T.safety) });
  }
  stages.forEach((stage, stageIndex) => {
    if (T.title > 0) segments.push({ kind: 'title', stageIndex, start: t, end: (t += T.title) });
    const schedule = buildSchedule(stage, { seed: `${opts.seed}:${stageIndex}`, lead: T.lead, voiceLead: opts.voiceLead });
    segments.push({ kind: 'stage', stageIndex, start: t, end: (t += schedule.completeAt), schedule });
  });
  return { segments, end: t };
};

export interface MatchSnapshot {
  /** null once the match is over. */
  segment: Segment | null;
  /** Seconds since the segment started. */
  local: number;
  /** Rep state while a stage segment runs. */
  stage?: PlayerSnapshot;
}

export const matchSnapshotAt = (ms: MatchSchedule, t: number, stages: Stage[]): MatchSnapshot => {
  const seg = ms.segments.find((s) => t < s.end) ?? null;
  if (!seg) return { segment: null, local: t - ms.end };
  const local = Math.max(0, t - seg.start);
  if (seg.kind === 'stage') return { segment: seg, local, stage: snapshotAt(seg.schedule, local, stages[seg.stageIndex]) };
  return { segment: seg, local };
};

/** Total length in seconds (average standby delays). */
export const estimateMatchDuration = (stages: Stage[], intro: boolean, voiceLead: number, timing?: Partial<MatchTiming>) => {
  const T = resolveTiming(timing);
  return (intro ? T.brand + T.safety : 0) + stages.reduce((sum, s) => sum + T.title + estimateDuration(s, T.lead, voiceLead), 0);
};
