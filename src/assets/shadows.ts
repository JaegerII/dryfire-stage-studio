/**
 * Floor shadows, rendered in Blender for every object in every environment with that
 * environment's own light (sun from the HDRI outdoors, the ceiling lights indoors).
 * tools/plate-renderer: `npm run blender shadows` writes the images and manifest.json.
 *
 * Frame geometry in cm like the asset registry: the image is viewW × viewH with the
 * ground line groundY below its top edge, centred on the object's ground point.
 */
import type { EnvironmentId, ObjectType } from '../types/stage';
import manifest from './shadows/manifest.json';

const files = import.meta.glob('./shadows/*/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const frames = manifest as Partial<Record<EnvironmentId, Partial<Record<ObjectType, [number, number, number]>>>>;

export interface ShadowSprite {
  src: string;
  viewW: number;
  viewH: number;
  groundY: number;
}

export const shadowFor = (env: EnvironmentId, type: ObjectType): ShadowSprite | undefined => {
  const f = frames[env]?.[type];
  const src = files[`./shadows/${env}/${type}.webp`];
  return f && src ? { src, viewW: f[0], viewH: f[1], groundY: f[2] } : undefined;
};
