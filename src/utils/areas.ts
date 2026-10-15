/**
 * Dynamic stages: the timeline of areas and barrier transitions inside the
 * par window, and helpers that present one area as a plain Stage (so the
 * canvas, editor and motion code need no changes).
 *
 *   start beep → area 1 (areaTime) → transition → area 2 (time) → … → end beep
 */
import type { AreaTransition, Stage, StageArea } from '../types/stage';
import { newId } from './random';

export const DEFAULT_TRANSITION: AreaTransition = { duration: 2.5, direction: 'ltr', style: 'mesh' };
export const DEFAULT_AREA_TIME = 4;

export const isDynamic = (s: Stage) => !!s.areas?.length;
export const areaCount = (s: Stage) => 1 + (s.areas?.length ?? 0);
export const transitionOf = (s: Stage): AreaTransition => ({ ...DEFAULT_TRANSITION, ...s.transition });

/** Area `k` (0 = the stage itself) as a stage of its own. */
export const areaStage = (s: Stage, k: number): Stage => {
  if (k <= 0 || !s.areas?.[k - 1]) return s;
  const a = s.areas[k - 1];
  return { ...s, environment: a.environment, objects: a.objects, view: a.view };
};

/** Writes an edited area-stage (from areaStage) back; stage-level fields (name, reps, …) come along. */
export const writeArea = (s: Stage, k: number, v: Stage): Stage => {
  if (k <= 0 || !s.areas?.[k - 1]) return v;
  const areas = (v.areas ?? s.areas).map((a, i) => (i === k - 1 ? { ...a, environment: v.environment, objects: v.objects, view: v.view } : a));
  return { ...v, environment: s.environment, objects: s.objects, view: s.view, areas };
};

/** Par time of a dynamic stage = all area times + all transitions. */
export const dynamicParTime = (s: Stage) => {
  if (!isDynamic(s)) return s.parTime;
  const t = transitionOf(s).duration;
  return +((s.areaTime ?? DEFAULT_AREA_TIME) + s.areas!.reduce((sum, a) => sum + t + a.time, 0)).toFixed(2);
};

/** Keeps parTime consistent with the areas (call after every change to areas / times). */
export const syncParTime = (s: Stage): Stage => (isDynamic(s) ? { ...s, parTime: dynamicParTime(s) } : s);

export type TimelinePart =
  | { kind: 'area'; area: number; start: number; end: number }
  | { kind: 'transition'; from: number; to: number; start: number; end: number };

/** Seconds after the start beep. */
export const areaTimeline = (s: Stage): TimelinePart[] => {
  if (!isDynamic(s)) return [{ kind: 'area', area: 0, start: 0, end: s.parTime }];
  const tr = transitionOf(s).duration;
  const parts: TimelinePart[] = [];
  let t = s.areaTime ?? DEFAULT_AREA_TIME;
  parts.push({ kind: 'area', area: 0, start: 0, end: t });
  s.areas!.forEach((a, i) => {
    parts.push({ kind: 'transition', from: i, to: i + 1, start: t, end: (t += tr) });
    parts.push({ kind: 'area', area: i + 1, start: t, end: (t += a.time) });
  });
  return parts;
};

export interface AreaView {
  /** The area to show (during a transition: the one behind the barrier at this moment). */
  area: number;
  /** When that area's own clock started (seconds after the beep) — motion runs on it. */
  areaStart: number;
  /** 0..1 progress of a running transition, null otherwise. */
  transition: number | null;
}

/**
 * What the screen shows `sinceStart` seconds after the beep. Outside the
 * par window (`active` false) the stage shows area 1 — the start position.
 * The swap happens at the middle of a transition, when the barrier covers the screen.
 */
export const areaAt = (s: Stage, parts: TimelinePart[], sinceStart: number, active: boolean): AreaView => {
  if (!active || !isDynamic(s)) return { area: 0, areaStart: 0, transition: null };
  for (const p of parts) {
    if (sinceStart >= p.end) continue;
    if (p.kind === 'area') return { area: p.area, areaStart: p.start, transition: null };
    const prog = Math.max(0, (sinceStart - p.start) / (p.end - p.start));
    // the next area's clock starts when the transition ends (its targets appear "as you arrive")
    return prog < 0.5 ? { area: p.from, areaStart: parts.find((q) => q.kind === 'area' && q.area === p.from)!.start, transition: prog } : { area: p.to, areaStart: p.end, transition: prog };
  }
  const last = parts[parts.length - 1];
  return { area: last.kind === 'area' ? last.area : last.to, areaStart: last.start, transition: null };
};

export const createArea = (from: Stage, k: number): StageArea => ({
  id: newId('area'),
  name: `Area ${k + 1}`,
  environment: areaStage(from, k - 1).environment,
  objects: [],
  time: DEFAULT_AREA_TIME,
});
