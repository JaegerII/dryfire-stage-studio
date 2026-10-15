/**
 * 3D stage: a floor plan in meters plus the shooter's path.
 *
 *   x = meters to the right of the range centre line
 *   d = meters downrange (away from the shooter's start side)
 *   heading = degrees the shooter looks: 0 = straight downrange, + = to the right
 *
 * In three.js the world is x right, y up, z = −d.
 */
import type { ObjectType } from '../types/stage';

export const SCHEMA_3D = 1;

export interface StageObject3D {
  id: string;
  type: ObjectType;
  x: number;
  d: number;
  /** Turn around the vertical axis in degrees (clockwise seen from above); 0 = front faces the start side. */
  yaw?: number;
  elevation?: number;
  /** Size multiplier (1 = true size). */
  scale?: number;
  /** Mirror left/right (e.g. a diagonal wall sloping the other way). */
  flip?: boolean;
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
  environment: 'indoor_01';
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

/** The 3D hall (indoor_01): x −8..8 m, d −6..28 m, backstop at the far end. */
export const HALL = { x0: -8, x1: 8, d0: -6, d1: 28 };

/** Par time = time at every position + every move. */
export const parTime3D = (s: Stage3D) => +(s.legs.reduce((t, l) => t + l.after + l.duration, 0) + s.finalTime).toFixed(2);
