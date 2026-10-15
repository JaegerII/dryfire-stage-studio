import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '../pose/landmarks';
import { assessQuality } from '../pose/quality';
import { type AnalyzerConfig, RepAnalyzer, type RepResult } from './analyzer';
import { toBodyFrame } from './features';
import { type HandsAt, PRESENT, REST, type SynthOptions, hold, makeFrames, sequence, tween } from './testing/syntheticPose';

const SIGNAL = 2000;
const END = 6000;

const run = (frames: PoseFrame[], cfg: Partial<AnalyzerConfig> = {}): RepResult => {
  const a = new RepAnalyzer({ rep: 1, signalT: SIGNAL, signalUncertaintyMs: 2, endT: END }, cfg);
  for (const f of frames) {
    const q = assessQuality(f);
    a.push(toBodyFrame(f, q, 0.5), f.t);
  }
  return a.result();
};

/** A draw: still until `start`, hands travel to the presentation zone in `dur` ms, then hold. */
const draw = (start: number, dur: number, o: SynthOptions, extra?: (t: number) => HandsAt | undefined) =>
  makeFrames(
    (t) => extra?.(t) ?? sequence([0, hold(REST)], [start, tween(REST, PRESENT, start, start + dur)], [start + dur, hold(PRESENT)])(t),
    1000,
    END + 100,
    o,
  );

const ev = (r: RepResult, type: string) => r.events.find((e) => e.type === type);

describe('RepAnalyzer — draw to presentation', () => {
  it('detects the phases in order with plausible timing (60 fps)', () => {
    const r = run(draw(SIGNAL + 250, 700, { fps: 60 }));
    expect(r.status).toBe('complete');
    expect(r.earlyMovement).toBe(false);
    const order = r.events.map((e) => e.type).filter((t) => t !== 'tracking_lost' && t !== 'tracking_restored');
    expect(order).toEqual(['signal', 'first_movement', 'presentation_reached', 'stabilized']);
    // threshold detection lags the true kinematic onset a little — bounded, never early
    expect(r.metrics.reaction!.ms).toBeGreaterThanOrEqual(240);
    expect(r.metrics.reaction!.ms).toBeLessThanOrEqual(310);
    // the hands enter the zone during the travel and stop at its end (950 ms after the signal)
    expect(r.metrics.presentation!.ms).toBeGreaterThan(400);
    expect(r.metrics.presentation!.ms).toBeLessThan(950);
    expect(r.metrics.total!.ms).toBeGreaterThan(r.metrics.presentation!.ms);
    expect(r.metrics.total!.ms).toBeLessThan(1150);
    expect(r.usedDepth).toBe(true);
    for (const e of r.events) {
      expect(e.confidence).toBeGreaterThan(0.8);
      expect(e.uncertaintyMs).toBeLessThanOrEqual(10);
    }
  });

  it('gives the same reaction time for a small / distant athlete (body-size normalisation)', () => {
    const near = run(draw(SIGNAL + 300, 600, { fps: 60, scale: 1 }));
    const far = run(draw(SIGNAL + 300, 600, { fps: 60, scale: 0.55, cx: 0.35 }));
    expect(Math.abs(near.metrics.reaction!.ms - far.metrics.reaction!.ms)).toBeLessThanOrEqual(20);
    expect(Math.abs(near.metrics.total!.ms - far.metrics.total!.ms)).toBeLessThanOrEqual(40);
  });

  it('works at 30 fps with larger uncertainty', () => {
    const r = run(draw(SIGNAL + 250, 700, { fps: 30 }));
    expect(r.status).toBe('complete');
    expect(ev(r, 'first_movement')!.uncertaintyMs).toBeGreaterThan(10);
    expect(ev(r, 'first_movement')!.uncertaintyMs).toBeLessThanOrEqual(17);
  });

  it('reports no movement when the athlete stays still', () => {
    const r = run(makeFrames(hold(REST), 1000, END + 100, { fps: 60 }));
    expect(r.status).toBe('no_movement');
    expect(r.metrics.reaction).toBeUndefined();
    expect(ev(r, 'timeout')).toBeDefined();
  });

  it('does not confirm a presentation for hands that stop outside the zone', () => {
    const chest: HandsAt = { left: { x: 0.1, y: 0.75 }, right: { x: -0.1, y: 0.75 }, extension: 0.05 };
    const r = run(makeFrames(sequence([0, hold(REST)], [SIGNAL + 200, tween(REST, chest, SIGNAL + 200, SIGNAL + 700)], [SIGNAL + 700, hold(chest)]), 1000, END + 100, { fps: 60 }));
    expect(ev(r, 'first_movement')).toBeDefined();
    expect(ev(r, 'presentation_reached')).toBeUndefined();
    expect(r.status).toBe('no_presentation');
  });

  it('requires arm extension when depth is available', () => {
    const notExtended: HandsAt = { ...PRESENT, extension: 0.1 };
    const r = run(makeFrames(sequence([0, hold(REST)], [SIGNAL + 200, tween(REST, notExtended, SIGNAL + 200, SIGNAL + 800)], [SIGNAL + 800, hold(notExtended)]), 1000, END + 100, { fps: 60 }));
    expect(ev(r, 'presentation_reached')).toBeUndefined();
  });

  it('falls back to 2D zone without depth, with lower confidence', () => {
    const r = run(draw(SIGNAL + 250, 700, { fps: 60, world: false }));
    expect(r.status).toBe('complete');
    expect(r.usedDepth).toBe(false);
    const p = ev(r, 'presentation_reached')!;
    expect(p.confidence).toBeLessThan(0.75);
    expect(p.note).toMatch(/no depth/);
  });

  it('flags movement before the signal', () => {
    const r = run(draw(SIGNAL - 300, 700, { fps: 60 }));
    expect(r.earlyMovement).toBe(true);
    expect(ev(r, 'early_movement')).toBeDefined();
  });

  it('reports tracking loss and widens the uncertainty across a gap', () => {
    const base = sequence([0, hold(REST)], [SIGNAL + 250, tween(REST, PRESENT, SIGNAL + 250, SIGNAL + 950)], [SIGNAL + 950, hold(PRESENT)]);
    const r = run(makeFrames((t) => (t > SIGNAL + 230 && t < SIGNAL + 450 ? { ...REST, missing: true } : base(t)), 1000, END + 100, { fps: 60 }));
    expect(ev(r, 'tracking_lost')).toBeDefined();
    expect(ev(r, 'tracking_restored')).toBeDefined();
    const first = ev(r, 'first_movement')!;
    expect(first.uncertaintyMs).toBeGreaterThan(50);
    expect(first.confidence).toBeLessThanOrEqual(0.5);
  });

  it('respects sensitivity and the calibrated noise floor', () => {
    const r = run(draw(SIGNAL + 250, 700, { fps: 60 }), { noiseFloor: 5 });
    // thresholds forced to ≥ 15 torso units/s: an ordinary draw is not detected
    expect(r.status).toBe('no_movement');
  });
});

describe('RepAnalyzer — position change', () => {
  it('detects start and arrival of a sideways move', () => {
    const moved: HandsAt = { ...REST, hipShift: 1.6 };
    const r = run(makeFrames(sequence([0, hold(REST)], [SIGNAL + 300, tween(REST, moved, SIGNAL + 300, SIGNAL + 1300)], [SIGNAL + 1300, hold(moved)]), 1000, END + 100, { fps: 60 }));
    const start = ev(r, 'position_change_start')!;
    const reached = ev(r, 'position_reached')!;
    expect(start.t).toBeGreaterThan(SIGNAL + 250);
    expect(start.t).toBeLessThan(SIGNAL + 700);
    expect(reached.t).toBeGreaterThan(SIGNAL + 1000);
    expect(reached.t).toBeLessThan(SIGNAL + 1500);
    // hands stayed at rest relative to the body: no draw was detected
    expect(ev(r, 'first_movement')).toBeUndefined();
  });
});
