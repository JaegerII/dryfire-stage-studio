/**
 * Pose → camera offset. Pure functions plus one small stateful mapper (filters,
 * tracking-loss handling). The result is an OFFSET relative to the stage's own
 * start view, in the shooter's frame: dx to the right, dz forward, dy up (metres),
 * yaw to the right (degrees). The TV adds it to the view of the chosen position.
 */
import { type BodyCalibration, signedTurnDeg } from './bodyCalibration';
import type { BodyFeatures } from './bodyFeatures';
import { DEFAULT_ONE_EURO, OneEuro, type OneEuroParams } from './oneEuro';

export interface BodyOffset {
  /** metres, + = right */
  dx: number;
  /** metres, + = forward (downrange) */
  dz: number;
  /** metres, + = up */
  dy: number;
  /** degrees, + = look right */
  yaw: number;
  /** degrees, head tilt, + = right ear down (leaning to the right) */
  roll: number;
}

export const ZERO_OFFSET: BodyOffset = { dx: 0, dz: 0, dy: 0, yaw: 0, roll: 0 };

export interface BodyMapConfig {
  /** Half width of the lane in metres: the comfort limit on either side maps to this. */
  laneHalfWidth: number;
  /** Multiplier on the lateral mapping (1 = limit ↔ lane edge). Above 1 reaches the edge before the limit. */
  gain: number;
  /** Dead zone around the neutral stance, as a share of the comfort limit (0..0.5). */
  deadZone: number;
  /** Where the soft clamp begins, share of the lane (0..1). Beyond it the movement slows towards the edge. */
  knee: number;
  /** Forward / back travel at a ±20 % torso scale change, metres. 0 disables. */
  depthRange: number;
  /** Dead zone of the scale change (fraction of the neutral torso length). */
  depthDead: number;
  /** Camera yaw at the largest comfortable body turn, degrees. */
  maxYaw: number;
  /** Dead zone of the turn, share of the comfort turn. */
  yawDead: number;
  /** Camera roll at the comfortable upper-body lean, degrees; and the sideways head shift that goes with it, metres. */
  maxRoll: number;
  leanShift: number;
  leanDead: number;
  filterLean: OneEuroParams;
  /** Eye height travel in metres (down, up); 0 disables. */
  heightDown: number;
  heightUp: number;
  /** Dead zone of head height, fraction of the torso. */
  heightDead: number;
  /** One-Euro parameters per channel. */
  filterLateral: OneEuroParams;
  filterDepth: OneEuroParams;
  filterYaw: OneEuroParams;
  filterHeight: OneEuroParams;
  /** Tracking lost: hold the last view this long, then ease to the neutral view over `returnMs`. */
  lostHoldMs: number;
  returnMs: number;
}

export const DEFAULT_BODY_MAP: BodyMapConfig = {
  // the stage targets are 5-20 m away: a lateral camera move of 0.8 m barely shifts the picture, so the default lane is wide
  laneHalfWidth: 1.5,
  gain: 1,
  deadZone: 0.06,
  knee: 0.8,
  depthRange: 0.25,
  depthDead: 0.04,
  // yaw from the shoulder line is the noisiest channel (arccos near 0°): calm and conservative by default
  maxYaw: 25,
  yawDead: 0.3,
  maxRoll: 18,
  leanShift: 0.2,
  leanDead: 0.06,
  filterLean: { minCutoff: 1.0, beta: 0.4, dCutoff: 1 },
  heightDown: 0.5,
  heightUp: 0.1,
  heightDead: 0.04,
  filterLateral: { minCutoff: 1.5, beta: 0.8, dCutoff: 1 },
  filterDepth: { minCutoff: 0.8, beta: 0.3, dCutoff: 1 },
  filterYaw: { minCutoff: 0.5, beta: 0.15, dCutoff: 1 },
  filterHeight: { minCutoff: 0.8, beta: 0.3, dCutoff: 1 },
  lostHoldMs: 400,
  returnMs: 1500,
};

// ------------------------------------------------------------------ shaping functions

/** Dead zone that keeps the full range: |u| ≤ dz → 0, then rises linearly to 1 at |u| = 1. */
export const deadZone = (u: number, dz: number) => {
  const a = Math.abs(u);
  if (a <= dz) return 0;
  return Math.sign(u) * (a - dz) / (1 - dz);
};

/**
 * Soft clamp to ±1: linear up to `knee`, then eases asymptotically into ±1 (derivative
 * continuous at the knee) — the view slows down at the lane edge instead of hitting a wall.
 */
export const softClamp = (u: number, knee: number) => {
  const a = Math.abs(u);
  if (a <= knee) return u;
  const room = 1 - knee;
  return Math.sign(u) * (knee + room * Math.tanh((a - knee) / room));
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ stateless pieces

/** Lateral position in units of the comfort limit (−1 = left limit, +1 = right limit). */
export const lateralUnits = (f: BodyFeatures, c: BodyCalibration) => {
  const lat = c.flip * (f.hipX - c.hipX0);
  return lat >= 0 ? lat / Math.max(1, c.limitRightPx) : lat / Math.max(1, -c.limitLeftPx);
};

/** Upper-body lean relative to the neutral stance in units of the comfort lean (−1 left … +1 right). */
export const leanUnits = (f: BodyFeatures, c: BodyCalibration) => {
  const l = c.flip * f.lean - (c.lean0 ?? 0);
  return l >= 0 ? l / Math.max(0.05, c.leanRight ?? 0.3) : l / Math.max(0.05, -(c.leanLeft ?? -0.3));
};

/** Torso scale change relative to the neutral stance (+ = closer to the phone). */
export const depthUnits = (f: BodyFeatures, c: BodyCalibration) => f.torso / Math.max(1, c.torso0) - 1;

/** Eye-line height change in torso lengths (+ = higher). */
export const heightUnits = (f: BodyFeatures, c: BodyCalibration) => -(f.headY - c.headY0) / Math.max(1, f.torso);

/** Torso length, metres, for the height conversion (from the body height if known, else a 1.78 m person). */
const torsoMeters = (c: BodyCalibration) => 0.29 * (c.bodyHeightM ?? 1.78);

// ------------------------------------------------------------------ the mapper

export interface MapResult {
  offset: BodyOffset;
  /** false while the person is not tracked (the offset is then the held / easing value). */
  tracked: boolean;
  /** How long tracking has been lost, ms (0 while tracked). */
  lostMs: number;
  /** Raw measurements before shaping, for the debug overlay. */
  raw: { lateral: number; depth: number; turnDeg: number; height: number; lean: number } | null;
}

export class BodyCameraMapper {
  private fx = new OneEuro();
  private fz = new OneEuro();
  private fy = new OneEuro();
  private fh = new OneEuro();
  private fl = new OneEuro();
  private sign: 1 | -1 = 1;
  private lastT: number | null = null;
  private lastValidT = 0;
  private held: BodyOffset = ZERO_OFFSET;
  private lastRaw: MapResult['raw'] = null;

  constructor(
    public cal: BodyCalibration,
    public cfg: BodyMapConfig = DEFAULT_BODY_MAP,
  ) {
    this.applyFilterParams();
  }

  applyFilterParams() {
    this.fx.params = this.cfg.filterLateral;
    this.fz.params = this.cfg.filterDepth;
    this.fy.params = this.cfg.filterYaw;
    this.fh.params = this.cfg.filterHeight;
    this.fl.params = this.cfg.filterLean;
  }

  reset() {
    for (const f of [this.fx, this.fz, this.fy, this.fh, this.fl]) f.reset();
    this.lastT = null;
    this.held = ZERO_OFFSET;
  }

  /** `f` = null: no person this frame. Times in ms, increasing. */
  update(f: BodyFeatures | null, tMs: number): MapResult {
    const { cal: c, cfg } = this;
    if (!f) {
      const lost = this.lastT === null ? Infinity : tMs - this.lastValidT;
      const k = lost <= cfg.lostHoldMs ? 1 : 1 - clamp((lost - cfg.lostHoldMs) / cfg.returnMs, 0, 1);
      const e = k * k * (3 - 2 * k);
      const h = this.held;
      return { offset: { dx: h.dx * e, dz: h.dz * e, dy: h.dy * e, yaw: h.yaw * e, roll: h.roll * e }, tracked: false, lostMs: Number.isFinite(lost) ? lost : 0, raw: this.lastRaw };
    }
    const t = tMs / 1000;
    this.lastT = tMs;
    this.lastValidT = tMs;

    const turn = signedTurnDeg(f, c, this.sign);
    this.sign = turn.sign;
    const lat = this.fx.filter(lateralUnits(f, c) * cfg.gain, t);
    const dep = this.fz.filter(depthUnits(f, c), t);
    const yaw = this.fy.filter(turn.deg, t);
    const hgt = this.fh.filter(heightUnits(f, c), t);
    const lean = this.fl.filter(leanUnits(f, c), t);

    const leanU = softClamp(deadZone(clamp(lean, -3, 3), cfg.leanDead), cfg.knee);
    // hip movement walks the lane; the leaning upper body adds a small head shift and the tilt of the view
    const dx = softClamp(deadZone(clamp(lat, -3, 3), cfg.deadZone), cfg.knee) * cfg.laneHalfWidth + leanU * cfg.leanShift;
    const dz = cfg.depthRange === 0 ? 0 : softClamp(deadZone(clamp(dep / 0.2, -3, 3), cfg.depthDead / 0.2), cfg.knee) * cfg.depthRange;
    const turnLim = yaw >= 0 ? c.turnRightDeg : c.turnLeftDeg;
    const ya = softClamp(deadZone(clamp(yaw / Math.max(1, turnLim), -3, 3), cfg.yawDead), cfg.knee) * cfg.maxYaw;
    const hm = hgt * torsoMeters(c);
    const dy = hm >= 0 ? softClamp(deadZone(clamp(hm / Math.max(0.01, cfg.heightUp), -3, 3), cfg.heightDead), cfg.knee) * cfg.heightUp : -softClamp(deadZone(clamp(-hm / Math.max(0.01, cfg.heightDown), -3, 3), cfg.heightDead), cfg.knee) * cfg.heightDown;

    this.held = { dx, dz, dy, yaw: ya, roll: leanU * cfg.maxRoll };
    this.lastRaw = { lateral: lat, depth: dep, turnDeg: yaw, height: hgt, lean };
    return { offset: this.held, tracked: true, lostMs: 0, raw: this.lastRaw };
  }
}

/** Absolute lateral lane limits (metres) of a configuration, for the debug overlay. */
export const laneLimits = (cfg: BodyMapConfig) => ({ left: -cfg.laneHalfWidth, right: cfg.laneHalfWidth });

export { DEFAULT_ONE_EURO };
