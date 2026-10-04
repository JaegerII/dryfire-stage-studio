/**
 * Target motion evaluation. `t` is seconds since the start beep; outside the
 * par window (`active = false`) every object shows its rest state (standing
 * steel, hidden activated targets) — the stage "resets" between reps.
 *
 * Activators: a steel object with `fall` motion goes down at its delay.
 * Any other motion with `trigger: <steelId>` starts counting when that
 * steel falls (shoot the popper → the swinger / pop-up appears).
 */
import type { Motion, StageObject } from '../types/stage';

export interface MotionState {
  dx: number; // meters, + = right
  dy: number; // meters, + = up
  visible: boolean;
  /** 0 standing … 1 lying flat (steel only). */
  fall: number;
  /** Tilt in degrees around the foot (swing), + = top to the right. */
  rot: number;
}

/** Seconds after the start beep at which each falling steel object goes down. */
export type FallTimes = Map<string, number>;

const REST: MotionState = { dx: 0, dy: 0, visible: true, fall: 0, rot: 0 };
const FALL_DURATION = 0.22;
export const DEFAULT_AMPLITUDE = 0.5; // meters
export const DEFAULT_SWING_ANGLE = 45; // degrees

export const isMoving = (m?: Motion) => !!m && m.kind !== 'static';

export const fallTimes = (objects: StageObject[]): FallTimes =>
  new Map(objects.filter((o) => o.motion?.kind === 'fall').map((o) => [o.id, o.motion!.delay ?? 1]));

/** Start of a motion in seconds after the beep (Infinity if its trigger never falls). */
const startOf = (m: Motion, falls: FallTimes) => (m.trigger ? (falls.get(m.trigger) ?? Infinity) : 0);

export const motionAt = (m: Motion | undefined, t: number, active: boolean, falls: FallTimes): MotionState => {
  if (!m || m.kind === 'static') return REST;
  const delay = m.delay ?? 0;
  if (m.kind === 'fall') {
    if (!active) return REST;
    const p = Math.min(1, Math.max(0, (t - (m.delay ?? 1)) / FALL_DURATION));
    return { ...REST, fall: p * p }; // accelerating
  }
  const local = t - startOf(m, falls); // seconds since this motion's start (beep or trigger)
  switch (m.kind) {
    case 'swing': {
      if (!active || local < delay) return m.hiddenUntilStart ? { ...REST, visible: false } : REST;
      const rot = (m.angle ?? DEFAULT_SWING_ANGLE) * Math.sin((2 * Math.PI * (local - delay)) / Math.max(0.2, m.period ?? 1.6));
      return { ...REST, rot };
    }
    case 'horizontal':
    case 'vertical': {
      if (!active || local < delay) return m.hiddenUntilStart ? { ...REST, visible: false } : REST;
      const off = (m.amplitude ?? DEFAULT_AMPLITUDE) * Math.sin((2 * Math.PI * (local - delay)) / Math.max(0.2, m.period ?? 2));
      return m.kind === 'horizontal' ? { ...REST, dx: off } : { ...REST, dy: off };
    }
    case 'appear':
      return { ...REST, visible: active && local >= delay };
    case 'popup':
      return { ...REST, visible: active && local >= delay && (m.duration === undefined || local < delay + m.duration) };
    case 'disappear':
      return { ...REST, visible: !active || local < delay };
  }
};

/** Vertical scale of a falling steel target (it tips away from the shooter). */
export const fallScale = (fall: number) => 1 - 0.88 * fall;
