/**
 * Training history, stored only in this browser (localStorage). A session
 * holds the measured rep results plus everything needed to judge them later:
 * timing basis, clock sync, camera settings, analyzer thresholds and version.
 *
 * Videos are NOT stored here (size); they are offered as a download.
 */
import type { AnalyzerConfig, RepResult } from '../motion/analyzer';
import type { CalibrationResult } from '../motion/calibration';

/** Bump when the analysis logic changes in a way that makes old numbers incomparable. */
export const ANALYZER_VERSION = 1;

export interface TrainingSession {
  id: string;
  createdAt: string;
  stageId: string;
  stageName: string;
  parTime: number;
  reps: RepResult[];
  analyzerVersion: number;
  config: AnalyzerConfig;
  timing: {
    /** Where the start signal was played: its time is known best on the device that played it. */
    signalSource: 'phone' | 'tv' | 'both';
    /** ± ms of the signal time on the phone clock (clock sync / audio latency). */
    signalUncertaintyMs: number;
    frameTimeSource: 'capture' | 'presentation' | 'callback' | 'mixed';
    medianFrameIntervalMs: number;
    fps: number;
  };
  camera: { label: string; width: number; height: number; fps?: number };
  model: string;
  calibration?: CalibrationResult;
  note?: string;
}

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const KEY = 'forth-trace.sessions.v1';

export class TrainingLog {
  constructor(private custom?: KeyValueStore) {}

  private get store(): KeyValueStore {
    return this.custom ?? localStorage;
  }

  list(): TrainingSession[] {
    try {
      const all = JSON.parse(this.store.getItem(KEY) ?? '[]') as TrainingSession[];
      return Array.isArray(all) ? all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
    } catch {
      return [];
    }
  }

  get(id: string) {
    return this.list().find((s) => s.id === id);
  }

  save(s: TrainingSession) {
    const all = this.list().filter((x) => x.id !== s.id);
    all.push(s);
    this.store.setItem(KEY, JSON.stringify(all));
  }

  remove(id: string) {
    this.store.setItem(KEY, JSON.stringify(this.list().filter((s) => s.id !== id)));
  }

  clear() {
    this.store.removeItem(KEY);
  }
}

export interface MetricSummary {
  /** Reps that produced a value / reps in total. */
  n: number;
  of: number;
  best?: number;
  median?: number;
  mean?: number;
  sd?: number;
  maxUncertainty?: number;
}

/**
 * Aggregates over the reps that produced a value — reps without a measurement
 * are counted in `of`, never filled in. Reps with movement before the signal
 * are left out: their times do not describe a reaction to the signal.
 */
export const summarize = (reps: RepResult[], key: keyof RepResult['metrics']): MetricSummary => {
  const vals = reps.filter((r) => !r.earlyMovement).flatMap((r) => (r.metrics[key] ? [r.metrics[key]] : []));
  const ms = vals.map((v) => v.ms).sort((a, b) => a - b);
  if (!ms.length) return { n: 0, of: reps.length };
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  const sd = ms.length > 1 ? Math.sqrt(ms.reduce((a, b) => a + (b - mean) ** 2, 0) / (ms.length - 1)) : 0;
  return { n: ms.length, of: reps.length, best: ms[0], median: ms[ms.length >> 1], mean, sd, maxUncertainty: Math.max(...vals.map((v) => v.uncertaintyMs)) };
};

export const trainingLog = new TrainingLog();
