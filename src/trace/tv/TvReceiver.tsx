import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '../../components/BrandMark';
import { type OverlayHandle, PlayerOverlay } from '../../components/player/PlayerOverlay';
import { SafetyScreen } from '../../components/player/IntroScreens';
import { StageCanvas } from '../../components/stage/StageCanvas';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import { useFullscreen } from '../../hooks/useFullscreen';
import { clockMapping, perfToAudio } from '../../session/audioClock';
import type { RepSummary, RunPlan, SessionMessage } from '../../session/protocol';
import { type SessionInfo, SessionClient } from '../../session/SessionClient';
import { probeRelay } from '../../session/transport';
import type { Stage } from '../../types/stage';
import { AudioEngine } from '../../utils/audioEngine';
import { buildSchedule, snapshotAt } from '../../utils/schedule';
import { applyStageMotion, stageMotionData } from '../../utils/stageMotion';
import { secPlain } from '../format';
import '../trace.css';

interface Props {
  room?: string;
  onJoin: (room: string) => void;
  onExit: () => void;
}

/**
 * TV renderer: joins a session by room code, shows the stage the phone
 * selected and plays runs on the phone's timeline (clock-synced). Optionally
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

const TvSession = ({ room, onExit }: { room: string; onExit: () => void }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const boxRef = useRef(box);
  boxRef.current = box;
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [plan, setPlan] = useState<RunPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(0);
  const [results, setResults] = useState<RepSummary[]>([]);
  const [sound, setSound] = useState(false);
  const [synced, setSynced] = useState(false);

  const client = useRef<SessionClient | null>(null);
  const engine = useRef<AudioEngine | null>(null);
  const overlay = useRef<OverlayHandle>(null);
  const layer = useRef<Konva.Layer | null>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const raf = useRef(0);
  /** Local performance time of the schedule's t = 0, frozen once (audio and picture must agree). */
  const localStart = useRef<number | null>(null);

  const shown = plan?.stage ?? stage;
  const schedule = useMemo(() => (plan ? buildSchedule(plan.stage, { seed: plan.seed, lead: plan.lead, voiceLead: plan.voiceLead }) : null), [plan]);
  const motion = useMemo(() => (shown ? stageMotionData(shown) : null), [shown]);

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
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase, stage, sound]);

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
          const rs = snapshotAt(schedule, t, plan.stage);
          overlay.current?.update(rs);
          if (motion && applyStageMotion(plan.stage, motion, rs, nodes.current, boxRef.current)) layer.current?.batchDraw();
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [plan, schedule, motion, sound]);

  useEffect(() => () => void engine.current?.close(), []);

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const phone = info?.peers.some((p) => p.role === 'controller');
  const lastResult = results.length ? [...results].sort((a, b) => b.rep - a.rep)[0] : null;

  return (
    <div className={`tv${phase === 'running' ? ' hide-cursor' : ''}`} ref={rootRef}>
      <div className="player-area" ref={areaRef}>
        <div className="player-box" style={{ width: box.width, height: box.height }}>
          {shown ? (
            <div className="stage-layer" key={`${shown.id}:${plan?.runId ?? ''}`}>
              <StageCanvas stage={shown} width={box.width} height={box.height} registerNode={registerNode} layerRef={layer} />
            </div>
          ) : (
            <SafetyScreen />
          )}
          {plan && phase === 'running' && <PlayerOverlay ref={overlay} stage={plan.stage} showTimer={plan.showTimer} signalBorder />}
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
