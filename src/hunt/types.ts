/**
 * Driven hunt (Drückjagd): you sit on a stand at the edge of a forest lane, game crosses it, you
 * identify it (ansprechen), decide whether it is released (Freigabe), swing with it and take the shot —
 * or don't. A scenario is a list of crossings on one timeline; the lane and the animals are rendered
 * offline in Blender (tools/plate-renderer/blender/hunt.py) through the local render service.
 *
 * Lane geometry (meters, same as hunt.py): x to the right, y down the lane; the stand's eye is at
 * x = −6.5, y = 0, 3.3 m up, looking down the lane; the lane centre line bends right after 30 m.
 */
export const SCHEMA_HUNT = 1;

export type GameClass = 'keiler' | 'bache' | 'ueberlaeufer' | 'frischling' | 'frischling_gestreift';
export type Gait = 'trot' | 'gallop';
export type Direction = 'ltr' | 'rtl';
export type HuntFormat = '16x9' | '9x16';

export const GAME_CLASSES: Record<GameClass, { label: string; plural: string; scale: number; young: boolean }> = {
  keiler: { label: 'Keiler', plural: 'Keiler', scale: 1.0, young: false },
  bache: { label: 'Bache', plural: 'Bachen', scale: 0.85, young: false },
  ueberlaeufer: { label: 'Überläufer', plural: 'Überläufer', scale: 0.7, young: false },
  frischling: { label: 'Frischling', plural: 'Frischlinge', scale: 0.5, young: true },
  frischling_gestreift: { label: 'Frischling (gestreift)', plural: 'Frischlinge (gestreift)', scale: 0.33, young: true },
};
export const GAME_ORDER: GameClass[] = ['keiler', 'bache', 'ueberlaeufer', 'frischling', 'frischling_gestreift'];

export const GAITS: Record<Gait, { label: string; speed: number }> = {
  trot: { label: 'Troll', speed: 3.6 },
  gallop: { label: 'Flüchtig', speed: 8 },
};

/** One crossing: a single animal or a sounder (the first sow / boar in the list leads). */
export interface Crossing {
  id: string;
  /** Seconds after the drive starts. */
  at: number;
  animals: GameClass[];
  gait: Gait;
  /** m/s */
  speed: number;
  /** Meters from the stand down the lane where the animals cross. */
  distance: number;
  direction: Direction;
  /** Seed of the sounder's order, spacing and sizes (same seed → same picture). */
  seed: number;
}

/** The hunt master's release (Freigabe) for the drive. */
export interface HuntRelease {
  keiler: boolean;
  /** Only sows without young: a sow with piglets in the sounder is never released (parent protection). */
  bache: boolean;
  ueberlaeufer: boolean;
  frischling: boolean;
  /** Shots at fleeing game (gallop) allowed at all. */
  gallop: boolean;
  /** Maximum shooting distance, m. */
  maxDistance: number;
}

export interface HuntScenario {
  schema: typeof SCHEMA_HUNT;
  id: string;
  name: string;
  lane: 'buche_herbst';
  release: HuntRelease;
  crossings: Crossing[];
  /** Seconds the answer card (identification, release, lead) stays up after each crossing; 0 = only at the end. */
  revealSeconds: number;
  notes?: string;
  meta?: { updatedAt?: string };
}

export const LANES = { buche_herbst: 'Schneise · Buchenwald im Herbst' } as const;
