/**
 * Per-frame body measurements for the body camera, all in image pixels of the
 * source frame (so they are comparable with the calibration). Pure.
 */
import { LM, type PoseFrame, dist, mid, px } from '../pose/landmarks';

export interface BodyFeatures {
  /** Frame time, ms (performance clock of the phone). */
  t: number;
  /** Hip centre x, px. */
  hipX: number;
  /** Shoulder centre x, px. */
  shoulderX: number;
  /** Shoulder width, px. Shrinks when the body turns away from frontal. */
  shoulderW: number;
  /** Shoulder centre → hip centre, px. Barely changes with a turn: the distance cue. */
  torso: number;
  /** Nose x minus shoulder centre x, px (image direction). */
  noseDx: number;
  /** (shoulder centre x − hip centre x) / torso, image direction: sideways lean of the upper body at fixed hips. */
  lean: number;
  /** Eye-line y (mean of both eyes, nose as fallback), px. */
  headY: number;
  /** Mean visibility of the core points (shoulders, hips, nose). */
  confidence: number;
}

/** Visibility below this on any of shoulders / hips: the frame is not used. */
export const MIN_VISIBILITY = 0.5;

/** null when the person is missing or the torso is not reliably seen. */
export const extractBodyFeatures = (f: PoseFrame): BodyFeatures | null => {
  const p = f.points;
  if (!p || p.length < 33) return null;
  const core = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip];
  if (core.some((i) => p[i].visibility < MIN_VISIBILITY)) return null;
  const ls = px(f, p[LM.leftShoulder]);
  const rs = px(f, p[LM.rightShoulder]);
  const lh = px(f, p[LM.leftHip]);
  const rh = px(f, p[LM.rightHip]);
  const sm = mid(ls, rs);
  const hm = mid(lh, rh);
  const nose = px(f, p[LM.nose]);
  const eyesOk = p[LM.leftEye].visibility >= MIN_VISIBILITY && p[LM.rightEye].visibility >= MIN_VISIBILITY;
  const headY = eyesOk ? (p[LM.leftEye].y + p[LM.rightEye].y) / 2 * f.height : nose.y;
  const conf = (core.reduce((s, i) => s + p[i].visibility, 0) + p[LM.nose].visibility) / (core.length + 1);
  return { t: f.t, hipX: hm.x, shoulderX: sm.x, shoulderW: dist(ls, rs), torso: dist(sm, hm), lean: (sm.x - hm.x) / Math.max(1, dist(sm, hm)), noseDx: nose.x - sm.x, headY, confidence: conf };
};
