/**
 * Setup calibration ("stand still for 3 seconds"): checks that the athlete
 * is tracked reliably at the training position and measures the landmark
 * jitter of the still body. The jitter becomes the analyzer's noise floor, so
 * movement thresholds adapt to camera, light and distance instead of being
 * guessed.
 *
 * This is a calibration of the TRACKING, not of aim: the TV is not visible to
 * the camera, so nothing here relates body pose to the screen.
 */
import { len, sub, type BodyFrame } from './features';

export interface CalibrationResult {
  ok: boolean;
  /** Fraction of frames with usable tracking. */
  usable: number;
  /** p95 hand speed of the still athlete, torso units / s. */
  noiseFloor: number;
  /** Median torso length, pixels. */
  torsoPx: number;
  frames: number;
  durationMs: number;
  problems: string[];
  at: string;
}

export const CALIBRATION_MS = 3000;

export const calibrate = (frames: (BodyFrame | null)[], windowMs = 40): CalibrationResult => {
  const ok = frames.filter((f): f is BodyFrame => !!f && f.ok);
  const durationMs = frames.length ? (frames.at(-1)?.t ?? 0) - (frames.find((f) => f)?.t ?? 0) : 0;
  const usable = frames.length ? ok.length / frames.length : 0;
  const speeds: number[] = [];
  let j = 0;
  for (let i = 1; i < ok.length; i++) {
    while (j < i - 1 && ok[j + 1].t <= ok[i].t - windowMs) j++;
    const a = ok[i];
    const b = ok[j];
    const dt = (a.t - b.t) / 1000;
    if (dt <= 0) continue;
    for (const [p, q] of [
      [a.left, b.left],
      [a.right, b.right],
    ] as const)
      if (p && q) speeds.push(len(sub(p, q)) / dt);
  }
  speeds.sort((x, y) => x - y);
  const noiseFloor = speeds.length ? speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * 0.95))] : 0;
  const torso = ok.map((f) => f.unit).sort((x, y) => x - y);
  const torsoPx = torso.length ? torso[torso.length >> 1] : 0;

  const problems: string[] = [];
  if (frames.length < 20) problems.push('Too few frames — is the camera running?');
  if (usable < 0.9) problems.push(`Tracking usable in only ${Math.round(usable * 100)} % of the frames`);
  if (!ok.some((f) => f.left) || !ok.some((f) => f.right)) problems.push('Both hands must be visible');
  // more jitter than a slow deliberate movement: the athlete moved, or tracking is unstable
  if (noiseFloor > 0.4) problems.push('Too much movement / jitter — stand still, improve light or move closer');
  return { ok: !problems.length, usable, noiseFloor, torsoPx, frames: frames.length, durationMs, problems, at: new Date().toISOString() };
};
