/**
 * Video timeline of a 3D stage — everything is a pure function of time, so
 * the live preview and the frame-by-frame MP4 render show exactly the same.
 *
 *   title + briefing (top view, the path is drawn with arrows)
 *   → camera flies down into the shooter's eyes at the start position
 *   → reps: MAKE READY / STANDBY / beep / positions + moves / end beep / reset
 *   → TRAINING COMPLETE
 */
import { type PlayerSnapshot, type Schedule, type StageTiming, buildSchedule, snapshotAt } from '../utils/schedule';
import { DEFAULT_SHAKE, type Stage3D, parTime3D, shakeOf } from './types';

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
  /** The 3D stage as the rep scheduler sees it (par = all positions + moves). */
  asStage: StageTiming;
}

/** A 3D stage as the rep scheduler sees it (par = all positions + moves). */
export const stageTiming = (s: Stage3D): StageTiming => ({ id: s.id, parTime: parTime3D(s), repetitions: s.repetitions, resetTime: s.resetTime, standbyDelay: s.standbyDelay });

export const buildVideoTimeline = (s: Stage3D, opts: { seed: string; voiceLead: number; timing?: Partial<VideoTiming> }): VideoTimeline => {
  const T = { ...VIDEO_TIMING, ...opts.timing };
  const asStage = stageTiming(s);
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
  /** 0..1 of the leg's time. */
  legProgress: number;
  /** Walking speed 0..1 (relative to the leg's cruising speed) — drives the head bob. */
  speed: number;
  /** −1..1: + speeding up, − braking (normalised). */
  accel: number;
  /** Meters walked on the current leg (the steps follow the distance, not the clock). */
  dist: number;
  reloading: boolean;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Shortest turn from a to b (degrees). */
const lerpAngle = (a: number, b: number, u: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * u;
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

type P2 = { x: number; d: number };

/** Point at fraction u (0..1, by length) along a polyline. */
export const alongPath = (pts: P2[], u: number) => {
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

export const pathLength = (pts: P2[]) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.d - pts[i].d), 0);

/**
 * The walked line through the corner points: a centripetal Catmull-Rom spline,
 * so a corner is a smooth curve (people do not turn on the spot). Sampled
 * every ~5 cm; a straight leg stays two points.
 */
export const smoothPath = (pts: P2[]): P2[] => {
  if (pts.length < 3) return pts;
  const out: P2[] = [pts[0]];
  const ext = [{ x: 2 * pts[0].x - pts[1].x, d: 2 * pts[0].d - pts[1].d }, ...pts, { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x, d: 2 * pts[pts.length - 1].d - pts[pts.length - 2].d }];
  const tj = (a: P2, b: P2) => Math.sqrt(Math.max(1e-6, Math.hypot(b.x - a.x, b.d - a.d)));
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const t1 = tj(p0, p1);
    const t2 = t1 + tj(p1, p2);
    const t3 = t2 + tj(p2, p3);
    const n = Math.max(4, Math.ceil(Math.hypot(p2.x - p1.x, p2.d - p1.d) / 0.05));
    for (let k = 1; k <= n; k++) {
      const t = t1 + ((t2 - t1) * k) / n;
      const L = (a: P2, b: P2, ta: number, tb: number): P2 => ({ x: ((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), d: ((tb - t) * a.d + (t - ta) * b.d) / (tb - ta) });
      const A1 = L(p0, p1, 0, t1);
      const A2 = L(p1, p2, t1, t2);
      const A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, 0, t2);
      const B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  return out;
};

export const legPoints = (s: Stage3D, i: number) => [s.positions[i], ...(s.legs[i].via ?? []), s.positions[i + 1]];
/** The line actually walked on leg i (smooth through its corner points). */
export const legPath = (s: Stage3D, i: number) => smoothPath(legPoints(s, i));

/**
 * Speed over a move: a brisk start (28 % of the time), cruising, then a longer
 * braking phase (42 %) that glides into the box instead of stopping dead.
 * Tabulated once: u = share of the distance, v = speed (0..1), a = acceleration (−1..1).
 */
const PROFILE = (() => {
  const N = 600;
  const UP = 0.28;
  const DOWN = 0.42;
  const v = (t: number) => (t < UP ? smooth(t / UP) : t > 1 - DOWN ? smooth((1 - t) / DOWN) : 1);
  const us = [0];
  for (let i = 1; i <= N; i++) us.push(us[i - 1] + (v((i - 0.5) / N) / N));
  const area = us[N];
  const acc = Array.from({ length: N + 1 }, (_, i) => (v(Math.min(1, (i + 1) / N)) - v(Math.max(0, (i - 1) / N))) * (N / 2));
  const maxA = Math.max(...acc.map(Math.abs)) || 1;
  return { N, u: us.map((x) => x / area), v, a: acc.map((x) => x / maxA) };
})();

export const moveProfile = (raw: number) => {
  const t = Math.max(0, Math.min(1, raw));
  const f = t * PROFILE.N;
  const i = Math.min(PROFILE.N - 1, Math.floor(f));
  const k = f - i;
  return { u: lerp(PROFILE.u[i], PROFILE.u[i + 1], k), v: PROFILE.v(t), a: lerp(PROFILE.a[i], PROFILE.a[i + 1], k) };
};

export const standing = (p: { x: number; d: number; heading: number }): ShooterState => ({ x: p.x, d: p.d, heading: p.heading, leg: -1, legProgress: 0, speed: 0, accel: 0, dist: 0, reloading: false });

/** Where the shooter is `t` seconds after the start beep (clamped to the par window). */
export const shooterAt = (s: Stage3D, t: number): ShooterState => {
  let clock = 0;
  for (let i = 0; i < s.legs.length; i++) {
    const leg = s.legs[i];
    const p = s.positions[i];
    if (t < clock + leg.after) return standing(p);
    clock += leg.after;
    if (t < clock + leg.duration) {
      const raw = (t - clock) / leg.duration;
      const { u, v, a } = moveProfile(raw);
      const pts = legPath(s, i);
      const len = pathLength(pts);
      const at = alongPath(pts, u);
      const next = s.positions[i + 1];
      // while moving, the eyes turn towards where the feet go — and back to the box's direction on arrival
      const ahead = alongPath(pts, Math.min(1, u + 0.4 / Math.max(0.5, len)));
      const moveDir = Math.hypot(ahead.x - at.x, ahead.d - at.d) > 1e-4 ? (Math.atan2(ahead.x - at.x, ahead.d - at.d) * 180) / Math.PI : p.heading;
      const base = lerpAngle(p.heading, next.heading, smooth(u));
      return { ...at, heading: lerpAngle(base, moveDir, 0.42 * v), leg: i, legProgress: raw, speed: v, accel: a, dist: u * len, reloading: leg.reload };
    }
    clock += leg.duration;
  }
  return standing(s.positions[s.positions.length - 1]);
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
  /** Head tilt (deg, + = right ear down). */
  roll: number;
  fov: number;
  /** 0 = clear, 1 = black. */
  fade: number;
}

export const POV_FOV = 62;
/** One step while moving through a stage, meters (two steps = one full sway left and right). */
const STEP = 0.8;

/**
 * The shooter's eyes. While moving: the head rises and dips with every step,
 * sways left / right and tilts a little with every second step, leans into the
 * start and nods + sinks slightly while braking into the box. Everything is
 * scaled by the walking speed, so it fades in and out with the move.
 */
export const povPose = (st: ShooterState, _t: number, shake = DEFAULT_SHAKE): CameraPose => {
  // 'shake' scales every head movement; the walk itself (speed, glide) stays the same
  const k = shake;
  const v = st.speed;
  const ph = (2 * Math.PI * st.dist) / STEP; // one cycle per step
  const brake = Math.max(0, -st.accel);
  const push = Math.max(0, st.accel);
  const bob = k * (0.016 * v * Math.sin(ph) - 0.01 * brake);
  const sway = k * 0.01 * v * Math.sin(ph / 2);
  const h = (st.heading * Math.PI) / 180;
  return {
    x: st.x + Math.cos(h) * sway,
    y: EYE_HEIGHT + bob,
    z: -st.d + Math.sin(h) * sway,
    yaw: st.heading + k * 0.25 * v * Math.sin(ph / 2 + 0.4),
    pitch: -4 + k * (0.3 * v * Math.sin(ph + 0.9) - 1.1 * brake - 0.6 * push),
    roll: k * 0.55 * v * Math.sin(ph / 2),
    fov: POV_FOV,
    fade: 0,
  };
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
  return { x: cx + drift, y: -Math.sin(p) * dist, z: -(cd - Math.cos(p) * dist), yaw: drift * 1.5, pitch, roll: 0, fov, fade: Math.max(0, 1 - t / 0.8) };
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
    roll: lerp(a.roll, b.roll, e),
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
    return { t, segment, camera: mixPose(briefingPose(s, tl.briefingEnd, aspect), povPose(start, t, shakeOf(s)), u), arrows, rep: null, shooter: start };
  }
  if (segment === 'outro') {
    return { t, segment, camera: { ...povPose(start, t, shakeOf(s)), fade: Math.min(0.6, (t - tl.stageEnd) / 1.2) }, arrows: null, rep: null, shooter: start };
  }
  return runFrameAt(s, tl.schedule, t - tl.flyInEnd, t, T.resetFade);
};

/**
 * The shooter's view during the reps: `local` = seconds on the rep schedule (0 = its start),
 * `t` = the clock for the head movement. Also used by the TV, on the phone's schedule.
 */
export const runFrameAt = (s: Stage3D, schedule: Schedule, local: number, t = local, resetFade = VIDEO_TIMING.resetFade): FrameState => {
  const timing = stageTiming(s);
  const rep = snapshotAt(schedule, local, timing);
  const par = timing.parTime;
  // during the par window and the "TIME" second the shooter is on the path; then back to the start
  const onPath = rep.phase === 'active' || (rep.phase === 'reset' && rep.sinceStart < par + 1);
  const shooter = onPath ? shooterAt(s, Math.min(rep.sinceStart, par)) : shooterAt(s, 0);
  const camera = povPose(shooter, t, shakeOf(s));
  // walking back to the start between reps happens behind a short black fade
  if (rep.phase === 'reset' && s.positions.length > 1) {
    const back = rep.sinceStart - (par + 1);
    camera.fade = back >= -resetFade && back < resetFade ? 1 - Math.abs(back) / resetFade : 0;
  }
  return { t, segment: 'stage', camera, arrows: null, rep, shooter };
};

/** Standing in the start box, nothing running (TV between runs, editor preview). */
export const startFrame = (s: Stage3D): FrameState => {
  const shooter = shooterAt(s, 0);
  return { t: 0, segment: 'stage', camera: povPose(shooter, 0, 0), arrows: null, rep: null, shooter };
};
