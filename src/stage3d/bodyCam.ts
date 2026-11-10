/**
 * Body camera on the TV side: the start view of a stage position, moved by the
 * offset the phone measured from the athlete's body. Pure.
 */
import type { BodyOffset } from '../motion/bodyMapping';
import { type CameraPose, type FrameState, povPose, standing, startFrame } from './timeline';
import type { Stage3D } from './types';

/** Lerp factor per second-constant helper: exponential smoothing with time constant `tau` (s). */
export const smoothingAlpha = (dt: number, tau: number) => (tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau));

/** Camera pose = base view + offset in the shooter's frame (heading `h` of the position). */
export const applyBodyOffset = (base: CameraPose, o: BodyOffset, headingDeg: number): CameraPose => {
  const h = (headingDeg * Math.PI) / 180;
  // base x/z are three.js coordinates: right = (cos h, sin h), forward = (sin h, −cos h)
  return {
    ...base,
    x: base.x + Math.cos(h) * o.dx + Math.sin(h) * o.dz,
    z: base.z + Math.sin(h) * o.dx - Math.cos(h) * o.dz,
    y: base.y + o.dy,
    yaw: base.yaw + o.yaw,
  };
};

/** Standing in position `index` (falls back to the start), nothing running, with the body offset applied. */
export const bodyFrame = (s: Stage3D, index: number, o: BodyOffset): FrameState => {
  const i = Math.max(0, Math.min(s.positions.length - 1, Math.round(index)));
  if (i === 0) {
    const f = startFrame(s);
    return { ...f, camera: applyBodyOffset(f.camera, o, s.positions[0].heading) };
  }
  const p = s.positions[i];
  const shooter = standing(p);
  return { t: 0, segment: 'stage', camera: applyBodyOffset(povPose(shooter, 0, 0), o, p.heading), arrows: null, rep: null, shooter };
};
