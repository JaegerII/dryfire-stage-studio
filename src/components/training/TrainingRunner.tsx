import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import { useFullscreen } from '../../hooks/useFullscreen';
import { AudioController } from '../../training/AudioController';
import { TRAINING_CONFIG, type TrainingConfig } from '../../training/config';
import { TARGET_DESIGNS, TurningTarget } from '../../training/targets';
import { type TrainingProgram, describePhase } from '../../training/TrainingPhase';
import { type Series, buildSeries, seriesState, seriesSummary } from '../../training/TrainingSequence';
import { Timer } from '../../training/Timer';

type Status = 'setup' | 'running' | 'paused' | 'between' | 'finished';

interface Props {
  program: TrainingProgram;
  onExit: () => void;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Runs a training program: series after series, each with task card → READY → (delay) →
 * 3…2…1 → start signal → targets → end signal → SERIES COMPLETE. While a series runs the
 * screen shows only the targets, the distance and the remaining time.
 */
export const TrainingRunner = ({ program, onExit }: Props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const { active: fullscreen, toggle: toggleFullscreen } = useFullscreen(rootRef);
  const design = TARGET_DESIGNS[program.design] ?? TARGET_DESIGNS.neutral;

  const [opts, setOpts] = useState({ muted: false, randomDelay: TRAINING_CONFIG.randomStartDelay.enabled, autoAdvance: TRAINING_CONFIG.autoAdvance !== null });
  const cfg: TrainingConfig = useMemo(
    () => ({
      ...TRAINING_CONFIG,
      randomStartDelay: { ...TRAINING_CONFIG.randomStartDelay, enabled: opts.randomDelay },
      autoAdvance: opts.autoAdvance ? (TRAINING_CONFIG.autoAdvance ?? 10) : null,
    }),
    [opts.randomDelay, opts.autoAdvance],
  );

  const [status, setStatus] = useState<Status>('setup');
  const [index, setIndex] = useState(0);
  const [, setFrame] = useState(0);
  const series = useRef<Series[]>([]);
  const audio = useRef<AudioController | null>(null);
  const timer = useRef<Timer | null>(null); // time inside the running series
  const pauseTimer = useRef<Timer | null>(null); // time inside the pause between series
  const statusRef = useRef<Status>('setup');
  const resumeTo = useRef<'running' | 'between'>('running');
  const setSt = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const current = series.current[index];

  const runSeries = useCallback((i: number) => {
    const a = audio.current!;
    a.stopAll();
    setIndex(i);
    timer.current!.start(0);
    a.schedule(series.current[i].cues, 0);
    setSt('running');
  }, []);

  const start = useCallback(async () => {
    const a = audio.current ?? (audio.current = new AudioController());
    await a.load();
    a.muted = opts.muted;
    timer.current = new Timer(() => a.now);
    pauseTimer.current = new Timer(() => a.now);
    series.current = buildSeries(program, cfg);
    runSeries(0);
  }, [program, cfg, opts.muted, runSeries]);

  const next = useCallback(() => {
    const i = index + 1;
    if (i < series.current.length) runSeries(i);
  }, [index, runSeries]);

  const pause = useCallback(() => {
    const s = statusRef.current;
    if (s === 'running') {
      timer.current?.pause();
      audio.current?.stopAll();
      resumeTo.current = 'running';
      setSt('paused');
    } else if (s === 'between') {
      pauseTimer.current?.pause();
      resumeTo.current = 'between';
      setSt('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== 'paused') return;
    if (resumeTo.current === 'running') {
      timer.current!.resume();
      audio.current!.schedule(series.current[index].cues, timer.current!.elapsed);
      setSt('running');
    } else {
      pauseTimer.current!.resume();
      setSt('between');
    }
  }, [index]);

  const reset = useCallback(() => {
    audio.current?.stopAll();
    timer.current?.reset();
    pauseTimer.current?.reset();
    setIndex(0);
    setSt('setup');
  }, []);

  // frame loop: advance series → pause → next series
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const s = statusRef.current;
      const cur = series.current[index];
      if (s === 'running' && cur && timer.current!.elapsed >= cur.duration) {
        if (!cur.pauseAfter) setSt('finished');
        else {
          pauseTimer.current!.start(0);
          setSt('between');
        }
      } else if (s === 'between' && cur?.pauseAfter?.seconds != null && pauseTimer.current!.elapsed >= cur.pauseAfter.seconds) {
        runSeries(index + 1);
      }
      if (s === 'running' || s === 'between') setFrame((f) => (f + 1) % 1e6);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, runSeries]);

  useEffect(() => () => audio.current?.close(), []);

  // dev only: jump inside the running series (testing long phases)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(window, {
      __training: {
        series: () => series.current,
        seek: (sec: number) => {
          timer.current?.start(sec);
          audio.current?.stopAll();
          if (audio.current && series.current[index]) audio.current.schedule(series.current[index].cues, sec);
        },
        goto: (i: number) => runSeries(i),
      },
    });
  }, [index, runSeries]);

  useEffect(() => {
    if (audio.current) audio.current.muted = opts.muted;
  }, [opts.muted]);

  // keyboard: Space start/pause/resume/next · F fullscreen · M mute · N next · R reset · Esc back (outside fullscreen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const s = statusRef.current;
      if (e.key === ' ') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
        if (s === 'setup' || s === 'finished') void start();
        else if (s === 'running' || s === 'between') pause();
        else if (s === 'paused') resume();
      } else if (e.key.toLowerCase() === 'f') toggleFullscreen();
      else if (e.key.toLowerCase() === 'm') setOpts((o) => ({ ...o, muted: !o.muted }));
      else if (e.key.toLowerCase() === 'n' && s === 'between') next();
      else if (e.key.toLowerCase() === 'r') reset();
      else if (e.key === 'Escape' && !document.fullscreenElement && (s === 'setup' || s === 'finished')) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start, pause, resume, next, reset, toggleFullscreen, onExit]);

  // ---------------------------------------------------------------- view state
  const t = timer.current?.elapsed ?? 0;
  const inSeries = (status === 'running' || (status === 'paused' && resumeTo.current === 'running')) && current;
  const st = inSeries ? seriesState(current, t, program.layout, cfg) : null;
  const shownPhase = current?.phase ?? program.phases[0];
  const distance = (status === 'between' || (status === 'paused' && resumeTo.current === 'between')) && series.current[index + 1] ? series.current[index + 1].phase.distance : shownPhase.distance;
  const targetH = box.height * Math.max(cfg.minTargetHeight, Math.min(0.75, (cfg.targetHeightAt10m * 10) / distance));
  const upcoming = series.current[index + 1];
  const pauseLeft = current?.pauseAfter?.seconds != null ? Math.max(0, current.pauseAfter.seconds - (pauseTimer.current?.elapsed ?? 0)) : null;
  // during a series: no menus at all — only targets, distance and time (Space pauses)
  const clean = status === 'running';

  return (
    <div className={`training-runner${clean ? ' clean' : ''}`} ref={rootRef}>
      <div className="training-area" ref={areaRef}>
        <div className="training-box" style={{ width: box.width, height: box.height }}>
          <div className="range-floor" />
          <div className="targets-row">
            {program.layout.map((slot) => (
              <TurningTarget
                key={slot}
                design={design}
                facing={st ? st.facing[slot] : 0}
                height={targetH}
                label={program.layout.length > 1 ? slot.toUpperCase() : undefined}
                dim={!!current && !current.phase.active.includes(slot) && status !== 'setup'}
              />
            ))}
          </div>

          {/* minimal HUD while a series runs */}
          {inSeries && st && (st.stage === 'active' || st.stage === 'hold' || st.stage === 'count' || st.stage === 'end') && (
            <div className="training-hud">
              <div className="th-distance">{current.phase.distance} m</div>
              <div className="th-time">
                {current.phase.type === 'continuous' && st.remaining !== undefined && <b>{clock(Math.ceil(st.remaining))}</b>}
                {current.phase.type === 'exposure' && st.exposure !== undefined && (
                  <>
                    <span>
                      {st.exposure} / {st.exposures}
                    </span>
                    <b>{st.remaining !== undefined ? st.remaining.toFixed(1) : '–'}</b>
                  </>
                )}
              </div>
            </div>
          )}

          {/* cards */}
          {inSeries && st?.stage === 'brief' && (
            <div className="training-card">
              <span className="tc-eyebrow">
                {program.discipline} · Phase {current.phaseIndex + 1} / {program.phases.length}
                {current.rounds > 1 ? ` · Round ${current.round} / ${current.rounds}` : ''}
              </span>
              <b className="tc-big distance">{current.phase.distance} m</b>
              <span className="tc-task">{current.task}</span>
            </div>
          )}
          {inSeries && st?.stage === 'ready' && (
            <div className="training-card">
              <b className="tc-big ready">READY</b>
            </div>
          )}
          {inSeries && st?.stage === 'count' && <div className="training-count">{st.count}</div>}
          {inSeries && st?.stage === 'end' && (
            <div className="training-card">
              <b className="tc-big time">TIME</b>
            </div>
          )}

          {(status === 'between' || (status === 'paused' && resumeTo.current === 'between')) && current && (
            <div className="training-card wide">
              <span className="tc-eyebrow go">Series complete</span>
              <span className="tc-task">{seriesSummary(current)}</span>
              {current.pauseAfter?.kind === 'round' ? (
                <>
                  <b className="tc-big">Reload pause</b>
                  <span className="tc-task">
                    Round {upcoming?.round} / {upcoming?.rounds} · starts in {clock(Math.ceil(pauseLeft ?? 0))}
                  </span>
                </>
              ) : (
                <>
                  <b className="tc-big distance">NEXT: {upcoming?.phase.distance} m</b>
                  <span className="tc-task">
                    {upcoming?.task}
                    {pauseLeft != null ? ` · starts in ${Math.ceil(pauseLeft)} s` : ''}
                  </span>
                </>
              )}
              <button className="primary tc-next" onClick={next}>
                NEXT ▶
              </button>
            </div>
          )}

          {status === 'finished' && (
            <div className="training-card wide">
              <span className="tc-eyebrow go">Training complete</span>
              <b className="tc-big">{program.name}</b>
              <ul className="tc-list">
                {series.current.map((s) => (
                  <li key={s.index}>{seriesSummary(s)}</li>
                ))}
              </ul>
            </div>
          )}

          {status === 'setup' && (
            <div className="training-setup">
              <span className="tc-eyebrow">{program.discipline}</span>
              <h1>{program.name}</h1>
              <ol>
                {program.phases.map((p, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {describePhase(p)}
                    {p.type === 'exposure' && (p.rounds ?? 1) > 1 ? ` · ${p.rounds} rounds` : ''}
                  </li>
                ))}
              </ol>
              <div className="setup-opts">
                <label>
                  <input type="checkbox" checked={opts.randomDelay} onChange={(e) => setOpts((o) => ({ ...o, randomDelay: e.target.checked }))} /> Random start delay
                </label>
                <label>
                  <input type="checkbox" checked={opts.autoAdvance} onChange={(e) => setOpts((o) => ({ ...o, autoAdvance: e.target.checked }))} /> Auto-advance after{' '}
                  {TRAINING_CONFIG.autoAdvance ?? 10} s
                </label>
              </div>
              <p className="hint">
                Unloaded firearm or training device only. No shots are detected. Keys: Space start / pause · F fullscreen · M mute · N next · R reset.
              </p>
            </div>
          )}
          {status === 'paused' && <div className="training-paused">PAUSED</div>}
        </div>
      </div>

      <div className={`training-controls${clean ? ' hidden' : ''}`}>
        <button onClick={onExit}>◀ Back</button>
        {status === 'setup' || status === 'finished' ? (
          <button className="primary" onClick={() => void start()}>
            {status === 'finished' ? 'Run again' : 'START'}
          </button>
        ) : status === 'paused' ? (
          <button className="primary" onClick={resume}>
            RESUME
          </button>
        ) : (
          <button onClick={pause}>PAUSE</button>
        )}
        <button onClick={reset} disabled={status === 'setup'}>
          RESET
        </button>
        <span className="spacer" />
        <button className={opts.muted ? 'on' : ''} onClick={() => setOpts((o) => ({ ...o, muted: !o.muted }))} title="M">
          {opts.muted ? '🔇 Muted' : '🔊 Sound'}
        </button>
        <button onClick={toggleFullscreen} title="F">
          {fullscreen ? 'Exit fullscreen' : '⛶ Fullscreen'}
        </button>
      </div>
    </div>
  );
};
