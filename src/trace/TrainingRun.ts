/**
 * One training run on the phone: the stage's rep timeline (the same
 * buildSchedule the player uses), start signals, a RepAnalyzer per rep fed
 * with camera frames, results to the TV and into the training log.
 *
 * Time base: the phone's performance clock. The TV receives `startAt` on that
 * clock and converts it with its clock-sync offset.
 */
import { ANALYZER_VERSION, type TrainingSession, trainingLog } from '../analytics/trainingLog';
import { CameraRecorder } from '../capture/videoRecorder';
import { type AnalyzerConfig, DEFAULT_ANALYZER, RepAnalyzer, type RepResult } from '../motion/analyzer';
import { toBodyFrame } from '../motion/features';
import type { PoseFrame } from '../pose/landmarks';
import type { QualityReport } from '../pose/quality';
import { clockMapping, perfToAudio } from '../session/audioClock';
import type { RepSummary, RunPlan } from '../session/protocol';
import type { SessionClient } from '../session/SessionClient';
import { MATCH_TIMING } from '../stage3d/program';
import { stageTiming } from '../stage3d/timeline';
import type { Stage3D } from '../stage3d/types';
import { AudioEngine, STANDBY_VOICE_LEAD } from '../utils/audioEngine';
import { newId } from '../utils/random';
import { type PlayerSnapshot, type Schedule, buildSchedule, snapshotAt } from '../utils/schedule';
import type { TraceSettings } from './settings';
import type { TrackingPipeline } from './TrackingPipeline';

/** Countdown before the schedule's t = 0, so the TV has time to receive and prepare. */
export const COUNTDOWN_MS = 3000;
/** Analysis keeps running this long after the par end beep. */
const GRACE_MS = 1000;

export type RunStatus = 'countdown' | 'running' | 'complete' | 'stopped';

export interface RunView {
  status: RunStatus;
  snapshot: PlayerSnapshot | null;
  /** ms until t = 0 (countdown). */
  untilStart: number;
  analyzerState: string | null;
  results: RepResult[];
  savedSessionId?: string;
  recording: boolean;
}

export const analyzerConfig = (s: TraceSettings): AnalyzerConfig => ({
  ...DEFAULT_ANALYZER,
  sensitivity: s.sensitivity,
  stableHoldMs: s.stableHoldMs,
  noiseFloor: s.calibration?.ok ? s.calibration.noiseFloor : undefined,
  zone: { ...DEFAULT_ANALYZER.zone, requireTwoHands: s.requireTwoHands },
});

export class TrainingRun {
  readonly id = newId('run');
  readonly schedule: Schedule;
  readonly plan: RunPlan;
  private analyzers = new Map<number, RepAnalyzer>();
  private results: RepResult[] = [];
  private status: RunStatus = 'countdown';
  private engine: AudioEngine | null = null;
  private unsub: (() => void) | null = null;
  private timer = 0;
  private cfg: AnalyzerConfig;
  private recorder: CameraRecorder | null = null;
  private frameSources = new Set<PoseFrame['tSource']>();
  private savedId?: string;
  /** Video of this run (kept in memory for replay / download). */
  recording?: { blob: Blob; ext: string; startedAt: number };
  onChange?: () => void;

  constructor(
    readonly stage: Stage3D,
    private settings: TraceSettings,
    private pipeline: TrackingPipeline,
    private session: SessionClient | null,
    /** Signal uncertainty the TV path adds (its clock sync), when the signal plays on the TV. */
    private tvSyncUncertaintyMs: number | null,
  ) {
    const seed = Math.random().toString(36).slice(2, 10);
    const voiceLead = settings.voice ? STANDBY_VOICE_LEAD : 0;
    const lead = MATCH_TIMING.lead;
    this.schedule = buildSchedule(stageTiming(stage), { seed, lead, voiceLead });
    this.cfg = analyzerConfig(settings);
    this.plan = { runId: this.id, stage, seed, lead, voiceLead, startAt: 0, audio: settings.audio, voice: settings.voice, showTimer: settings.showTimerOnTv };
  }

  /** Must be called from a user gesture (audio unlock, camera recording). */
  async start() {
    const phoneAudio = this.settings.audio !== 'tv' || !this.session?.tvs.length;
    if (phoneAudio) {
      this.engine = new AudioEngine();
      await this.engine.load();
      await this.engine.resume();
      // give the output a moment so getOutputTimestamp() reports real values
      await new Promise((r) => setTimeout(r, 250));
    } else if (this.tvSyncUncertaintyMs === null) {
      throw new Error('The TV clock is not synchronised yet — wait a moment, or play the signal on the phone.');
    }
    this.plan.startAt = performance.now() + COUNTDOWN_MS;
    if (this.engine) {
      const m = clockMapping(this.engine.ctx, performance.now());
      for (const rep of this.schedule.reps) {
        if (this.settings.voice) this.engine.play('standby', perfToAudio(m, this.at(rep.standbyStart)));
        this.engine.play('start', perfToAudio(m, this.at(rep.startBeep)));
        this.engine.play('par', perfToAudio(m, this.at(rep.endBeep)));
      }
    }
    this.session?.send({ type: 'run_start', plan: this.plan });
    if (this.settings.recordVideo && this.pipeline.stream) {
      try {
        this.recorder = new CameraRecorder(this.pipeline.stream);
        this.recorder.start();
      } catch (e) {
        console.warn('recording not available', e);
        this.recorder = null;
      }
    }
    this.unsub = this.pipeline.onFrame((f, q) => this.onFrame(f, q));
    this.timer = window.setInterval(() => this.tick(), 50);
  }

  /** Schedule seconds → phone performance clock ms. */
  private at(s: number) {
    return this.plan.startAt + s * 1000;
  }

  private get signalUncertaintyMs() {
    // the phone knows its own beep time best; a TV-only signal adds the clock-sync error
    // (TV sound processing / HDMI latency are NOT measurable by the browser and not included)
    if (this.engine) return 5;
    return this.tvSyncUncertaintyMs ?? 0; // start() refuses a TV-only signal without sync
  }

  private onFrame(frame: PoseFrame, q: QualityReport) {
    if (this.status !== 'running' && this.status !== 'countdown') return;
    this.frameSources.add(frame.tSource);
    const t = frame.t;
    for (const rep of this.schedule.reps) {
      const armT = this.at(rep.standbyStart);
      const endT = this.at(rep.endBeep) + GRACE_MS;
      if (t < armT || t >= endT + 200 || this.results.some((r) => r.rep === rep.index)) continue;
      let a = this.analyzers.get(rep.index);
      if (!a) {
        a = new RepAnalyzer({ rep: rep.index, signalT: this.at(rep.startBeep), signalUncertaintyMs: this.signalUncertaintyMs, endT }, this.cfg);
        this.analyzers.set(rep.index, a);
      }
      a.push(toBodyFrame(frame, q, this.cfg.minQuality), t);
    }
  }

  private tick() {
    const now = performance.now();
    if (this.status === 'countdown' && now >= this.plan.startAt) this.status = 'running';
    // close reps whose window has passed (also when no frame arrived — camera stalled)
    for (const rep of this.schedule.reps) {
      if (this.results.some((r) => r.rep === rep.index)) continue;
      if (now < this.at(rep.endBeep) + GRACE_MS + 100) continue;
      const a = this.analyzers.get(rep.index) ?? new RepAnalyzer({ rep: rep.index, signalT: this.at(rep.startBeep), signalUncertaintyMs: this.signalUncertaintyMs, endT: this.at(rep.endBeep) + GRACE_MS }, this.cfg);
      const r = a.result();
      this.results.push(r);
      this.session?.send({ type: 'rep_result', runId: this.id, summary: summaryOf(r) });
    }
    if (this.status === 'running' && now >= this.at(this.schedule.completeAt)) void this.finish('complete');
    this.onChange?.();
  }

  private async finish(status: 'complete' | 'stopped') {
    if (this.status === 'complete' || this.status === 'stopped') return;
    this.status = status;
    clearInterval(this.timer);
    this.unsub?.();
    if (status === 'stopped') {
      this.engine?.stopAll();
      this.session?.send({ type: 'run_stop', runId: this.id });
    }
    void this.engine?.close();
    if (this.recorder) {
      this.recording = await this.recorder.stop();
      this.recorder = null;
    }
    if (this.results.length) this.savedId = this.save();
    this.onChange?.();
  }

  stop() {
    void this.finish('stopped');
  }

  private save() {
    const snap = this.pipeline.poll();
    const src = [...this.frameSources];
    const session: TrainingSession = {
      id: this.id,
      createdAt: new Date().toISOString(),
      stageId: this.stage.id,
      stageName: this.stage.name,
      parTime: stageTiming(this.stage).parTime,
      reps: [...this.results].sort((a, b) => a.rep - b.rep),
      analyzerVersion: ANALYZER_VERSION,
      config: this.cfg,
      timing: {
        signalSource: this.engine ? (this.settings.audio === 'both' ? 'both' : 'phone') : 'tv',
        signalUncertaintyMs: this.signalUncertaintyMs,
        frameTimeSource: src.length === 1 ? src[0] : 'mixed',
        medianFrameIntervalMs: snap.frameIntervalMs,
        fps: snap.fps,
      },
      camera: { label: snap.actual?.label ?? '', width: snap.actual?.width ?? 0, height: snap.actual?.height ?? 0, fps: snap.actual?.fps },
      model: `${this.settings.model}/${snap.delegate ?? '?'}`,
      calibration: this.settings.calibration,
    };
    trainingLog.save(session);
    return session.id;
  }

  view(): RunView {
    const now = performance.now();
    const t = (now - this.plan.startAt) / 1000;
    const current = [...this.analyzers.values()].find((a) => !a.finished && !this.results.some((r) => r.rep === a.window.rep));
    return {
      status: this.status,
      snapshot: this.plan.startAt && t >= 0 ? snapshotAt(this.schedule, t, stageTiming(this.stage)) : null,
      untilStart: Math.max(0, this.plan.startAt - now),
      analyzerState: current?.state ?? null,
      results: this.results,
      savedSessionId: this.savedId,
      recording: !!this.recorder,
    };
  }
}

export const summaryOf = (r: RepResult): RepSummary => ({
  rep: r.rep,
  status: r.status,
  presentationMs: r.metrics.presentation?.ms,
  totalMs: r.metrics.total?.ms,
  reactionMs: r.metrics.reaction?.ms,
  uncertaintyMs: r.metrics.total?.uncertaintyMs ?? r.metrics.presentation?.uncertaintyMs,
  earlyMovement: r.earlyMovement,
});
