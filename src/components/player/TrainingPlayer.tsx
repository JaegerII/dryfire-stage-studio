import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { useFullscreen } from '../../hooks/useFullscreen';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import type { Stage } from '../../types/stage';
import { AudioEngine, STANDBY_VOICE_LEAD } from '../../utils/audioEngine';
import { fallScale, fallTimes, isMoving, motionAt } from '../../utils/motion';
import { elevationPx, pxPerMeter } from '../../utils/perspective';
import { INTRO_TOTAL, type Phase, type Schedule, buildSchedule, estimateDuration, snapshotAt } from '../../utils/schedule';
import { StageCanvas } from '../stage/StageCanvas';
import { FullscreenButton } from './FullscreenButton';
import { BrandScreen, CompleteScreen, SafetyScreen } from './IntroScreens';
import { type OverlayHandle, PlayerOverlay } from './PlayerOverlay';

interface Props {
  stage: Stage;
  onExit: () => void;
}

interface Options {
  intro: boolean;
  timer: boolean;
  voice: boolean;
  signalBorder: boolean;
  seed: string;
  volume: number;
}

type Status = 'setup' | 'running' | 'paused' | 'complete';
type Scene = 'intro-safety' | 'intro-brand' | 'stage' | 'complete';

const sceneOf = (p: Phase): Scene => (p === 'intro-safety' || p === 'intro-brand' || p === 'complete' ? p : 'stage');
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Player mode: the stage, a minimal HUD and nothing else. The audio clock is
 * the master clock — beeps are scheduled sample-accurately, the HUD and any
 * moving targets follow it on requestAnimationFrame.
 */
export const TrainingPlayer = ({ stage, onExit }: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);

  const [opts, setOpts] = useState<Options>({ intro: true, timer: false, voice: true, signalBorder: false, seed: stage.id, volume: 1 });
  const [status, setStatus] = useState<Status>('setup');
  const [scene, setScene] = useState<Scene>('stage');
  const [controlsVisible, setControlsVisible] = useState(true);

  const engine = useRef<AudioEngine | null>(null);
  const schedule = useRef<Schedule | null>(null);
  const t0 = useRef(0);
  const raf = useRef(0);
  const overlay = useRef<OverlayHandle>(null);
  const layer = useRef<Konva.Layer | null>(null);
  const nodes = useRef(new Map<string, Konva.Group>());
  const boxRef = useRef(box);
  boxRef.current = box;
  const movers = useMemo(() => stage.objects.filter((o) => isMoving(o.motion)), [stage.objects]);
  const falls = useMemo(() => fallTimes(stage.objects), [stage.objects]);

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  // ---------------------------------------------------------------- frame loop
  const tick = useCallback(() => {
    const e = engine.current;
    const s = schedule.current;
    if (!e || !s) return;
    const t = e.now - t0.current;
    const snap = snapshotAt(s, t, stage);
    overlay.current?.update(snap);
    setScene((cur) => (cur === sceneOf(snap.phase) ? cur : sceneOf(snap.phase)));

    if (movers.length) {
      const { width, height } = boxRef.current;
      // keep the shot-at state (fallen steel, activated targets) through the "TIME" second, then reset
      const activeWindow = snap.phase === 'active' || (snap.phase === 'reset' && snap.sinceStart < stage.parTime + 1);
      for (const o of movers) {
        const node = nodes.current.get(o.id);
        if (!node) continue;
        const m = motionAt(o.motion, snap.sinceStart, activeWindow, falls);
        const ppm = pxPerMeter(o, ENVIRONMENTS[stage.environment], height);
        node.position({ x: o.x * width + m.dx * ppm, y: o.y * height - elevationPx(o, ENVIRONMENTS[stage.environment], height) - m.dy * ppm });
        node.visible(m.visible);
        node.scaleY(fallScale(m.fall));
        node.findOne('.motion')?.rotation(m.rot); // swing pivots at the object's own foot
      }
      layer.current?.batchDraw();
    }

    if (snap.phase === 'complete') {
      setStatus('complete');
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, [stage, movers, falls]);

  // ---------------------------------------------------------------- transport
  const start = useCallback(async () => {
    cancelAnimationFrame(raf.current);
    const e = engine.current ?? (engine.current = new AudioEngine());
    e.stopAll();
    await e.load();
    await e.resume();
    e.volume = opts.volume;
    const intro = opts.intro ? INTRO_TOTAL : 0;
    const voiceLead = opts.voice ? STANDBY_VOICE_LEAD : 0;
    const s = buildSchedule(stage, { seed: opts.seed, intro, voiceLead });
    schedule.current = s;
    t0.current = e.now + 0.3;
    for (const rep of s.reps) {
      if (opts.voice) e.play('standby', t0.current + rep.standbyStart);
      e.play('start', t0.current + rep.startBeep);
      e.play('par', t0.current + rep.endBeep);
    }
    setStatus('running');
    setControlsVisible(false);
    raf.current = requestAnimationFrame(tick);
    if (import.meta.env.DEV) Object.assign(window, { __player: { engine: e, schedule: s, t0: t0.current } });
  }, [opts, stage, tick]);

  const togglePause = useCallback(async () => {
    const e = engine.current;
    if (!e) return;
    if (status === 'running') {
      await e.pause();
      setStatus('paused');
      setControlsVisible(true);
    } else if (status === 'paused') {
      await e.resume();
      setStatus('running');
      setControlsVisible(false);
    }
  }, [status]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    engine.current?.stopAll();
    schedule.current = null;
    setStatus('setup');
    setScene('stage');
    setControlsVisible(true);
  }, []);

  const exit = useCallback(() => {
    stop();
    if (document.fullscreenElement) void document.exitFullscreen();
    onExit();
  }, [stop, onExit]);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      void engine.current?.close();
    },
    [],
  );

  // ---------------------------------------------------------------- keyboard + mouse
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === ' ') {
        // a focused button would also "click" on Space — handle it only once, here
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (status === 'setup' || status === 'complete') void start();
        else void togglePause();
      } else if (e.key.toLowerCase() === 'r') void start();
      else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key === 'Escape' && !document.fullscreenElement) {
        if (status === 'setup' || status === 'complete') exit();
        else stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, start, togglePause, toggleFullscreen, exit, stop]);

  useEffect(() => {
    if (status !== 'running') return;
    let timer = 0;
    const onMove = () => {
      setControlsVisible(true);
      clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 2000);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      clearTimeout(timer);
    };
  }, [status]);

  const set = <K extends keyof Options>(k: K, v: Options[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const duration = estimateDuration(stage, opts.intro ? INTRO_TOTAL : 0, opts.voice ? STANDBY_VOICE_LEAD : 0);
  const playing = status === 'running' || status === 'paused';

  return (
    <div className={`player${status === 'running' && !controlsVisible ? ' hide-cursor' : ''}`} ref={rootRef}>
      <div className="player-area" ref={areaRef}>
        <div className="player-box" style={{ width: box.width, height: box.height }}>
          <StageCanvas stage={stage} width={box.width} height={box.height} registerNode={registerNode} layerRef={layer} />
          {playing && scene === 'stage' && <PlayerOverlay ref={overlay} stage={stage} showTimer={opts.timer} signalBorder={opts.signalBorder} />}
          {playing && scene === 'intro-safety' && <SafetyScreen />}
          {playing && scene === 'intro-brand' && <BrandScreen />}
          {status === 'complete' && <CompleteScreen reps={stage.repetitions} onRestart={() => void start()} onExit={exit} />}
          {status === 'paused' && <div className="paused-badge">Paused — Space to resume</div>}

          {status === 'setup' && (
            <div className="setup">
              <div className="setup-card">
                <div className="eyebrow">{ENVIRONMENTS[stage.environment].label}</div>
                <h2>{stage.name}</h2>
                {stage.description && <p className="muted">{stage.description}</p>}
                <div className="setup-stats">
                  <span><b>{stage.parTime.toFixed(2)} s</b> par</span>
                  <span><b>{stage.repetitions}</b> reps</span>
                  <span><b>{stage.resetTime} s</b> reset</span>
                  <span><b>{stage.standbyDelay.min}–{stage.standbyDelay.max} s</b> delay</span>
                  <span>≈ <b>{fmt(duration)}</b></span>
                </div>
                <div className="setup-options">
                  <label><input type="checkbox" checked={opts.intro} onChange={(e) => set('intro', e.target.checked)} /> Safety + brand intro</label>
                  <label><input type="checkbox" checked={opts.voice} onChange={(e) => set('voice', e.target.checked)} /> Spoken “Stand by”</label>
                  <label><input type="checkbox" checked={opts.timer} onChange={(e) => set('timer', e.target.checked)} /> Running timer</label>
                  <label><input type="checkbox" checked={opts.signalBorder} onChange={(e) => set('signalBorder', e.target.checked)} /> Signal border</label>
                  <label className="seed">
                    Seed <input value={opts.seed} onChange={(e) => set('seed', e.target.value)} />
                    <button onClick={() => set('seed', Math.random().toString(36).slice(2, 8))}>New</button>
                  </label>
                  <label className="seed">
                    Volume <input type="range" min={0} max={1} step={0.05} value={opts.volume} onChange={(e) => set('volume', parseFloat(e.target.value))} />
                  </label>
                </div>
                <div className="setup-actions">
                  <button className="primary" onClick={() => void start()}>Start (Space)</button>
                  <FullscreenButton active={fullscreen} onToggle={toggleFullscreen} />
                  <button onClick={exit}>Back to editor</button>
                </div>
                <p className="hint">Same seed = same standby delays (repeatable recordings). Keys: Space start/pause · R restart · F fullscreen · Esc stop.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {playing && (
        <div className={`player-controls${controlsVisible ? ' visible' : ''}`}>
          <button onClick={() => void togglePause()}>{status === 'paused' ? 'Resume' : 'Pause'}</button>
          <button onClick={() => void start()}>Restart</button>
          <FullscreenButton active={fullscreen} onToggle={toggleFullscreen} />
          <button onClick={stop}>Stop</button>
        </div>
      )}
    </div>
  );
};
