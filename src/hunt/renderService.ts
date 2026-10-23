/**
 * Client of the local driven-hunt render service (scripts/hunt-render.mjs on the Vite dev server)
 * and the compositor that lays the rendered animal crops onto the lane plate.
 */
import { renderScenario } from './repository';
import type { HuntFormat, HuntScenario } from './types';

const BASE = '/__hunt';

export type RenderQuality = 'preview' | 'final';

export interface RenderJob {
  key: string;
  phase: 'plate' | 'animals' | 'compose' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  error: string | null;
  width: number;
  height: number;
  seconds: number;
}

export const jobKey = (s: HuntScenario, format: HuntFormat, quality: RenderQuality) => `${s.id}_${format}_${quality}`;

/** Is the render service there (studio running locally) and does it find Blender? */
export const pingService = async (): Promise<{ ok: boolean; blender: boolean }> => {
  try {
    const r = await fetch(`${BASE}/ping`);
    if (!r.ok) return { ok: false, blender: false };
    return await r.json();
  } catch {
    return { ok: false, blender: false };
  }
};

export const startRender = async (s: HuntScenario, format: HuntFormat, quality: RenderQuality): Promise<RenderJob> => {
  const r = await fetch(`${BASE}/render`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: s.id, scenario: renderScenario(s), format, quality }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body.job;
};

export const renderStatus = async (): Promise<RenderJob | null> => (await (await fetch(`${BASE}/status`)).json()).job;

export const cancelRender = () => fetch(`${BASE}/cancel`, { method: 'POST' });

type Rect = [number, number, number, number];

/**
 * The rendered drive: the lane plate plus, per frame, the animals' crop (feathered alpha) and where it
 * goes (pixel rect, origin bottom-left as Blender writes it). Crops load on demand and are cached a
 * little ahead of the playhead.
 */
export class HuntFrames {
  plate!: ImageBitmap;
  width = 0;
  height = 0;
  rects: Record<string, Rect | null> = {};
  frames = 0;
  private cache = new Map<number, Promise<ImageBitmap | null>>();
  /** Crops that have arrived (the live player draws only what is there and never waits). */
  private loaded = new Map<number, ImageBitmap>();

  constructor(readonly key: string) {}

  private url(path: string) {
    return `${BASE}/files/${encodeURIComponent(this.key)}/${path}`;
  }

  async load() {
    const meta = await (await fetch(this.url('crops.json'))).json();
    this.width = meta.width;
    this.height = meta.height;
    this.rects = meta.rects;
    this.frames = Math.max(0, ...Object.keys(this.rects).map(Number)) + 1;
    this.plate = await createImageBitmap(await (await fetch(this.url('plate.png'))).blob());
    return this;
  }

  /**
   * When the animals of a crossing that starts at `from` have left the frame (seconds at 30 fps): the end
   * of the first stretch of frames with animals after `from` (gaps under half a second — an animal behind
   * a trunk — do not end it), not later than `to`. Null if nothing showed.
   */
  lastVisible(from: number, to: number, fps = 30) {
    const end = Math.min(this.frames, Math.floor(to * fps));
    let f = Math.floor(from * fps);
    while (f < end && !this.rects[String(f)]) f++;
    if (f >= end) return null;
    let last = f;
    for (; f < end && f - last <= fps / 2; f++) if (this.rects[String(f)]) last = f;
    return last / fps;
  }

  crop(frame: number): Promise<ImageBitmap | null> {
    if (!this.rects[String(frame)]) return Promise.resolve(null);
    let p = this.cache.get(frame);
    if (!p) {
      p = fetch(this.url(`crops/${String(frame).padStart(4, '0')}.png`))
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? createImageBitmap(b) : null))
        .then((bmp) => {
          if (bmp && this.cache.has(frame)) this.loaded.set(frame, bmp);
          return bmp;
        })
        .catch(() => null);
      this.cache.set(frame, p);
      // keep memory bounded: forget crops far behind / ahead
      for (const k of this.cache.keys())
        if (k < frame - 90 || k > frame + 400) {
          this.cache.delete(k);
          this.loaded.get(k)?.close();
          this.loaded.delete(k);
        }
    }
    return p;
  }

  /** The crop if it has arrived, else null (and start loading it). */
  cropNow(frame: number): ImageBitmap | null {
    void this.crop(frame);
    return this.loaded.get(frame) ?? null;
  }

  prefetch(frame: number, ahead = 45) {
    for (let f = frame; f < Math.min(this.frames, frame + ahead); f++) void this.crop(f);
  }

  /** Plate + the frame's crop, scaled to W × H. `crop` = the loaded crop (null: plate only). */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, frame: number, crop: ImageBitmap | null) {
    ctx.drawImage(this.plate, 0, 0, W, H);
    const r = this.rects[String(frame)];
    if (!r || !crop) return;
    const k = W / this.width;
    const [x0, , , y1] = r;
    ctx.drawImage(crop, x0 * k, (this.height - y1) * k, crop.width * k, crop.height * k);
  }
}
