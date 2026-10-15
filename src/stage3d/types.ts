/**
 * 3D stage: a floor plan in meters plus the shooter's path.
 *
 *   x = meters to the right of the range centre line
 *   d = meters downrange (away from the shooter's start side)
 *   heading = degrees the shooter looks: 0 = straight downrange, + = to the right
 *
 * In three.js the world is x right, y up, z = −d.
 */
import type { EnvironmentId, Motion, ObjectType } from '../types/stage';

export const SCHEMA_3D = 1;

export interface StageObject3D {
  id: string;
  type: ObjectType;
  x: number;
  d: number;
  /** Group id: clicking one member selects the whole group (editor only). */
  group?: string;
  /**
   * Same motion model as the 2D stages (swinger, falling steel, activators, pop-up …).
   * Times count from the start beep; `amplitude` is in meters.
   */
  motion?: Motion;
  /** Turn around the vertical axis in degrees (clockwise seen from above); 0 = front faces the start side. */
  yaw?: number;
  elevation?: number;
  /** Size multiplier (1 = true size). */
  scale?: number;
  /** Mirror left/right (e.g. a diagonal wall sloping the other way). */
  flip?: boolean;
  /**
   * Only up during part of the run (seconds after the start beep), e.g. the areas of a
   * dynamic stage. Before the beep and between reps it counts as 0; the editor and the
   * briefing always show it.
   */
  shown?: { from?: number; until?: number };
}

export interface ShooterPosition {
  id: string;
  label?: string;
  x: number;
  d: number;
  heading: number;
}

/** The move from one position to the next. */
export interface Leg {
  /** Seconds spent at the previous position before moving (after the beep / the previous arrival). */
  after: number;
  /** Seconds the move takes. */
  duration: number;
  /** The shooter reloads during this move (shown in the briefing and the HUD). */
  reload: boolean;
  /** Optional corner points between the two positions. */
  via?: { x: number; d: number }[];
}

export interface Stage3D {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  environment: Env3D;
  repetitions: number;
  resetTime: number;
  standbyDelay: { min: number; max: number };
  objects: StageObject3D[];
  /** At least one; the first is the start position. */
  positions: ShooterPosition[];
  /** positions.length − 1 legs. */
  legs: Leg[];
  /** Seconds at the last position until the end beep. */
  finalTime: number;
  /** Brightness of the scene: 1 = the environment as it is, < 1 darker, > 1 lighter. */
  brightness?: number;
  /** Start condition, shown in the briefing and on the title card (e.g. "Pistol unloaded on the table, magazines on the table"). */
  start?: string;
  /** Camera feel while moving between positions. */
  camera?: {
    /** Head movement while walking: 0 = steady (gimbal), 1 = default, 2 = strong. */
    shake?: number;
  };
  meta?: { createdAt?: string; updatedAt?: string; source?: string };
}

/** Default head movement while walking (see Stage3D.camera.shake). */
export const DEFAULT_SHAKE = 1;
export const shakeOf = (s: Pick<Stage3D, 'camera'>) => Math.max(0, Math.min(2, s.camera?.shake ?? DEFAULT_SHAKE));

/** Where a stage can be built: x across, d downrange (meters). */
export interface Room {
  label: string;
  /** indoor: a closed hall (walls, ceiling) · outdoor: open range under a sky panorama (sky_<id>.jpg) */
  kind: 'indoor' | 'outdoor';
  x0: number;
  x1: number;
  d0: number;
  d1: number;
  /** Indoor: ceiling height · outdoor: height of the berms. */
  height: number;
  /** Depth of the backstop inside the room (indoor); outdoor rooms end at the foot of the back berm. */
  backstop: number;
  /** Outdoor, berms around the bay (drawn in the plan) — not outdoor_04's open field. */
  berms?: boolean;
  /**
   * Outdoor: the sun of the HDRI (SUN in tools/plate-renderer/blender/scene.py), degrees:
   * azimuth in the ground plane, 0 = to the right (+x), 90 = downrange · elevation above the horizon.
   * None = overcast.
   */
  sun?: { azimuth: number; elevation: number };
}

/**
 * The environments available in 3D (baked by tools/plate-renderer/blender/export3d.py).
 * Indoor: the bounds must match ROOMS there (inside faces of the walls).
 * Outdoor: the bay between the berms of the scene.py plates (feet of the side and back berms).
 */
export const ENV3D = {
  indoor_01: { label: 'Indoor Range 01', kind: 'indoor', x0: -8, x1: 8, d0: -6, d1: 28, height: 6, backstop: 2.2 },
  indoor_02: { label: 'Indoor Range 02', kind: 'indoor', x0: -8, x1: 8, d0: -6, d1: 28, height: 6, backstop: 2.2 },
  indoor_03: { label: 'Indoor Range 03 (bright lane)', kind: 'indoor', x0: -4, x1: 4, d0: -4, d1: 34.6, height: 3.6, backstop: 1 },
  indoor_04: { label: 'Indoor Range 04 (beam ceiling)', kind: 'indoor', x0: -7, x1: 7, d0: -4, d1: 32, height: 4.6, backstop: 0 },
  indoor_05: { label: 'Indoor Range 05 (270° rubber hall)', kind: 'indoor', x0: -12, x1: 12, d0: -4, d1: 30, height: 5, backstop: 0 },
  indoor_06: { label: 'Indoor Range 06 (red duct ceiling)', kind: 'indoor', x0: -6, x1: 6, d0: -4, d1: 26, height: 3.8, backstop: 0 },
  outdoor_01: { label: 'Outdoor Berm 01 (midday)', kind: 'outdoor', x0: -8.4, x1: 8.4, d0: -6, d1: 15, height: 2.6, backstop: 0, berms: true, sun: { azimuth: -120, elevation: 73.5 } },
  outdoor_02: { label: 'Outdoor Berm 02 (evening)', kind: 'outdoor', x0: -8.4, x1: 8.4, d0: -6, d1: 15.5, height: 2.4, backstop: 0, berms: true, sun: { azimuth: -125, elevation: 20.7 } },
  outdoor_03: { label: 'Outdoor Berm 03 (overcast)', kind: 'outdoor', x0: -10.8, x1: 10.8, d0: -6, d1: 17.5, height: 4, backstop: 0, berms: true },
  outdoor_04: { label: 'Outdoor 04 (sunset, covered bays)', kind: 'outdoor', x0: -15, x1: 15, d0: -6, d1: 26, height: 3.3, backstop: 0, sun: { azimuth: 160, elevation: 3.2 } },
  outdoor_05: { label: 'Outdoor 05 (limestone hillside)', kind: 'outdoor', x0: -8.6, x1: 8.6, d0: -6, d1: 17, height: 15, backstop: 0, berms: true, sun: { azimuth: -70, elevation: 73.5 } },
} satisfies Record<string, Room>;

export type Env3D = keyof typeof ENV3D;

export const isEnv3D = (e: string): e is Env3D => e in ENV3D;
export const roomOf = (env: string): Room => (isEnv3D(env) ? ENV3D[env] : ENV3D.indoor_01);

/** The 3D environment of a 2D one (every 2D environment exists in 3D). */
export const env3dFor = (env: EnvironmentId): Env3D => (isEnv3D(env) ? env : 'indoor_01');

/** Par time = time at every position + every move. */
export const parTime3D = (s: Stage3D) => +(s.legs.reduce((t, l) => t + l.after + l.duration, 0) + s.finalTime).toFixed(2);
