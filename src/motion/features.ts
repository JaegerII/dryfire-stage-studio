/**
 * Body-normalised features of one pose frame. All positions are expressed in
 * "torso units" (shoulder centre → hip centre distance), relative to the
 * shoulder centre. That makes thresholds independent of body size and of the
 * athlete's distance to the camera; torso length also survives turning the
 * body much better than shoulder width does.
 */
import { LM, type PoseFrame, type Vec2, dist, mid, px } from '../pose/landmarks';
import type { QualityReport } from '../pose/quality';

export interface BodyFrame {
  t: number;
  /** Quality good enough to use this frame for the analysis. */
  ok: boolean;
  /** 0..1 quality score of the frame (weakest required body region). */
  conf: number;
  /** Torso length in pixels — the unit of every position below. */
  unit: number;
  /** Shoulder / hip centre in pixels. */
  shoulder: Vec2;
  hip: Vec2;
  /** Wrists relative to the shoulder centre, in torso units (y down). null = not reliably visible. */
  left: Vec2 | null;
  right: Vec2 | null;
  /**
   * How far the hands are in front of the shoulders toward the camera, meters —
   * from the detector's world estimate (null when unavailable). This is an
   * estimate of arm extension, NOT a measurement of where a device points.
   */
  extension: number | null;
}

const WRIST_VISIBLE = 0.5;

export const toBodyFrame = (f: PoseFrame, q: QualityReport, minQuality: number): BodyFrame | null => {
  const p = f.points;
  if (!p) return null;
  const shoulder = mid(px(f, p[LM.leftShoulder]), px(f, p[LM.rightShoulder]));
  const hip = mid(px(f, p[LM.leftHip]), px(f, p[LM.rightHip]));
  const unit = dist(shoulder, hip);
  if (!(unit > 1)) return null;
  const rel = (i: number): Vec2 | null => {
    if (p[i].visibility < WRIST_VISIBLE) return null;
    const w = px(f, p[i]);
    return { x: (w.x - shoulder.x) / unit, y: (w.y - shoulder.y) / unit };
  };
  let extension: number | null = null;
  const w = f.world;
  if (w && w[LM.leftWrist].visibility >= WRIST_VISIBLE && w[LM.rightWrist].visibility >= WRIST_VISIBLE) {
    const shoulderZ = (w[LM.leftShoulder].z + w[LM.rightShoulder].z) / 2;
    const wristZ = (w[LM.leftWrist].z + w[LM.rightWrist].z) / 2;
    extension = shoulderZ - wristZ; // smaller z = closer to the camera
  }
  return {
    t: f.t,
    ok: q.score >= minQuality && q.issues.every((i) => i !== 'out_of_frame' && i !== 'too_small' && i !== 'no_person'),
    conf: q.score,
    unit,
    shoulder,
    hip,
    left: rel(LM.leftWrist),
    right: rel(LM.rightWrist),
    extension,
  };
};

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const len = (a: Vec2) => Math.hypot(a.x, a.y);
