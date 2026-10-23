import { useEffect, useRef, useState } from 'react';
import { HUNT_FPS, drawHuntFrame, driveFrameAt } from './exportHunt';
import { fmtTime } from './HuntPlan';
import { INTRO_SECONDS, type HuntProgram } from './program';
import type { HuntFrames } from './renderService';
import type { HuntFormat } from './types';

/**
 * Plays the driven-hunt video in the editor: briefing, the rendered drive (plate + animal crops, as far
 * as they have loaded — it never waits), answer cards, summary. Without a render the drive is a grey
 * frame, so briefing and cards can be checked before Blender runs.
 */
export const HuntPlayer = ({ program, format, frames, onDriveTime }: { program: HuntProgram; format: HuntFormat; frames: HuntFrames | null; onDriveTime?: (t: number | null) => void }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  // start a moment into the briefing (at 0 it is still fading in)
  const [t, setT] = useState(2);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(2);
  const W = frames?.width ?? (format === '16x9' ? 960 : 540);
  const H = frames?.height ?? (format === '16x9' ? 540 : 960);

  const draw = (time: number) => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    const df = driveFrameAt(program, time);
    let crop: ImageBitmap | null = null;
    if (frames && df >= 0) {
      frames.prefetch(df, 45);
      crop = frames.cropNow(df);
    }
    drawHuntFrame(ctx, W, H, program, format, frames, time, crop);
    onDriveTime?.(df >= 0 ? df / HUNT_FPS : null);
  };

  useEffect(() => {
    tRef.current = Math.min(tRef.current, program.end);
    draw(tRef.current);
  }, [program, frames, W, H]);

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
  }, [playing, program, frames]);

  const seek = (v: number) => {
    tRef.current = v;
    setT(v);
    draw(v);
  };

  return (
    <div className="hunt-player">
      <div className="hp-screen">
        <canvas ref={canvas} width={W} height={H} style={{ aspectRatio: `${W} / ${H}` }} />
      </div>
      <div className="hp-controls">
        <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : '▶ Abspielen'}</button>
        <input type="range" min={0} max={program.end} step={1 / HUNT_FPS} value={t} onChange={(e) => seek(parseFloat(e.target.value))} />
        <span className="p3-time">
          {fmtTime(t)} / {fmtTime(program.end)}
        </span>
        <button onClick={() => seek(0)}>Briefing</button>
        <button onClick={() => seek(INTRO_SECONDS)}>Treiben</button>
        {program.reveals.map((r) => (
          <button key={r.index} onClick={() => seek(INTRO_SECONDS + Math.max(0, program.scenario.crossings[r.index].at))} title={`Anlauf ${r.index + 1}`}>
            A{r.index + 1}
          </button>
        ))}
      </div>
    </div>
  );
};
