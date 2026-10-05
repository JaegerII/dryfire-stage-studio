/**
 * Central visual asset library. Every stage uses exactly these files,
 * so every wall, target, popper, no-shoot and start box looks identical.
 * The SVGs are generated once by scripts/generate-assets.mjs.
 *
 * Geometry is in centimetres and mirrors the SVG viewBox:
 *   viewW × viewH  full image incl. shadow margin
 *   groundY        distance from the image top to the ground line
 */
import type { ObjectType } from '../types/stage';
import noShoot from './realistic/no_shoot.webp';
import noShootOverlay from './realistic/no_shoot_overlay.webp';
import paperFull from './realistic/paper_full.webp';
import paperHcBottom from './realistic/paper_hc_bottom.webp';
import paperHcDiagonal from './realistic/paper_hc_diagonal.webp';
import paperHcHalf from './realistic/paper_hc_half.webp';
import paperHcVertical from './realistic/paper_hc_vertical.webp';
import paperHcVerticalCard from './realistic/paper_hc_vertical_card.webp';
import paperHcHalfCard from './realistic/paper_hc_half_card.webp';
import paperHcBottomCard from './realistic/paper_hc_bottom_card.webp';
import paperHcDiagonalCard from './realistic/paper_hc_diagonal_card.webp';
import steelPlateRack from './realistic/steel_plate_rack.webp';
import paperCard from './realistic/paper_card.webp';
import paperMini from './realistic/paper_mini.webp';
import paperStack from './realistic/paper_stack.webp';
import paperStackDouble from './realistic/paper_stack_double.webp';
import paperSwinger from './realistic/paper_swinger.webp';
import steelPlate from './realistic/steel_plate.webp';
import steelPopper from './realistic/steel_popper.webp';
import barrel from './realistic/barrel.webp';
import barrelBarricade from './realistic/barrel_barricade.webp';
import meshCorner from './realistic/mesh_corner.webp';
import woodWall from './realistic/wood_wall.webp';
import meshWall from './realistic/mesh_wall.webp';
import meshWallShort from './realistic/mesh_wall_short.webp';
import meshWallDiagonal from './realistic/mesh_wall_diagonal.webp';
import meshWallPort from './realistic/mesh_wall_port.webp';
import meshWallWindow from './realistic/mesh_wall_window.webp';
import bannerForthTraceBlack from './realistic/banner_forth_trace_black.webp';
import bannerForthTraceWhite from './realistic/banner_forth_trace_white.webp';
import bannerWestArms from './realistic/banner_west_arms.webp';
import crate from './realistic/crate.webp';
import crateWide from './realistic/crate_wide.webp';
import startBox from './other/start_box.svg';

export type AssetCategory = 'target' | 'barrier' | 'banner' | 'other';

export interface AssetDef {
  type: ObjectType;
  category: AssetCategory;
  label: string;
  src: string;
  viewW: number;
  viewH: number;
  groundY: number;
  /** Engaged target (paper / steel) — not a no-shoot or prop. */
  scoring: boolean;
  /** Steel that can fall when "hit" (activator). */
  canFall?: boolean;
  /** Elevation (m) given to new objects of this type. */
  defaultElevation?: number;
  /** Lands on top of a selected box when added. */
  stackable?: boolean;
  /** Height (m) of the top surface, for objects things can stand on. */
  topHeight?: number;
  /** Advertising banner: hangs on a selected wall when added. */
  banner?: boolean;
}

export const ASSETS: Record<ObjectType, AssetDef> = {
  paper_full: { type: 'paper_full', category: 'target', label: 'Paper Target', src: paperFull, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_mini: { type: 'paper_mini', category: 'target', label: 'Mini Paper Target', src: paperMini, viewW: 54, viewH: 124.96, groundY: 120.96, scoring: true },
  no_shoot: { type: 'no_shoot', category: 'target', label: 'No-Shoot', src: noShoot, viewW: 54, viewH: 147, groundY: 143, scoring: false },
  paper_hc_vertical: { type: 'paper_hc_vertical', category: 'target', label: 'Hard Cover: Centre Strip', src: paperHcVertical, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_hc_half: { type: 'paper_hc_half', category: 'target', label: 'Hard Cover: Half', src: paperHcHalf, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_hc_bottom: { type: 'paper_hc_bottom', category: 'target', label: 'Hard Cover: Bottom', src: paperHcBottom, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_hc_diagonal: { type: 'paper_hc_diagonal', category: 'target', label: 'Hard Cover: Diagonal', src: paperHcDiagonal, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_hc_vertical_card: { type: 'paper_hc_vertical_card', category: 'target', label: 'Hard Cover: Centre Strip (card only)', src: paperHcVerticalCard, viewW: 54, viewH: 62, groundY: 58, scoring: true, defaultElevation: 0.85, stackable: true },
  paper_hc_half_card: { type: 'paper_hc_half_card', category: 'target', label: 'Hard Cover: Half (card only)', src: paperHcHalfCard, viewW: 54, viewH: 62, groundY: 58, scoring: true, defaultElevation: 0.85, stackable: true },
  paper_hc_bottom_card: { type: 'paper_hc_bottom_card', category: 'target', label: 'Hard Cover: Bottom (card only)', src: paperHcBottomCard, viewW: 54, viewH: 62, groundY: 58, scoring: true, defaultElevation: 0.85, stackable: true },
  paper_hc_diagonal_card: { type: 'paper_hc_diagonal_card', category: 'target', label: 'Hard Cover: Diagonal (card only)', src: paperHcDiagonalCard, viewW: 54, viewH: 62, groundY: 58, scoring: true, defaultElevation: 0.85, stackable: true },
  paper_stack: { type: 'paper_stack', category: 'target', label: 'Stack: Target / No-Shoot / Target', src: paperStack, viewW: 54, viewH: 154, groundY: 150, scoring: true },
  paper_stack_double: { type: 'paper_stack_double', category: 'target', label: 'Stack: 2 Targets', src: paperStackDouble, viewW: 54, viewH: 144, groundY: 140, scoring: true },
  paper_swinger: { type: 'paper_swinger', category: 'target', label: 'Swinger (on pole)', src: paperSwinger, viewW: 54, viewH: 147, groundY: 143, scoring: true },
  paper_card: { type: 'paper_card', category: 'target', label: 'Paper Target (card only)', src: paperCard, viewW: 54, viewH: 62, groundY: 58, scoring: true, defaultElevation: 0.85, stackable: true },
  no_shoot_overlay: { type: 'no_shoot_overlay', category: 'target', label: 'No-Shoot (card only)', src: noShootOverlay, viewW: 54, viewH: 62, groundY: 58, scoring: false, defaultElevation: 0.85, stackable: true },
  steel_popper: { type: 'steel_popper', category: 'target', label: 'Steel Popper', src: steelPopper, viewW: 54, viewH: 103, groundY: 99, scoring: true, canFall: true, stackable: true },
  steel_plate: { type: 'steel_plate', category: 'target', label: 'Steel Plate', src: steelPlate, viewW: 54, viewH: 88, groundY: 84, scoring: true, canFall: true, stackable: true },
  steel_plate_rack: { type: 'steel_plate_rack', category: 'target', label: 'Plate Rack (6)', src: steelPlateRack, viewW: 180, viewH: 132, groundY: 128, scoring: true },
  mesh_wall: { type: 'mesh_wall', category: 'barrier', label: 'Straight Mesh Wall', src: meshWall, viewW: 220, viewH: 189, groundY: 185, scoring: false },
  mesh_wall_short: { type: 'mesh_wall_short', category: 'barrier', label: 'Short Mesh Wall', src: meshWallShort, viewW: 130, viewH: 189, groundY: 185, scoring: false },
  mesh_wall_window: { type: 'mesh_wall_window', category: 'barrier', label: 'Mesh Wall with Window', src: meshWallWindow, viewW: 280, viewH: 189, groundY: 185, scoring: false },
  mesh_wall_diagonal: { type: 'mesh_wall_diagonal', category: 'barrier', label: 'Mesh Wall Diagonal', src: meshWallDiagonal, viewW: 220, viewH: 189, groundY: 185, scoring: false },
  mesh_wall_port: { type: 'mesh_wall_port', category: 'barrier', label: 'Mesh Wall with Port', src: meshWallPort, viewW: 240, viewH: 189, groundY: 185, scoring: false },
  mesh_corner: { type: 'mesh_corner', category: 'barrier', label: 'Corner / Angled Wall', src: meshCorner, viewW: 290, viewH: 189, groundY: 185, scoring: false },
  wood_wall: { type: 'wood_wall', category: 'barrier', label: 'Wooden Wall (3 m)', src: woodWall, viewW: 330, viewH: 204, groundY: 200, scoring: false },
  barrel: { type: 'barrel', category: 'barrier', label: 'Blue Barrel', src: barrel, viewW: 80, viewH: 99, groundY: 95, scoring: false, topHeight: 0.9 },
  barrel_barricade: { type: 'barrel_barricade', category: 'barrier', label: 'Barrel Barricade', src: barrelBarricade, viewW: 220, viewH: 154, groundY: 150, scoring: false },
  banner_forth_trace_black: { type: 'banner_forth_trace_black', category: 'banner', label: 'Banner FORTH TRACE (black)', src: bannerForthTraceBlack, viewW: 160, viewH: 54, groundY: 50, scoring: false, defaultElevation: 1.0, banner: true },
  banner_forth_trace_white: { type: 'banner_forth_trace_white', category: 'banner', label: 'Banner FORTH TRACE (white)', src: bannerForthTraceWhite, viewW: 160, viewH: 54, groundY: 50, scoring: false, defaultElevation: 1.0, banner: true },
  banner_west_arms: { type: 'banner_west_arms', category: 'banner', label: 'Banner West Arms', src: bannerWestArms, viewW: 160, viewH: 54, groundY: 50, scoring: false, defaultElevation: 1.0, banner: true },
  start_box: { type: 'start_box', category: 'other', label: 'Start Box', src: startBox, viewW: 108, viewH: 36, groundY: 32, scoring: false },
  crate: { type: 'crate', category: 'other', label: 'Box (60 cm)', src: crate, viewW: 76, viewH: 76, groundY: 72, scoring: false, topHeight: 0.6 },
  crate_wide: { type: 'crate_wide', category: 'other', label: 'Box wide (120 cm)', src: crateWide, viewW: 136, viewH: 76, groundY: 72, scoring: false, topHeight: 0.6 },
};

export const ASSET_LIST = Object.values(ASSETS);
