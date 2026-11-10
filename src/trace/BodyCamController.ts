/**
 * Body camera on the phone: placement check, guided calibration and the live
 * stream of camera offsets to the TV. React-free; the tab polls `version` and
 * draws the overlay itself at camera rate.
 */
import { type BodyCalibration, BodyCalibrator, type CalStatus, type PlacementReport, checkPlacement } from '../motion/bodyCalibration';
import { type BodyFeatures, extractBodyFeatures } from '../motion/bodyFeatures';
import { BodyCameraMapper, type BodyMapConfig, DEFAULT_BODY_MAP, type MapResult } from '../motion/bodyMapping';
import type { PoseFrame } from '../pose/landmarks';
import type { SessionClient } from '../session/SessionClient';
import type { TrackingPipeline } from './TrackingPipeline';

export type BodyPhase = 'idle' | 'placement' | 'calibrating' | 'live';

const CAL_KEY = 'forth-trace.bodycal.v1';
const CFG_KEY = 'forth-trace.bodycfg.v1';
/** Minimum spacing of messages, ms (≈ 40 Hz at most; a 30 fps camera sends every frame). */
const MIN_SEND_GAP = 24;

const beep = (() => {
  let ctx: AudioContext | null = null;
  return (freq: number, dur = 0.15) => {
    try {
      ctx ??= new AudioContext();
      void ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.35, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + dur);
    } catch {
      /* audio is a convenience */
    }
  };
})();

const load = <T,>(key: string): T | undefined => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  } catch {
    return undefined;
  }
};

export interface BodyDeps {
  pipeline: TrackingPipeline;
  session: () => SessionClient | null;
  /** Called on every state change that the UI shows (not per frame). */
  changed: () => void;
  /** Whether the front/back camera image is mirrored (for the calibration sign). Raw frames are not. */
  luma: () => number | undefined;
}

export class BodyCamController {
  phase: BodyPhase = 'idle';
  calibration: BodyCalibration | null = load<BodyCalibration>(CAL_KEY) ?? null;
  cfg: BodyMapConfig = { ...DEFAULT_BODY_MAP, ...load<Partial<BodyMapConfig>>(CFG_KEY) };
  bodyHeightM = 1.78;
  /** −1: the person's right is the image's left (camera looks at the person). Swap only if left / right come out reversed. */
  flip: 1 | -1 = load<{ flip: 1 | -1 }>('forth-trace.bodyflip.v1')?.flip ?? -1;
  /** Index of the stage position whose view is driven. */
  pos = 0;
  placement: PlacementReport | null = null;
  cal: CalStatus | null = null;
  /** Last mapping result and features, read by the overlay at camera rate. */
  last: { features: BodyFeatures | null; result: MapResult | null; frame: PoseFrame } | null = null;
  stats = { sendHz: 0, captureToSendMs: 0, sent: 0 };

  private off: (() => void) | null = null;
  private mapper: BodyCameraMapper | null = null;
  private calibrator: BodyCalibrator | null = null;
  private seq = 0;
  private lastSent = 0;
  private lastState = 0;
  private lastPrompt = '';
  private lastPhaseKey = '';
  private sentTimes: number[] = [];
  private lags: number[] = [];
  private lastUi = 0;

  constructor(private d: BodyDeps) {}

  private ui() {
    this.d.changed();
  }

  private sendState(mode: 'off' | 'calib' | 'live', prompt?: string) {
    this.d.session()?.send({ type: 'body_state', mode, prompt });
    this.lastState = performance.now();
  }

  saveConfig() {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify(this.cfg));
    } catch {
      /* ignore */
    }
    if (this.mapper) {
      this.mapper.cfg = this.cfg;
      this.mapper.applyFilterParams();
    }
    this.ui();
  }

  updateConfig(p: Partial<BodyMapConfig>) {
    this.cfg = { ...this.cfg, ...p };
    this.saveConfig();
  }

  private attach() {
    this.off?.();
    this.off = this.d.pipeline.onFrame((f) => this.onFrame(f));
  }

  /** Step 1: live placement check (no calibration data yet). */
  startPlacement() {
    this.stopLive();
    this.phase = 'placement';
    this.attach();
    this.ui();
  }

  /** Step 2: guided calibration. */
  startCalibration() {
    const v = this.d.pipeline.video;
    if (!v.videoWidth) return;
    this.calibrator = new BodyCalibrator({ frameW: v.videoWidth, frameH: v.videoHeight, bodyHeightM: this.bodyHeightM, flip: this.flip });
    this.phase = 'calibrating';
    this.cal = this.calibrator.current;
    this.lastPhaseKey = '';
    this.attach();
    beep(0.001, 0.01);
    this.ui();
  }

  /** Step 3: send the body camera to the TV. */
  startLive() {
    if (!this.calibration) return;
    this.mapper = new BodyCameraMapper(this.calibration, this.cfg);
    this.phase = 'live';
    this.seq = 0;
    this.sentTimes = [];
    this.lags = [];
    this.attach();
    this.sendState('live');
    this.ui();
  }

  stopLive() {
    if (this.phase === 'live' || this.phase === 'calibrating') this.sendState('off');
    this.off?.();
    this.off = null;
    this.mapper = null;
    this.calibrator = null;
    this.phase = 'idle';
    this.last = null;
    this.ui();
  }

  private onFrame(f: PoseFrame) {
    const features = extractBodyFeatures(f);
    const now = performance.now();
    if (this.phase === 'placement') {
      this.placement = checkPlacement(f, this.d.luma());
      this.last = { features, result: null, frame: f };
      if (now - this.lastUi > 250) {
        this.lastUi = now;
        this.ui();
      }
      return;
    }
    if (this.phase === 'calibrating' && this.calibrator) {
      const st = this.calibrator.feed(features, f.t);
      this.cal = st;
      this.last = { features, result: null, frame: f };
      const key = `${st.step}:${st.phase}`;
      if (key !== this.lastPhaseKey) {
        this.lastPhaseKey = key;
        beep(st.phase === 'hold' ? 880 : st.phase === 'done' ? 1200 : st.phase === 'failed' ? 200 : 660, st.phase === 'done' ? 0.4 : 0.15);
      }
      const prompt = st.phase === 'hold' ? `${st.prompt}  (${Math.ceil(st.remainingMs / 1000)})` : st.phase === 'prep' ? `${st.prompt}  (${Math.ceil(st.remainingMs / 1000)})` : st.phase === 'done' ? 'Calibration done' : 'Calibration failed — see the phone';
      if (prompt !== this.lastPrompt) {
        this.lastPrompt = prompt;
        this.sendState('calib', prompt);
      }
      if (st.phase === 'done' && st.result) {
        this.calibration = st.result;
        try {
          localStorage.setItem(CAL_KEY, JSON.stringify(st.result));
        } catch {
          /* ignore */
        }
        this.calibrator = null;
        this.phase = 'idle';
        this.off?.();
        this.off = null;
        this.sendState('off');
        this.ui();
      } else if (st.phase === 'failed') {
        this.calibrator = null;
        this.phase = 'idle';
        this.off?.();
        this.off = null;
        this.sendState('off');
        this.ui();
      } else if (now - this.lastUi > 250) {
        this.lastUi = now;
        this.ui();
      }
      return;
    }
    if (this.phase !== 'live' || !this.mapper) return;
    const result = this.mapper.update(features, f.t);
    this.last = { features, result, frame: f };
    if (f.t - this.lastSent >= MIN_SEND_GAP) {
      this.lastSent = f.t;
      const o = result.offset;
      const r = (v: number) => Math.round(v * 1000) / 1000;
      this.d.session()?.send({ type: 'body_cam', seq: ++this.seq, tCap: f.t, pos: this.pos, tracked: result.tracked, dx: r(o.dx), dz: r(o.dz), dy: r(o.dy), yaw: Math.round(o.yaw * 100) / 100, roll: Math.round(o.roll * 100) / 100 });
      const sent = performance.now();
      this.lags.push(sent - f.t);
      if (this.lags.length > 60) this.lags.shift();
      this.sentTimes.push(sent);
      while (this.sentTimes.length && sent - this.sentTimes[0] > 1000) this.sentTimes.shift();
      this.stats = { sendHz: this.sentTimes.length, captureToSendMs: [...this.lags].sort((a, b) => a - b)[Math.floor(this.lags.length / 2)] ?? 0, sent: this.seq };
    }
    // the TV may have (re)joined: keep announcing the mode
    if (now - this.lastState > 2000) this.sendState('live');
    if (now - this.lastUi > 250) {
      this.lastUi = now;
      this.ui();
    }
  }

  setFlip(f: 1 | -1) {
    this.flip = f;
    try {
      localStorage.setItem('forth-trace.bodyflip.v1', JSON.stringify({ flip: f }));
    } catch {
      /* ignore */
    }
    this.clearCalibration();
  }

  setPos(i: number) {
    this.pos = i;
    this.ui();
  }

  clearCalibration() {
    this.calibration = null;
    try {
      localStorage.removeItem(CAL_KEY);
    } catch {
      /* ignore */
    }
    this.ui();
  }

  dispose() {
    this.stopLive();
  }
}
