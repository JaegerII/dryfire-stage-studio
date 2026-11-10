/**
 * TEST ONLY — a synthetic standing person facing the phone, for the body-camera
 * unit tests. Never imported by the app.
 *
 * Geometry: the person faces the camera, so their RIGHT side is on the image's LEFT.
 * `lateral` (px) + = the person moves to their right = image x decreases.
 */
import type { BodyFeatures } from '../bodyFeatures';
import type { PoseFrame, PosePoint } from '../../pose/landmarks';
import { LM } from '../../pose/landmarks';

export const W = 1280;
export const H = 720;

export interface SynthBody {
  /** px, + = person's right */
  lateral?: number;
  /** torso length, px */
  torso?: number;
  /** frontal shoulder width, px */
  shoulderW?: number;
  /** degrees, + = turned to the person's right */
  turn?: number;
  /** px the eye line is raised above neutral (+ up) */
  up?: number;
  /** centre of the neutral stance, px */
  cx?: number;
  t?: number;
  visible?: boolean;
}

export const NEUTRAL = { cx: W / 2, torso: 150, shoulderW: 110, hipY: 400, headUp: 150 };

export const bodyFeatures = (b: SynthBody = {}): BodyFeatures => {
  const torso = b.torso ?? NEUTRAL.torso;
  const sw = (b.shoulderW ?? NEUTRAL.shoulderW) * Math.cos(((b.turn ?? 0) * Math.PI) / 180);
  const hipX = (b.cx ?? NEUTRAL.cx) - (b.lateral ?? 0);
  const noseLat = 0.25 * (b.shoulderW ?? NEUTRAL.shoulderW) * Math.sin(((b.turn ?? 0) * Math.PI) / 180);
  return {
    t: b.t ?? 0,
    hipX,
    shoulderX: hipX,
    shoulderW: sw,
    torso,
    noseDx: -noseLat,
    headY: NEUTRAL.hipY - torso - 0.5 * torso - (b.up ?? 0),
    confidence: 1,
  };
};

/** A full 33-point frame (with legs) for the placement check. */
export const bodyFrame = (b: SynthBody & { heightFraction?: number; x?: number } = {}): PoseFrame => {
  const torso = b.torso ?? NEUTRAL.torso;
  const hipX = (b.x ?? NEUTRAL.cx / W) * W;
  const sw = b.shoulderW ?? NEUTRAL.shoulderW;
  const hipY = NEUTRAL.hipY;
  const pts: PosePoint[] = Array.from({ length: 33 }, () => ({ x: hipX / W, y: hipY / H, z: 0, visibility: b.visible === false ? 0.1 : 0.99 }));
  const set = (i: number, x: number, y: number) => (pts[i] = { ...pts[i], x: x / W, y: y / H });
  set(LM.nose, hipX, hipY - torso * 1.45);
  set(LM.leftEye, hipX + 8, hipY - torso * 1.5);
  set(LM.rightEye, hipX - 8, hipY - torso * 1.5);
  set(LM.leftShoulder, hipX - sw / 2, hipY - torso);
  set(LM.rightShoulder, hipX + sw / 2, hipY - torso);
  set(LM.leftHip, hipX - sw / 4, hipY);
  set(LM.rightHip, hipX + sw / 4, hipY);
  const nose = hipY - torso * 1.45;
  const total = (b.heightFraction ?? 0.7) * H;
  const ankle = nose + 0.9 * total;
  set(LM.leftKnee, hipX - sw / 4, (hipY + ankle) / 2);
  set(LM.rightKnee, hipX + sw / 4, (hipY + ankle) / 2);
  set(LM.leftAnkle, hipX - sw / 4, ankle);
  set(LM.rightAnkle, hipX + sw / 4, ankle);
  return { t: b.t ?? 0, tSource: 'capture', width: W, height: H, points: pts, world: null, inferenceMs: 5 };
};
