/**
 * Pose data model, independent of the detector (MediaPipe today, something
 * else tomorrow). Indices follow the 33-point BlazePose topology that the
 * MediaPipe Pose Landmarker outputs.
 */

export interface PosePoint {
  /** Image coordinates, 0..1 of the frame width / height (may leave 0..1 when out of frame). */
  x: number;
  y: number;
  /** Relative depth (detector specific; smaller = closer to the camera). */
  z: number;
  /** 0..1: how likely the point is visible (not occluded) — reported by the detector. */
  visibility: number;
}

/** Metric 3D estimate in meters, origin between the hips (detector estimate, not a measurement). */
export interface WorldPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface PoseFrame {
  /** Frame time on the local performance clock, ms. */
  t: number;
  /** Where `t` came from — `capture` is the camera's own timestamp, the best one. */
  tSource: 'capture' | 'presentation' | 'callback';
  /** Source frame size in pixels (normalised coordinates are converted with it). */
  width: number;
  height: number;
  /** null = no person detected in this frame. */
  points: PosePoint[] | null;
  world: WorldPoint[] | null;
  /** Detector run time for this frame, ms. */
  inferenceMs: number;
}

export const LM = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftIndex: 19,
  rightIndex: 20,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/** Body regions the training analysis relies on (spec: head, shoulders, elbows, wrists, hips, knees). */
export const BODY_GROUPS = {
  head: [LM.nose, LM.leftEye, LM.rightEye],
  shoulders: [LM.leftShoulder, LM.rightShoulder],
  elbows: [LM.leftElbow, LM.rightElbow],
  wrists: [LM.leftWrist, LM.rightWrist],
  hips: [LM.leftHip, LM.rightHip],
  knees: [LM.leftKnee, LM.rightKnee],
} as const;

export type BodyGroup = keyof typeof BODY_GROUPS;

/** Skeleton lines for the overlay (subset of BlazePose: no face mesh, no feet detail). */
export const SKELETON: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftWrist, LM.leftIndex],
  [LM.rightWrist, LM.rightIndex],
];

export interface Vec2 {
  x: number;
  y: number;
}

/** Point in pixels (normalised coordinates are anisotropic on a 16:9 frame). */
export const px = (f: Pick<PoseFrame, 'width' | 'height'>, p: PosePoint): Vec2 => ({ x: p.x * f.width, y: p.y * f.height });
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
