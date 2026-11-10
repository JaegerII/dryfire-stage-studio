/**
 * Calibration of the body camera: placement check, neutral stance, comfort
 * limits left / right and the largest comfortable turn. Pure logic driven by
 * timestamps and BodyFeatures — the UI only shows the prompts it returns.
 *
 * Coordinates: "lateral" is the PERSON's left-right axis as seen by the phone:
 * a person facing the phone has their right side on the image's left, so
 * lateral = −image x (flip = −1). Positive lateral = person's right.
 */
import { LM, type PoseFrame } from '../pose/landmarks';
import type { BodyFeatures } from './bodyFeatures';

export const BODY_CAL_VERSION = 1;

/** Typical anthropometry (shoulder joint → hip joint ≈ 0.29 × body height), for the optional metres scale. */
export const TORSO_PER_HEIGHT = 0.29;

export interface BodyCalibration {
  version: number;
  at: number;
  /** Image x → lateral sign: −1 = person's right is image left (camera faces the person). */
  flip: 1 | -1;
  /** Neutral stance at the centre mark. */
  hipX0: number;
  shoulderW0: number;
  torso0: number;
  headY0: number;
  noseDx0: number;
  /** Comfort limits as lateral px from the neutral hip x: left < 0 < right. */
  limitLeftPx: number;
  limitRightPx: number;
  /** Largest comfortable body turn, degrees (positive; each side). */
  turnLeftDeg: number;
  turnRightDeg: number;
  /** Optional: body height, metres — gives px → metres (informational; the lane mapping does not need it). */
  bodyHeightM?: number;
  /** Frame size the pixel values refer to. */
  frameW: number;
  frameH: number;
  warnings: string[];
}

// ------------------------------------------------------------------ turn from the shoulder line

/** Body turn away from frontal, degrees: |cos θ| = shoulder width / frontal shoulder width. */
export const turnMagnitudeDeg = (shoulderW: number, shoulderW0: number) => {
  const r = Math.max(0, Math.min(1, shoulderW / Math.max(1e-6, shoulderW0)));
  return (Math.acos(r) * 180) / Math.PI;
};

/** Nose x relative to the neutral stance, as a fraction of the frontal shoulder width, lateral sign. */
export const noseLateral = (f: BodyFeatures, c: Pick<BodyCalibration, 'noseDx0' | 'shoulderW0' | 'flip'>) => (c.flip * (f.noseDx - c.noseDx0)) / Math.max(1e-6, c.shoulderW0);

/** Dead band of the nose cue (fraction of shoulder width); inside it the previous sign is kept. */
export const NOSE_DEADBAND = 0.03;

/**
 * Signed turn, degrees, + = to the person's right: magnitude from the shoulder
 * line, sign from the nose offset (the nose sits in front of the shoulder plane,
 * so it moves towards the side the body turns to).
 */
export const signedTurnDeg = (f: BodyFeatures, c: Pick<BodyCalibration, 'noseDx0' | 'shoulderW0' | 'flip'>, prevSign = 1): { deg: number; sign: 1 | -1 } => {
  const n = noseLateral(f, c);
  const sign: 1 | -1 = Math.abs(n) < NOSE_DEADBAND ? (prevSign < 0 ? -1 : 1) : n < 0 ? -1 : 1;
  return { deg: sign * turnMagnitudeDeg(f.shoulderW, c.shoulderW0), sign };
};

// ------------------------------------------------------------------ placement check

export interface PlacementItem {
  id: 'person' | 'whole_body' | 'distance' | 'centered' | 'light';
  ok: boolean;
  text: string;
}

export interface PlacementReport {
  ok: boolean;
  items: PlacementItem[];
  /** Body height as a fraction of the frame height (shoulder-to-ankle estimate), null if unknown. */
  heightFraction: number | null;
}

const BODY_POINTS = [LM.nose, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle];

/** Frame height fraction the whole body should fill: big enough for precision, small enough to leave sideways room. */
export const HEIGHT_RANGE: [number, number] = [0.55, 0.85];

export const checkPlacement = (f: PoseFrame, luma?: number): PlacementReport => {
  const p = f.points;
  const items: PlacementItem[] = [];
  if (!p || p.length < 33) {
    return { ok: false, items: [{ id: 'person', ok: false, text: 'No person detected — step into the picture.' }], heightFraction: null };
  }
  items.push({ id: 'person', ok: true, text: 'Person detected' });

  const inside = BODY_POINTS.every((i) => p[i].visibility >= 0.5 && p[i].x > 0.01 && p[i].x < 0.99 && p[i].y > 0.01 && p[i].y < 0.99);
  items.push({ id: 'whole_body', ok: inside, text: inside ? 'Whole body visible (head to ankles)' : 'Whole body must be visible, head to ankles — tilt the phone or step back.' });

  // head (nose) to ankle mean ≈ 0.9 × body height
  const ankleY = (p[LM.leftAnkle].y + p[LM.rightAnkle].y) / 2;
  const heightFraction = inside ? (ankleY - p[LM.nose].y) / 0.9 : null;
  const distOk = heightFraction !== null && heightFraction >= HEIGHT_RANGE[0] && heightFraction <= HEIGHT_RANGE[1];
  items.push({
    id: 'distance',
    ok: distOk,
    text:
      heightFraction === null
        ? 'Distance unknown until the whole body is visible.'
        : heightFraction < HEIGHT_RANGE[0]
          ? 'Too far from the phone — step closer (2–3 m).'
          : heightFraction > HEIGHT_RANGE[1]
            ? 'Too close — step back (you need room to move sideways).'
            : 'Distance fine',
  });

  const hipX = (p[LM.leftHip].x + p[LM.rightHip].x) / 2;
  const centered = Math.abs(hipX - 0.5) < 0.1;
  items.push({ id: 'centered', ok: centered, text: centered ? 'Standing in the middle of the picture' : 'Stand in the middle of the picture (centre mark) — move the phone or yourself.' });

  const lightOk = luma === undefined || (luma >= 60 && luma <= 225);
  items.push({ id: 'light', ok: lightOk, text: lightOk ? 'Light fine' : luma! < 60 ? 'Too dark — add light in front of you, not behind.' : 'Too bright / backlit — avoid windows behind you.' });

  return { ok: items.every((i) => i.ok), items, heightFraction };
};

// ------------------------------------------------------------------ guided calibration

export type CalStepId = 'neutral' | 'left' | 'right' | 'turnLeft' | 'turnRight';

export interface CalStep {
  id: CalStepId;
  /** Shown on the phone and on the TV. */
  prompt: string;
  /** Time to get into the pose, ms. */
  prepMs: number;
  /** Time the pose is held and measured, ms. */
  holdMs: number;
}

export const CAL_STEPS: CalStep[] = [
  { id: 'neutral', prompt: 'Stand on the centre mark, face the phone, arms relaxed', prepMs: 2500, holdMs: 3000 },
  { id: 'left', prompt: 'Step LEFT as far as is comfortable — and hold', prepMs: 3000, holdMs: 1600 },
  { id: 'right', prompt: 'Step RIGHT as far as is comfortable — and hold', prepMs: 3500, holdMs: 1600 },
  { id: 'turnLeft', prompt: 'Back to centre, turn your body LEFT as far as is comfortable — and hold', prepMs: 3500, holdMs: 1600 },
  { id: 'turnRight', prompt: 'Turn your body RIGHT as far as is comfortable — and hold', prepMs: 3500, holdMs: 1600 },
];

export type CalPhase = 'prep' | 'hold' | 'done' | 'failed';

export interface CalStatus {
  phase: CalPhase;
  step: number;
  id: CalStepId;
  prompt: string;
  /** 0..1 within the current phase. */
  progress: number;
  /** ms left in the current phase. */
  remainingMs: number;
  problems: string[];
  result?: BodyCalibration;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};
const percentile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

/** Frames of a hold window needed, as a share of the expected count at 15 fps (a slow phone still passes). */
const MIN_HOLD_FRAMES = 8;

export interface CalibratorOptions {
  frameW: number;
  frameH: number;
  flip?: 1 | -1;
  bodyHeightM?: number;
  steps?: CalStep[];
}

/**
 * Feed every frame (null = person lost) with its time; it walks through the
 * steps by the clock. Poses are measured as the median over the hold window,
 * from its second half only (the person is settled by then).
 */
export class BodyCalibrator {
  private steps: CalStep[];
  private stepStart: number | null = null;
  private idx = 0;
  private hold: BodyFeatures[] = [];
  private holdTotal = 0;
  private neutral: Pick<BodyCalibration, 'hipX0' | 'shoulderW0' | 'torso0' | 'headY0' | 'noseDx0'> | null = null;
  private left = 0;
  private right = 0;
  private turnL = 0;
  private turnR = 0;
  private problems: string[] = [];
  private warnings: string[] = [];
  private status: CalStatus;
  private flip: 1 | -1;
  private sign: 1 | -1 = 1;

  constructor(private o: CalibratorOptions) {
    this.steps = o.steps ?? CAL_STEPS;
    this.flip = o.flip ?? -1;
    this.status = this.mk('prep', 0, this.steps[0].prepMs, this.steps[0].prepMs);
  }

  private mk(phase: CalPhase, progress: number, remainingMs: number, _len: number): CalStatus {
    const s = this.steps[Math.min(this.idx, this.steps.length - 1)];
    return { phase, step: this.idx, id: s.id, prompt: s.prompt, progress, remainingMs, problems: this.problems };
  }

  get current() {
    return this.status;
  }

  feed(f: BodyFeatures | null, t: number): CalStatus {
    if (this.status.phase === 'done' || this.status.phase === 'failed') return this.status;
    this.stepStart ??= t;
    const step = this.steps[this.idx];
    const el = t - this.stepStart;
    if (el < step.prepMs) {
      this.status = this.mk('prep', el / step.prepMs, step.prepMs - el, step.prepMs);
      return this.status;
    }
    const heldFor = el - step.prepMs;
    // second half of the hold only
    this.holdTotal++;
    if (f && heldFor >= step.holdMs / 2) this.hold.push(f);
    if (heldFor < step.holdMs) {
      this.status = this.mk('hold', heldFor / step.holdMs, step.holdMs - heldFor, step.holdMs);
      return this.status;
    }
    if (!this.finishStep(step)) return this.status;
    this.idx++;
    this.hold = [];
    this.holdTotal = 0;
    if (this.idx >= this.steps.length) {
      this.status = { ...this.mk('done', 1, 0, 0), step: this.steps.length - 1, result: this.build() };
      return this.status;
    }
    this.stepStart = t;
    this.status = this.mk('prep', 0, this.steps[this.idx].prepMs, this.steps[this.idx].prepMs);
    return this.status;
  }

  private fail(msg: string) {
    this.problems = [...this.problems, msg];
    this.status = { ...this.mk('failed', 1, 0, 0), problems: this.problems };
  }

  private finishStep(step: CalStep): boolean {
    const h = this.hold;
    if (h.length < MIN_HOLD_FRAMES) {
      this.fail(`“${step.id}”: not enough tracked frames (${h.length}) — whole upper body must stay in view and well lit.`);
      return false;
    }
    const m = (k: keyof BodyFeatures) => median(h.map((x) => x[k]));
    if (step.id === 'neutral') {
      this.neutral = { hipX0: m('hipX'), shoulderW0: percentile(h.map((x) => x.shoulderW), 0.9), torso0: m('torso'), headY0: m('headY'), noseDx0: m('noseDx') };
      return true;
    }
    const n = this.neutral!;
    if (step.id === 'left' || step.id === 'right') {
      const lat = this.flip * (m('hipX') - n.hipX0);
      if (step.id === 'left') this.left = lat;
      else this.right = lat;
      return true;
    }
    // turns: signed angle at the hold, using the neutral baseline
    const cal = { noseDx0: n.noseDx0, shoulderW0: n.shoulderW0, flip: this.flip };
    const angles = h.map((x) => {
      const r = signedTurnDeg(x, cal, this.sign);
      this.sign = r.sign;
      return r.deg;
    });
    const a = median(angles);
    if (step.id === 'turnLeft') this.turnL = Math.max(0, -a);
    else this.turnR = Math.max(0, a);
    return true;
  }

  private build(): BodyCalibration {
    const n = this.neutral!;
    const warn = [...this.warnings];
    const minStep = 0.25 * n.torso0;
    let left = this.left;
    let right = this.right;
    if (left > -minStep) {
      warn.push('Left limit very small or on the wrong side — the step to the left was too short; using a default range.');
      left = -0.9 * n.torso0;
    }
    if (right < minStep) {
      warn.push('Right limit very small or on the wrong side — the step to the right was too short; using a default range.');
      right = 0.9 * n.torso0;
    }
    const MIN_TURN = 8;
    const DEFAULT_TURN = 25;
    let turnL = this.turnL;
    let turnR = this.turnR;
    if (turnL < MIN_TURN) {
      warn.push(`Left turn only ${turnL.toFixed(0)}° measured — using ${DEFAULT_TURN}°.`);
      turnL = DEFAULT_TURN;
    }
    if (turnR < MIN_TURN) {
      warn.push(`Right turn only ${turnR.toFixed(0)}° measured — using ${DEFAULT_TURN}°.`);
      turnR = DEFAULT_TURN;
    }
    return {
      version: BODY_CAL_VERSION,
      at: Date.now(),
      flip: this.flip,
      ...n,
      limitLeftPx: left,
      limitRightPx: right,
      turnLeftDeg: turnL,
      turnRightDeg: turnR,
      bodyHeightM: this.o.bodyHeightM,
      frameW: this.o.frameW,
      frameH: this.o.frameH,
      warnings: warn,
    };
  }
}

/** Metres per pixel at the body's distance, from the body height (optional scale). */
export const metersPerPx = (c: BodyCalibration) => (c.bodyHeightM ? (c.bodyHeightM * TORSO_PER_HEIGHT) / c.torso0 : null);
