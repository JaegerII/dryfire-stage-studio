import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fit16x9, useElementSize } from '../hooks/useElementSize';
import { AudioEngine, STANDBY_VOICE_LEAD } from '../utils/audioEngine';
import { downloadBlob } from '../utils/recorder';
import { videoCues } from './audio';
import { RenderAborted, renderMp4 } from './exportVideo';
import { drawHud } from './hud';
import { StageScene3D } from './StageScene3D';
import { buildVideoTimeline, frameAt } from './timeline';
import type { Stage3D } from './types';
import { parTime3D } from './types';

const RESOLUTIONS = { '1080p': [1920, 1080], '1440p': [2560, 1440], '4K': [3840, 2160] } as const;
type Res = keyof typeof RESOLUTIONS;

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/**
 * 3D stage player (prototype): briefing from above, camera flight into the
 * shooter's eyes, reps with real movement between positions. Plays live with
 * sound, and renders the identical video frame by frame to MP4.
 */
export const Player3D = ({ stage, onExit }: { stage: Stage3D; onExit: () => void }) => {
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const glRef = useRef<HTMLCanvasElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<StageScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState(true);
  const [showTimer, setShowTimer] = useState(false);
  const tl = useMemo(() => buildVideoTimeline(stage, { seed: stage.id, voiceLead: voice ? STANDBY_VOICE_LEAD : 0 }), [stage, voice]);

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
  useEffect(() => {
    const canvas = glRef.current;
    if (!canvas) return;
    const s = new StageScene3D(canvas);
    sceneRef.current = s;
    if (import.meta.env.DEV) Object.assign(window, { __scene3d: s });
    setReady(false);
    s.load(stage)
      .then(() => document.fonts.load('900 40px Montserrat'))
      .then(() => setReady(true))
      .catch((e) => setError(`3D assets could not be loaded (${e?.message ?? e}). Export them with tools/plate-renderer (npm run blender3d).`));
    return () => {
      s.dispose();
      sceneRef.current = null;
    };
  }, [stage]);

  const draw = useCallback(
    (time: number) => {
      const s = sceneRef.current;
      const hud = hudRef.current;
      if (!s || !hud || !ready) return;
      const f = frameAt(stage, tl, time, box.width / Math.max(1, box.height));
      s.apply(f);
      s.render();
      const ctx = hud.getContext('2d')!;
      ctx.clearRect(0, 0, hud.width, hud.height);
      drawHud(ctx, hud.width, hud.height, f, stage, s.project.bind(s), { showTimer });
    },
    [stage, tl, ready, box.width, box.height, showTimer],
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
    const from = tRef.current >= tl.end ? 0 : tRef.current;
    t0.current = e.now + 0.1 - from;
    for (const c of videoCues(tl, voice)) if (c.t >= from) e.play(c.cue, t0.current + c.t);
    setPlaying(true);
  }, [tl, voice]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      const e = engine.current;
      if (!e) return;
      const now = Math.max(0, e.now - t0.current);
      tRef.current = now;
      draw(now);
      if (now >= tl.end) {
        stop();
        setT(tl.end);
        return;
      }
      setT((p) => (Math.abs(p - now) > 0.1 ? now : p)); // scrubber at ~10 Hz
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, draw, tl.end, stop]);

  useEffect(() => () => stop(), [stop]);

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
  const render = async () => {
    stop();
    const [w, h] = RESOLUTIONS[res];
    const ac = new AbortController();
    abort.current = ac;
    const started = performance.now();
    setProgress({ done: 0, total: 1, started });
    try {
      const r = await renderMp4(stage, tl, { width: w, height: h, fps, voice, showTimer, signal: ac.signal, onProgress: (done, total) => setProgress({ done, total, started }) });
      downloadBlob(r.blob, `${stage.name.replace(/[^\w-]+/g, '_')}_${res}_${fps}fps.mp4`);
    } catch (e) {
      if (!(e instanceof RenderAborted)) alert(`Render failed: ${(e as Error).message}`);
    } finally {
      setProgress(null);
      abort.current = null;
      draw(tRef.current);
    }
  };

  const jumps: [string, number][] = [
    ['Briefing', 0],
    ['Fly-in', tl.briefingEnd],
    ['Rep 1', tl.flyInEnd + (tl.schedule.reps[0]?.standbyStart ?? 0) - 1],
    ...(stage.legs.length ? ([['Move', tl.flyInEnd + (tl.schedule.reps[0]?.startBeep ?? 0) + stage.legs[0].after - 0.5]] as [string, number][]) : []),
  ];
  const eta = progress && progress.done > 0 ? ((performance.now() - progress.started) / progress.done) * (progress.total - progress.done) / 1000 : null;

  return (
    <div className="player3d">
      <div className="p3-area" ref={areaRef}>
        <div className="p3-box" style={{ width: box.width, height: box.height }}>
          <canvas ref={glRef} className="p3-gl" />
          <canvas ref={hudRef} className="p3-hud" />
          {!ready && !error && <div className="p3-msg">Loading 3D stage…</div>}
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
        <input type="range" min={0} max={tl.end} step={0.05} value={t} disabled={!ready || !!progress} onChange={(e) => seek(parseFloat(e.target.value))} />
        <span className="p3-time">
          {fmt(t)} / {fmt(tl.end)}
        </span>
        {jumps.map(([label, at]) => (
          <button key={label} disabled={!ready || !!progress} onClick={() => seek(Math.max(0, at))}>
            {label}
          </button>
        ))}
        <span className="spacer" />
        <label className="p3-opt"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> Voice</label>
        <label className="p3-opt"><input type="checkbox" checked={showTimer} onChange={(e) => setShowTimer(e.target.checked)} /> Timer</label>
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
        {stage.name} · par {parTime3D(stage).toFixed(1)} s · {stage.repetitions} reps · video {fmt(tl.end)} · prototype (3D)
      </div>
    </div>
  );
};
