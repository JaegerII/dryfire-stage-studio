import { useEffect, useRef, useState } from 'react';
import { HUNT_FPS, drawHuntFrame, driveAt } from './exportHunt';
import { fmtTime } from './HuntPlan';
import { HuntScene3D } from './HuntScene3D';
import { type HuntProgram, driveStart } from './program';
import type { HuntFrames } from './renderService';
import type { HuntFormat } from './types';

type View = '3d' | 'render';

/**
 * Plays a driven-hunt video — one scenario or a whole hunt: briefing, (title cards,) drives, answer cards,
 * summary. A drive is the live 3D view (three.js, like the stage editor's preview — every change shows at
 * once) or, once that scenario is rendered, the Blender render (plate + animal crops, as far as they have
 * loaded; it never waits).
 */
export const HuntPlayer = ({
  program,
  format,
  frames,
  onDriveTime,
}: {
  program: HuntProgram;
  format: HuntFormat;
  /** Per scenario: its Blender render, if there is one. */
  frames: (HuntFrames | null)[];
  onDriveTime?: (d: { scenario: number; time: number } | null) => void;
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  // start a moment into the briefing (at 0 it is still fading in)
  const [t, setT] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>('3d');
  const [scene3d, setScene3d] = useState<HuntScene3D | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(2);
  const anyRender = frames.some((f) => !!f);
  const useRender = view === 'render' && anyRender;
  const sized = useRender ? frames.find((f) => !!f)! : null;
  const W = sized ? sized.width : format === '16x9' ? 1280 : 720;
  const H = sized ? sized.height : format === '16x9' ? 720 : 1280;

  // the live 3D view: its own WebGL canvas, drawn onto the player canvas under the screens / cards
  useEffect(() => {
    const sc = new HuntScene3D(document.createElement('canvas'));
    setScene3d(sc);
    return () => sc.dispose();
  }, []);
  const [herdsReady, setHerdsReady] = useState(0);
  useEffect(() => {
    if (!scene3d) return;
    scene3d.setSize(W, H);
    scene3d.setScenarios(program.scenarios).then(
      () => setHerdsReady((n) => n + 1),
      (e) => setError(`3D-Vorschau nicht geladen: ${(e as Error).message}`),
    );
  }, [scene3d, program, W, H]);

  const draw = (time: number) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const d = driveAt(program, time);
    let crop: ImageBitmap | null = null;
    let live: HTMLCanvasElement | undefined;
    const fr = d && useRender ? frames[d.scenario] : null;
    if (d && fr) {
      fr.prefetch(d.frame, 45);
      crop = fr.cropNow(d.frame);
    } else if (d && scene3d && herdsReady) {
      scene3d.show(d.scenario, d.time);
      scene3d.render();
      live = scene3d.renderer.domElement;
    }
    drawHuntFrame(ctx, W, H, program, format, useRender ? frames : [], time, crop, live);
    onDriveTime?.(d && { scenario: d.scenario, time: d.time });
  };

  useEffect(() => {
    tRef.current = Math.min(tRef.current, program.end);
    draw(tRef.current);
  }, [program, frames, W, H, view, herdsReady]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      tRef.current = Math.min(program.end, tRef.current + (now - last) / 1000);
      last = now;
      setT(tRef.current);
      draw(tRef.current);
      if (tRef.current >= program.end) setPlaying(false);
      else raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, program, frames, view, herdsReady]);

  const seek = (v: number) => {
    tRef.current = v;
    setT(v);
    draw(v);
  };

  // jump buttons: per scenario of a hunt; in a single scenario per crossing
  const jumps: [string, number][] = program.isHunt
    ? program.scenarios.map((_, i) => [`S${i + 1}`, driveStart(program, i) - 4])
    : program.scenarios[0].crossings.map((c, i) => [`A${i + 1}`, driveStart(program, 0) + Math.max(0, c.at)]);

  return (
    <div className="hunt-player">
      <div className="hp-screen">
        <canvas ref={canvas} width={W} height={H} style={{ aspectRatio: `${W} / ${H}` }} />
        {error && <div className="hp-error">{error}</div>}
      </div>
      <div className="hp-controls">
        <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : '▶ Abspielen'}</button>
        <input type="range" min={0} max={program.end} step={1 / HUNT_FPS} value={t} onChange={(e) => seek(parseFloat(e.target.value))} />
        <span className="p3-time">
          {fmtTime(t)} / {fmtTime(program.end)}
        </span>
        <button onClick={() => seek(0)}>Briefing</button>
        {jumps.map(([label, at]) => (
          <button key={label} onClick={() => seek(Math.max(0, at))}>
            {label}
          </button>
        ))}
        <span className="hp-view">
          <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')} title="Live-Vorschau in 3D">3D</button>
          <button className={view === 'render' ? 'on' : ''} disabled={!anyRender} onClick={() => setView('render')} title={anyRender ? 'Blender-Render' : 'Noch nicht in Blender gerendert'}>
            Render
          </button>
        </span>
      </div>
    </div>
  );
};
