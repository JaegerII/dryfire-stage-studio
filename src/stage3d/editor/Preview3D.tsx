import { useEffect, useRef, useState } from 'react';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import { StageScene3D } from '../StageScene3D';
import { type FrameState, briefingPose, povPose, standing } from '../timeline';
import type { Stage3D } from '../types';

export type PreviewMode = 'pov' | 'top';

/**
 * Live 3D view next to the plan: what the shooter sees from a position, or
 * the briefing view from above. The hall loads once; every edit only swaps
 * the objects (debounced), so it follows the plan while you drag.
 * Dragging the shooter's view looks around: it sets the position's turn and look up / down (onLook).
 */
export const Preview3D = ({ stage, position, mode, onMode, onLook }: { stage: Stage3D; position: number; mode: PreviewMode; onMode: (m: PreviewMode) => void; onLook?: (heading: number, pitch: number) => void }) => {
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<StageScene3D | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = new StageScene3D(canvas.current!);
    scene.current = s;
    s.loadEnvironment(latest.current.stage.environment)
      .then(() => setReady(true))
      .catch((e) => setError(String(e?.message ?? e)));
    return () => {
      s.dispose();
      scene.current = null;
    };
  }, []);

  // the latest props: draw() also runs from the debounced rebuild, after newer renders
  // look-around drag: shown at once, written to the position on release
  const look = useRef<{ x: number; y: number; heading: number; pitch: number; h0: number; p0: number } | null>(null);
  const latest = useRef({ stage, position, mode, box, ready });
  latest.current = { stage, position, mode, box, ready };

  // what to draw for the current mode / position
  const draw = () => {
    const { stage, position, mode, box, ready } = latest.current;
    const s = scene.current;
    if (!s || !ready || !box.width) return;
    const p = stage.positions[Math.min(position, stage.positions.length - 1)];
    const camera =
      mode === 'top'
        ? { ...briefingPose(stage, 3, box.width / box.height), fade: 0 }
        : povPose(standing(look.current ? { ...p, heading: look.current.heading, pitch: look.current.pitch } : p), 0);
    // the path arrows belong to the briefing view; the shooter's view shows the floor as in the run
    const f: FrameState = { t: 3, segment: mode === 'top' ? 'briefing' : 'stage', camera, arrows: mode === 'top' ? stage.legs.map(() => 1) : null, rep: null, shooter: null };
    s.apply(f);
    s.render();
  };

  // size
  useEffect(() => {
    const s = scene.current;
    if (!s || !box.width) return;
    s.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    s.setSize(box.width, box.height);
    draw();
  }, [box.width, box.height, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // stage edits: rebuild the objects shortly after the last change
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      // another environment swaps the hall first (once per change; the same one returns at once)
      const s = scene.current;
      if (s) void s.loadEnvironment(stage.environment).then(() => s.setStage(stage)).then(draw);
    }, 120);
    return () => clearTimeout(t);
  }, [stage, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = stage.positions[Math.min(position, stage.positions.length - 1)];
  useEffect(draw, [mode, position, p?.heading, p?.pitch, p?.eye]); // eslint-disable-line react-hooks/exhaustive-deps

  const lookable = mode === 'pov' && !!onLook && !!p;
  const onDown = (e: React.PointerEvent) => {
    if (!lookable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    look.current = { x: e.clientX, y: e.clientY, heading: p.heading, pitch: p.pitch ?? 0, h0: p.heading, p0: p.pitch ?? 0 };
  };
  const onMove = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l) return;
    // about one degree of view per degree dragged (the view is ~62° high)
    const k = 62 / Math.max(1, box.height);
    l.heading = (((l.h0 + (e.clientX - l.x) * k + 180) % 360) + 360) % 360 - 180;
    l.pitch = Math.max(-80, Math.min(60, l.p0 - (e.clientY - l.y) * k));
    draw();
  };
  const onUp = () => {
    const l = look.current;
    look.current = null;
    if (l && (l.heading !== l.h0 || l.pitch !== l.p0)) onLook?.(Math.round(l.heading * 2) / 2, Math.round(l.pitch * 2) / 2);
  };
  return (
    <div className="preview3d">
      <div className="preview3d-bar">
        <button className={mode === 'pov' ? 'on' : ''} onClick={() => onMode('pov')}>
          View from {p?.label ?? 'START'}
        </button>
        <button className={mode === 'top' ? 'on' : ''} onClick={() => onMode('top')}>
          Briefing (top)
        </button>
      </div>
      <div className="preview3d-area" ref={areaRef}>
        <canvas
          ref={canvas}
          style={{ width: box.width, height: box.height, cursor: lookable ? 'grab' : undefined, touchAction: lookable ? 'none' : undefined }}
          title={lookable ? 'Drag to look around (turn and up / down)' : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {!ready && <div className="p3-msg">{error ? `3D assets missing: ${error}` : 'Loading hall…'}</div>}
      </div>
    </div>
  );
};
