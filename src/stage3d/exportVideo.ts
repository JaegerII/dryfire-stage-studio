/**
 * Frame-by-frame MP4 render of a 3D stage video, entirely in the browser:
 * every frame is drawn at an exact time (no screen capture, no dropped
 * frames, any resolution), encoded with WebCodecs and muxed by mediabunny.
 * The soundtrack is mixed offline and lands sample-accurately on the beeps.
 */
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { renderSoundtrack, videoCues } from './audio';
import { drawHud } from './hud';
import { StageScene3D } from './StageScene3D';
import { type VideoTimeline, frameAt } from './timeline';
import type { Stage3D } from './types';

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  voice: boolean;
  showTimer: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export class RenderAborted extends Error {}

export const renderMp4 = async (stage: Stage3D, tl: VideoTimeline, o: RenderOptions): Promise<{ blob: Blob; codec: string; audio: string }> => {
  const { width: W, height: H, fps } = o;
  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
  if (!vcodec) throw new Error(`This browser cannot encode ${W}×${H} video. Try a lower resolution or Chrome / Edge.`);
  const acodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });

  // 3D frame on its own canvas, composited with the HUD onto the canvas that gets encoded
  const glCanvas = document.createElement('canvas');
  glCanvas.width = W;
  glCanvas.height = H;
  const scene = new StageScene3D(glCanvas);
  scene.renderer.setPixelRatio(1);
  scene.setSize(W, H);
  await scene.load(stage);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  // ~0.12 bit per pixel and frame: generous for YouTube's re-encode (4K60 ≈ 60 Mbit/s)
  const video = new CanvasSource(out, { codec: vcodec, bitrate: Math.round(W * H * fps * 0.12), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = acodec ? new AudioBufferSource({ codec: acodec, bitrate: 192_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  try {
    if (audio) {
      const sound = await renderSoundtrack(videoCues(tl, o.voice), tl.end);
      await audio.add(sound);
      audio.close();
    }
    const total = Math.ceil(tl.end * fps);
    const project = scene.project.bind(scene);
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new RenderAborted('Render cancelled');
      const t = i / fps;
      const f = frameAt(stage, tl, t, W / H);
      scene.apply(f);
      scene.render();
      ctx.drawImage(glCanvas, 0, 0);
      drawHud(ctx, W, H, f, stage, project, { showTimer: o.showTimer });
      await video.add(t, 1 / fps);
      if (i % 15 === 0) {
        o.onProgress?.(i, total);
        // let the page breathe (progress bar, cancel button)
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    video.close();
    await output.finalize();
    o.onProgress?.(total, total);
  } catch (e) {
    await output.cancel();
    throw e;
  } finally {
    scene.dispose();
  }
  const buf = (output.target as BufferTarget).buffer!;
  return { blob: new Blob([buf], { type: 'video/mp4' }), codec: vcodec, audio: acodec ?? 'none' };
};
