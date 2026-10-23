/**
 * Driven hunt (Drückjagd): you sit on a stand at the edge of a forest lane, game crosses it, you
 * identify it (ansprechen), decide whether it is released (Freigabe), swing with it and take the shot —
 * or don't. Built like the IPSC match builder:
 *
 *   HuntScenario  ≙ stage: a map (Revier) + one of its three stands + crossings on one timeline
 *   Hunt          ≙ match: up to nine scenarios played as one session / one video, one release for all
 *
 * The lane and the animals are rendered offline in Blender (tools/plate-renderer/blender/hunt.py) through
 * the local render service; the editor shows the same scene live in three.js.
 * Lane geometry (meters, same as hunt.py): x to the right, y down the lane; maps and stands: maps.json.
 */
import type { MapId, StandIndex } from './maps';

export const SCHEMA_HUNT = 2;
/** A hunt plays at most this many scenarios. */
export const MAX_SCENARIOS = 9;

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
  /** Meters from the stand to where the animals cross the lane. */
  distance: number;
  /** As the hunter on the stand sees it: from the left / from the right. */
  direction: Direction;
  /** Seed of the sounder's order, spacing and sizes (same seed → same picture). */
  seed: number;
}

/** The hunt master's release (Freigabe). */
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

/** A scenario (≙ stage): one stand on one map, crossings on one timeline. */
export interface HuntScenario {
  schema: typeof SCHEMA_HUNT;
  id: string;
  name: string;
  map: MapId;
  stand: StandIndex;
  /** Release when the scenario plays on its own; inside a hunt the hunt's release applies. */
  release: HuntRelease;
  crossings: Crossing[];
  /** Seconds the answer card (identification, release, lead) stays up after each crossing; 0 = only at the end. */
  revealSeconds: number;
  notes?: string;
  meta?: { updatedAt?: string };
}

/** A driven hunt (≙ match): scenarios in play order with one release. */
export interface Hunt {
  schema: typeof SCHEMA_HUNT;
  id: string;
  name: string;
  description?: string;
  scenarioIds: string[];
  release: HuntRelease;
  /** Briefing screen before the first scenario (default on). */
  intro?: boolean;
  archived?: boolean;
  meta?: { updatedAt?: string };
}
