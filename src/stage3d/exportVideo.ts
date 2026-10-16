/**
 * Frame-by-frame MP4 render of a program (one stage or a whole match), entirely in the
 * browser: every frame is drawn at an exact time (no screen capture, no dropped frames,
 * any resolution), encoded with WebCodecs and muxed by mediabunny. The soundtrack is
 * mixed offline and lands sample-accurately on the beeps.
 */
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, StreamTarget, type StreamTargetChunk, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } from 'mediabunny';
import { renderSoundtrack } from './audio';
import { type Program, programCues, programFrameAt } from './program';
import { drawProgramHud, loadScreenAssets, showsScene } from './screens';
import { StageScene3D } from './StageScene3D';

export interface RenderOptions {
  width: number;
  height: number;
  fps: number;
  voice: boolean;
  showTimer: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /**
   * Write the file out while rendering (batch render: npm run render) instead of keeping it in
   * memory — a long match in 4K is gigabytes. The result's blob is null then.
   */
  stream?: WritableStream<StreamTargetChunk>;
  /**
   * The 3D frame is rendered this many times larger and scaled down (default: 2, 1.5 above
   * 1440p): smooth edges, no shimmer / moiré on the barrier mesh and fine textures while the
   * camera moves. 1 = fast (about 3× quicker).
   */
  supersample?: number;
}

/**
 * Video bits per pixel and frame: 0.3 ≈ 21 Mbit/s at 1080p60. Lower rates smear the floor and
 * the mesh into blocks while the camera moves (the encoder also undershoots the target). Capped
 * at 80 Mbit/s — YouTube re-encodes anyway, above that the files only get bigger.
 */
const BITS_PER_PIXEL = 0.3;
const MAX_BITRATE = 80e6;

/** By the frame's short side: 4K would need an 8K render at 2×. */
export const defaultSupersample = (shortSide: number) => (shortSide > 1440 ? 1.5 : 2);

export class RenderAborted extends Error {}

export const renderMp4 = async (p: Program, o: RenderOptions): Promise<{ blob: Blob | null; codec: string; audio: string }> => {
  const { width: W, height: H, fps } = o;
  const vcodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
  if (!vcodec) throw new Error(`This browser cannot encode ${W}×${H} video. Try a lower resolution or Chrome / Edge.`);
  const acodec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000 });

  // 3D frame on its own canvas, composited with the HUD onto the canvas that gets encoded
  const ss = o.supersample ?? defaultSupersample(Math.min(W, H));
  const glCanvas = document.createElement('canvas');
  glCanvas.width = W * ss;
  glCanvas.height = H * ss;
  const scene = new StageScene3D(glCanvas);
  scene.renderer.setPixelRatio(1);
  scene.setSize(W * ss, H * ss);
  await loadScreenAssets();
  let loaded = -1;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';

  // in memory: the index (moov) goes in front, the file streams right away when played from a server
  const output = o.stream
    ? new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(o.stream, { chunked: true }) })
    : new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(out, { codec: vcodec, bitrate: Math.min(MAX_BITRATE, Math.round(W * H * fps * BITS_PER_PIXEL)), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: fps });
  const audio = acodec ? new AudioBufferSource({ codec: acodec, bitrate: 192_000 }) : null;
  if (audio) output.addAudioTrack(audio);
  await output.start();

  try {
    if (audio) {
      const sound = await renderSoundtrack(programCues(p, o.voice), p.end);
      await audio.add(sound);
      audio.close();
    }
    const total = Math.ceil(p.end * fps);
    const project = scene.project.bind(scene);
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new RenderAborted('Render cancelled');
      const t = i / fps;
      const pf = programFrameAt(p, t, W / H);
      // the next stage's range and objects load during its title card
      if (pf.stageIndex !== loaded) {
        await scene.load(p.stages[pf.stageIndex]);
        loaded = pf.stageIndex;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (showsScene(pf) && pf.frame) {
        scene.apply(pf.frame);
        scene.render();
        ctx.drawImage(glCanvas, 0, 0, W, H);
      }
      drawProgramHud(ctx, W, H, p, pf, project, { showTimer: o.showTimer });
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
  const blob = o.stream ? null : new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
  return { blob, codec: vcodec, audio: acodec ?? 'none' };
};
