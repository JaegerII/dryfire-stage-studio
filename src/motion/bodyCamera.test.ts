import { describe, expect, it } from 'vitest';
import { BodyCalibrator, type BodyCalibration, CAL_STEPS, checkPlacement, signedTurnDeg, turnMagnitudeDeg } from './bodyCalibration';
import { BodyCameraMapper, DEFAULT_BODY_MAP, deadZone, softClamp } from './bodyMapping';
import { extractBodyFeatures } from './bodyFeatures';
import { OneEuro } from './oneEuro';
import { H, NEUTRAL, W, bodyFeatures, bodyFrame, type SynthBody } from './testing/syntheticBody';

const CAL: BodyCalibration = {
  version: 1,
  at: 0,
  flip: -1,
  hipX0: NEUTRAL.cx,
  shoulderW0: NEUTRAL.shoulderW,
  torso0: NEUTRAL.torso,
  headY0: bodyFeatures().headY,
  noseDx0: 0,
  limitLeftPx: -100,
  limitRightPx: 120,
  turnLeftDeg: 25,
  turnRightDeg: 30,
  frameW: W,
  frameH: H,
  warnings: [],
};

describe('OneEuro', () => {
  it('passes the first value and converges to a constant', () => {
    const f = new OneEuro();
    expect(f.filter(5, 0)).toBe(5);
    let v = 0;
    for (let i = 1; i < 90; i++) v = f.filter(2, i / 30);
    expect(v).toBeCloseTo(2, 2);
  });
  it('is calm at rest (jitter damped) and quick in a fast move', () => {
    const calm = new OneEuro({ minCutoff: 1, beta: 0, dCutoff: 1 });
    const fast = new OneEuro({ minCutoff: 1, beta: 2, dCutoff: 1 });
    let jitterOut = 0;
    for (let i = 0; i < 90; i++) jitterOut = Math.max(jitterOut, i > 30 ? Math.abs(calm.filter(i % 2 ? 0.02 : -0.02, i / 30)) : (calm.filter(0, i / 30), 0));
    expect(jitterOut).toBeLessThan(0.015);
    // step from 0 to 1: with beta the filter follows sooner
    for (let i = 0; i < 30; i++) {
      calm.filter(0, 4 + i / 30);
      fast.filter(0, 4 + i / 30);
    }
    const a = calm.filter(1, 5.0);
    const b = fast.filter(1, 5.0);
    const a2 = calm.filter(1, 5.033);
    const b2 = fast.filter(1, 5.033);
    expect(b2).toBeGreaterThan(a2);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('shaping', () => {
  it('dead zone keeps the full range', () => {
    expect(deadZone(0.05, 0.1)).toBe(0);
    expect(deadZone(1, 0.1)).toBeCloseTo(1);
    expect(deadZone(-1, 0.1)).toBeCloseTo(-1);
    expect(deadZone(0.55, 0.1)).toBeCloseTo(0.5);
  });
  it('soft clamp is linear below the knee, monotone and bounded by 1', () => {
    expect(softClamp(0.5, 0.8)).toBe(0.5);
    let prev = -1;
    for (let u = 0; u < 5; u += 0.05) {
      const v = softClamp(u, 0.8);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(softClamp(3, 0.8)).toBeCloseTo(1, 2);
    expect(softClamp(-3, 0.8)).toBeCloseTo(-1, 2);
    // continuous at the knee
    expect(softClamp(0.8001, 0.8) - softClamp(0.7999, 0.8)).toBeLessThan(0.001);
  });
});

describe('turn', () => {
  it('magnitude follows the shoulder line (cos θ) and is 0 when frontal', () => {
    expect(turnMagnitudeDeg(110, 110)).toBe(0);
    expect(turnMagnitudeDeg(110 * Math.cos((30 * Math.PI) / 180), 110)).toBeCloseTo(30, 3);
    expect(turnMagnitudeDeg(130, 110)).toBe(0); // wider than frontal: clamped
  });
  it('sign comes from the nose offset', () => {
    expect(signedTurnDeg(bodyFeatures({ turn: 25 }), CAL).deg).toBeCloseTo(25, 1);
    expect(signedTurnDeg(bodyFeatures({ turn: -25 }), CAL).deg).toBeCloseTo(-25, 1);
  });
  it('keeps the previous sign inside the nose dead band', () => {
    const f = bodyFeatures({ turn: 2 });
    expect(signedTurnDeg(f, CAL, -1).sign).toBe(-1);
  });
});

describe('placement check', () => {
  it('passes for a centred whole body at the right distance', () => {
    expect(checkPlacement(bodyFrame(), 120).ok).toBe(true);
  });
  it('names each failure', () => {
    expect(checkPlacement({ ...bodyFrame(), points: null }).ok).toBe(false);
    const far = checkPlacement(bodyFrame({ heightFraction: 0.35 }), 120);
    expect(far.items.find((i) => i.id === 'distance')!.text).toMatch(/closer/);
    const close = checkPlacement(bodyFrame({ heightFraction: 0.95 }), 120);
    expect(close.ok).toBe(false);
    expect(checkPlacement(bodyFrame({ x: 0.8 }), 120).items.find((i) => i.id === 'centered')!.ok).toBe(false);
    expect(checkPlacement(bodyFrame(), 20).items.find((i) => i.id === 'light')!.ok).toBe(false);
    expect(checkPlacement(bodyFrame({ visible: false }), 120).items.find((i) => i.id === 'whole_body')!.ok).toBe(false);
  });
});

/** Drives the calibrator at 30 fps with a person who does what each step asks. */
const runCalibration = (pose: (id: string) => SynthBody, drop?: (id: string) => boolean) => {
  const cal = new BodyCalibrator({ frameW: W, frameH: H });
  let t = 1000;
  let st = cal.current;
  for (let i = 0; i < 4000 && st.phase !== 'done' && st.phase !== 'failed'; i++) {
    const id = st.id;
    const body = pose(id);
    const f = drop?.(id) ? null : bodyFeatures({ ...body, t });
    st = cal.feed(f, t);
    t += 1000 / 30;
  }
  return st;
};

describe('BodyCalibrator', () => {
  const person = (id: string): SynthBody => {
    switch (id) {
      case 'left': return { lateral: -90 };
      case 'right': return { lateral: 115 };
      case 'turnLeft': return { turn: -22 };
      case 'turnRight': return { turn: 28 };
      case 'leanLeft': return { lean: -0.3 };
      case 'leanRight': return { lean: 0.35 };
      default: return {};
    }
  };
  it('measures neutral, comfort limits and turn limits', () => {
    const st = runCalibration(person);
    expect(st.phase).toBe('done');
    const r = st.result!;
    expect(r.hipX0).toBeCloseTo(NEUTRAL.cx, 0);
    expect(r.torso0).toBeCloseTo(NEUTRAL.torso, 0);
    expect(r.limitLeftPx).toBeCloseTo(-90, 0);
    expect(r.limitRightPx).toBeCloseTo(115, 0);
    expect(r.turnLeftDeg).toBeCloseTo(22, 0);
    expect(r.turnRightDeg).toBeCloseTo(28, 0);
    expect(r.leanLeft).toBeCloseTo(-0.3, 1);
    expect(r.leanRight).toBeCloseTo(0.35, 1);
    expect(r.flip).toBe(-1);
    expect(r.warnings).toEqual([]);
  });
  it('detects reversed left / right and corrects it', () => {
    // a camera for which the person's right is on the image's RIGHT: everything the person does appears mirrored
    const mirrored = (id: string): SynthBody => {
      const b = person(id);
      return { ...b, lateral: b.lateral !== undefined ? -b.lateral : undefined, turn: b.turn !== undefined ? -b.turn : undefined, lean: b.lean !== undefined ? -b.lean : undefined };
    };
    const r = runCalibration(mirrored).result!;
    expect(r.flip).toBe(1);
    expect(r.limitLeftPx).toBeCloseTo(-90, 0);
    expect(r.limitRightPx).toBeCloseTo(115, 0);
    expect(r.turnLeftDeg).toBeCloseTo(22, 0);
    expect(r.leanRight).toBeCloseTo(0.35, 1);
    expect(r.warnings.join(' ')).toMatch(/reversed/);
  });
  it('falls back to defaults and warns when a step was too small', () => {
    const r = runCalibration((id) => (id === 'left' ? { lateral: -3 } : person(id))).result!;
    expect(r.limitLeftPx).toBeLessThan(-0.5 * NEUTRAL.torso);
    expect(r.warnings.join(' ')).toMatch(/Left limit/);
  });
  it('fails clearly when the person is not tracked', () => {
    const st = runCalibration(person, (id) => id === 'neutral');
    expect(st.phase).toBe('failed');
    expect(st.problems[0]).toMatch(/not enough tracked frames/);
  });
  it('walks the steps in order with prompts', () => {
    expect(CAL_STEPS.map((s) => s.id)).toEqual(['neutral', 'left', 'right', 'turnLeft', 'turnRight', 'leanLeft', 'leanRight']);
  });
});

const feed = (m: BodyCameraMapper, b: SynthBody, seconds = 2) => {
  let r = m.update(bodyFeatures({ ...b, t: 0 }), 0);
  for (let i = 1; i <= seconds * 30; i++) r = m.update(bodyFeatures({ ...b, t: i * 33.3 }), i * 33.3);
  return r;
};

describe('BodyCameraMapper', () => {
  const mk = () => new BodyCameraMapper(CAL, { ...DEFAULT_BODY_MAP });
  it('neutral stance = the stage view', () => {
    const o = feed(mk(), {}).offset;
    expect(o.dx).toBeCloseTo(0, 3);
    expect(o.dz).toBeCloseTo(0, 3);
    expect(o.yaw).toBeCloseTo(0, 3);
    expect(o.dy).toBeCloseTo(0, 3);
  });
  it('stepping right moves the camera right, left moves it left; the limit reaches the lane edge', () => {
    const r = feed(mk(), { lateral: 120 }).offset.dx;
    const l = feed(mk(), { lateral: -100 }).offset.dx;
    expect(r).toBeGreaterThan(0.6);
    expect(r).toBeLessThanOrEqual(DEFAULT_BODY_MAP.laneHalfWidth);
    expect(l).toBeLessThan(-0.6);
    expect(feed(mk(), { lateral: 60 }).offset.dx).toBeGreaterThan(0.2);
  });
  it('never leaves the lane, however far the person goes', () => {
    const o = feed(mk(), { lateral: 800 }).offset;
    expect(o.dx).toBeLessThanOrEqual(DEFAULT_BODY_MAP.laneHalfWidth + 1e-9);
    expect(feed(mk(), { lateral: -800 }).offset.dx).toBeGreaterThanOrEqual(-DEFAULT_BODY_MAP.laneHalfWidth - 1e-9);
  });
  it('lane width scales the result; dead zone swallows tiny sway', () => {
    const m = new BodyCameraMapper(CAL, { ...DEFAULT_BODY_MAP, laneHalfWidth: 0.4 });
    expect(feed(m, { lateral: 120 }).offset.dx).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(feed(mk(), { lateral: 3 }).offset.dx).toBe(0);
  });
  it('closer to the phone = forward, further = back', () => {
    expect(feed(mk(), { torso: NEUTRAL.torso * 1.15 }).offset.dz).toBeGreaterThan(0.1);
    expect(feed(mk(), { torso: NEUTRAL.torso * 0.85 }).offset.dz).toBeLessThan(-0.1);
  });
  it('turn: ±35° at the comfort limit, sign from the nose', () => {
    expect(feed(mk(), { turn: 30 }).offset.yaw).toBeGreaterThan(DEFAULT_BODY_MAP.maxYaw * 0.8);
    expect(feed(mk(), { turn: 30 }).offset.yaw).toBeLessThanOrEqual(DEFAULT_BODY_MAP.maxYaw);
    expect(feed(mk(), { turn: -25 }).offset.yaw).toBeLessThan(-DEFAULT_BODY_MAP.maxYaw * 0.8);
    expect(feed(mk(), { turn: 70 }).offset.yaw).toBeLessThanOrEqual(DEFAULT_BODY_MAP.maxYaw + 1e-9);
  });
  it('lower head = lower eye height (clamped), higher = a little up', () => {
    expect(feed(mk(), { up: -80 }).offset.dy).toBeLessThan(-0.15);
    expect(feed(mk(), { up: -2000 }).offset.dy).toBeGreaterThanOrEqual(-DEFAULT_BODY_MAP.heightDown - 1e-9);
    expect(feed(mk(), { up: 30 }).offset.dy).toBeGreaterThan(0);
  });
  it('leaning the upper body (hips still) tilts the view and moves the head to that side', () => {
    const r = feed(mk(), { lean: 0.3 }).offset;
    const l = feed(mk(), { lean: -0.3 }).offset;
    expect(r.roll).toBeGreaterThan(8);
    expect(r.dx).toBeGreaterThan(0.05);
    expect(l.roll).toBeLessThan(-8);
    expect(l.dx).toBeLessThan(-0.05);
    expect(Math.abs(r.roll)).toBeLessThanOrEqual(DEFAULT_BODY_MAP.maxRoll + 1e-9);
    // far less than walking to the lane edge
    expect(r.dx).toBeLessThan(0.4);
  });
  it('walking sideways with a straight body does not roll the view', () => {
    const o = feed(mk(), { lateral: 110 }).offset;
    expect(Math.abs(o.roll)).toBeLessThan(0.5);
    expect(o.dx).toBeGreaterThan(0.5);
  });
  it('lateral movement is independent of the turn channel', () => {
    const o = feed(mk(), { lateral: 100, turn: 0 }).offset;
    expect(Math.abs(o.yaw)).toBeLessThan(0.5);
  });
  it('tracking lost: holds, then eases back to the neutral view', () => {
    const m = mk();
    const held = feed(m, { lateral: 120 });
    let t = 2000;
    const early = m.update(null, (t += 100) + 100);
    expect(early.tracked).toBe(false);
    expect(early.offset.dx).toBeCloseTo(held.offset.dx, 1);
    const late = m.update(null, t + 3000);
    expect(late.offset.dx).toBeCloseTo(0, 6);
  });
  it('extractBodyFeatures rejects frames without a reliable torso', () => {
    expect(extractBodyFeatures({ ...bodyFrame(), points: null })).toBeNull();
    expect(extractBodyFeatures(bodyFrame({ visible: false }))).toBeNull();
    const f = extractBodyFeatures(bodyFrame())!;
    expect(f.torso).toBeCloseTo(NEUTRAL.torso, 0);
    expect(f.shoulderW).toBeCloseTo(NEUTRAL.shoulderW, 0);
  });
});
