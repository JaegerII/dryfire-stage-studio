/**
 * Environment plates — background images that contain ONLY the range.
 * They are rendered by tools/plate-renderer with one fixed
 * camera; `horizon` and `cameraHeight` must match that camera
 * (tools/plate-renderer/src/plateCamera.ts). A replacement photo works too, as long
 * as it is level (no tilt) and these two values are measured for it.
 */
import type { EnvironmentId } from '../types/stage';
import indoor01 from './environments/indoor_01.webp';
import indoor02 from './environments/indoor_02.webp';
import indoor03 from './environments/indoor_03.webp';
import outdoor01 from './environments/outdoor_01.webp';
import outdoor02 from './environments/outdoor_02.webp';
import outdoor03 from './environments/outdoor_03.webp';

export interface EnvironmentDef {
  id: EnvironmentId;
  label: string;
  kind: 'indoor' | 'outdoor';
  src: string;
  /** Horizon line, 0..1 of the image height. */
  horizon: number;
  /** Camera height above the floor, meters. */
  cameraHeight: number;
}

const PLATE = { horizon: 0.4, cameraHeight: 1.5 };

export const ENVIRONMENTS: Record<EnvironmentId, EnvironmentDef> = {
  indoor_01: { id: 'indoor_01', label: 'Indoor Range 01', kind: 'indoor', src: indoor01, ...PLATE },
  indoor_02: { id: 'indoor_02', label: 'Indoor Range 02', kind: 'indoor', src: indoor02, ...PLATE },
  indoor_03: { id: 'indoor_03', label: 'Indoor Range 03 (bright lane)', kind: 'indoor', src: indoor03, ...PLATE },
  outdoor_01: { id: 'outdoor_01', label: 'Outdoor Berm 01', kind: 'outdoor', src: outdoor01, ...PLATE },
  outdoor_02: { id: 'outdoor_02', label: 'Outdoor Berm 02', kind: 'outdoor', src: outdoor02, ...PLATE },
  outdoor_03: { id: 'outdoor_03', label: 'Outdoor Berm 03 (grass)', kind: 'outdoor', src: outdoor03, ...PLATE },
};

export const ENVIRONMENT_LIST = Object.values(ENVIRONMENTS);
