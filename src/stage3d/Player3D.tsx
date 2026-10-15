import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fit16x9, useElementSize } from '../hooks/useElementSize';
import type { MatchSettings } from '../types/match';
import { AudioEngine, STANDBY_VOICE_LEAD } from '../utils/audioEngine';
import { downloadBlob } from '../utils/recorder';
import { RenderAborted, renderMp4 } from './exportVideo';
import { buildProgram, programCues, programFrameAt, stageStarts } from './program';
import { drawProgramHud, loadScreenAssets, showsScene } from './screens';
import { StageScene3D } from './StageScene3D';
import type { Stage3D } from './types';
import { parTime3D, shakeOf } from './types';

const RESOLUTIONS = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4K': [3840, 2160] } as const;
type Res = keyof typeof RESOLUTIONS;

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

interface Props {
  /** One stage, or the stages of a match in play order. */
  stages: Stage3D[];
  /** Set for a match: logo / safety intro (per its settings), title card before every stage. */
  matchName?: string;
  settings?: MatchSettings;
  onExit: () => void;
}

/**
 * Plays a stage or a whole match in 3D: (logo → safety →) per stage: title card, briefing
 * from above, camera flight into the shooter's eyes, reps with real movement between the
 * positions → COMPLETE. Plays live with sound, and renders the identical video frame by
 * frame to MP4.
 */
export const Player3D = ({ stages: stagesProp, matchName, settings, onExit }: Props) => {
  const isMatch = matchName !== undefined;
  // walking shake: each stage's own setting; the slider sets it for all stages (preview + render)
  const [shake, setShake] = useState<number | null>(null);
  const stages = useMemo(() => (shake === null ? stagesProp : stagesProp.map((s) => ({ ...s, camera: { ...s.camera, shake } }))), [stagesProp, shake]);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StageScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState(true);
  const [showTimer, setShowTimer] = useState(false);
  const [intro, setIntro] = useState(settings?.intro ?? true);
  const program = useMemo(
    () =>
      buildProgram(stages, {
        seed: stages.map((s) => s.id).join('+'),
        voiceLead: voice ? STANDBY_VOICE_LEAD : 0,
        ...(isMatch ? { matchName, settings: { ...settings, intro } } : {}),
      }),
    [stages, voice, isMatch, matchName, settings, intro],
  );

  // playback clock: audio clock while playing, the scrubber otherwise
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const engine = useRef<AudioEngine | null>(null);
  const t0 = useRef(0);

  // render job
  const [res, setRes] = useState<Res>('1080p');
  const [fps, setFps] = useState<30 | 60>(60);
  const [progress, setProgress] = useState<{ done: number; total: number; started: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------- scene
  /** Index of the stage whose range + objects are in the scene; -1 while one loads. */
  const loaded = useRef(-1);
  const loading = useRef<number | null>(null);
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const s = new StageScene3D(canvas);
    sceneRef.current = s;
    loaded.current = -1;
    if (import.meta.env.DEV) Object.assign(window, { __scene3d: s });
    setReady(false);
    // every stage once, so switching stages later only takes cached models; then the first one
    (async () => {
      for (const st of stagesProp) await s.load(st);
      if (stagesProp.length > 1) await s.load(stagesProp[0]);
      loaded.current = 0;
      await loadScreenAssets();
      await document.fonts.load('900 40px Montserrat');
    })()
      .then(() => setReady(true))
      .catch((e) => setError(`3D assets could not be loaded (${e?.message ?? e}). Export them with tools/plate-renderer (npm run blender3d).`));
    return () => {
      s.dispose();
      sceneRef.current = null;
    };
  }, [stagesProp]);

  const draw = useCallback(
    (time: number) => {
      const s = sceneRef.current;
      const hud = hudRef.current;
      if (!s || !hud || !ready) return;
      const pf = programFrameAt(program, time, box.width / Math.max(1, box.height));
      // another stage comes up: swap the scene (cached models, done within a frame or two)
      if (pf.stageIndex !== loaded.current && loading.current !== pf.stageIndex) {
        const i = pf.stageIndex;
        loading.current = i;
        loaded.current = -1;
        void s.load(program.stages[i]).then(() => {
          if (loading.current === i) {
            loaded.current = i;
            loading.current = null;
          }
        });
      }
      const ctx = hud.getContext('2d')!;
      ctx.clearRect(0, 0, hud.width, hud.height);
      if (showsScene(pf) && pf.frame && loaded.current === pf.stageIndex) {
        s.apply(pf.frame);
        s.render();
      } else {
        // screens and stage changes: nothing of the old range shows through
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, hud.width, hud.height);
      }
      drawProgramHud(ctx, hud.width, hud.height, program, pf, s.project.bind(s), { showTimer });
    },
    [program, ready, box.width, box.height, showTimer],
  );

  // canvas sizes follow the 16:9 box (device pixels, capped for performance)
  useEffect(() => {
    const s = sceneRef.current;
    const hud = hudRef.current;
    if (!s || !hud || !box.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    s.renderer.setPixelRatio(dpr);
    s.setSize(box.width, box.height);
    hud.width = Math.round(box.width * dpr);
    hud.height = Math.round(box.height * dpr);
    draw(tRef.current);
  }, [box.width, box.height, draw, ready]);

  // ---------------------------------------------------------------- live playback
  const stop = useCallback(() => {
    engine.current?.stopAll();
    void engine.current?.close();
    engine.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(async () => {
    const e = new AudioEngine();
    await e.load();
    await e.resume();
    engine.current = e;
    const from = tRef.current >= program.end ? 0 : tRef.current;
    t0.current = e.now + 0.1 - from;
    for (const c of programCues(program, voice)) if (c.t >= from) e.play(c.cue, t0.current + c.t);
    setPlaying(true);
  }, [program, voice]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const e = engine.current;
      if (!e) return;
      const now = Math.max(0, e.now - t0.current);
      tRef.current = now;
      draw(now);
      if (now >= program.end) {
        stop();
        setT(program.end);
        return;
      }
      setT((p) => (Math.abs(p - now) > 0.1 ? now : p)); // scrubber at ~10 Hz
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, program.end, stop]);

  useEffect(() => () => stop(), [stop]);

  // a changed program (voice, intro, shake) keeps the position but redraws
  useEffect(() => {
    if (!playing) draw(tRef.current);
  }, [draw, playing]);

  const seek = (v: number) => {
    if (playing) stop();
    tRef.current = v;
    setT(v);
    draw(v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) stop();
        else void play();
      } else if (e.key === 'Escape' && !progress) onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, play, stop, onExit, progress]);

  // ---------------------------------------------------------------- MP4 render
  const title = matchName ?? stages[0]?.name ?? 'stage';
  const render = async () => {
    stop();
    const [w, h] = RESOLUTIONS[res];
    const ac = new AbortController();
    abort.current = ac;
    const started = performance.now();
    setProgress({ done: 0, total: 1, started });
    try {
      const r = await renderMp4(program, { width: w, height: h, fps, voice, showTimer, signal: ac.signal, onProgress: (done, total) => setProgress({ done, total, started }) });
      downloadBlob(r.blob, `${title.replace(/[^\w-]+/g, '_')}_${res}_${fps}fps.mp4`);
    } catch (e) {
      if (!(e instanceof RenderAborted)) alert(`Render failed: ${(e as Error).message}`);
    } finally {
      setProgress(null);
      abort.current = null;
      draw(tRef.current);
    }
  };

  // jump buttons: per stage its briefing and rep 1 (a single stage also its first move)
  const runs = stageStarts(program);
  const jumps: [string, number][] = isMatch
    ? runs.flatMap((r, i) => [[`S${i + 1}`, r.start] as [string, number]])
    : runs.flatMap((r) => {
        const st = program.stages[r.stageIndex];
        const rep1 = r.start + r.tl.flyInEnd + (r.tl.schedule.reps[0]?.standbyStart ?? 0) - 1;
        return [
          ['Briefing', r.start],
          ['Fly-in', r.start + r.tl.briefingEnd],
          ['Rep 1', rep1],
          ...(st.legs.length ? [['Move', r.start + r.tl.flyInEnd + (r.tl.schedule.reps[0]?.startBeep ?? 0) + st.legs[0].after - 0.5]] : []),
        ] as [string, number][];
      });
  const eta = progress && progress.done > 0 ? ((performance.now() - progress.started) / progress.done) * (progress.total - progress.done) / 1000 : null;
  const shakeShown = shake ?? shakeOf(stagesProp[0]);
  const reps = program.stages.reduce((n, s) => n + s.repetitions, 0);

  return (
    <div className="player3d">
      <div className="p3-area" ref={areaRef}>
        <div className="p3-box" style={{ width: box.width, height: box.height }}>
          <canvas ref={glRef} className="p3-gl" />
          <canvas ref={hudRef} className="p3-hud" />
          {!ready && !error && <div className="p3-msg">Loading 3D {isMatch ? 'match' : 'stage'}…</div>}
          {error && <div className="p3-msg bad">{error}</div>}
          {progress && (
            <div className="p3-msg">
              <strong>Rendering MP4 · {res} · {fps} fps</strong>
              <div className="p3-bar">
                <div style={{ width: `${(100 * progress.done) / progress.total}%` }} />
              </div>
              <span>
                {Math.round((100 * progress.done) / progress.total)} % {eta !== null ? `· ≈ ${Math.ceil(eta)} s left` : ''}
              </span>
              <button onClick={() => abort.current?.abort()}>Cancel</button>
            </div>
          )}
        </div>
      </div>
      <div className="p3-controls">
        <button className="primary" disabled={!ready || !!progress} onClick={() => (playing ? stop() : void play())}>
          {playing ? 'Pause' : '▶ Play'}
        </button>
        <input type="range" min={0} max={program.end} step={0.05} value={Math.min(t, program.end)} disabled={!ready || !!progress} onChange={(e) => seek(parseFloat(e.target.value))} />
        <span className="p3-time">
          {fmt(Math.min(t, program.end))} / {fmt(program.end)}
        </span>
        {jumps.map(([label, at]) => (
          <button key={label} disabled={!ready || !!progress} onClick={() => seek(Math.max(0, at))}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        {isMatch && (
          <label className="p3-opt" title="FORTH TRACE logo and safety screen before the first stage">
            <input type="checkbox" checked={intro} disabled={!!progress} onChange={(e) => setIntro(e.target.checked)} /> Intro
          </label>
        )}
        <label className="p3-opt"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice</label>
        <label className="p3-opt"><input type="checkbox" checked={showTimer} onChange={(e) => setShowTimer(e.target.checked)} /> Timer</label>
        <label className="p3-opt p3-shake" title="Head movement while walking: 0 = steady (gimbal), 1 = natural, 2 = strong. Each stage keeps its own setting (editor) until you move this.">
          Shake <input type="range" min={0} max={2} step={0.05} value={shakeShown} disabled={!!progress} onChange={(e) => setShake(parseFloat(e.target.value))} /> <b>{shakeShown.toFixed(2)}</b>
        </label>
        <select value={res} onChange={(e) => setRes(e.target.value as Res)} disabled={!!progress}>
          {Object.keys(RESOLUTIONS).map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
        <select value={fps} onChange={(e) => setFps(Number(e.target.value) as 30 | 60)} disabled={!!progress}>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
        <button className="primary" disabled={!ready || !!progress} onClick={() => void render()}>
          Render MP4
        </button>
        <button onClick={onExit} disabled={!!progress}>
          Back
        </button>
      </div>
      <div className="p3-info">
        {isMatch
          ? `${matchName} · ${program.stages.length} stages · ${reps} reps · video ${fmt(program.end)}`
          : `${stages[0]?.name} · par ${parTime3D(program.stages[0]).toFixed(1)} s · ${program.stages[0].repetitions} reps · video ${fmt(program.end)}`}
      </div>
    </div>
  );
};
