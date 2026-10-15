/**
 * Video timeline of a 3D stage — everything is a pure function of time, so
 * the live preview and the frame-by-frame MP4 render show exactly the same.
 *
 *   title + briefing (top view, the path is drawn with arrows)
 *   → camera flies down into the shooter's eyes at the start position
 *   → reps: MAKE READY / STANDBY / beep / positions + moves / end beep / reset
 *   → TRAINING COMPLETE
 */
import type { Stage } from '../types/stage';
import { type PlayerSnapshot, type Schedule, buildSchedule, snapshotAt } from '../utils/schedule';
import { type Stage3D, parTime3D } from './types';

export const EYE_HEIGHT = 1.6;

export interface VideoTiming {
  /** Title over the top view before the path is drawn. */
  intro: number;
  /** Seconds to draw one leg of the path. */
  perLeg: number;
  /** Hold on the finished briefing. */
  briefingHold: number;
  /** Camera flight from the top view into the shooter's eyes. */
  flyIn: number;
  /** MAKE READY at the start position before rep 1. */
  lead: number;
  /** TRAINING COMPLETE at the end. */
  outro: number;
  /** Black fade when the shooter walks back to the start between reps. */
  resetFade: number;
}

export const VIDEO_TIMING: VideoTiming = { intro: 2, perLeg: 2.6, briefingHold: 2, flyIn: 3.2, lead: 2, outro: 3, resetFade: 0.7 };

export type VideoSegment = 'briefing' | 'flyin' | 'stage' | 'outro';

export interface VideoTimeline {
  timing: VideoTiming;
  briefingEnd: number;
  flyInEnd: number;
  stageEnd: number;
  end: number;
  /** Rep schedule, times relative to flyInEnd. */
  schedule: Schedule;
  /** The 3D stage as the classic rep scheduler sees it (par = all positions + moves). */
  asStage: Stage;
}

export const buildVideoTimeline = (s: Stage3D, opts: { seed: string; voiceLead: number; timing?: Partial<VideoTiming> }): VideoTimeline => {
  const T = { ...VIDEO_TIMING, ...opts.timing };
  const asStage: Stage = {
    schemaVersion: 1,
    id: s.id,
    name: s.name,
    environment: 'indoor_01',
    parTime: parTime3D(s),
    repetitions: s.repetitions,
    resetTime: s.resetTime,
    standbyDelay: s.standbyDelay,
    objects: [],
  };
  const briefingEnd = T.intro + T.perLeg * s.legs.length + T.briefingHold;
  const flyInEnd = briefingEnd + T.flyIn;
  const schedule = buildSchedule(asStage, { seed: opts.seed, lead: T.lead, voiceLead: opts.voiceLead });
  const stageEnd = flyInEnd + schedule.completeAt;
  return { timing: T, briefingEnd, flyInEnd, stageEnd, end: stageEnd + T.outro, schedule, asStage };
};

export const segmentAt = (tl: VideoTimeline, t: number): VideoSegment =>
  t < tl.briefingEnd ? 'briefing' : t < tl.flyInEnd ? 'flyin' : t < tl.stageEnd ? 'stage' : 'outro';

// ------------------------------------------------------------------ the shooter on the path

export interface ShooterState {
  x: number;
  d: number;
  heading: number;
  /** Index of the leg being walked, or −1 when standing. */
  leg: number;
  /** 0..1 along that leg. */
  legProgress: number;
  /** Walking speed 0..1 (for the head bob). */
  speed: number;
  reloading: boolean;
}

const ease = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Shortest turn from a to b (degrees). */
const lerpAngle = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;

/** Point at fraction u (0..1, by length) along a polyline. */
export const alongPath = (pts: { x: number; d: number }[], u: number) => {
  const segs = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.d - pts[i].d));
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let left = Math.max(0, Math.min(1, u)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (left <= segs[i] || i === segs.length - 1) {
      const f = segs[i] ? Math.min(1, left / segs[i]) : 1;
      return { x: lerp(pts[i].x, pts[i + 1].x, f), d: lerp(pts[i].d, pts[i + 1].d, f) };
    }
    left -= segs[i];
  }
  return pts[pts.length - 1];
};

export const legPoints = (s: Stage3D, i: number) => [s.positions[i], ...(s.legs[i].via ?? []), s.positions[i + 1]];

/** Where the shooter is `t` seconds after the start beep (clamped to the par window). */
export const shooterAt = (s: Stage3D, t: number): ShooterState => {
  let clock = 0;
  for (let i = 0; i < s.legs.length; i++) {
    const leg = s.legs[i];
    const p = s.positions[i];
    if (t < clock + leg.after) return { x: p.x, d: p.d, heading: p.heading, leg: -1, legProgress: 0, speed: 0, reloading: false };
    clock += leg.after;
    if (t < clock + leg.duration) {
      const raw = (t - clock) / leg.duration;
      const u = ease(raw);
      const pts = legPoints(s, i);
      const at = alongPath(pts, u);
      const next = s.positions[i + 1];
      // smoothstep speed profile, normalised to 1 at mid-leg
      const speed = 4 * raw * (1 - raw);
      // while moving, the eyes turn a little towards where the feet go
      const ahead = alongPath(pts, Math.min(1, u + 0.05));
      const moveDir = Math.hypot(ahead.x - at.x, ahead.d - at.d) > 1e-4 ? (Math.atan2(ahead.x - at.x, ahead.d - at.d) * 180) / Math.PI : p.heading;
      const base = lerpAngle(p.heading, next.heading, u);
      return { ...at, heading: lerpAngle(base, moveDir, 0.3 * speed), leg: i, legProgress: raw, speed, reloading: leg.reload };
    }
    clock += leg.duration;
  }
  const last = s.positions[s.positions.length - 1];
  return { x: last.x, d: last.d, heading: last.heading, leg: -1, legProgress: 0, speed: 0, reloading: false };
};

// ------------------------------------------------------------------ camera

export interface CameraPose {
  /** three.js world position */
  x: number;
  y: number;
  z: number;
  /** Look direction as yaw (deg, 0 = −z / downrange, + = right) and pitch (deg, − = down). */
  yaw: number;
  pitch: number;
  fov: number;
  /** 0 = clear, 1 = black. */
  fade: number;
}

export const POV_FOV = 62;

/** The shooter's eyes; a gentle head bob while walking. */
export const povPose = (st: ShooterState, t: number): CameraPose => {
  const bob = Math.sin(t * Math.PI * 2 * 1.9) * 0.025 * st.speed;
  const sway = Math.sin(t * Math.PI * 1.9) * 0.012 * st.speed;
  const h = (st.heading * Math.PI) / 180;
  return { x: st.x + Math.cos(h) * sway, y: EYE_HEIGHT + bob, z: -st.d + Math.sin(h) * sway, yaw: st.heading, pitch: -4, fov: POV_FOV, fade: 0 };
};

export interface Bounds {
  x0: number;
  x1: number;
  d0: number;
  d1: number;
}

export const stageBounds = (s: Stage3D): Bounds => {
  const xs = [...s.objects.map((o) => o.x), ...s.positions.map((p) => p.x)];
  const ds = [...s.objects.map((o) => o.d), ...s.positions.map((p) => p.d)];
  return { x0: Math.min(...xs) - 1.5, x1: Math.max(...xs) + 1.5, d0: Math.min(...ds) - 1.5, d1: Math.max(...ds) + 1.5 };
};

/** Briefing: high above, from behind the start, looking steeply down onto the whole stage; slow drift. */
export const briefingPose = (s: Stage3D, t: number, aspect = 16 / 9): CameraPose => {
  const b = stageBounds(s);
  const cx = (b.x0 + b.x1) / 2;
  const cd = (b.d0 + b.d1) / 2;
  const pitch = -62;
  const fov = 40;
  // height so the stage depth fits the vertical field of view (generous margin)
  const span = Math.max(b.d1 - b.d0, (b.x1 - b.x0) / aspect);
  const dist = (span * 0.54) / Math.tan(((fov / 2) * Math.PI) / 180);
  const p = (pitch * Math.PI) / 180;
  const drift = Math.sin(t * 0.18) * 0.6;
  return { x: cx + drift, y: -Math.sin(p) * dist, z: -(cd - Math.cos(p) * dist), yaw: drift * 1.5, pitch, fov, fade: Math.max(0, 1 - t / 0.8) };
};

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

export const mixPose = (a: CameraPose, b: CameraPose, u: number): CameraPose => {
  const e = easeInOut(Math.max(0, Math.min(1, u)));
  // position on an arc: fast drop first, the last meters level into the eyes
  const ey = 1 - (1 - e) ** 2;
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, ey),
    z: lerp(a.z, b.z, e),
    yaw: lerpAngle(a.yaw, b.yaw, e),
    pitch: lerp(a.pitch, b.pitch, e),
    fov: lerp(a.fov, b.fov, e),
    fade: lerp(a.fade, b.fade, e),
  };
};

export interface FrameState {
  t: number;
  segment: VideoSegment;
  camera: CameraPose;
  /** 0..1 drawn per leg (briefing); null outside the briefing. */
  arrows: number[] | null;
  /** Rep state during the stage segment. */
  rep: PlayerSnapshot | null;
  shooter: ShooterState | null;
}

/** Everything the renderer and the HUD need for time `t` (seconds from the video start). */
export const frameAt = (s: Stage3D, tl: VideoTimeline, t: number, aspect = 16 / 9): FrameState => {
  const T = tl.timing;
  const segment = segmentAt(tl, t);
  const start = shooterAt(s, 0);
  if (segment === 'briefing') {
    const arrows = s.legs.map((_, i) => Math.max(0, Math.min(1, (t - T.intro - i * T.perLeg) / (T.perLeg * 0.8))));
    return { t, segment, camera: briefingPose(s, t, aspect), arrows, rep: null, shooter: null };
  }
  if (segment === 'flyin') {
    const u = (t - tl.briefingEnd) / T.flyIn;
    const arrows = s.legs.map(() => Math.max(0, 1 - u * 2.5)); // the path fades as we descend
    return { t, segment, camera: mixPose(briefingPose(s, tl.briefingEnd, aspect), povPose(start, t), u), arrows, rep: null, shooter: start };
  }
  if (segment === 'outro') {
    return { t, segment, camera: { ...povPose(start, t), fade: Math.min(0.6, (t - tl.stageEnd) / 1.2) }, arrows: null, rep: null, shooter: start };
  }
  const local = t - tl.flyInEnd;
  const rep = snapshotAt(tl.schedule, local, tl.asStage);
  const par = tl.asStage.parTime;
  // during the par window and the "TIME" second the shooter is on the path; then back to the start
  const onPath = rep.phase === 'active' || (rep.phase === 'reset' && rep.sinceStart < par + 1);
  const shooter = onPath ? shooterAt(s, Math.min(rep.sinceStart, par)) : start;
  const camera = povPose(shooter, t);
  // walking back to the start between reps happens behind a short black fade
  if (rep.phase === 'reset' && s.positions.length > 1) {
    const back = rep.sinceStart - (par + 1);
    const f = T.resetFade;
    camera.fade = back >= -f && back < f ? 1 - Math.abs(back) / f : 0;
  }
  return { t, segment, camera, arrows: null, rep, shooter };
};
