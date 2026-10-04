/**
 * In-app video recording: captures this browser tab (cropped to the player
 * when the browser supports Region Capture) plus the player's own audio, and
 * downloads the result. Real time — an 8-minute match records in 8 minutes.
 */

type CropTargetCtor = { fromElement: (el: Element) => Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo?: (target: unknown) => Promise<void> };

const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export const recordingSupported = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

export class TabRecorder {
  private display: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = '';

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
    const stream = new MediaStream([track, ...audio.getAudioTracks()]);
    this.mime = MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: 16_000_000 });
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
    this.display?.getTracks().forEach((t) => t.stop());
    this.display = null;
    this.recorder = null;
    if (!keep || !this.chunks.length) return null;
    const type = this.mime.split(';')[0] || 'video/webm';
    return { blob: new Blob(this.chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' };
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
