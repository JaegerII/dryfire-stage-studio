/**
 * The phone side of FORTH TRACE in one object: settings, the tracking
 * pipeline, the TV session and the current run. React views subscribe via
 * useTrace(); nothing here depends on React.
 */
import { stageRepository } from '../data/stageRepository';
import type { SessionMessage } from '../session/protocol';
import { type SessionInfo, SessionClient } from '../session/SessionClient';
import { newRoomCode, probeRelay } from '../session/transport';
import { TrackingPipeline } from './TrackingPipeline';
import { type TraceSettings, loadSettings, saveSettings } from './settings';
import { TrainingRun } from './TrainingRun';

export interface TvStatus {
  state: string;
  soundEnabled: boolean;
  sync: { offset: number; uncertainty: number; rtt: number } | null;
  outputLatencyMs: number | null;
  at: number;
}

const ROOM_KEY = 'forth-trace.room';

export class TraceController {
  settings: TraceSettings = loadSettings();
  readonly pipeline = new TrackingPipeline();
  session: SessionClient | null = null;
  sessionInfo: SessionInfo | null = null;
  tv: TvStatus | null = null;
  run: TrainingRun | null = null;
  stageId: string | null = stageRepository.list()[0]?.id ?? null;
  error: string | null = null;
  private version = 0;
  private listeners = new Set<() => void>();
  private offSession: (() => void)[] = [];

  constructor() {
    this.pipeline.onChange(() => this.bump());
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  bump() {
    this.version++;
    for (const l of this.listeners) l();
  }

  updateSettings(p: Partial<TraceSettings>) {
    this.settings = { ...this.settings, ...p };
    saveSettings(this.settings);
    this.bump();
  }

  get stage() {
    return this.stageId ? stageRepository.get(this.stageId) : undefined;
  }

  selectStage(id: string) {
    this.stageId = id;
    if (this.session) this.session.send({ type: 'stage', stage: this.stage ?? null });
    this.bump();
  }

  startCamera() {
    return this.pipeline.start(this.settings);
  }

  // ------------------------------------------------------------ TV session
  get room() {
    let r = sessionStorage.getItem(ROOM_KEY);
    if (!r) sessionStorage.setItem(ROOM_KEY, (r = newRoomCode()));
    return r;
  }

  async connectTv() {
    this.disconnectTv();
    const kind = (await probeRelay()) ? 'websocket' : 'broadcast';
    const s = new SessionClient(this.room, 'controller', kind);
    this.session = s;
    this.offSession = [
      s.onInfo((i) => {
        const hadTv = !!this.sessionInfo?.peers.some((p) => p.role === 'tv');
        this.sessionInfo = i;
        // a TV (re)joined: show it the selected stage right away
        if (!hadTv && i.peers.some((p) => p.role === 'tv')) s.send({ type: 'stage', stage: this.stage ?? null });
        this.bump();
      }),
      s.onMessage((m) => this.onMessage(m)),
    ];
    this.bump();
  }

  private onMessage(m: SessionMessage) {
    if (m.type === 'tv_status') {
      this.tv = { state: m.state, soundEnabled: m.soundEnabled, sync: m.sync, outputLatencyMs: m.outputLatencyMs, at: performance.now() };
      this.bump();
    } else if (m.type === 'hello' && m.role === 'tv') {
      this.session?.send({ type: 'stage', stage: this.stage ?? null });
    }
  }

  disconnectTv() {
    this.offSession.forEach((f) => f());
    this.offSession = [];
    this.session?.close();
    this.session = null;
    this.sessionInfo = null;
    this.tv = null;
    this.bump();
  }

  newRoom() {
    sessionStorage.setItem(ROOM_KEY, newRoomCode());
    if (this.session) void this.connectTv();
    else this.bump();
  }

  get tvConnected() {
    return !!this.sessionInfo?.peers.some((p) => p.role === 'tv');
  }

  // ------------------------------------------------------------ runs
  async startRun() {
    const stage = this.stage;
    this.error = null;
    if (!stage) return this.fail('Select a stage first.');
    if (this.pipeline.snap.camera !== 'live' || this.pipeline.snap.tracker !== 'ready') return this.fail('Start the camera and wait for the pose model first (Live tab).');
    this.run?.stop();
    const tvSignal = this.settings.audio === 'tv' && this.tvConnected;
    const run = new TrainingRun(stage, this.settings, this.pipeline, this.tvConnected ? this.session : null, tvSignal ? (this.tv?.sync?.uncertainty ?? null) : null);
    run.onChange = () => this.bump();
    this.run = run;
    try {
      await run.start();
    } catch (e) {
      this.run = null;
      return this.fail((e as Error).message);
    }
    this.bump();
  }

  stopRun() {
    this.run?.stop();
    this.bump();
  }

  private fail(msg: string) {
    this.error = msg;
    this.bump();
  }

  dispose() {
    this.run?.stop();
    this.disconnectTv();
    this.pipeline.dispose();
    this.listeners.clear();
  }
}
