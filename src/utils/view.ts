/**
 * Stage zoom ("bring it closer"). The whole scene — plate and objects — is
 * scaled around the horizon centre, which is the camera's principal point, so
 * zooming is optically the same as a longer lens: perspective stays correct.
 * Object coordinates are always stored un-zoomed.
 */
import type { EnvironmentDef } from '../assets/environments';
import type { Stage } from '../types/stage';

export const MAX_ZOOM = 2.5;

export const stageZoom = (stage: Stage) => Math.min(MAX_ZOOM, Math.max(1, stage.view?.zoom ?? 1));

/** Konva layer props that apply the zoom. */
export const viewTransform = (stage: Stage, env: EnvironmentDef, width: number, height: number) => {
  const z = stageZoom(stage);
  return { x: 0.5 * width * (1 - z), y: env.horizon * height * (1 - z), scaleX: z, scaleY: z };
};

/** Screen position (0..1 of the visible frame) → stored stage coordinates. */
export const screenToStage = (sx: number, sy: number, stage: Stage, env: EnvironmentDef) => {
  const z = stageZoom(stage);
  return { x: 0.5 + (sx - 0.5) / z, y: env.horizon + (sy - env.horizon) / z };
};
