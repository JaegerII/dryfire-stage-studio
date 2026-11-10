import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import { useFullscreen } from '../../hooks/useFullscreen';
import { clockMapping, perfToAudio } from '../../session/audioClock';
import { type BodyOffset, ZERO_OFFSET } from '../../motion/bodyMapping';
import type { BodyLinkStats, BodyMode, RepSummary, RunPlan, SessionMessage } from '../../session/protocol';
import { type SessionInfo, SessionClient } from '../../session/SessionClient';
import { probeRelay } from '../../session/transport';
import { drawHud } from '../../stage3d/hud';
import { SAFETY_RULES } from '../../stage3d/screens';
import { StageScene3D } from '../../stage3d/StageScene3D';
import { bodyFrame, smoothingAlpha } from '../../stage3d/bodyCam';
import { runFrameAt, stageTiming, startFrame } from '../../stage3d/timeline';
import type { Stage3D } from '../../stage3d/types';
import { AudioEngine } from '../../utils/audioEngine';
import { buildSchedule } from '../../utils/schedule';
import { secPlain } from '../format';
import '../trace.css';

interface Props {
  room?: string;
  onJoin: (room: string) => void;
  onExit: () => void;
}

/**
 * TV renderer: joins a session by room code, shows the stage the phone selected in 3D
 * (the shooter's view from the start box) and plays runs on the phone's timeline
 * (clock-synced) — moves between positions, target motion and the range commands. Optionally
 * plays the beeps. Shows result summaries the phone sends — the TV measures
 * nothing itself.
 */
export const TvReceiver = ({ room, onJoin, onExit }: Props) => {
  if (!room) return <JoinForm onJoin={onJoin} onExit={onExit} />;
  return <TvSession key={room} room={room} onExit={onExit} />;
};

const JoinForm = ({ onJoin, onExit }: { onJoin: (r: string) => void; onExit: () => void }) => {
  const [code, setCode] = useState('');
  return (
    <div className="tv tv-join">
      <BrandMark height={48} />
      <h1>Join training</h1>
      <p className="muted">Enter the room code shown on the phone (Training → Connect TV).</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim().length >= 3) onJoin(code.trim().toUpperCase());
        }}
      >
        <input autoFocus value={code} maxLength={8} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE" />
        <button className="primary" type="submit">Join</button>
      </form>
      <button className="linkish" onClick={onExit}>Back</button>
    </div>
  );
};

type Phase = 'idle' | 'countdown' | 'running' | 'complete';

/** The view follows the phone's 30 Hz pose with this time constant (s): hides the steps between messages at 60 Hz render. */
const BODY_SMOOTH_TAU = 0.03;
/** No body message for this long while live: the link or the phone stalled. */
const BODY_STALE_MS = 1500;

const pct = (a: number[], q: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const summarize = (a: number[]) => ({ p50: pct(a, 0.5), p95: pct(a, 0.95), max: a.length ? Math.max(...a) : 0 });

/** Live state of the body camera on the TV (render-rate, so kept out of React state). */
interface BodyRuntime {
  target: BodyOffset;
  cur: BodyOffset;
  pos: number;
  tracked: boolean;
  lastAt: number;
  /** capture time of the newest message not yet drawn */
  pendingCap: number | null;
  arrive: number[];
  paint: number[];
  arrivals: number[];
  fresh: boolean;
  /** Smoothed gap between messages, ms: the smoothing follows it, so a slow phone does not look steppy. */
  dtEma: number;
}
const newBody = (): BodyRuntime => ({ target: ZERO_OFFSET, cur: ZERO_OFFSET, pos: 0, tracked: true, lastAt: 0, pendingCap: null, arrive: [], paint: [], arrivals: [], fresh: true, dtEma: 33 });

const bodyStats = (b: BodyRuntime, syncUncertaintyMs: number | null): BodyLinkStats => ({
  arriveMs: summarize(b.arrive),
  paintMs: summarize(b.paint),
  rateHz: b.arrivals.length,
  syncUncertaintyMs,
});

const TvSession = ({ room, onExit }: { room: string; onExit: () => void }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [stage, setStage] = useState<Stage3D | null>(null);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(0);
  const [results, setResults] = useState<RepSummary[]>([]);
  const [sound, setSound] = useState(false);
  const [synced, setSynced] = useState(false);
  const [bodyMode, setBodyMode] = useState<BodyMode>('off');
  const [bodyPrompt, setBodyPrompt] = useState('');
  const [bodyLive, setBodyLive] = useState<{ stale: boolean; tracked: boolean; ms: number | null }>({ stale: false, tracked: true, ms: null });
  const body = useRef<BodyRuntime>(newBody());

  const client = useRef<SessionClient | null>(null);
  const engine = useRef<AudioEngine | null>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<StageScene3D | null>(null);
  /** Id of the stage in the 3D scene (null while it loads). */
  const [loaded, setLoaded] = useState<string | null>(null);
  const raf = useRef(0);
  /** Local performance time of the schedule's t = 0, frozen once (audio and picture must agree). */
  const localStart = useRef<number | null>(null);

  const shown = plan?.stage ?? stage;
  const schedule = useMemo(() => (plan ? buildSchedule(stageTiming(plan.stage), { seed: plan.seed, lead: plan.lead, voiceLead: plan.voiceLead }) : null), [plan]);

  // ------------------------------------------------------------ 3D view
  useEffect(() => {
    const c = glRef.current;
    if (!c) return;
    const s = new StageScene3D(c);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    const s = scene.current;
    if (!s || !shown) return;
    setLoaded(null);
    let live = true;
    void s.load(shown).then(() => live && setLoaded(shown.id));
    return () => {
      live = false;
    };
  }, [shown]);
  /** Draws the stage: standing in the start box, or the run at schedule time `t`. */
  const paint = useCallback(
    (t: number | null, view?: { pos: number; offset: BodyOffset }) => {
      const s = scene.current;
      const hud = hudRef.current;
      if (!s || !hud || !shown || loaded !== shown.id) return;
      const f = view ? bodyFrame(shown, view.pos, view.offset) : t !== null && schedule ? runFrameAt(shown, schedule, t) : startFrame(shown);
      s.apply(f);
      s.render();
      const ctx = hud.getContext('2d')!;
      ctx.clearRect(0, 0, hud.width, hud.height);
      if (t !== null) drawHud(ctx, hud.width, hud.height, f, shown, s.project.bind(s), { showTimer: !!plan?.showTimer });
    },
    [shown, loaded, schedule, plan?.showTimer],
  );
  // canvas sizes follow the 16:9 box
  useEffect(() => {
    const s = scene.current;
    const hud = hudRef.current;
    if (!s || !hud || !box.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    s.renderer.setPixelRatio(dpr);
    s.setSize(box.width, box.height);
    hud.width = Math.round(box.width * dpr);
    hud.height = Math.round(box.height * dpr);
    paint(null);
  }, [box.width, box.height, paint]);

  // ------------------------------------------------------------ connection
  useEffect(() => {
    let c: SessionClient | null = null;
    let off: (() => void)[] = [];
    let cancelled = false;
    void probeRelay().then((ok) => {
      if (cancelled) return;
      c = new SessionClient(room, 'tv', ok ? 'websocket' : 'broadcast');
      client.current = c;
      off = [c.onInfo(setInfo), c.onMessage((m) => onMessage(m))];
    });
    const onMessage = (m: SessionMessage) => {
      if (m.type === 'stage') setStage(m.stage);
      else if (m.type === 'run_start') {
        engine.current?.stopAll();
        localStart.current = null;
        setResults([]);
        setPlan(m.plan);
        setPhase('countdown');
      } else if (m.type === 'body_state') {
        setBodyMode(m.mode);
        setBodyPrompt(m.prompt ?? '');
        if (m.mode !== 'live') body.current = newBody();
      } else if (m.type === 'body_cam') {
        const b = body.current;
        const est = c?.sync.estimate;
        const now = performance.now();
        if (est) {
          // phone clock = local clock + offset
          b.arrive.push(now + est.offset - m.tCap);
          if (b.arrive.length > 150) b.arrive.shift();
        }
        if (b.lastAt > 0 && now - b.lastAt < 500) b.dtEma = b.dtEma * 0.9 + (now - b.lastAt) * 0.1;
        b.target = { dx: m.dx, dz: m.dz, dy: m.dy, yaw: m.yaw, roll: m.roll ?? 0 };
        b.pos = m.pos;
        b.tracked = m.tracked;
        b.lastAt = now;
        b.pendingCap = m.tCap;
        b.arrivals.push(now);
        while (b.arrivals.length && now - b.arrivals[0] > 1000) b.arrivals.shift();
        if (b.fresh) {
          b.cur = b.target;
          b.fresh = false;
        }
        setBodyMode((x) => (x === 'live' ? x : 'live'));
      } else if (m.type === 'run_stop') {
        engine.current?.stopAll();
        localStart.current = null;
        setPlan(null);
        setPhase('idle');
      } else if (m.type === 'rep_result') setResults((r) => [...r.filter((x) => x.rep !== m.summary.rep), m.summary]);
    };
    return () => {
      cancelled = true;
      off.forEach((f) => f());
      c?.close();
      client.current = null;
    };
  }, [room]);

  // status report to the phone (sync quality, sound) once a second
  useEffect(() => {
    const id = setInterval(() => {
      const c = client.current;
      if (!c) return;
      const est = c.sync.estimate;
      const latency = engine.current?.ctx.outputLatency;
      setSynced(!!est);
      c.send({
        type: 'tv_status',
        state: phase === 'idle' ? (stage ? 'stage' : 'idle') : phase === 'complete' ? 'complete' : 'running',
        soundEnabled: sound,
        sync: est ? { offset: est.offset, uncertainty: est.uncertainty, rtt: est.rtt } : null,
        outputLatencyMs: latency === undefined ? null : latency * 1000,
        body: bodyMode === 'live' && body.current.arrive.length ? bodyStats(body.current, est?.uncertainty ?? null) : null,
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, stage, sound, bodyMode]);

  const enableSound = useCallback(async () => {
    const e = engine.current ?? (engine.current = new AudioEngine());
    await e.load();
    await e.resume();
    setSound(true);
  }, []);

  // ------------------------------------------------------------ run loop
  useEffect(() => {
    if (!plan || !schedule) return;
    const tick = () => {
      const c = client.current;
      if (localStart.current === null) {
        const est = c?.sync.estimate;
        if (est) {
          // controller clock → local clock
          localStart.current = plan.startAt - est.offset;
          const e = engine.current;
          if (e && sound && plan.audio !== 'phone') {
            const m = clockMapping(e.ctx, performance.now());
            const at = (s: number) => perfToAudio(m, localStart.current! + s * 1000);
            for (const rep of schedule.reps) {
              if (plan.voice) e.play('standby', at(rep.standbyStart));
              e.play('start', at(rep.startBeep));
              e.play('par', at(rep.endBeep));
            }
          }
        }
      }
      const ls = localStart.current;
      if (ls !== null) {
        const t = (performance.now() - ls) / 1000;
        if (t < 0) {
          setPhase('countdown');
          setCountdown(Math.ceil(-t));
        } else if (t >= schedule.completeAt) {
          setPhase('complete');
          return;
        } else {
          setPhase('running');
          paint(t);
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [plan, schedule, paint, sound]);

  useEffect(() => () => void engine.current?.close(), []);

  // body camera: the view of the chosen position, moved by the phone's pose, drawn every frame
  useEffect(() => {
    if (bodyMode !== 'live' || phase === 'running' || phase === 'countdown') return;
    let last = performance.now();
    let id = 0;
    let shownAt = 0;
    const tick = () => {
      const now = performance.now();
      const b = body.current;
      // follow about one message gap behind: smooth at 30 Hz, still glides at 10-15 Hz
      const tau = Math.min(0.12, Math.max(BODY_SMOOTH_TAU, (b.dtEma / 1000) * 0.9));
      const a = smoothingAlpha((now - last) / 1000, tau);
      last = now;
      const lerp = (x: number, y: number) => x + (y - x) * a;
      b.cur = { dx: lerp(b.cur.dx, b.target.dx), dz: lerp(b.cur.dz, b.target.dz), dy: lerp(b.cur.dy, b.target.dy), yaw: lerp(b.cur.yaw, b.target.yaw), roll: lerp(b.cur.roll, b.target.roll) };
      paint(null, { pos: b.pos, offset: b.cur });
      const est = client.current?.sync.estimate;
      if (b.pendingCap !== null && est) {
        b.paint.push(performance.now() + est.offset - b.pendingCap);
        if (b.paint.length > 150) b.paint.shift();
        b.pendingCap = null;
      }
      if (now - shownAt > 250) {
        shownAt = now;
        const stale = b.lastAt > 0 && now - b.lastAt > BODY_STALE_MS;
        const ms = b.paint.length ? Math.round(pct(b.paint, 0.5)) : null;
        setBodyLive((p) => (p.stale === stale && p.tracked === b.tracked && p.ms === ms ? p : { stale, tracked: b.tracked, ms }));
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [bodyMode, phase, paint]);

  // between runs: the stage as it stands
  useEffect(() => {
    if (phase !== 'running') paint(null);
  }, [phase, paint]);

  const phone = info?.peers.some((p) => p.role === 'controller');
  const lastResult = results.length ? [...results].sort((a, b) => b.rep - a.rep)[0] : null;

  return (
    <div className={`tv${phase === 'running' ? ' hide-cursor' : ''}`} ref={rootRef}>
      <div className="player-area" ref={areaRef}>
        <div className="player-box" style={{ width: box.width, height: box.height }}>
          <canvas ref={glRef} className="p3-gl" style={{ visibility: shown ? 'visible' : 'hidden' }} />
          <canvas ref={hudRef} className="p3-hud" />
          {shown && loaded !== shown.id && <div className="p3-msg">Loading stage…</div>}
          {!shown && <SafetyScreen />}
          {bodyMode === 'calib' && bodyPrompt && (
            <div className="hud">
              <div className="hud-cmd show ready">
                <span className="cmd-rep">Body camera calibration</span>
                <span className="cmd-text" style={{ fontSize: 'clamp(24px, 4vw, 56px)', lineHeight: 1.15, maxWidth: '80%', textAlign: 'center' }}>{bodyPrompt}</span>
                <span className="cmd-rule" />
              </div>
            </div>
          )}
          {bodyMode === 'live' && phase !== 'running' && (
            <div className="tv-pill" style={{ position: 'absolute', top: 12, left: 12 }}>
              Body camera · {bodyLive.stale ? 'phone signal lost' : bodyLive.tracked ? 'tracking' : 'person not tracked'}
              {bodyLive.ms !== null ? ` · ${bodyLive.ms} ms` : ''}
            </div>
          )}
          {phase === 'countdown' && (
            <div className="hud">
              <div className="hud-cmd show ready">
                <span className="cmd-rep">{synced ? 'Starting in' : 'Synchronising clocks…'}</span>
                <span className="cmd-text">{synced ? countdown : '…'}</span>
                <span className="cmd-rule" />
              </div>
            </div>
          )}
          {phase === 'running' && lastResult && (
            <div className="tv-result" key={lastResult.rep}>
              <span>Rep {lastResult.rep}</span>
              <b>{lastResult.presentationMs !== undefined ? secPlain(lastResult.presentationMs) : '—'}</b>
              <em>{lastResult.earlyMovement ? 'moved before signal' : lastResult.presentationMs !== undefined ? 'to presentation · experimental' : lastResult.status.replace(/_/g, ' ')}</em>
            </div>
          )}
          {phase === 'complete' && plan && (
            <div className="screen complete fade-in">
              <div className="eyebrow accent">{plan.stage.name}</div>
              <h1>Training Complete</h1>
              <ol className="tv-results">
                {[...results]
                  .sort((a, b) => a.rep - b.rep)
                  .map((r) => (
                    <li key={r.rep}>
                      <span>Rep {r.rep}</span>
                      <b>{r.presentationMs !== undefined ? secPlain(r.presentationMs) : '—'}</b>
                      <em>{r.earlyMovement ? 'moved before signal' : r.status.replace(/_/g, ' ')}</em>
                    </li>
                  ))}
              </ol>
              <p>Time from signal to hands in presentation zone · experimental, not validated · not time to first shot</p>
            </div>
          )}
          {phase === 'idle' && (
            <div className="tv-idle">
              <div className="tv-pill">
                Room <b>{room}</b> · {info?.kind === 'broadcast' ? 'same-browser link' : info?.status ?? 'connecting'} · {phone ? 'phone connected' : 'waiting for phone'}
              </div>
              <div className="inline">
                {!sound && <button onClick={() => void enableSound()}>Enable sound</button>}
                <button onClick={toggleFullscreen}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
                <button onClick={onExit}>Leave</button>
              </div>
              {!shown && <p className="muted">Select a stage on the phone.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Shown while no stage is selected: the firearm must be unloaded at all times. */
const SafetyScreen = () => (
  <div className="screen safety fade-in">
    <div className="eyebrow accent">⚠ Safety First</div>
    <h1>
      Your firearm must be
      <br />
      <em>unloaded</em> at all times.
    </h1>
    <ol>
      {SAFETY_RULES.map((r, i) => (
        <li key={i}>
          <span>0{i + 1}</span>
          {r}
        </li>
      ))}
    </ol>
  </div>
);
