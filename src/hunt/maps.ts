/**
 * Driven-hunt maps (Reviere) and their three stands — the same file Blender reads (maps.json), so lane
 * bend, stand eye and aim match the render exactly. Thumbnails: public/3d/hunt/<map>/stand<n>.jpg.
 */
import MAPS_JSON from './maps.json';

export type MapId = keyof typeof MAPS_JSON;
export type StandIndex = 0 | 1 | 2;

export interface StandView {
  name: string;
  x: number;
  y: number;
  eye: number;
  aim: [number, number, number];
}

export interface HuntMap {
  id: MapId;
  label: string;
  short: string;
  lane: { a: number; y0: number };
  stands: StandView[];
}

export const MAPS = Object.fromEntries(Object.entries(MAPS_JSON).map(([id, m]) => [id, { id, ...m }])) as unknown as Record<MapId, HuntMap>;
export const MAP_IDS = Object.keys(MAPS) as MapId[];
export const DEFAULT_MAP: MapId = 'buche_herbst';

export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && v in MAPS;

/** Lane centre line x at station y (meters). */
export const laneX = (map: MapId, y: number) => MAPS[map].lane.a * Math.max(0, y - MAPS[map].lane.y0) ** 2;

export const standView = (map: MapId, stand: StandIndex) => MAPS[map].stands[stand] ?? MAPS[map].stands[0];

export const standThumb = (map: MapId, stand: StandIndex) => new URL(`3d/hunt/${map}/stand${stand + 1}.jpg`, document.baseURI).href;
