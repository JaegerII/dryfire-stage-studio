import type { MatchSettings } from '../../types/match';
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { useFullscreen } from '../../hooks/useFullscreen';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import type { Stage } from '../../types/stage';
import { AudioEngine, STANDBY_VOICE_LEAD } from '../../utils/audioEngine';
import { type MatchSchedule, buildMatchSchedule, estimateMatchDuration, matchSnapshotAt } from '../../utils/matchSchedule';
import { applyStageMotion, stageMotionData } from '../../utils/stageMotion';
import { areaAt, areaCount, areaStage, areaTimeline, isDynamic, transitionOf } from '../../utils/areas';
import { WallWipe, type WallWipeHandle } from './WallWipe';
import { TabRecorder, downloadBlob, recordingSupported, videoFileName } from '../../utils/recorder';
import { StageCanvas } from '../stage/StageCanvas';
import { FullscreenButton } from './FullscreenButton';
import { BrandScreen, CompleteScreen, SafetyScreen, StageTitleScreen } from './IntroScreens';
import { type OverlayHandle, PlayerOverlay } from './PlayerOverlay';

interface Props {
  /** One stage, or all stages of a match in play order. */
  stages: Stage[];
  /** Match name (undefined when a single stage is played). */
  matchName?: string;
  /** Match settings: intro default and the times between the stages. */
  matchSettings?: MatchSettings;
  onExit: () => void;
}

interface Options {
  intro: boolean;
  timer: boolean;
  voice: boolean;
  signalBorder: boolean;
  seed: string;
  volume: number;
  /** Record this tab + player audio and download a video file at the end. */
  record: boolean;
}

type Status = 'setup' | 'running' | 'paused' | 'complete';
type Scene = 'brand' | 'safety' | 'title' | 'stage' | 'complete';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Player mode: the stage, a minimal HUD and nothing else. Plays a whole match
 * (logo → safety → stage titles + stages) on the audio clock — beeps are
 * scheduled sample-accurately, the HUD and moving targets follow it on
 * requestAnimationFrame.
 */
export const TrainingPlayer = ({ stages, matchName, matchSettings, onExit }: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);
  const isMatch = matchName !== undefined;

  const [opts, setOpts] = useState<Options>({
    intro: isMatch && (matchSettings?.intro ?? true),
    timer: false,
    voice: true,
    signalBorder: true,
    seed: stages.map((s) => s.id).join('+'),
    volume: 1,
    record: false,
  });
  const [recording, setRecording] = useState(false);
  /** Recording armed: tab shared, waiting for fullscreen so every screen pixel is recorded 1:1. */
  const [armed, setArmed] = useState(false);
  const pending = useRef<(() => Promise<void>) | null>(null);
  const recorder = useRef<TabRecorder | null>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  const title = matchName ?? stages[0]?.name ?? 'dryfire';

  /** Ends the recording; keep = download the file. */
  const finishRecording = useCallback(
    async (keep: boolean) => {
      const rec = recorder.current;
      recorder.current = null;
      setRecording(false);
      const file = await rec?.stop(keep);
      if (file) downloadBlob(file.blob, videoFileName(title, file.ext));
    },
    [title],
  );
  const [status, setStatus] = useState<Status>('setup');
  const [scene, setScene] = useState<Scene>('stage');
  const [stageIndex, setStageIndex] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);

  const engine = useRef<AudioEngine | null>(null);
  const schedule = useRef<MatchSchedule | null>(null);
  const t0 = useRef(0);
  const raf = useRef(0);
  const overlay = useRef<OverlayHandle>(null);
  // one canvas per area (a classic stage has exactly one); nodes / layers / elements per area
  const layers = useRef<(Konva.Layer | null)[]>([]);
  const nodes = useRef<Map<string, Konva.Group>[]>([]);
  const areaEls = useRef<(HTMLDivElement | null)[]>([]);
  const shownArea = useRef(0);
  const wipe = useRef<WallWipeHandle>(null);
  const boxRef = useRef(box);
  boxRef.current = box;
  const motionData = useMemo(() => stages.map((s) => Array.from({ length: areaCount(s) }, (_, k) => stageMotionData(areaStage(s, k)))), [stages]);
  const timelines = useMemo(() => stages.map(areaTimeline), [stages]);
  const stage = stages[stageIndex];
  const areaStages = useMemo(() => (stage ? Array.from({ length: areaCount(stage) }, (_, k) => areaStage(stage, k)) : []), [stage]);
  const registerFor = useMemo(
    () =>
      areaStages.map((_, k) => (id: string, node: Konva.Group | null) => {
        const m = (nodes.current[k] ??= new Map());
        if (node) m.set(id, node);
        else m.delete(id);
      }),
    [areaStages],
  );
  const layerRefs = useMemo(
    () =>
      areaStages.map((_, k) => ({
        get current() {
          return layers.current[k] ?? null;
        },
        set current(l: Konva.Layer | null) {
          layers.current[k] = l;
        },
      })),
    [areaStages],
  );

  /** Shows area `k` (hides the others) and shifts it during a transition (parallax: the shooter moves). */
  const showArea = useCallback((k: number, st: Stage, progress: number | null) => {
    if (shownArea.current !== k) {
      areaEls.current.forEach((el, i) => {
        if (!el) return;
        el.style.visibility = i === k ? 'visible' : 'hidden';
        el.style.transform = '';
      });
      shownArea.current = k;
    }
    const el = areaEls.current[k];
    if (el && isDynamic(st)) {
      const dir = transitionOf(st).direction === 'ltr' ? 1 : -1;
      const W = boxRef.current.width;
      const off = progress === null ? 0 : progress < 0.5 ? dir * 0.12 * W * (progress / 0.5) : -dir * 0.12 * W * (1 - (progress - 0.5) / 0.5);
      el.style.transform = off ? `translate3d(${off}px,0,0)` : '';
    }
    wipe.current?.update(progress);
  }, []);

  // ---------------------------------------------------------------- frame loop
  const tick = useCallback(() => {
    const e = engine.current;
    const ms = schedule.current;
    if (!e || !ms) return;
    const snap = matchSnapshotAt(ms, e.now - t0.current, stages);
    const seg = snap.segment;
    if (!seg) {
      setScene('complete');
      setStatus('complete');
      // keep the "complete" screen in the video for a moment, then save it
      if (recorder.current) setTimeout(() => void finishRecording(true), 2500);
      return;
    }
    const nextScene: Scene = seg.kind;
    setScene((cur) => (cur === nextScene ? cur : nextScene));
    if (seg.kind === 'title' || seg.kind === 'stage') setStageIndex((cur) => (cur === seg.stageIndex ? cur : seg.stageIndex));

    if (seg.kind === 'stage' && snap.stage) {
      const st = stages[seg.stageIndex];
      const rs = snap.stage;
      overlay.current?.update(rs);
      // dynamic stage: which area is on screen, and is a barrier passing right now?
      const activeWindow = rs.phase === 'active' || (rs.phase === 'reset' && rs.sinceStart < st.parTime + 1);
      const av = areaAt(st, timelines[seg.stageIndex], rs.sinceStart, activeWindow);
      showArea(av.area, st, av.transition);
      // each area's targets run on that area's own clock (from the moment it appears)
      const local = { ...rs, sinceStart: rs.sinceStart - av.areaStart };
      const m = nodes.current[av.area];
      if (m && applyStageMotion(areaStage(st, av.area), motionData[seg.stageIndex][av.area], local, m, boxRef.current)) layers.current[av.area]?.batchDraw();
    }
    raf.current = requestAnimationFrame(tick);
  }, [stages, motionData, timelines, showArea, finishRecording]);

  // ---------------------------------------------------------------- transport
  const start = useCallback(async () => {
    cancelAnimationFrame(raf.current);
    const e = engine.current ?? (engine.current = new AudioEngine());
    e.stopAll();
    if (recorder.current) await finishRecording(false); // restart → drop the unfinished take
    if (opts.record) {
      // must run first, while the click still counts as a user gesture
      const rec = new TabRecorder();
      try {
        await rec.start(boxEl.current, e.recordingStream());
      } catch {
        alert('Recording was not started (tab sharing was cancelled or is not supported).');
        return;
      }
      recorder.current = rec;
      setRecording(true);
    }
    const run = async () => {
      recorder.current?.begin();
      await play(e);
    };
    if (opts.record && !document.fullscreenElement) {
      // sharp video: start only in fullscreen (the capture is cropped to the player — a window would be upscaled)
      pending.current = run;
      setArmed(true);
      return;
    }
    await run();
  }, [opts, stages, tick, finishRecording]); // eslint-disable-line react-hooks/exhaustive-deps -- play() reads the same stages / tick

  const play = async (e: AudioEngine) => {
    await e.load();
    await e.resume();
    e.volume = opts.volume;
    const ms = buildMatchSchedule(stages, { seed: opts.seed, intro: opts.intro, voiceLead: opts.voice ? STANDBY_VOICE_LEAD : 0, timing: matchSettings?.timing });
    schedule.current = ms;
    t0.current = e.now + 0.3;
    for (const seg of ms.segments) {
      if (seg.kind !== 'stage') continue;
      const base = t0.current + seg.start;
      for (const rep of seg.schedule.reps) {
        if (opts.voice) e.play('standby', base + rep.standbyStart);
        e.play('start', base + rep.startBeep);
        e.play('par', base + rep.endBeep);
      }
    }
    setStageIndex(0);
    setScene(ms.segments[0]?.kind ?? 'stage');
    setStatus('running');
    setControlsVisible(false);
    raf.current = requestAnimationFrame(tick);
    if (import.meta.env.DEV) Object.assign(window, { __player: { engine: e, schedule: ms, t0: t0.current } });
  };

  // armed recording: fullscreen reached → give the layout a moment to settle, then record + play
  useEffect(() => {
    if (!armed || !fullscreen) return;
    const go = pending.current;
    pending.current = null;
    setArmed(false); // (no cleanup that clears the timer: this very change re-runs the effect)
    setTimeout(() => void go?.(), 700);
  }, [armed, fullscreen]);

  const cancelArmed = useCallback(() => {
    pending.current = null;
    setArmed(false);
    void finishRecording(false);
  }, [finishRecording]);

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
    if (recorder.current) void finishRecording(confirm('Save the recording made so far?'));
    cancelAnimationFrame(raf.current);
    engine.current?.stopAll();
    schedule.current = null;
    const st = stages[0];
    if (st) showArea(0, st, null);
    setStatus('setup');
    setScene('stage');
    setStageIndex(0);
    setControlsVisible(true);
  }, [finishRecording, stages, showArea]);

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
      if (armed) {
        if (e.key.toLowerCase() === 'f') toggleFullscreen();
        else if (e.key === 'Escape') cancelArmed();
        return;
      }
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
  }, [status, armed, start, togglePause, toggleFullscreen, cancelArmed, exit, stop]);

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
  const duration = estimateMatchDuration(stages, opts.intro, opts.voice ? STANDBY_VOICE_LEAD : 0, matchSettings?.timing);
  const playing = status === 'running' || status === 'paused';
  const totalReps = stages.reduce((s, st) => s + st.repetitions, 0);
  // the stage is visible in setup, during its own segment and on the complete screen; hidden behind intro/title cards
  const canvasClass = !playing ? 'stage-layer' : scene === 'stage' ? 'stage-layer push-in' : 'stage-layer hidden';

  if (!stage) return null;

  return (
    <div className={`player${status === 'running' && !controlsVisible ? ' hide-cursor' : ''}`} ref={rootRef}>
      <div className="player-area" ref={areaRef}>
        <div className="player-box" ref={boxEl} style={{ width: box.width, height: box.height }}>
          <div className={canvasClass} key={`layer-${stageIndex}`}>
            {areaStages.map((as, k) => (
              <div
                key={k}
                className="area-layer"
                ref={(el) => {
                  areaEls.current[k] = el;
                }}
                style={{ visibility: k === 0 ? 'visible' : 'hidden' }}
              >
                <StageCanvas stage={as} width={box.width} height={box.height} registerNode={registerFor[k]} layerRef={layerRefs[k]} />
              </div>
            ))}
            {isDynamic(stage) && <WallWipe ref={wipe} transition={transitionOf(stage)} />}
          </div>
          {playing && scene === 'stage' && (
            <PlayerOverlay
              key={`hud-${stageIndex}`}
              ref={overlay}
              stage={stage}
              caption={isMatch ? `${matchName} · Stage ${stageIndex + 1}/${stages.length}` : undefined}
              showTimer={opts.timer}
              signalBorder={opts.signalBorder}
            />
          )}
          {playing && scene === 'brand' && <BrandScreen />}
          {playing && scene === 'safety' && <SafetyScreen />}
          {playing && scene === 'title' && (
            <StageTitleScreen key={`title-${stageIndex}`} stage={stage} index={stageIndex} count={stages.length} matchName={matchName} />
          )}
          {status === 'complete' && (
            <CompleteScreen
              title={isMatch ? 'Match Complete' : 'Training Complete'}
              detail={isMatch ? `${stages.length} stages · ${totalReps} reps` : `${totalReps} repetitions`}
              onRestart={() => void start()}
              onExit={exit}
            />
          )}
          {status === 'paused' && <div className="paused-badge">Paused — Space to resume</div>}

          {armed && (
            <button className="record-armed" onClick={toggleFullscreen}>
              <span className="armed-dot">●</span>
              <strong>Recording ready</strong>
              <span>Press F or click here for fullscreen — recording and the match start automatically.</span>
              <em>Esc cancels</em>
            </button>
          )}
          {status === 'setup' && !armed && (
            <div className="setup">
              <div className="setup-card">
                <div className="eyebrow">{isMatch ? `Match · ${stages.length} stages` : ENVIRONMENTS[stage.environment].label}</div>
                <h2>{matchName ?? stage.name}</h2>
                {!isMatch && stage.description && <p className="muted">{stage.description}</p>}
                {isMatch ? (
                  <ol className="setup-stages">
                    {stages.map((s, i) => (
                      <li key={`${s.id}${i}`}>
                        <span>{s.name}</span>
                        <em>
                          par {s.parTime.toFixed(1)} s · {s.repetitions} reps
                        </em>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="setup-stats">
                    <span><b>{stage.parTime.toFixed(2)} s</b> par</span>
                    <span><b>{stage.repetitions}</b> reps</span>
                    <span><b>{stage.resetTime} s</b> reset</span>
                    <span><b>{stage.standbyDelay.min}–{stage.standbyDelay.max} s</b> delay</span>
                    {isDynamic(stage) && (
                      <span><b>{areaCount(stage)}</b> areas · {transitionOf(stage).duration} s reload moves</span>
                    )}
                  </div>
                )}
                <div className="setup-stats">
                  <span>Length ≈ <b>{fmt(duration)}</b></span>
                </div>
                <div className="setup-options">
                  <label><input type="checkbox" checked={opts.intro} onChange={(e) => set('intro', e.target.checked)} /> Logo + safety intro</label>
                  <label><input type="checkbox" checked={opts.voice} onChange={(e) => set('voice', e.target.checked)} /> Spoken “Stand by”</label>
                  <label><input type="checkbox" checked={opts.timer} onChange={(e) => set('timer', e.target.checked)} /> Running timer</label>
                  <label><input type="checkbox" checked={opts.signalBorder} onChange={(e) => set('signalBorder', e.target.checked)} /> Signal border</label>
                  <label className="seed">
                    Seed <input value={opts.seed} onChange={(e) => set('seed', e.target.value)} />
                    <button onClick={() => set('seed', Math.random().toString(36).slice(2, 8))}>New</button>
                  </label>
                  {recordingSupported() && (
                    <label className="record-opt">
                      <input type="checkbox" checked={opts.record} onChange={(e) => set('record', e.target.checked)} /> ● Record video file
                    </label>
                  )}
                  <label className="seed">
                    Volume <input type="range" min={0} max={1} step={0.05} value={opts.volume} onChange={(e) => set('volume', parseFloat(e.target.value))} />
                  </label>
                </div>
                <div className="setup-actions">
                  <button className="primary" onClick={() => void start()}>Start (Space)</button>
                  <FullscreenButton active={fullscreen} onToggle={toggleFullscreen} />
                  <button onClick={exit}>Back</button>
                </div>
                {opts.record && (
                  <p className="hint warn">
                    On Start the browser asks to share this tab — choose this tab. Record in fullscreen (F) for the sharpest
                    picture: every screen pixel is recorded 1:1 (WQHD → 2560 × 1440). Keep the mouse still. The video downloads
                    automatically at the end.
                  </p>
                )}
                <p className="hint">Same seed = same standby delays (repeatable recordings). Keys: Space start/pause · R restart · F fullscreen · Esc stop.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {playing && (
        <div className={`player-controls${controlsVisible ? ' visible' : ''}`}>
          {recording && <span className="rec">● REC</span>}
          <button onClick={() => void togglePause()}>{status === 'paused' ? 'Resume' : 'Pause'}</button>
          <button onClick={() => void start()}>Restart</button>
          <FullscreenButton active={fullscreen} onToggle={toggleFullscreen} />
          <button onClick={stop}>Stop</button>
        </div>
      )}
    </div>
  );
};
