/**
 * Camera → pose detector → quality, frame by frame, on the phone.
 *
 * Owns one <video> element (views mount it), the camera stream, the pose
 * tracker and the frame statistics. Consumers (live view, calibration, the
 * training run) subscribe to frames; the UI polls `snapshot` a few times per
 * second so React never re-renders at camera rate.
 */
import { CameraError, type CameraActual, CAMERA_ERROR_TEXT, openCamera, stopStream } from '../capture/camera';
import { FrameStats, measureLuma, startFrameLoop } from '../capture/frameLoop';
import type { PoseFrame } from '../pose/landmarks';
import { PoseTracker } from '../pose/poseTracker';
import { type QualityReport, assessQuality } from '../pose/quality';
import { RESOLUTIONS, type TraceSettings } from './settings';

export type CameraStatus = 'off' | 'starting' | 'live' | 'error';
export type TrackerStatus = 'off' | 'loading' | 'ready' | 'error';

export interface PipelineSnapshot {
  camera: CameraStatus;
  cameraError?: string;
  actual?: CameraActual;
  tracker: TrackerStatus;
  trackerError?: string;
  delegate?: string;
  fps: number;
  frameIntervalMs: number;
  inferenceMs: number;
  dropped: number;
  luma?: number;
  quality?: QualityReport;
  tSource?: PoseFrame['tSource'];
  wakeLock: boolean;
}

export type FrameListener = (frame: PoseFrame, quality: QualityReport) => void;

type WakeLockSentinelLike = { release(): Promise<void> };

export class TrackingPipeline {
  readonly video: HTMLVideoElement;
  stream: MediaStream | null = null;
  private tracker: PoseTracker | null = null;
  private stopLoop: (() => void) | null = null;
  private listeners = new Set<FrameListener>();
  private stats = new FrameStats();
  private lumaAt = 0;
  private wake: WakeLockSentinelLike | null = null;
  last: { frame: PoseFrame; quality: QualityReport } | null = null;
  snap: PipelineSnapshot = { camera: 'off', tracker: 'off', fps: 0, frameIntervalMs: 0, inferenceMs: 0, dropped: 0, wakeLock: false };
  private changed = new Set<() => void>();

  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    v.className = 'trace-video';
    this.video = v;
  }

  private set(p: Partial<PipelineSnapshot>) {
    this.snap = { ...this.snap, ...p };
    for (const f of this.changed) f();
  }

  onChange(fn: () => void) {
    this.changed.add(fn);
    return () => void this.changed.delete(fn);
  }

  onFrame(fn: FrameListener) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  async start(s: TraceSettings) {
    this.stop();
    this.set({ camera: 'starting', cameraError: undefined });
    const [width, height] = RESOLUTIONS[s.resolution];
    try {
      const { stream, actual } = await openCamera({ deviceId: s.cameraId, facing: s.facing, width, height, fps: s.fps });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => undefined);
      this.set({ camera: 'live', actual });
      stream.getVideoTracks()[0].addEventListener('ended', () => this.set({ camera: 'error', cameraError: 'The camera stopped (disconnected or taken by another app).' }));
    } catch (e) {
      this.set({ camera: 'error', cameraError: e instanceof CameraError ? e.message : CAMERA_ERROR_TEXT.unknown });
      return;
    }
    void this.keepAwake();
    await this.loadTracker(s);
    this.stats = new FrameStats();
    this.stopLoop = startFrameLoop(this.video, (m) => this.process(m.t, m.tSource, m.presented));
  }

  private async loadTracker(s: TraceSettings) {
    if (this.tracker && this.tracker.model === s.model && this.tracker.requested === s.delegate) return this.set({ tracker: 'ready', delegate: this.tracker.delegate });
    this.tracker?.close();
    this.tracker = null;
    this.set({ tracker: 'loading', trackerError: undefined });
    try {
      this.tracker = await PoseTracker.create({ model: s.model, delegate: s.delegate });
      this.set({ tracker: 'ready', delegate: this.tracker.delegate });
    } catch (e) {
      console.error(e);
      this.set({ tracker: 'error', trackerError: `Pose model could not be loaded (${(e as Error)?.message ?? e}). Run "npm run models" and reload.` });
    }
  }

  private process(t: number, tSource: PoseFrame['tSource'], presented?: number) {
    const v = this.video;
    if (!this.tracker || v.readyState < 2 || !v.videoWidth) return;
    let det;
    try {
      det = this.tracker.detect(v, t);
    } catch (e) {
      console.error(e);
      return;
    }
    const frame: PoseFrame = { t, tSource, width: v.videoWidth, height: v.videoHeight, points: det.points, world: det.world, inferenceMs: det.inferenceMs };
    this.stats.add(t, det.inferenceMs, presented);
    if (t - this.lumaAt > 500) {
      this.lumaAt = t;
      this.snap.luma = measureLuma(v);
    }
    const quality = assessQuality(frame, { luma: this.snap.luma, fps: this.stats.processed > 30 ? this.stats.fps : undefined });
    this.last = { frame, quality };
    for (const l of this.listeners) l(frame, quality);
  }

  /** Cheap snapshot for the UI (stats are read on demand, not pushed per frame). */
  poll(): PipelineSnapshot {
    this.snap = {
      ...this.snap,
      fps: this.stats.fps,
      frameIntervalMs: this.stats.frameIntervalMs,
      inferenceMs: this.stats.inferenceMs,
      dropped: this.stats.dropped,
      quality: this.last?.quality,
      tSource: this.last?.frame.tSource,
    };
    return this.snap;
  }

  /** Phones dim and lock during a long session — that would stop the camera. */
  private async keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
      if (!wl) return;
      this.wake = await wl.request('screen');
      this.set({ wakeLock: true });
    } catch {
      this.set({ wakeLock: false });
    }
  }

  stop() {
    this.stopLoop?.();
    this.stopLoop = null;
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
    this.last = null;
    this.set({ camera: 'off', wakeLock: false, quality: undefined });
  }

  dispose() {
    this.stop();
    this.tracker?.close();
    this.tracker = null;
    this.listeners.clear();
    this.changed.clear();
  }
}
