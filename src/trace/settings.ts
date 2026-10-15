/** Trace settings — stored in this browser only. */
import type { PoseModel, Delegate } from '../pose/poseTracker';
import type { AudioOutput } from '../session/protocol';
import type { CalibrationResult } from '../motion/calibration';

export interface TraceSettings {
  cameraId?: string;
  facing: 'user' | 'environment';
  resolution: '480p' | '720p' | '1080p';
  fps: 30 | 60;
  model: PoseModel;
  delegate: Delegate;
  /** 0.5 (less sensitive) … 2 (more sensitive). */
  sensitivity: number;
  requireTwoHands: boolean;
  stableHoldMs: number;
  showSkeleton: boolean;
  mirrorPreview: boolean;
  recordVideo: boolean;
  audio: AudioOutput;
  voice: boolean;
  showTimerOnTv: boolean;
  calibration?: CalibrationResult;
}

export const RESOLUTIONS = { '480p': [640, 480], '720p': [1280, 720], '1080p': [1920, 1080] } as const;

export const DEFAULT_SETTINGS: TraceSettings = {
  facing: 'environment',
  resolution: '720p',
  fps: 60,
  model: 'lite',
  delegate: 'GPU',
  sensitivity: 1,
  requireTwoHands: false,
  stableHoldMs: 200,
  showSkeleton: true,
  mirrorPreview: false,
  recordVideo: false,
  audio: 'phone',
  voice: true,
  showTimerOnTv: false,
};

const KEY = 'forth-trace.settings.v1';

export const loadSettings = (): TraceSettings => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (s: TraceSettings) => localStorage.setItem(KEY, JSON.stringify(s));
