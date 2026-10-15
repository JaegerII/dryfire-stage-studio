/**
 * Motion analysis of one repetition â€” a state machine fed with body frames:
 *
 *   READY â†’ MOVEMENT â†’ PRESENTATION â†’ STABILIZATION â†’ COMPLETE
 *
 *   READY          armed before the start signal; hands are expected to be still
 *   MOVEMENT       first hand movement after the signal was confirmed
 *   PRESENTATION   hands reached the configured presentation zone (still moving)
 *   STABILIZATION  hands in the zone and slow; waiting for the hold time
 *   COMPLETE       held still long enough â€” or the par window ran out
 *
 * Every transition is decided by explicit, measurable criteria (speeds and
 * positions in torso units, see features.ts). The presentation zone describes
 * WHERE THE HANDS ARE relative to the body. It says nothing about whether a
 * device is aimed at a target, and nothing here claims that.
 *
 * Event times are interpolated between the two frames that bracket a change,
 * and every event carries a confidence (tracking quality) and an uncertainty
 * (frame spacing + tracking gaps) in ms.
 */
import type { Vec2 } from '../pose/landmarks';
import { type BodyFrame, len, sub } from './features';

export type MotionState = 'READY' | 'MOVEMENT' | 'PRESENTATION' | 'STABILIZATION' | 'COMPLETE';

export type MotionEventType =
  | 'signal'
  | 'early_movement'
  | 'first_movement'
  | 'presentation_reached'
  | 'stabilized'
  | 'position_change_start'
  | 'position_reached'
  | 'tracking_lost'
  | 'tracking_restored'
  | 'timeout';

export interface MotionEvent {
  type: MotionEventType;
  /** Local performance clock, ms. */
  t: number;
  /** 0..1 â€” tracking quality around the event. */
  confidence: number;
  /** Â± ms around `t`. */
  uncertaintyMs: number;
  note?: string;
}

export interface PresentationZone {
  /** Hands at most this far above the shoulder line (torso units). */
  maxAbove: number;
  /** â€¦ and at most this far below it. */
  maxBelow: number;
  /** Max sideways distance from the body centre line. */
  maxSide: number;
  /** Two hands count as "together" within this distance. */
  maxGap: number;
  requireTwoHands: boolean;
  /** Min estimated arm extension toward the camera, meters (used only when the detector supplies depth). */
  minExtension: number;
}

export interface AnalyzerConfig {
  /** 1 = default; 2 = thresholds halved (reacts to smaller / slower movement). */
  sensitivity: number;
  /** Hand travel from the rest position that confirms a movement, torso units. */
  onsetDisplacement: number;
  /** Hand speed that counts as moving, torso units / s. */
  onsetSpeed: number;
  /** Below this the hands count as still, torso units / s. */
  stableSpeed: number;
  stableHoldMs: number;
  zone: PresentationZone;
  /** Frames below this quality score are skipped. */
  minQuality: number;
  /** A gap longer than this is reported as tracking loss. */
  maxGapMs: number;
  /** Hip travel that counts as a position change, torso units. */
  positionShift: number;
  /** Speeds are measured over this window, ms. */
  speedWindowMs: number;
  /** Hand jitter of the still athlete from calibration (torso units / s) â€” thresholds never go below 3Ã— this. */
  noiseFloor?: number;
}

export const DEFAULT_ANALYZER: AnalyzerConfig = {
  sensitivity: 1,
  onsetDisplacement: 0.12,
  onsetSpeed: 0.45,
  stableSpeed: 0.35,
  stableHoldMs: 200,
  zone: { maxAbove: 0.7, maxBelow: 0.45, maxSide: 0.6, maxGap: 0.5, requireTwoHands: false, minExtension: 0.3 },
  minQuality: 0.5,
  maxGapMs: 150,
  positionShift: 0.6,
  speedWindowMs: 40,
};

export interface RepWindow {
  rep: number;
  /** Start signal on the local clock, ms. */
  signalT: number;
  /** Â± ms of the signal time itself (clock sync + audio latency). */
  signalUncertaintyMs: number;
  /** Analysis ends here (end of par + grace), ms. */
  endT: number;
}

export interface Measured {
  ms: number;
  uncertaintyMs: number;
  confidence: number;
}

export type RepStatus = 'complete' | 'no_presentation' | 'no_movement' | 'tracking_lost';

export interface RepResult {
  rep: number;
  signalT: number;
  status: RepStatus;
  earlyMovement: boolean;
  events: MotionEvent[];
  metrics: {
    /** Signal â†’ first movement. */
    reaction?: Measured;
    /** Signal â†’ hands in the presentation zone (NOT the time of a first shot). */
    presentation?: Measured;
    /** First movement â†’ presentation zone. */
    movement?: Measured;
    /** Presentation zone â†’ hands still. */
    stabilization?: Measured;
    /** Signal â†’ hands still in the zone. */
    total?: Measured;
  };
  framesUsed: number;
  framesSkipped: number;
  /** True when the presentation decision had depth (arm extension) available. */
  usedDepth: boolean;
}

interface Sample {
  f: BodyFrame;
  /** Active hand position (torso units). */
  hand: Vec2 | null;
  speed: number;
  hipSpeed: number;
  inZone: boolean;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class RepAnalyzer {
  state: MotionState = 'READY';
  readonly events: MotionEvent[] = [];
  private cfg: AnalyzerConfig;
  private hist: Sample[] = [];
  private lastOkT = -Infinity;
  private lostAt: number | null = null;
  /** Gap (ms) that preceded the current sample â€” feeds the event uncertainty. */
  private gapBefore = 0;
  private restLeft: Vec2 | null = null;
  private restRight: Vec2 | null = null;
  private restHip: Vec2 | null = null;
  private holdStart: number | null = null;
  private holdConf = 1;
  private zoneRun = 0;
  private outRun = 0;
  private posMoving = false;
  private posStillSince: number | null = null;
  private early = false;
  private skipped = 0;
  private used = 0;
  private usedDepth = false;
  private done = false;

  constructor(
    readonly window: RepWindow,
    config: Partial<AnalyzerConfig> = {},
  ) {
    this.cfg = { ...DEFAULT_ANALYZER, ...config, zone: { ...DEFAULT_ANALYZER.zone, ...config.zone } };
    this.events.push({ type: 'signal', t: window.signalT, confidence: 1, uncertaintyMs: window.signalUncertaintyMs });
  }

  /** Effective threshold: scaled by sensitivity, never below the calibrated noise. */
  private th(base: number) {
    return Math.max(base / Math.max(0.25, this.cfg.sensitivity), 3 * (this.cfg.noiseFloor ?? 0));
  }

  private emit(type: MotionEventType, t: number, confidence: number, uncertaintyMs: number, note?: string) {
    this.events.push({ type, t, confidence: Math.max(0, Math.min(1, confidence)), uncertaintyMs, note });
  }

  private zone(hand: Vec2, f: BodyFrame, together: boolean): boolean {
    const z = this.cfg.zone;
    if (hand.y < -z.maxAbove || hand.y > z.maxBelow || Math.abs(hand.x) > z.maxSide) return false;
    if (z.requireTwoHands && !together) return false;
    if (f.extension !== null) return f.extension >= z.minExtension;
    return true;
  }

  /** Feed the next frame (frames must arrive in time order). */
  push(f: BodyFrame | null, t = f?.t ?? NaN) {
    if (this.done || !Number.isFinite(t)) return;
    if (t >= this.window.endT) return this.finishAt(t);
    if (!f || !f.ok) {
      this.skipped++;
      if (this.lostAt === null && t - this.lastOkT > this.cfg.maxGapMs && Number.isFinite(this.lastOkT)) {
        this.lostAt = this.lastOkT;
        this.emit('tracking_lost', this.lastOkT, 1, 0);
      }
      return;
    }
    this.gapBefore = Number.isFinite(this.lastOkT) ? t - this.lastOkT : 0;
    if (this.lostAt !== null) {
      this.emit('tracking_restored', t, f.conf, 0, `gap ${Math.round(t - this.lostAt)} ms`);
      this.lostAt = null;
    }
    this.lastOkT = t;

    // active hand: both hands together â†’ their centre, otherwise the one that left its rest position most
    const together = !!(f.left && f.right && len(sub(f.left, f.right)) <= this.cfg.zone.maxGap);
    let hand: Vec2 | null = together ? { x: (f.left!.x + f.right!.x) / 2, y: (f.left!.y + f.right!.y) / 2 } : null;
    if (!hand) {
      const dl = f.left && this.restLeft ? len(sub(f.left, this.restLeft)) : -1;
      const dr = f.right && this.restRight ? len(sub(f.right, this.restRight)) : -1;
      hand = dl >= dr ? f.left ?? f.right : f.right ?? f.left;
    }
    // speeds over a short window instead of frame to frame: at 60 fps single-frame
    // differences are dominated by landmark jitter
    const p = this.refSample(t - this.cfg.speedWindowMs);
    const dt = p ? (t - p.f.t) / 1000 : 0;
    // speed of the fastest visible hand: either hand starting to move is a movement
    let speed = 0;
    if (p && dt > 0) {
      const sp = (a: Vec2 | null, b: Vec2 | null) => (a && b ? len(sub(a, b)) / dt : 0);
      speed = Math.max(sp(f.left, p.f.left), sp(f.right, p.f.right));
    }
    const hipSpeed = p && dt > 0 ? len(sub(f.hip, p.f.hip)) / f.unit / dt : 0;
    const inZone = !!hand && this.zone(hand, f, together);
    if (inZone && f.extension !== null) this.usedDepth = true;
    const s: Sample = { f, hand, speed, hipSpeed, inZone };
    this.used++;
    this.hist.push(s);
    if (this.hist.length > 240) this.hist.shift();
    this.step(s, t);
  }

  /** Latest sample at or before `t` (the oldest one when none is that old). */
  private refSample(t: number) {
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].f.t <= t) return this.hist[i];
    return this.hist[0];
  }

  /** Time of a change between the previous and this sample (midpoint), with its uncertainty. */
  private bracket(s: Sample, before: Sample | undefined) {
    if (!before) return { t: s.f.t, unc: this.gapBefore / 2 };
    return { t: (before.f.t + s.f.t) / 2, unc: (s.f.t - before.f.t) / 2 };
  }

  private confAt(s: Sample) {
    // a long gap right before the event lowers the confidence
    const gap = this.gapBefore > this.cfg.maxGapMs ? 0.5 : 1;
    return s.f.conf * gap;
  }

  private captureRest() {
    const recent = this.hist.filter((h) => h.f.t >= this.window.signalT - 400 && h.f.t < this.window.signalT);
    const pool = recent.length ? recent : this.hist.slice(-1);
    const med = (pick: (h: Sample) => Vec2 | null) => {
      const v = pool.map(pick).filter((x): x is Vec2 => !!x);
      return v.length ? { x: median(v.map((a) => a.x)), y: median(v.map((a) => a.y)) } : null;
    };
    this.restLeft = med((h) => h.f.left);
    this.restRight = med((h) => h.f.right);
    const hip = med((h) => ({ x: h.f.hip.x / h.f.unit, y: h.f.hip.y / h.f.unit }));
    this.restHip = hip;
  }

  private displacement(s: Sample) {
    const d = (a: Vec2 | null, b: Vec2 | null) => (a && b ? len(sub(a, b)) : 0);
    return Math.max(d(s.f.left, this.restLeft), d(s.f.right, this.restRight));
  }

  /** Start of the current run of samples above `speed` â€” where the movement really began. */
  private runStart(speed: number) {
    let i = this.hist.length - 1;
    while (i > 0 && this.hist[i - 1].speed >= speed) i--;
    return i;
  }

  private step(s: Sample, t: number) {
    const onsetSpeed = this.th(this.cfg.onsetSpeed);
    const stableSpeed = this.th(this.cfg.stableSpeed);
    const disp = this.th(this.cfg.onsetDisplacement);

    if (t < this.window.signalT) {
      // READY: hands must stay still; sustained movement before the signal is flagged once
      const last2 = this.hist.slice(-2);
      if (!this.early && last2.length === 2 && last2.every((h) => h.speed >= onsetSpeed * 1.5)) {
        this.early = true;
        this.emit('early_movement', last2[0].f.t, this.confAt(s), (s.f.t - last2[0].f.t) / 2);
      }
      return;
    }
    if (!this.restLeft && !this.restRight) this.captureRest();

    this.trackPosition(s, t);

    switch (this.state) {
      case 'READY': {
        if (this.displacement(s) >= disp && s.speed >= onsetSpeed) {
          // walk back to where the speed first rose above a low threshold: the onset, not the confirmation
          const i = this.runStart(Math.max(onsetSpeed * 0.4, 2 * (this.cfg.noiseFloor ?? 0)));
          const { t: at, unc } = this.bracket(this.hist[i], this.hist[i - 1]);
          this.emit('first_movement', at, this.confAt(this.hist[i]), unc, at < this.window.signalT ? 'movement began before the signal' : undefined);
          this.state = 'MOVEMENT';
        }
        break;
      }
      case 'MOVEMENT': {
        this.zoneRun = s.inZone ? this.zoneRun + 1 : 0;
        if (this.zoneRun >= 2) {
          const first = this.hist[this.hist.length - 2];
          const { t: at, unc } = this.bracket(first, this.hist[this.hist.length - 3]);
          if (!this.events.some((e) => e.type === 'presentation_reached'))
            this.emit('presentation_reached', at, this.confAt(first) * (s.f.extension === null ? 0.7 : 1), unc, s.f.extension === null ? 'no depth estimate â€” zone from 2D position only' : undefined);
          this.state = 'PRESENTATION';
          this.outRun = 0;
        }
        break;
      }
      case 'PRESENTATION':
      case 'STABILIZATION': {
        this.outRun = s.inZone ? 0 : this.outRun + 1;
        if (this.outRun >= 2) {
          // left the zone again (e.g. re-gripping, moving to the next position): back to MOVEMENT
          this.state = 'MOVEMENT';
          this.zoneRun = 0;
          this.holdStart = null;
          break;
        }
        if (s.speed < stableSpeed && s.inZone) {
          if (this.holdStart === null) {
            const { t: at } = this.bracket(s, this.hist[this.hist.length - 2]);
            this.holdStart = at;
            this.holdConf = this.confAt(s);
            this.state = 'STABILIZATION';
          } else if (t - this.holdStart >= this.cfg.stableHoldMs) {
            const unc = (this.hist.length > 1 ? s.f.t - this.hist[this.hist.length - 2].f.t : 0) / 2;
            this.emit('stabilized', this.holdStart, Math.min(this.holdConf, this.confAt(s)), unc);
            this.state = 'COMPLETE';
          }
        } else if (s.speed >= stableSpeed) {
          this.holdStart = null;
          this.state = 'PRESENTATION';
        }
        break;
      }
      case 'COMPLETE':
        break;
    }
  }

  /** Position changes: hip centre travel, independent of the draw state machine. */
  private trackPosition(s: Sample, t: number) {
    if (!this.restHip) return;
    const hip = { x: s.f.hip.x / s.f.unit, y: s.f.hip.y / s.f.unit };
    const shift = len(sub(hip, this.restHip));
    if (!this.posMoving && shift >= this.cfg.positionShift && s.hipSpeed >= this.th(0.5)) {
      let i = this.hist.length - 1;
      while (i > 0 && this.hist[i - 1].hipSpeed >= this.th(0.25)) i--;
      const { t: at, unc } = this.bracket(this.hist[i], this.hist[i - 1]);
      this.emit('position_change_start', at, this.confAt(s), unc);
      this.posMoving = true;
      this.posStillSince = null;
    } else if (this.posMoving) {
      if (s.hipSpeed < this.th(0.2)) {
        this.posStillSince ??= t;
        if (t - this.posStillSince >= 300) {
          this.emit('position_reached', this.posStillSince, this.confAt(s), (s.f.t - (this.hist.at(-2)?.f.t ?? s.f.t)) / 2);
          this.posMoving = false;
          this.restHip = hip;
        }
      } else this.posStillSince = null;
    }
  }

  private finishAt(t: number) {
    if (this.done) return;
    if (this.state !== 'COMPLETE') this.emit('timeout', Math.min(t, this.window.endT), 1, 0, `state ${this.state}`);
    this.state = 'COMPLETE';
    this.done = true;
  }

  get finished() {
    return this.done;
  }

  /** Close the analysis (if not done yet) and compute the rep result. */
  result(): RepResult {
    this.finishAt(this.window.endT);
    const w = this.window;
    const ev = (type: MotionEventType) => this.events.find((e) => e.type === type);
    const signal = ev('signal')!;
    const first = ev('first_movement');
    const pres = ev('presentation_reached');
    const stable = ev('stabilized');
    const span = (a: MotionEvent | undefined, b: MotionEvent | undefined): Measured | undefined =>
      a && b ? { ms: b.t - a.t, uncertaintyMs: a.uncertaintyMs + b.uncertaintyMs, confidence: Math.min(a.confidence, b.confidence) } : undefined;
    const lost = this.events.some((e) => e.type === 'tracking_lost');
    const status: RepStatus = stable ? 'complete' : !first ? (lost ? 'tracking_lost' : 'no_movement') : lost ? 'tracking_lost' : 'no_presentation';
    return {
      rep: w.rep,
      signalT: w.signalT,
      status,
      earlyMovement: this.early || (!!first && first.t < w.signalT),
      events: [...this.events].sort((a, b) => a.t - b.t),
      metrics: {
        reaction: span(signal, first),
        presentation: span(signal, pres),
        movement: span(first, pres),
        stabilization: span(pres, stable),
        total: span(signal, stable),
      },
      framesUsed: this.used,
      framesSkipped: this.skipped,
      usedDepth: this.usedDepth,
    };
  }
}
