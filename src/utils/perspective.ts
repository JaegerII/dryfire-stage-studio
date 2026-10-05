/**
 * 2.5D perspective. The environment plates are rendered with a level
 * pinhole camera, so an object of real height h whose foot is at screen
 * height y is exactly  h × (y − horizon) / cameraHeight  stage-heights tall.
 * Objects higher up the screen (further downrange) shrink automatically.
 */
import { ASSETS } from '../assets/registry';
import type { EnvironmentDef } from '../assets/environments';
import type { StageObject } from '../types/stage';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Perspective factor: 1 at the bottom edge of the frame, 0 at the horizon. */
export const perspectiveFactor = (obj: Pick<StageObject, 'y' | 'perspective' | 'depth'>, env: EnvironmentDef) =>
  obj.perspective === 'manual'
    ? clamp(1 - (obj.depth ?? 0), 0.02, 1.5)
    : clamp((obj.y - env.horizon) / (1 - env.horizon), 0.02, 1.5);

/** Depth as shown in the editor: 0 = bottom edge (near), 1 = horizon (far). */
export const autoDepth = (y: number, env: EnvironmentDef) => clamp(1 - (y - env.horizon) / (1 - env.horizon), 0, 1);

/** Pixel size of an object's full image for a stage of the given pixel height. */
export const objectSize = (obj: StageObject, env: EnvironmentDef, stageHeightPx: number) => {
  const asset = ASSETS[obj.type];
  const p = perspectiveFactor(obj, env);
  const heightM = asset.viewH / 100;
  const h = ((heightM * p * (1 - env.horizon)) / env.cameraHeight) * obj.scale * stageHeightPx;
  const w = (h * asset.viewW) / asset.viewH;
  return { w, h, groundOffset: (h * asset.groundY) / asset.viewH };
};

/** Screen pixels per meter at the object's depth. */
export const pxPerMeter = (obj: StageObject, env: EnvironmentDef, stageHeightPx: number) =>
  ((perspectiveFactor(obj, env) * (1 - env.horizon)) / env.cameraHeight) * stageHeightPx;

/** Pixels an object is lifted by its elevation (meters above the floor) at its depth. */
export const elevationPx = (obj: StageObject, env: EnvironmentDef, stageHeightPx: number) =>
  (((obj.elevation ?? 0) * perspectiveFactor(obj, env) * (1 - env.horizon)) / env.cameraHeight) * stageHeightPx;

const FOCAL = 1.4; // plate camera focal length in image heights (tools/plate-renderer)
const ASPECT = 16 / 9;

/** Floor point (normalised x, y) → world position: X across (m, + = right), D = distance from the camera (m). */
export const toWorld = (x: number, y: number, env: EnvironmentDef) => {
  const D = (FOCAL * env.cameraHeight) / Math.max(0.002, y - env.horizon);
  return { X: ((x - 0.5) * ASPECT * D) / FOCAL, D };
};

/** World position → normalised floor point on screen. */
export const fromWorld = (X: number, D: number, env: EnvironmentDef) => ({
  x: 0.5 + (FOCAL * X) / (ASPECT * D),
  y: env.horizon + (FOCAL * env.cameraHeight) / D,
});

/** Back-to-front draw order: zIndex, then closer (larger y), then higher (things on boxes) on top. */
export const drawOrder = (objects: StageObject[]) =>
  [...objects].sort((a, b) => a.zIndex - b.zIndex || a.y - b.y || (a.elevation ?? 0) - (b.elevation ?? 0));
