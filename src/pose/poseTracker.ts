/**
 * MediaPipe Pose Landmarker, on the device. Runtime (WASM) and model are
 * served from the app itself (public/mediapipe, public/models — see
 * scripts/fetch-models.mjs), so tracking needs no network and no cloud.
 *
 * The library is loaded lazily: the Stage Builder never pays for it.
 */
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PosePoint, WorldPoint } from './landmarks';

export type PoseModel = 'lite' | 'full';
export type Delegate = 'GPU' | 'CPU';

export interface PoseTrackerOptions {
  model: PoseModel;
  delegate: Delegate;
  /** Detector thresholds (0..1). */
  minDetection?: number;
  minTracking?: number;
}

export interface PoseDetection {
  points: PosePoint[] | null;
  world: WorldPoint[] | null;
  inferenceMs: number;
}

const asset = (path: string) => new URL(path, document.baseURI).href;

export class PoseTracker {
  private lastTs = 0;

  private constructor(
    private lm: PoseLandmarker,
    /** The delegate actually in use (GPU may fall back to CPU). */
    readonly delegate: Delegate,
    readonly model: PoseModel,
    /** The delegate that was asked for. */
    readonly requested: Delegate,
  ) {}

  static async create(o: PoseTrackerOptions): Promise<PoseTracker> {
    const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const files = await FilesetResolver.forVisionTasks(asset('mediapipe/wasm'));
    const make = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: asset(`models/pose_landmarker_${o.model}.task`), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: o.minDetection ?? 0.5,
        minPosePresenceConfidence: o.minTracking ?? 0.5,
        minTrackingConfidence: o.minTracking ?? 0.5,
        outputSegmentationMasks: false,
      });
    if (o.delegate === 'GPU') {
      try {
        return new PoseTracker(await make('GPU'), 'GPU', o.model, o.delegate);
      } catch (e) {
        console.warn('Pose: GPU delegate unavailable, using CPU', e);
      }
    }
    return new PoseTracker(await make('CPU'), 'CPU', o.model, o.delegate);
  }

  /** Synchronous; `t` must increase (performance clock, ms). */
  detect(source: HTMLVideoElement, t: number): PoseDetection {
    const ts = Math.max(this.lastTs + 1, Math.round(t));
    this.lastTs = ts;
    const t0 = performance.now();
    const r = this.lm.detectForVideo(source, ts);
    const inferenceMs = performance.now() - t0;
    const p = r.landmarks[0];
    const w = r.worldLandmarks[0];
    return {
      points: p ? p.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 })) : null,
      world: w ? w.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility ?? 0 })) : null,
      inferenceMs,
    };
  }

  close() {
    this.lm.close();
  }
}
