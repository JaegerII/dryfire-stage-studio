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

type LegKey = 'FL' | 'FR' | 'HL' | 'HR';
interface GaitDef {
  stride: number;
  duty: number;
  phase: Record<LegKey, number>;
  amp: [number, number];
  flex: [number, number];
  stance: [number, number];
  bob: number;
  rock: number;
  head: number;
  nod: number;
  tail: number;
}
/** hunt.py GAITS (keep both in step). */
export const GAIT_MOTION: Record<Gait, GaitDef> = {
  trot: { stride: 1.15, duty: 0.56, phase: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, amp: [22, 20], flex: [70, -45], stance: [6, -5], bob: 0.016, rock: 1.2, head: 3, nod: 1.5, tail: 15 },
  gallop: { stride: 2.1, duty: 0.38, phase: { FL: 0, FR: 0.1, HL: 0.5, HR: 0.6 }, amp: [40, 36], flex: [95, -70], stance: [10, -8], bob: 0.035, rock: 5, head: 7, nod: 5, tail: 115 },
};
/** hunt.py WANDER / SPEED_VAR. */
const WANDER = 0.35;
const SPEED_VAR = 0.06;

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
  /** Random phases of the group surge, the sideways wander and the speed variation (hunt.py sp, wp, vp). */
  sp: number;
  wp: number;
  vp: number;
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
        ...(() => {
          const r = mulberry(n);
          return { sp: r.random() * 6.3, wp: r.random() * 6.3, vp: r.random() * 6.3 };
        })(),
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
  /** Direction of travel (radians, lane coords: 0 = +x). */
  heading: number;
  /** Blender euler angles (radians) of the parts. */
  body: { bob: number; rx: number; ry: number };
  neck: number;
  tail: { rx: number; ry: number };
  legs: Record<LegKey, { up: number; lo: number }>;
}

/** hunt.py gait_pose at time t. */
export const poseAt = (a: AnimalTrack, t: number): AnimalPose => {
  const g = GAIT_MOTION[a.gait];
  const place = (tt: number) => {
    const run = Math.max(0, tt - a.t0);
    const ramp = Math.min(1, run);
    const dist = a.speed * (run + (SPEED_VAR / 0.9) * (Math.cos(a.vp) - Math.cos(0.9 * run + a.vp))) + a.surge * Math.sin(run * 2.7 + a.sp) * ramp;
    return { dist, x: a.x0 + a.dir * dist, y: a.y + WANDER * Math.sin(0.45 * run + a.wp) * ramp };
  };
  const { dist, x, y } = place(t);
  const arrived = (x - a.x1) * a.dir >= 0;
  const moving = t >= a.t0 && !arrived;
  const parked = t < a.t0 - 1 / 30 || arrived;
  let heading = a.dir > 0 ? 0 : Math.PI;
  if (moving) {
    const n = place(t + 0.02);
    heading = Math.atan2(n.y - y, n.x - x);
  }
  const legs = {} as AnimalPose['legs'];
  if (!moving) {
    for (const k of ['FL', 'FR', 'HL', 'HR'] as const) legs[k] = { up: 0, lo: 0 };
    return { visible: !parked, x, y, heading, body: { bob: 0, rx: 0, ry: 0 }, neck: 0, tail: { rx: 0, ry: 5 * DEG }, legs };
  }
  const cyc = dist / (g.stride * a.scale) + a.phase0;
  const c = 2 * Math.PI * cyc;
  const pitch = g.rock * DEG * Math.sin(c + 0.6);
  for (const k of ['FL', 'FR', 'HL', 'HR'] as const) {
    const i = k[0] === 'F' ? 0 : 1;
    const p = (((cyc + g.phase[k]) % 1) + 1) % 1;
    const A = g.amp[i] * DEG;
    if (p < g.duty) {
      const u = p / g.duty;
      legs[k] = { up: A * (1 - 2 * u), lo: g.stance[i] * DEG * Math.sin(Math.PI * u) };
    } else {
      const u = (p - g.duty) / (1 - g.duty);
      legs[k] = { up: -A + 2 * A * u * u * (3 - 2 * u), lo: g.flex[i] * DEG * Math.sin(Math.PI * u) };
    }
  }
  return {
    visible: !parked,
    x,
    y,
    heading,
    body: { bob: g.bob * (a.gait === 'trot' ? Math.cos(2 * c) : Math.cos(c)), rx: 0.02 * Math.sin(c), ry: pitch },
    neck: g.head * DEG - 0.6 * pitch + g.nod * DEG * Math.sin((a.gait === 'trot' ? 2 : 1) * c + 1.4),
    tail: { rx: 0.15 * Math.sin(c + 1), ry: (g.tail + 8 * Math.sin(c)) * DEG },
    legs,
  };
};
