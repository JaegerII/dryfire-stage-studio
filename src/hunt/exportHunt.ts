/**
 * Driven-hunt video in the browser: every frame = the rendered lane plate + that frame's animal crop
 * (per scenario) + the screens / answer cards, encoded with WebCodecs and muxed by mediabunny (like
 * exportVideo.ts). The animals are rendered at 30 fps, so the video is 30 fps.
 */
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, getFirstEncodableVideoCodec } from 'mediabunny';
import { type HuntProgram, huntFrameAt } from './program';
import type { HuntFrames } from './renderService';
import { drawBriefing, drawDriveHud, drawSummary, drawTitle } from './screens';
import type { HuntFormat } from './types';

export const HUNT_FPS = 30;

export class HuntRenderAborted extends Error {}

/**
 * Draw the program at time t. A drive comes from its scenario's Blender render (`frames[scenario]` + the
 * frame's loaded `crop`) or, for the live preview, from `scene` (the three.js view, already rendered for
 * this moment).
 */
export const drawHuntFrame = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: HuntProgram,
  format: HuntFormat,
  frames: (HuntFrames | null)[],
  t: number,
  crop: ImageBitmap | null,
  scene?: CanvasImageSource,
) => {
  const f = huntFrameAt(p, t);
  if (f.phase === 'intro') return drawBriefing(ctx, W, H, p, format, f.local);
  if (f.phase === 'end') return drawSummary(ctx, W, H, p, f.local);
  if (f.phase === 'title') return drawTitle(ctx, W, H, p, f.scenario, f.local);
  const fr = frames[f.scenario];
  if (fr) fr.draw(ctx, W, H, Math.floor(f.time * HUNT_FPS), crop);
  else if (scene) ctx.drawImage(scene, 0, 0, W, H);
  else {
    ctx.fillStyle = '#1b1d1a';
    ctx.fillRect(0, 0, W, H);
  }
  drawDriveHud(ctx, W, H, p, f);
};

/** Scenario and drive time (s) at program time t, or null outside a drive. */
export const driveAt = (p: HuntProgram, t: number) => {
  const f = huntFrameAt(p, t);
  return f.phase === 'drive' ? { scenario: f.scenario, time: f.time, frame: Math.floor(f.time * HUNT_FPS) } : null;
};

/** Every scenario must be rendered (frames[i]) — all at the same size. */
export const renderHuntMp4 = async (p: HuntProgram, format: HuntFormat, frames: HuntFrames[], o: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}) => {
  const W = frames[0].width;
  const H = frames[0].height;
  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
  if (!vcodec) throw new Error(`Dieser Browser kann ${W}×${H} nicht kodieren. Bitte Chrome / Edge verwenden.`);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(out, { codec: vcodec, bitrate: Math.min(80e6, Math.round(W * H * HUNT_FPS * 0.3)), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: HUNT_FPS });
  await output.start();
  try {
    const total = Math.ceil(p.end * HUNT_FPS);
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new HuntRenderAborted('Render abgebrochen');
      const t = i / HUNT_FPS;
      const d = driveAt(p, t);
      let crop: ImageBitmap | null = null;
      if (d) {
        frames[d.scenario].prefetch(d.frame, 30);
        crop = await frames[d.scenario].crop(d.frame);
      }
      drawHuntFrame(ctx, W, H, p, format, frames, t, crop);
      await video.add(t, 1 / HUNT_FPS);
      if (i % 15 === 0) {
        o.onProgress?.(i, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    video.close();
    await output.finalize();
    o.onProgress?.(total, total);
  } catch (e) {
    await output.cancel();
    throw e;
  }
  return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
};
