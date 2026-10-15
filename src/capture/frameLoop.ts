/**
 * Per-frame callback for a <video> showing the camera, with the best
 * timestamp the browser offers:
 *
 *   capture       metadata.captureTime — when the sensor captured the frame (best)
 *   presentation  metadata.presentationTime — when the frame was handed to the compositor
 *   callback      the callback's own time (requestAnimationFrame fallback)
 *
 * All three are on the performance clock (ms). The source is recorded with
 * every frame so the analysis can state how good its timing basis was.
 */
export interface FrameMeta {
  t: number;
  tSource: 'capture' | 'presentation' | 'callback';
  /** Frames the browser presented so far (gaps = dropped frames), if known. */
  presented?: number;
  width: number;
  height: number;
}

type VFCMeta = { captureTime?: number; presentationTime?: number; presentedFrames?: number; width: number; height: number };
type VideoWithVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VFCMeta) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

export const startFrameLoop = (video: HTMLVideoElement, onFrame: (m: FrameMeta) => void): (() => void) => {
  const v = video as VideoWithVFC;
  let stopped = false;
  let handle = 0;
  if (v.requestVideoFrameCallback) {
    const cb = (now: number, meta: VFCMeta) => {
      if (stopped) return;
      const cap = meta.captureTime;
      const t = cap && cap > 0 ? cap : meta.presentationTime && meta.presentationTime > 0 ? meta.presentationTime : now;
      onFrame({
        t,
        tSource: cap && cap > 0 ? 'capture' : meta.presentationTime && meta.presentationTime > 0 ? 'presentation' : 'callback',
        presented: meta.presentedFrames,
        width: meta.width,
        height: meta.height,
      });
      handle = v.requestVideoFrameCallback!(cb);
    };
    handle = v.requestVideoFrameCallback(cb);
    return () => {
      stopped = true;
      v.cancelVideoFrameCallback?.(handle);
    };
  }
  // fallback: poll on animation frames, process only when the video advanced
  let lastTime = -1;
  const tick = (now: number) => {
    if (stopped) return;
    if (video.currentTime !== lastTime && video.readyState >= 2) {
      lastTime = video.currentTime;
      onFrame({ t: now, tSource: 'callback', width: video.videoWidth, height: video.videoHeight });
    }
    handle = requestAnimationFrame(tick);
  };
  handle = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(handle);
  };
};

/** Rolling frame statistics: processed fps, dropped frames, inference time. */
export class FrameStats {
  private times: number[] = [];
  private infer: number[] = [];
  private lastPresented: number | undefined;
  dropped = 0;
  processed = 0;

  constructor(private readonly windowMs = 2000) {}

  add(t: number, inferenceMs: number, presented?: number) {
    this.processed++;
    if (presented !== undefined && this.lastPresented !== undefined && presented > this.lastPresented + 1) this.dropped += presented - this.lastPresented - 1;
    if (presented !== undefined) this.lastPresented = presented;
    this.times.push(t);
    this.infer.push(inferenceMs);
    while (this.times.length > 2 && t - this.times[0] > this.windowMs) {
      this.times.shift();
      this.infer.shift();
    }
  }

  get fps() {
    const n = this.times.length;
    if (n < 2) return 0;
    return ((n - 1) * 1000) / (this.times[n - 1] - this.times[0]);
  }

  /** Median spacing between processed frames, ms — the timing resolution of the analysis. */
  get frameIntervalMs() {
    const d = this.times.slice(1).map((t, i) => t - this.times[i]).sort((a, b) => a - b);
    return d.length ? d[d.length >> 1] : 0;
  }

  get inferenceMs() {
    if (!this.infer.length) return 0;
    return this.infer.reduce((a, b) => a + b, 0) / this.infer.length;
  }
}

/** Mean luma (0..255) of a video frame on a tiny canvas — cheap enough to run twice a second. */
export const measureLuma = (() => {
  let canvas: HTMLCanvasElement | null = null;
  return (video: HTMLVideoElement): number | undefined => {
    if (video.readyState < 2) return undefined;
    canvas ??= document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0, 32, 18);
    const d = ctx.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  };
})();
