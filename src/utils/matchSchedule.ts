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

export interface MatchOptions {
  seed: string;
  intro: boolean;
  voiceLead: number;
}

export const buildMatchSchedule = (stages: Stage[], opts: MatchOptions): MatchSchedule => {
  const segments: Segment[] = [];
  let t = 0;
  if (opts.intro) {
    segments.push({ kind: 'brand', start: t, end: (t += MATCH_TIMING.brand) });
    segments.push({ kind: 'safety', start: t, end: (t += MATCH_TIMING.safety) });
  }
  stages.forEach((stage, stageIndex) => {
    segments.push({ kind: 'title', stageIndex, start: t, end: (t += MATCH_TIMING.title) });
    const schedule = buildSchedule(stage, { seed: `${opts.seed}:${stageIndex}`, lead: MATCH_TIMING.lead, voiceLead: opts.voiceLead });
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
export const estimateMatchDuration = (stages: Stage[], intro: boolean, voiceLead: number) =>
  (intro ? MATCH_TIMING.brand + MATCH_TIMING.safety : 0) +
  stages.reduce((sum, s) => sum + MATCH_TIMING.title + estimateDuration(s, MATCH_TIMING.lead, voiceLead), 0);
