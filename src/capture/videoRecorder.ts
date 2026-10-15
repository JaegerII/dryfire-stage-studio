/**
 * Optional local recording of the camera stream (MediaRecorder). The file
 * is only offered as a download — nothing is uploaded.
 *
 * `startedAt` (performance clock) links the video to the event log: an event
 * at time t appears at ≈ (t − startedAt) / 1000 s in the video. MediaRecorder
 * gives no per-frame timestamps, so allow ±1 frame plus the encoder start-up.
 */
const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export const cameraRecordingSupported = () => typeof MediaRecorder !== 'undefined' && TYPES.some((t) => MediaRecorder.isTypeSupported(t));

export class CameraRecorder {
  private rec: MediaRecorder;
  private chunks: Blob[] = [];
  readonly mime: string;
  startedAt = 0;

  constructor(stream: MediaStream, bitsPerSecond = 8_000_000) {
    this.mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.rec = new MediaRecorder(stream, { mimeType: this.mime || undefined, videoBitsPerSecond: bitsPerSecond });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.onstart = () => (this.startedAt = performance.now());
  }

  start() {
    this.startedAt = performance.now();
    this.rec.start(1000);
  }

  stop(): Promise<{ blob: Blob; ext: string; startedAt: number }> {
    return new Promise((resolve) => {
      this.rec.onstop = () => resolve({ blob: new Blob(this.chunks, { type: this.mime || 'video/webm' }), ext: this.mime.startsWith('video/mp4') ? 'mp4' : 'webm', startedAt: this.startedAt });
      if (this.rec.state !== 'inactive') this.rec.stop();
      else this.rec.onstop(new Event('stop'));
    });
  }
}
