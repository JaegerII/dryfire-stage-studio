/**
 * Stage data model. A stage is plain JSON — creating a new stage never
 * requires code. Coordinates are normalised to the 16:9 stage frame
 * (0..1 on both axes), so layouts are resolution-independent.
 */

export const SCHEMA_VERSION = 1;

export type EnvironmentId = 'indoor_01' | 'indoor_02' | 'indoor_03' | 'outdoor_01' | 'outdoor_02' | 'outdoor_03';

export type TargetType =
  | 'paper_full'
  | 'paper_mini'
  | 'paper_card'
  | 'paper_hc_vertical'
  | 'paper_hc_half'
  | 'paper_hc_bottom'
  | 'paper_hc_diagonal'
  | 'paper_swinger'
  | 'paper_stack'
  | 'paper_stack_double'
  | 'no_shoot'
  | 'no_shoot_overlay'
  | 'steel_popper'
  | 'steel_plate'
  | 'steel_plate_rack';
export type BarrierType = 'mesh_wall' | 'mesh_wall_short' | 'mesh_wall_window' | 'mesh_wall_diagonal' | 'mesh_wall_port' | 'mesh_corner';
export type OtherType = 'start_box' | 'crate' | 'crate_wide';
export type ObjectType = TargetType | BarrierType | OtherType;

/**
 * Target behaviour during the par window. Times are seconds after the start
 * beep — or, with `trigger`, after the referenced steel target falls
 * (activator: shoot the popper, the next target appears). Distances are in
 * meters in the world, so a far swinger moves less on screen than a near one.
 */
export type MotionKind = 'static' | 'fall' | 'swing' | 'horizontal' | 'vertical' | 'popup' | 'appear' | 'disappear';

export interface Motion {
  kind: MotionKind;
  /** horizontal / vertical: how far it moves to each side (or up), in METERS.
   *  Negative = first move goes left (horizontal) / down (vertical). */
  amplitude?: number;
  /** swing: maximum tilt to each side in degrees, pivoting at the object's foot.
   *  Negative = first tilt goes left. */
  angle?: number;
  /** swing / horizontal / vertical: seconds per full back-and-forth. */
  period?: number;
  /** fall: seconds after the start beep when the steel goes down (simulated hit).
   *  popup / appear / disappear: seconds after the start beep or the trigger. */
  delay?: number;
  /** Id of a steel object with `fall` motion — this motion starts when it falls. */
  trigger?: string;
  /** swing / horizontal / vertical: invisible until the motion starts (activated swinger). */
  hiddenUntilStart?: boolean;
  /** popup: seconds the target stays up (omit = until par end). */
  duration?: number;
}

export interface StageObject {
  id: string;
  type: ObjectType;
  /** Ground contact point (bottom centre), 0..1 of stage width. */
  x: number;
  /** Ground contact point, 0..1 of stage height. Lower on screen = closer. */
  y: number;
  /** Extra size multiplier on top of the perspective size (1 = true size). */
  scale: number;
  /** Rotation in the image plane, degrees. */
  rotation: number;
  /** Height above the floor in meters (e.g. a card standing on a box). */
  elevation?: number;
  /** Mirror left/right (e.g. a diagonal wall sloping the other way). */
  flip?: boolean;
  /** Turn away from the shooter, degrees (−80..80). Faked in 2.5D. */
  yaw?: number;
  opacity?: number;
  /** Draw order. Equal zIndex → sorted by y (closer objects on top). */
  zIndex: number;
  /** 'auto' derives size from y; 'manual' uses `depth` instead. */
  perspective?: 'auto' | 'manual';
  /** Manual depth 0 (at the bottom edge) .. 1 (at the horizon). */
  depth?: number;
  /** Optional target label, e.g. engagement order "1" (stored, not drawn). */
  label?: string;
  locked?: boolean;
  motion?: Motion;
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type Discipline = 'handgun' | 'rifle' | 'pcc';

export interface Stage {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  environment: EnvironmentId;
  /** Seconds between start beep and end beep. */
  parTime: number;
  repetitions: number;
  /** Seconds of reset / preparation before every rep (and after the last). */
  resetTime: number;
  /** Random delay after "STAND BY" before the start beep, seconds. */
  standbyDelay: { min: number; max: number };
  objects: StageObject[];
  /** Framing: zoom 1 = full plate, up to 2.5 = closer (scaled around the horizon centre). */
  view?: { zoom?: number };
  /** Library metadata — filters, categories, ownership (future platform). */
  meta?: {
    difficulty?: Difficulty;
    discipline?: Discipline;
    tags?: string[];
    author?: string;
    createdAt?: string;
    updatedAt?: string;
  };
}
