/**
 * Where every animal of a scenario is at time t — the same math as hunt.py (scenario_game, rotte_layout,
 * animate_boar) on the same PRNG (mulberry32), so the live 3D preview shows the sounder exactly as
 * Blender renders it. Lane coordinates (meters): x right, y down the lane, z up.
 */
import { crossingLine } from './rules';
import type { GameClass, Gait, HuntFormat, HuntScenario } from './types';

/** mulberry32 (hunt.py: Mulberry). */
export const mulberry = (seed: number) => {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    random,
    uniform: (lo: number, hi: number) => lo + (hi - lo) * random(),
    gauss: (mu: number, sigma: number) => {
      const u1 = random();
      const u2 = random();
      return mu + sigma * Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
    },
  };
};
type Rng = ReturnType<typeof mulberry>;

/** hunt.py BOAR_KINDS: scale and leg length (young animals stand higher). */
export const KIND_BODY: Record<GameClass, { scale: number; legs: number }> = {
  keiler: { scale: 1.0, legs: 1.0 },
  bache: { scale: 0.85, legs: 1.0 },
  ueberlaeufer: { scale: 0.7, legs: 1.04 },
  frischling: { scale: 0.5, legs: 1.12 },
  frischling_gestreift: { scale: 0.33, legs: 1.15 },
};
/** Statue units → keiler size (hunt.py: 0.92 / STATUE_WITHERS). */
export const STATUE_SCALE = 0.92 / 0.84;

/** hunt.py GAITS. */
export const GAIT_MOTION: Record<Gait, { stride: number; phase: Record<'FL' | 'FR' | 'HL' | 'HR', number>; amp: [number, number]; flex: [number, number]; bob: number; rock: number; tail: number }> = {
  trot: { stride: 1.15, phase: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, amp: [24, 22], flex: [60, -35], bob: 0.018, rock: 1.2, tail: 15 },
  gallop: { stride: 2.1, phase: { FL: 0, FR: 0.12, HL: 0.52, HR: 0.64 }, amp: [44, 40], flex: [85, -55], bob: 0.035, rock: 6, tail: 115 },
};

const ORDER: Record<GameClass, number> = { bache: 0, keiler: 0, frischling_gestreift: 1, frischling: 1, ueberlaeufer: 2 };

/** hunt.py rotte_layout: (kind, distance behind the leader's nose, lateral offset, size) per animal. */
export const rotteLayout = (kinds: GameClass[], rng: Rng) => {
  const found = kinds.findIndex((k) => k === 'bache' || k === 'keiler');
  const lead = found < 0 ? 0 : found;
  const rest = kinds
    .filter((_, i) => i !== lead)
    .map((k) => ({ k, key: rng.random() }))
    .sort((a, b) => ORDER[a.k] - ORDER[b.k] || a.key - b.key)
    .map((r) => r.k);
  const out: { kind: GameClass; back: number; dy: number; size: number }[] = [];
  let back = 0;
  let prevLen = 0;
  [kinds[lead], ...rest].forEach((kind, i) => {
    const size = rng.uniform(0.92, 1.08);
    const length = 1.65 * KIND_BODY[kind].scale * size;
    if (i) {
      const young = kind.startsWith('frischling');
      const gap = young ? rng.uniform(0.1, 0.9) : rng.uniform(0.6, 2.2);
      const beside = young && rng.random() < 0.35;
      back += (beside ? prevLen * 0.5 : prevLen) + gap * (beside ? 0.3 : 1);
    }
    out.push({ kind, back, dy: i ? rng.gauss(0, 0.45) : 0, size });
    prevLen = length;
  });
  return out;
};

export interface AnimalTrack {
  kind: GameClass;
  size: number;
  /** Root scale as in Blender (kind × size × statue → keiler). */
  scale: number;
  gait: Gait;
  t0: number;
  x0: number;
  x1: number;
  y: number;
  speed: number;
  dir: 1 | -1;
  phase0: number;
  surge: number;
  sp: number;
}

/** hunt.py scenario_game: every animal of every crossing. */
export const scenarioTracks = (s: Pick<HuntScenario, 'map' | 'stand' | 'crossings'>, format: HuntFormat): AnimalTrack[] => {
  const tracks: AnimalTrack[] = [];
  let n = 0;
  for (const c of s.crossings) {
    const rng = mulberry(c.seed);
    const { y, xc, half, look } = crossingLine(s.map, s.stand, c.distance, format);
    // "from the left" as the hunter sees it: looking back down the lane, left is +x
    const dir = ((c.direction === 'ltr' ? 1 : -1) * look) as 1 | -1;
    const xStart = xc - dir * half;
    const xEnd = xc + dir * half;
    for (const a of rotteLayout(c.animals, rng)) {
      n += 1;
      tracks.push({
        kind: a.kind,
        size: a.size,
        scale: KIND_BODY[a.kind].scale * a.size * STATUE_SCALE,
        gait: c.gait,
        t0: c.at,
        x0: xStart - dir * a.back,
        x1: xEnd + dir * 0.5,
        y: y + a.dy,
        speed: c.speed,
        dir,
        phase0: rng.random(),
        surge: c.animals.length > 1 ? 0.25 : 0,
        sp: mulberry(n).random() * 6.3,
      });
    }
  }
  return tracks;
};

const DEG = Math.PI / 180;

export interface AnimalPose {
  visible: boolean;
  x: number;
  y: number;
  /** Blender euler angles (radians) of the parts. */
  body: { bob: number; rx: number; ry: number };
  tail: { rx: number; ry: number };
  legs: Record<'FL' | 'FR' | 'HL' | 'HR', { up: number; lo: number }>;
}

/** hunt.py animate_boar at time t. */
export const poseAt = (a: AnimalTrack, t: number): AnimalPose => {
  const g = GAIT_MOTION[a.gait];
  const run = Math.max(0, t - a.t0);
  const x = a.x0 + a.dir * (run * a.speed + a.surge * Math.sin(run * 2.7 + a.sp) * Math.min(1, run));
  const arrived = (x - a.x1) * a.dir >= 0;
  const moving = t >= a.t0 && !arrived;
  const phase = 2 * Math.PI * (Math.abs(x - a.x0) / (g.stride * a.scale) + a.phase0);
  const parked = t < a.t0 - 1 / 30 || arrived;
  const legs = {} as AnimalPose['legs'];
  for (const key of ['FL', 'FR', 'HL', 'HR'] as const) {
    const ph = phase + 2 * Math.PI * g.phase[key];
    const front = key[0] === 'F';
    if (!moving) legs[key] = { up: 0, lo: 0 };
    else {
      const swing = Math.max(0, Math.cos(ph)) ** 1.5;
      legs[key] = { up: -g.amp[front ? 0 : 1] * DEG * Math.sin(ph), lo: g.flex[front ? 0 : 1] * DEG * swing };
    }
  }
  return {
    visible: !parked,
    x,
    y: a.y,
    body: moving
      ? { bob: g.bob * (a.gait === 'trot' ? Math.cos(2 * phase) : Math.cos(phase)), rx: 0.02 * Math.sin(phase), ry: g.rock * DEG * Math.sin(phase + 0.6) }
      : { bob: 0, rx: 0, ry: 0 },
    tail: moving ? { rx: 0.15 * Math.sin(phase + 1), ry: (g.tail + 8 * Math.sin(phase)) * DEG } : { rx: 0, ry: 5 * DEG },
    legs,
  };
};
