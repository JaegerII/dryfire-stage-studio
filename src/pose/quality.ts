/**
 * Tracking quality of one pose frame: which body regions are reliably seen,
 * whether the athlete is fully in frame and large enough, plus scene checks
 * (light, frame rate) measured elsewhere and passed in.
 *
 * Everything here is derived from the detector's own per-point visibility and
 * from geometry — no assumptions about what the athlete is doing.
 */
import { BODY_GROUPS, type BodyGroup, LM, type PoseFrame, dist, mid, px } from './landmarks';

export type QualityLevel = 'good' | 'partial' | 'poor' | 'none';

export type QualityIssue =
  | 'no_person'
  | 'occluded_head'
  | 'occluded_shoulders'
  | 'occluded_elbows'
  | 'occluded_wrists'
  | 'occluded_hips'
  | 'occluded_knees'
  | 'out_of_frame'
  | 'too_small'
  | 'too_dark'
  | 'low_fps';

export interface QualityReport {
  level: QualityLevel;
  /** 0..1, the weakest required region (a chain is as good as its weakest link). */
  score: number;
  groups: Record<BodyGroup, number>;
  issues: QualityIssue[];
  /** Torso length (shoulder centre → hip centre) as a fraction of the frame height. */
  torsoFraction: number;
}

export interface SceneInfo {
  /** Mean luma 0..255 of the camera image, if measured. */
  luma?: number;
  /** Measured processing rate, frames per second. */
  fps?: number;
}

export interface QualityThresholds {
  /** A region counts as seen above this mean visibility. */
  visible: number;
  /** Torso shorter than this fraction of the frame height → athlete too far / too small. */
  minTorso: number;
  /** Frame margin: points beyond it count as out of frame. */
  margin: number;
  minLuma: number;
  minFps: number;
}

export const DEFAULT_QUALITY: QualityThresholds = { visible: 0.6, minTorso: 0.12, margin: 0.01, minLuma: 45, minFps: 15 };

/** Regions the draw analysis needs; knees only matter for position changes. */
const REQUIRED: BodyGroup[] = ['shoulders', 'elbows', 'wrists', 'hips'];

const EMPTY_GROUPS: Record<BodyGroup, number> = { head: 0, shoulders: 0, elbows: 0, wrists: 0, hips: 0, knees: 0 };

export const assessQuality = (frame: PoseFrame, scene: SceneInfo = {}, th: QualityThresholds = DEFAULT_QUALITY): QualityReport => {
  const sceneIssues: QualityIssue[] = [];
  if (scene.luma !== undefined && scene.luma < th.minLuma) sceneIssues.push('too_dark');
  if (scene.fps !== undefined && scene.fps < th.minFps) sceneIssues.push('low_fps');

  const pts = frame.points;
  if (!pts || pts.length < 33) return { level: 'none', score: 0, groups: { ...EMPTY_GROUPS }, issues: ['no_person', ...sceneIssues], torsoFraction: 0 };

  const groups = { ...EMPTY_GROUPS };
  const issues: QualityIssue[] = [];
  let outOfFrame = false;
  for (const g of Object.keys(BODY_GROUPS) as BodyGroup[]) {
    const idx: readonly number[] = BODY_GROUPS[g];
    groups[g] = idx.reduce((s, i) => s + pts[i].visibility, 0) / idx.length;
    if (groups[g] < th.visible) issues.push(`occluded_${g}` as QualityIssue);
    if (REQUIRED.includes(g))
      outOfFrame ||= idx.some((i) => pts[i].x < -th.margin || pts[i].x > 1 + th.margin || pts[i].y < -th.margin || pts[i].y > 1 + th.margin);
  }
  if (outOfFrame) issues.push('out_of_frame');

  const shoulder = mid(px(frame, pts[LM.leftShoulder]), px(frame, pts[LM.rightShoulder]));
  const hip = mid(px(frame, pts[LM.leftHip]), px(frame, pts[LM.rightHip]));
  const torsoFraction = dist(shoulder, hip) / frame.height;
  if (torsoFraction < th.minTorso) issues.push('too_small');
  issues.push(...sceneIssues);

  const score = Math.min(...REQUIRED.map((g) => groups[g])) * (outOfFrame ? 0.5 : 1);
  const blocking = issues.some((i) => i === 'out_of_frame' || i === 'too_small' || REQUIRED.some((g) => i === `occluded_${g}`));
  const level: QualityLevel = !blocking && !issues.length ? 'good' : !blocking ? 'partial' : score >= 0.3 ? 'poor' : 'none';
  return { level, score, groups, issues, torsoFraction };
};

/** Short, user-facing text per issue (the UI shows these). */
export const ISSUE_TEXT: Record<QualityIssue, string> = {
  no_person: 'No person detected',
  occluded_head: 'Head not clearly visible',
  occluded_shoulders: 'Shoulders hidden',
  occluded_elbows: 'Elbows hidden',
  occluded_wrists: 'Hands / wrists hidden',
  occluded_hips: 'Hips hidden',
  occluded_knees: 'Knees hidden (position changes unreliable)',
  out_of_frame: 'Body leaves the frame — step back or tilt the camera',
  too_small: 'Too far away — move closer or use a higher resolution',
  too_dark: 'Too dark — add light',
  low_fps: 'Low frame rate — lower the resolution or use the Lite model',
};
