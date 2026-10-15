/**
 * Program: what one video / one session plays — a single stage, or a whole match:
 *
 *   [FORTH TRACE logo] → [safety] → per stage: title card ("Stage 2 / 3") →
 *   briefing from above → camera flight into the start box → MAKE READY → all reps →
 *   … → MATCH COMPLETE (TRAINING COMPLETE for a single stage)
 *
 * A pure function of time like the stage timeline, so the live player and the
 * frame-by-frame MP4 render show exactly the same.
 */
import type { MatchSettings } from '../types/match';
import type { TimedCue } from './audio';
import { videoCues } from './audio';
import { type FrameState, type VideoTimeline, buildVideoTimeline, frameAt } from './timeline';
import type { Stage3D } from './types';

/** Default match timing (seconds); every match can override it in its settings. */
export const MATCH_TIMING = {
  brand: 5,
  safety: 7,
  /** Stage title card ("Stage 2 / 3"). */
  title: 4,
  /** MAKE READY at the start box before the first rep. */
  lead: 2,
};
export type MatchTiming = typeof MATCH_TIMING;
export const resolveTiming = (t?: Partial<MatchTiming>): MatchTiming => ({ ...MATCH_TIMING, ...t });

/** TRAINING / MATCH COMPLETE at the end. */
const OUTRO = 3;

export type ProgramSegment =
  | { kind: 'brand' | 'safety' | 'complete'; start: number; end: number }
  | { kind: 'title'; stageIndex: number; start: number; end: number }
  | { kind: 'stage'; stageIndex: number; start: number; end: number; tl: VideoTimeline };

export interface Program {
  stages: Stage3D[];
  /** Set for a match: shown on the title cards and the end screen. */
  matchName?: string;
  segments: ProgramSegment[];
  end: number;
}

export interface ProgramOptions {
  seed: string;
  /** Seconds the spoken "Stand by" takes (0 = no voice). */
  voiceLead: number;
  /** A match (title cards, intro per its settings); otherwise a single stage. */
  matchName?: string;
  settings?: MatchSettings;
}

/** Values applied to every stage of a match (MatchSettings.overrides). */
export const applyOverrides = (s: Stage3D, settings?: MatchSettings): Stage3D => {
  const o = settings?.overrides;
  if (!o) return s;
  return {
    ...s,
    ...(o.resetTime !== undefined ? { resetTime: o.resetTime } : {}),
    ...(o.repetitions !== undefined ? { repetitions: o.repetitions } : {}),
    ...(o.standbyDelay ? { standbyDelay: { ...o.standbyDelay } } : {}),
  };
};

export const buildProgram = (stagesIn: Stage3D[], o: ProgramOptions): Program => {
  const isMatch = o.matchName !== undefined;
  const T = resolveTiming(o.settings?.timing);
  const stages = isMatch ? stagesIn.map((s) => applyOverrides(s, o.settings)) : stagesIn;
  const segments: ProgramSegment[] = [];
  let t = 0;
  if (isMatch && (o.settings?.intro ?? true)) {
    if (T.brand > 0) segments.push({ kind: 'brand', start: t, end: (t += T.brand) });
    if (T.safety > 0) segments.push({ kind: 'safety', start: t, end: (t += T.safety) });
  }
  stages.forEach((stage, stageIndex) => {
    if (isMatch && T.title > 0) segments.push({ kind: 'title', stageIndex, start: t, end: (t += T.title) });
    const tl = buildVideoTimeline(stage, { seed: `${o.seed}:${stageIndex}`, voiceLead: o.voiceLead, timing: { lead: T.lead, outro: 0 } });
    segments.push({ kind: 'stage', stageIndex, start: t, end: (t += tl.end), tl });
  });
  segments.push({ kind: 'complete', start: t, end: (t += OUTRO) });
  return { stages, matchName: o.matchName, segments, end: t };
};

export interface ProgramFrame {
  segment: ProgramSegment;
  /** Seconds since the segment started. */
  local: number;
  /** The stage on screen: during its title card, its run, and (the last one) the end screen. */
  stageIndex: number;
  /** 3D frame during a stage segment. */
  frame: FrameState | null;
}

export const segmentAtTime = (p: Program, t: number) => p.segments.find((s) => t < s.end) ?? p.segments[p.segments.length - 1];

export const programFrameAt = (p: Program, t: number, aspect = 16 / 9): ProgramFrame => {
  const segment = segmentAtTime(p, t);
  const local = Math.max(0, t - segment.start);
  const stageIndex = 'stageIndex' in segment ? segment.stageIndex : segment.kind === 'complete' ? p.stages.length - 1 : 0;
  // the end screen lies over the last stage's start view
  const run = segment.kind === 'stage' ? segment : segment.kind === 'complete' ? stageStarts(p).at(-1) : undefined;
  const frame = run ? frameAt(p.stages[run.stageIndex], run.tl, segment.kind === 'stage' ? Math.min(local, run.tl.end - 1e-3) : run.tl.end - 1e-3, aspect) : null;
  return { segment, local, stageIndex, frame };
};

/** Every beep and "Stand by" of the program, in seconds from its start. */
export const programCues = (p: Program, voice: boolean): TimedCue[] =>
  p.segments.flatMap((s) => (s.kind === 'stage' ? videoCues(s.tl, voice).map((c) => ({ ...c, t: c.t + s.start })) : []));

/** Start of each stage's run (for "jump to" buttons). */
export const stageStarts = (p: Program) => p.segments.filter((s): s is Extract<ProgramSegment, { kind: 'stage' }> => s.kind === 'stage');
