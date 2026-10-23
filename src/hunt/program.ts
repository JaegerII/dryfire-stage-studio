/**
 * Timeline of a driven-hunt video — one scenario or a whole hunt (≙ match):
 *   briefing (release, safety, distance to the screen)
 *   → per scenario: title card (map, stand) → the drive (after each crossing an answer card:
 *     what it was, released or not, lead)
 *   → summary.
 */
import { MAPS, standView } from './maps';
import { crossingWindow } from './rules';
import { driveDuration } from './repository';
import type { HuntFormat, HuntRelease, HuntScenario } from './types';

export const INTRO_SECONDS = 14;
export const TITLE_SECONDS = 4;
export const END_SECONDS = 10;
/** The last seconds of the briefing count down to the start of the drive. */
export const COUNTDOWN = 3;

export interface HuntSegment {
  kind: 'intro' | 'title' | 'drive' | 'end';
  start: number;
  end: number;
  /** Index into scenarios (title / drive). */
  scenario: number;
}

export interface HuntProgram {
  name: string;
  release: HuntRelease;
  scenarios: HuntScenario[];
  /** A whole hunt: title cards between the scenarios. */
  isHunt: boolean;
  segments: HuntSegment[];
  /** Per scenario: answer cards (in its drive time). */
  reveals: { index: number; from: number; until: number }[][];
  end: number;
}

export type HuntFrame =
  | { phase: 'intro'; local: number }
  | { phase: 'title'; scenario: number; local: number }
  | { phase: 'drive'; scenario: number; time: number; reveal: { index: number; local: number } | null }
  | { phase: 'end'; local: number };

/**
 * `leaveTimes[s][c]`: when crossing c of scenario s had its last animal leave the frame (from the render),
 * else estimated.
 */
export const huntProgram = (
  o: { name: string; release: HuntRelease; scenarios: HuntScenario[]; isHunt?: boolean; intro?: boolean },
  format: HuntFormat,
  leaveTimes?: (number | null)[][],
): HuntProgram => {
  const segments: HuntSegment[] = [];
  const reveals: HuntProgram['reveals'] = [];
  let t = 0;
  const push = (kind: HuntSegment['kind'], len: number, scenario = -1) => {
    segments.push({ kind, start: t, end: t + len, scenario });
    t += len;
  };
  if (o.intro !== false) push('intro', INTRO_SECONDS);
  o.scenarios.forEach((s, si) => {
    const drive = driveDuration(s);
    const r = s.revealSeconds > 0
      ? s.crossings.map((c, index) => {
          const from = (leaveTimes?.[si]?.[index] ?? crossingWindow(c, format).leave) + 0.6;
          return { index, from, until: from + s.revealSeconds };
        })
      : [];
    reveals.push(r);
    if (o.isHunt) push('title', TITLE_SECONDS, si);
    push('drive', Math.max(drive, Math.max(0, ...r.map((x) => x.until)) + 0.5), si);
  });
  push('end', END_SECONDS);
  return { name: o.name, release: o.release, scenarios: o.scenarios, isHunt: !!o.isHunt, segments, reveals, end: t };
};

export const segmentAt = (p: HuntProgram, t: number) => p.segments.find((s) => t < s.end) ?? p.segments[p.segments.length - 1];

export const huntFrameAt = (p: HuntProgram, t: number): HuntFrame => {
  const seg = segmentAt(p, t);
  const local = Math.max(0, t - seg.start);
  if (seg.kind === 'intro') return { phase: 'intro', local };
  if (seg.kind === 'end') return { phase: 'end', local };
  if (seg.kind === 'title') return { phase: 'title', scenario: seg.scenario, local };
  const r = p.reveals[seg.scenario].find((x) => local >= x.from && local < x.until);
  return { phase: 'drive', scenario: seg.scenario, time: local, reveal: r ? { index: r.index, local: local - r.from } : null };
};

/** Program time where scenario `si`'s drive starts (its title card before it, in a hunt). */
export const driveStart = (p: HuntProgram, si: number) => p.segments.find((s) => s.kind === 'drive' && s.scenario === si)?.start ?? 0;

/** "Buchenschneise · Winter · Stand 3 · Gegenrichtung" */
export const scenarioPlace = (s: HuntScenario) => `${MAPS[s.map].label} · ${standView(s.map, s.stand).name}`;
