/**
 * Timeline of a driven-hunt video: briefing (release, safety, distance to the screen) → the drive
 * (the rendered lane; after each crossing an answer card: what it was, released or not, lead) → summary.
 */
import { crossingWindow } from './rules';
import { driveDuration } from './repository';
import type { HuntFormat, HuntScenario } from './types';

export const INTRO_SECONDS = 14;
export const END_SECONDS = 10;
/** The last seconds of the briefing count down to the start of the drive. */
export const COUNTDOWN = 3;

export interface HuntProgram {
  scenario: HuntScenario;
  drive: number;
  end: number;
  /** Per crossing (in scenario order): when its answer card shows, in drive time. */
  reveals: { index: number; from: number; until: number }[];
}

export type HuntFrame =
  | { phase: 'intro'; local: number }
  | { phase: 'drive'; time: number; reveal: { index: number; local: number } | null }
  | { phase: 'end'; local: number };

/**
 * `leaveTimes`: when each crossing's last animal left the frame (from the render), else estimated.
 */
export const huntProgram = (s: HuntScenario, format: HuntFormat, leaveTimes?: (number | null)[]): HuntProgram => {
  const drive = driveDuration(s);
  const reveals = s.revealSeconds > 0
    ? s.crossings.map((c, index) => {
        const from = (leaveTimes?.[index] ?? crossingWindow(c, format).leave) + 0.6;
        return { index, from, until: Math.min(drive + END_SECONDS, from + s.revealSeconds) };
      })
    : [];
  const lastReveal = Math.max(0, ...reveals.map((r) => r.until));
  const sceneEnd = Math.max(drive, lastReveal + 0.5);
  return { scenario: s, drive: sceneEnd, end: INTRO_SECONDS + sceneEnd + END_SECONDS, reveals };
};

export const huntFrameAt = (p: HuntProgram, t: number): HuntFrame => {
  if (t < INTRO_SECONDS) return { phase: 'intro', local: t };
  const time = t - INTRO_SECONDS;
  if (time < p.drive) {
    const r = p.reveals.find((x) => time >= x.from && time < x.until);
    return { phase: 'drive', time, reveal: r ? { index: r.index, local: time - r.from } : null };
  }
  return { phase: 'end', local: time - p.drive };
};
