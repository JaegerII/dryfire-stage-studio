/**
 * TEST ONLY — synthetic pose sequences for unit tests of the motion analysis.
 * Never imported by the app: real measurements come exclusively from the camera.
 *
 * Builds a frontal standing athlete (33 BlazePose points) whose wrists follow a
 * scripted path in torso units, with seeded jitter, at a given frame rate.
 */
import type { PoseFrame, PosePoint, Vec2, WorldPoint } from '../../pose/landmarks';
import { LM } from '../../pose/landmarks';
import { seededRandom } from '../../utils/random';

export interface SynthOptions {
  fps: number;
  /** Scales the athlete in the image (0.6 = further away / smaller person). */
  scale?: number;
  /** Horizontal centre of the athlete, 0..1. */
  cx?: number;
  /** Landmark jitter, torso units (uniform ±). */
  noise?: number;
  /** Provide detector depth (world landmarks)? */
  world?: boolean;
  seed?: string;
}

export interface HandsAt {
  left: Vec2;
  right: Vec2;
  /** Hand extension toward the camera, meters (world z). */
  extension: number;
  /** Hip shift sideways, torso units (position change). */
  hipShift?: number;
  /** Frame dropped / person not detected. */
  missing?: boolean;
}

export const REST: HandsAt = { left: { x: 0.55, y: 1.0 }, right: { x: -0.55, y: 1.0 }, extension: 0 };
export const PRESENT: HandsAt = { left: { x: 0.03, y: -0.1 }, right: { x: -0.03, y: -0.1 }, extension: 0.55 };

const W = 1280;
const H = 720;
const TORSO_PX = 180;

const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Hands moving from `a` to `b` over [t0, t1] (ms), smoothstep. */
export const tween = (a: HandsAt, b: HandsAt, t0: number, t1: number) => (t: number): HandsAt => {
  const u = smooth((t - t0) / (t1 - t0));
  return {
    left: { x: lerp(a.left.x, b.left.x, u), y: lerp(a.left.y, b.left.y, u) },
    right: { x: lerp(a.right.x, b.right.x, u), y: lerp(a.right.y, b.right.y, u) },
    extension: lerp(a.extension, b.extension, u),
    hipShift: lerp(a.hipShift ?? 0, b.hipShift ?? 0, u),
  };
};

export const makeFrames = (script: (t: number) => HandsAt, fromMs: number, toMs: number, o: SynthOptions): PoseFrame[] => {
  const rand = seededRandom(o.seed ?? 'synthetic');
  const scale = o.scale ?? 1;
  const unit = TORSO_PX * scale;
  const noise = o.noise ?? 0.003;
  const frames: PoseFrame[] = [];
  for (let t = fromMs; t <= toMs; t += 1000 / o.fps) {
    const h = script(t);
    if (h.missing) {
      frames.push({ t, tSource: 'capture', width: W, height: H, points: null, world: null, inferenceMs: 8 });
      continue;
    }
    const sc = { x: (o.cx ?? 0.5) * W + (h.hipShift ?? 0) * unit, y: 0.3 * H };
    const at = (u: Vec2): PosePoint => {
      const j = () => (rand() * 2 - 1) * noise;
      return { x: (sc.x + (u.x + j()) * unit) / W, y: (sc.y + (u.y + j()) * unit) / H, z: 0, visibility: 0.95 };
    };
    const points: PosePoint[] = Array.from({ length: 33 }, () => at({ x: 0, y: -0.5 }));
    points[LM.nose] = at({ x: 0, y: -0.45 });
    points[LM.leftEye] = at({ x: 0.06, y: -0.52 });
    points[LM.rightEye] = at({ x: -0.06, y: -0.52 });
    points[LM.leftShoulder] = at({ x: 0.45, y: 0 });
    points[LM.rightShoulder] = at({ x: -0.45, y: 0 });
    points[LM.leftHip] = at({ x: 0.3, y: 1 });
    points[LM.rightHip] = at({ x: -0.3, y: 1 });
    points[LM.leftKnee] = at({ x: 0.3, y: 1.9 });
    points[LM.rightKnee] = at({ x: -0.3, y: 1.9 });
    points[LM.leftAnkle] = at({ x: 0.3, y: 2.7 });
    points[LM.rightAnkle] = at({ x: -0.3, y: 2.7 });
    points[LM.leftWrist] = at(h.left);
    points[LM.rightWrist] = at(h.right);
    points[LM.leftElbow] = at({ x: (0.45 + h.left.x) / 2 + 0.1, y: h.left.y / 2 + 0.05 });
    points[LM.rightElbow] = at({ x: (-0.45 + h.right.x) / 2 - 0.1, y: h.right.y / 2 + 0.05 });
    points[LM.leftIndex] = at({ x: h.left.x, y: h.left.y + 0.1 });
    points[LM.rightIndex] = at({ x: h.right.x, y: h.right.y + 0.1 });
    let world: WorldPoint[] | null = null;
    if (o.world !== false) {
      world = points.map((p) => ({ x: p.x, y: p.y, z: 0, visibility: 0.95 }));
      world[LM.leftShoulder].z = world[LM.rightShoulder].z = -0.1;
      world[LM.leftWrist].z = world[LM.rightWrist].z = -0.1 - h.extension;
    }
    frames.push({ t, tSource: 'capture', width: W, height: H, points, world, inferenceMs: 8 });
  }
  return frames;
};

/** Piecewise script helper: the last segment whose start ≤ t wins. */
export const sequence = (...parts: [number, (t: number) => HandsAt][]) => (t: number) => {
  let f = parts[0][1];
  for (const [start, g] of parts) if (t >= start) f = g;
  return f(t);
};
export const hold = (h: HandsAt) => () => h;
