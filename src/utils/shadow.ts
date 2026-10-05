/**
 * Cast shadows. Each environment knows where its sun is (azimuth / elevation, measured
 * from the HDRI the plate was rendered with); every object then throws its own silhouette
 * onto the floor in that direction. Because the shadow is drawn by the app, it moves with
 * swingers, disappears with falling steel and works for any layout.
 *
 * The sprites already contain a soft contact shadow from above; this adds the
 * environment-specific, directional part.
 */
import type { EnvironmentDef } from '../assets/environments';

export interface EnvShadow {
  /** Direction TOWARDS the sun on the ground plane, degrees: 0 = right, 90 = downrange, -90 = behind the shooter. */
  azimuth: number;
  /** Sun height above the horizon, degrees (low sun = long shadow). */
  elevation: number;
  opacity: number;
  /** Blur radius as a fraction of the sprite height. */
  softness: number;
}

const MAX_LENGTH = 3; // shadow length / object height, capped for a very low sun
const FOCAL = 1.4; // plate camera focal length in image heights (tools/plate-renderer)

const cache = new Map<string, { canvas: HTMLCanvasElement; pad: number }>();

/**
 * Black silhouette of a sprite, blurred. Pure-black pixels are the sprite's own baked
 * contact shadow — they are left out so a shadow does not throw a shadow.
 */
export const silhouette = (img: HTMLImageElement, softness: number) => {
  const key = `${img.src}|${softness}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const flat = document.createElement('canvas');
  flat.width = w;
  flat.height = h;
  const fctx = flat.getContext('2d', { willReadFrequently: true })!;
  fctx.drawImage(img, 0, 0);
  const data = fctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const baked = px[i] + px[i + 1] + px[i + 2] <= 6;
    px[i + 3] = baked ? 0 : px[i + 3];
    px[i] = px[i + 1] = px[i + 2] = 0;
  }
  fctx.putImageData(data, 0, 0);
  const blur = Math.max(0.5, softness * h);
  const pad = Math.ceil(blur * 3);
  const canvas = document.createElement('canvas');
  canvas.width = w + pad * 2;
  canvas.height = h + pad * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(flat, pad, pad);
  const out = { canvas, pad };
  cache.set(key, out);
  return out;
};

/**
 * Konva transform that lays the silhouette onto the floor. In the image's local frame
 * (ground point at 0, up = negative y) a point at height v px lands at
 * (x + v·L·dx, −v·L·df·f): L = shadow length per height, (dx, df) = shadow direction
 * across / away from the shooter, f = how much ground depth is foreshortened on screen.
 */
export const shadowTransform = (s: EnvShadow, env: EnvironmentDef, y: number) => {
  const az = (s.azimuth * Math.PI) / 180;
  const length = Math.min(MAX_LENGTH, 1 / Math.tan((Math.max(1, s.elevation) * Math.PI) / 180));
  const dx = -Math.cos(az); // shadow points away from the sun
  const df = -Math.sin(az);
  const f = Math.max(0.01, (y - env.horizon) / FOCAL);
  let scaleY = length * df * f;
  if (Math.abs(scaleY) < 0.02) scaleY = scaleY < 0 ? -0.02 : 0.02;
  return { scaleY, skewX: -(length * dx) / scaleY };
};
