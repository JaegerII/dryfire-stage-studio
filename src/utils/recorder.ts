/**
 * In-app video recording: captures this browser tab (cropped to the player
 * when the browser supports Region Capture) plus the player's own audio, and
 * downloads the result. Real time — an 8-minute match records in 8 minutes.
 *
 * The captured tab is redrawn onto a canvas of FIXED size (1080p / 1440p / 2160p) and that
 * canvas is recorded. Recording the tab track directly gives files whose resolution changes
 * mid-stream (crop, window resize) — Windows' player then shows only fragments.
 */

type CropTargetCtor = { fromElement: (el: Element) => Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

const MIME_TYPES = [
  // H.264 High @ level 5.2: valid up to 2160p60 (level 4.0 only covers 1080p30)
  'video/mp4;codecs=avc1.640034,mp4a.40.2',
  'video/mp4;codecs=avc1.640033,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const FPS = 30;

/**
 * Chrome's MP4 recorder writes the video size as 0 × 0 into the file header (tkhd + avc1).
 * Windows' player trusts that and shows only fragments — so we write the real size in.
 * The header (ftyp + moov) is always inside the first recorded chunk; nothing is re-encoded.
 */
const fixMp4Header = async (first: Blob, size: { width: number; height: number }) => {
  const buf = new Uint8Array(await first.arrayBuffer());
  const view = new DataView(buf.buffer);
  const find = (type: string, from = 0) => {
    const c = [...type].map((ch) => ch.charCodeAt(0));
    for (let i = from; i < Math.min(buf.length, 64_000) - 4; i++) if (buf[i] === c[0] && buf[i + 1] === c[1] && buf[i + 2] === c[2] && buf[i + 3] === c[3]) return i;
    return -1;
  };
  const tkhd = find('tkhd');
  if (tkhd > 0) {
    // version 1: 8-byte times; then track id, reserved, duration, reserved, layer, group, volume, reserved, matrix
    const v1 = buf[tkhd + 4] === 1;
    const at = tkhd + 4 + 4 + (v1 ? 32 : 20) + 8 + 8 + 36;
    if (!view.getUint32(at) && !view.getUint32(at + 4)) {
      view.setUint32(at, size.width * 65536);
      view.setUint32(at + 4, size.height * 65536);
    }
  }
  const avc1 = find('avc1', tkhd > 0 ? tkhd : 0);
  if (avc1 > 0 && !view.getUint16(avc1 + 28)) {
    view.setUint16(avc1 + 28, size.width);
    view.setUint16(avc1 + 30, size.height);
  }
  return new Blob([buf]);
};

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export class TabRecorder {
  private display: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';
  private video: HTMLVideoElement | null = null;
  private size = { width: 0, height: 0 };
  private timer = 0;

  /** Asks the user to share this tab, then starts recording. Must be called from a click. */
  async start(cropTo: Element | null, audio: MediaStream) {
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 60 }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      audio: false,
      // Chrome: offer "this tab" first and don't switch to another tab
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions);
    this.display = display;
    const [track] = display.getVideoTracks() as CroppableTrack[];
    const CropTarget = (window as unknown as { CropTarget?: CropTargetCtor }).CropTarget;
    if (cropTo && CropTarget && track.cropTo) {
      try {
        await track.cropTo(await CropTarget.fromElement(cropTo)); // only the 16:9 player, no black bars
      } catch {
        /* whole tab then */
      }
    }
    // redraw the (cropped) tab onto a fixed-size 16:9 canvas → constant, even dimensions
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    await video.play();
    this.video = video;
    const box = cropTo?.getBoundingClientRect();
    const px = (box?.height ?? window.innerHeight) * window.devicePixelRatio;
    const outH = px >= 2000 ? 2160 : px >= 1350 ? 1440 : 1080;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((outH * 16) / 9);
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.imageSmoothingQuality = 'high';
    const draw = () => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        // fit the source 16:9 into the canvas (black bars only if the source is not 16:9)
        const k = Math.min(canvas.width / vw, canvas.height / vh);
        const w = vw * k;
        const h = vh * k;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      }
    };
    // a timer, not requestAnimationFrame: keeps recording even when the window is covered
    this.timer = window.setInterval(draw, 1000 / FPS);
    this.size = { width: canvas.width, height: canvas.height };
    // 30 fps: the H.264 level Chrome picks is only valid up to 30 fps at these sizes
    const [canvasTrack] = canvas.captureStream(FPS).getVideoTracks();
    const stream = new MediaStream([canvasTrack, ...audio.getAudioTracks()]);
    this.mime = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mime || undefined,
      videoBitsPerSecond: outH >= 2160 ? 30_000_000 : outH >= 1440 ? 16_000_000 : 10_000_000,
      // a keyframe every 2 s so players can seek (Chrome; ignored elsewhere)
      videoKeyFrameIntervalDuration: 2000,
    } as MediaRecorderOptions);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    // sharing stopped from the browser bar → finish like a normal stop
    track.addEventListener('ended', () => this.recorder?.state === 'recording' && this.recorder.stop());
    this.recorder.start(1000);
  }

  get active() {
    return this.recorder?.state === 'recording';
  }

  /** Stops; resolves with the file (or null when discarded / nothing recorded). */
  async stop(keep: boolean): Promise<{ blob: Blob; ext: string } | null> {
    const rec = this.recorder;
    if (!rec) return null;
    if (rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    clearInterval(this.timer);
    this.video?.pause();
    this.video = null;
    this.display?.getTracks().forEach((t) => t.stop());
    this.display = null;
    this.recorder = null;
    if (!keep || !this.chunks.length) return null;
    const type = this.mime.split(';')[0] || 'video/webm';
    const chunks = type.includes('mp4') ? [await fixMp4Header(this.chunks[0], this.size), ...this.chunks.slice(1)] : this.chunks;
    return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
  }
}

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const videoFileName = (title: string, ext: string) =>
  `${title.replace(/[^\w\-– ]+/g, '').trim().replace(/\s+/g, '_') || 'dryfire'}_${new Date().toISOString().slice(0, 10)}.${ext}`;
