/**
 * Shared ids of the stage model: environments, object types and target motion.
 * The stages themselves are 3D stages (src/stage3d/types.ts).
 */

export type EnvironmentId = 'indoor_01' | 'indoor_02' | 'indoor_03' | 'indoor_04' | 'indoor_05' | 'indoor_06' | 'outdoor_01' | 'outdoor_02' | 'outdoor_03' | 'outdoor_04' | 'outdoor_05';

export type TargetType =
  | 'paper_full'
  | 'paper_mini'
  | 'paper_card'
  | 'paper_hc_vertical'
  | 'paper_hc_half'
  | 'paper_hc_bottom'
  | 'paper_hc_diagonal'
  | 'paper_hc_vertical_card'
  | 'paper_hc_half_card'
  | 'paper_hc_bottom_card'
  | 'paper_hc_diagonal_card'
  | 'paper_swinger'
  | 'paper_stack'
  | 'paper_stack_double'
  | 'no_shoot'
  | 'no_shoot_overlay'
  | 'steel_popper'
  | 'steel_plate'
  | 'steel_plate_rack';
export type BarrierType =
  | 'mesh_wall'
  | 'mesh_wall_short'
  | 'mesh_wall_window'
  | 'mesh_wall_diagonal'
  | 'mesh_wall_port'
  | 'mesh_corner'
  | 'wood_wall'
  | 'barrel'
  | 'barrel_barricade'
  | 'barrel_steel'
  | 'barrel_stack'
  | 'barrel_lying'
  | 'mesh_wall_black'
  | 'mesh_wall_black_short'
  | 'wall_black'
  | 'wall_black_window'
  | 'mesh_wall_black_window'
  | 'mesh_wall_black_low'
  | 'mesh_wall_black_port'
  | 'mesh_wall_black_openings'
  | 'fence_green'
  | 'tire_wall'
  | 'sawhorse'
  | 'sandbags';
export type OtherType = 'start_box' | 'crate' | 'crate_wide' | 'tire' | 'tire_stack' | 'rubber_stand' | 'rubber_wall' | 'target_box_pallet' | 'pallet' | 'stage_sign_1' | 'stage_sign_2' | 'stage_sign_3' | 'fault_line' | 'bush' | 'rock' | 'cone' | 'table' | 'table_start';
export type BannerType = 'banner_forth_trace_black' | 'banner_forth_trace_white' | 'banner_west_arms';
export type ObjectType = TargetType | BarrierType | OtherType | BannerType;

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
