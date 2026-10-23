import { useEffect, useRef, useState } from 'react';
import { HUNT_FPS, drawHuntFrame, driveFrameAt, driveTimeAt } from './exportHunt';
import { fmtTime } from './HuntPlan';
import { HuntScene3D } from './HuntScene3D';
import { INTRO_SECONDS, type HuntProgram } from './program';
import type { HuntFrames } from './renderService';
import type { HuntFormat } from './types';

type View = '3d' | 'render';

/**
 * Plays the driven-hunt video in the editor: briefing, the drive, answer cards, summary. The drive is
 * the live 3D view (three.js, like the stage editor's preview — every change shows at once) or, once
 * rendered, the Blender render (plate + animal crops, as far as they have loaded; it never waits).
 */
export const HuntPlayer = ({ program, format, frames, onDriveTime }: { program: HuntProgram; format: HuntFormat; frames: HuntFrames | null; onDriveTime?: (t: number | null) => void }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  // start a moment into the briefing (at 0 it is still fading in)
  const [t, setT] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState<View>('3d');
  const [scene3d, setScene3d] = useState<HuntScene3D | null>(null);
  const [error, setError] = useState('');
  const tRef = useRef(2);
  const useRender = view === 'render' && !!frames;
  const W = useRender ? frames.width : format === '16x9' ? 1280 : 720;
  const H = useRender ? frames.height : format === '16x9' ? 720 : 1280;

  // the live 3D view: its own WebGL canvas, drawn onto the player canvas under the screens / cards
  useEffect(() => {
    const gl = document.createElement('canvas');
    const sc = new HuntScene3D(gl);
    sc.load().then(
      () => setScene3d(sc),
      (e) => setError(`3D-Vorschau nicht geladen: ${(e as Error).message}`),
    );
    return () => sc.dispose();
  }, []);
  useEffect(() => {
    if (!scene3d) return;
    scene3d.setSize(W, H);
    void scene3d.setScenario(program.scenario).then(() => draw(tRef.current));
  }, [scene3d, program, W, H]);

  const draw = (time: number) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const dt = driveTimeAt(program, time);
    let crop: ImageBitmap | null = null;
    let live: HTMLCanvasElement | undefined;
    if (useRender && dt !== null) {
      const df = driveFrameAt(program, time);
      frames.prefetch(df, 45);
      crop = frames.cropNow(df);
    } else if (scene3d && dt !== null) {
      scene3d.apply(dt);
      scene3d.render();
      live = scene3d.renderer.domElement;
    }
    drawHuntFrame(ctx, W, H, program, format, useRender ? frames : null, time, crop, live);
    onDriveTime?.(dt);
  };

  useEffect(() => {
    tRef.current = Math.min(tRef.current, program.end);
    draw(tRef.current);
  }, [program, frames, W, H, view, scene3d]);

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
  }, [playing, program, frames, view, scene3d]);

  const seek = (v: number) => {
    tRef.current = v;
    setT(v);
    draw(v);
  };

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
        <button onClick={() => seek(INTRO_SECONDS)}>Treiben</button>
        {program.scenario.crossings.map((c, i) => (
          <button key={c.id} onClick={() => seek(INTRO_SECONDS + Math.max(0, c.at))} title={`Anlauf ${i + 1}`}>
            A{i + 1}
          </button>
        ))}
        <span className="hp-view">
          <button className={view === '3d' ? 'on' : ''} onClick={() => setView('3d')} title="Live-Vorschau in 3D">3D</button>
          <button className={view === 'render' ? 'on' : ''} disabled={!frames} onClick={() => setView('render')} title={frames ? 'Blender-Render' : 'Noch nicht in Blender gerendert'}>
            Render
          </button>
        </span>
      </div>
    </div>
  );
};
