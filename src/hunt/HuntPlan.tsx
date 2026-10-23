import { useRef } from 'react';
import { AIM, HFOV, STAND, crossingWindow, judge, laneX } from './rules';
import type { Crossing, HuntScenario } from './types';

/**
 * Top view of the lane: forest, lane and gravel track (bending right after 30 m), the stand with its
 * field of view (16:9 solid, 9:16 dashed), the maximum shooting distance, and every crossing as an
 * arrow across the lane. Drag a crossing up / down to change its distance.
 */
const X0 = -34;
const X1 = 34;
const Y0 = -6;
const Y1 = 82;

const half = (format: '16x9' | '9x16', y: number) => Math.tan((HFOV[format] * Math.PI) / 360) * (y - STAND.y);
const centreX = (y: number) => STAND.x + ((AIM.x - STAND.x) * (y - STAND.y)) / (AIM.y - STAND.y);

export const HuntPlan = ({
  scenario,
  selected,
  onSelect,
  onChange,
  onCommit,
}: {
  scenario: HuntScenario;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Crossing>) => void;
  onCommit?: () => void;
}) => {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null);
  const sy = (y: number) => Y1 - y; // svg y grows down, distance grows up

  const lane = (w: number) => {
    const pts: string[] = [];
    for (let y = Y0; y <= Y1; y += 2) pts.push(`${laneX(y) - w},${sy(y)}`);
    for (let y = Y1; y >= Y0; y -= 2) pts.push(`${laneX(y) + w},${sy(y)}`);
    return pts.join(' ');
  };
  const wedge = (format: '16x9' | '9x16') => {
    const far = Y1 + 4;
    return `${STAND.x},${sy(STAND.y)} ${centreX(far) - half(format, far)},${sy(far)} ${centreX(far) + half(format, far)},${sy(far)}`;
  };
  const toY = (e: React.PointerEvent) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return Y1 - pt.matrixTransform(el.getScreenCTM()!.inverse()).y;
  };

  return (
    <svg
      ref={svg}
      className="hunt-plan"
      viewBox={`${X0} 0 ${X1 - X0} ${Y1 - Y0}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(e) => {
        if (!drag.current) return;
        const d = Math.round(Math.min(80, Math.max(15, toY(e))));
        onChange(drag.current, { distance: d });
      }}
      onPointerUp={() => {
        if (drag.current) onCommit?.();
        drag.current = null;
      }}
      onPointerLeave={() => {
        if (drag.current) onCommit?.();
        drag.current = null;
      }}
    >
      <rect x={X0} y={0} width={X1 - X0} height={Y1 - Y0} fill="#1c2018" />
      {/* faint 10 m grid with distance labels */}
      {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((d) => (
        <g key={d}>
          <line x1={X0} x2={X1} y1={sy(d)} y2={sy(d)} stroke="rgba(237,237,230,0.06)" strokeWidth={0.2} />
          <text x={X0 + 1} y={sy(d) - 0.6} className="hp-grid">{d} m</text>
        </g>
      ))}
      <polygon points={lane(4.5)} fill="#3a3a2c" />
      <polygon points={lane(1.5)} fill="#5c5a52" />
      <polygon points={wedge('9x16')} fill="none" stroke="rgba(237,237,230,0.22)" strokeWidth={0.25} strokeDasharray="1 1" />
      <polygon points={wedge('16x9')} fill="rgba(237,237,230,0.05)" stroke="rgba(237,237,230,0.35)" strokeWidth={0.25} />
      <circle cx={STAND.x} cy={sy(STAND.y)} r={scenario.release.maxDistance} fill="none" stroke="rgba(255,49,49,0.55)" strokeWidth={0.3} strokeDasharray="1.5 1" />
      <text x={STAND.x + 1.5} y={sy(STAND.y + scenario.release.maxDistance) - 0.8} className="hp-max">max. {scenario.release.maxDistance} m</text>
      {scenario.crossings.map((c, i) => {
        const y = c.distance;
        const xc = centreX(y);
        const h = half('16x9', y) + 4;
        const dir = c.direction === 'ltr' ? 1 : -1;
        const from = xc - dir * h;
        const to = xc + dir * h;
        const free = judge(c, scenario.release).some((v) => v.free);
        const on = c.id === selected;
        const col = free ? '#2bd96b' : '#ff3131';
        return (
          <g
            key={c.id}
            className={`hp-cross${on ? ' on' : ''}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.target as Element).setPointerCapture?.(e.pointerId);
              onSelect(c.id);
              drag.current = c.id;
            }}
          >
            <line x1={from} x2={to} y1={sy(y)} y2={sy(y)} stroke="transparent" strokeWidth={4} />
            <line x1={from} x2={to - dir * 1.6} y1={sy(y)} y2={sy(y)} stroke={col} strokeWidth={on ? 0.9 : 0.5} />
            <polygon points={`${to},${sy(y)} ${to - dir * 2.4},${sy(y) - 1.2} ${to - dir * 2.4},${sy(y) + 1.2}`} fill={col} />
            <text x={xc} y={sy(y) - 1.6} textAnchor="middle" className="hp-label">
              A{i + 1} · {fmtTime(c.at)} · {Math.round(c.distance)} m
            </text>
          </g>
        );
      })}
      <rect x={STAND.x - 1.2} y={sy(STAND.y) - 1.2} width={2.4} height={2.4} fill="#ff3131" />
      <text x={STAND.x + 2} y={sy(STAND.y) + 0.8} className="hp-label">Stand</text>
    </svg>
  );
};

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Timeline of the drive: one block per crossing (on screen from enter to leave); drag to move it. */
export const HuntTimeline = ({
  scenario,
  duration,
  selected,
  playhead,
  onSelect,
  onChange,
  onCommit,
}: {
  scenario: HuntScenario;
  duration: number;
  selected: string | null;
  playhead?: number | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Crossing>) => void;
  onCommit?: () => void;
}) => {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; x: number; at: number } | null>(null);
  const pct = (t: number) => `${(100 * t) / duration}%`;
  return (
    <div
      ref={box}
      className="hunt-timeline"
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const k = duration / box.current!.clientWidth;
        onChange(d.id, { at: Math.max(0, Math.round((d.at + (e.clientX - d.x) * k) * 2) / 2) });
      }}
      onPointerUp={() => {
        if (drag.current) onCommit?.();
        drag.current = null;
      }}
    >
      {Array.from({ length: Math.floor(duration / 10) + 1 }, (_, i) => i * 10).map((t) => (
        <span key={t} className="ht-tick" style={{ left: pct(t) }}>{fmtTime(t)}</span>
      ))}
      {scenario.crossings.map((c, i) => {
        const w = crossingWindow(c);
        return (
          <button
            key={c.id}
            className={`ht-block${c.id === selected ? ' on' : ''}`}
            style={{ left: pct(c.at), width: pct(Math.max(0.5, w.leave - c.at)) }}
            title={`Anlauf ${i + 1}: ${fmtTime(c.at)}`}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              onSelect(c.id);
              drag.current = { id: c.id, x: e.clientX, at: c.at };
            }}
          >
            A{i + 1}
          </button>
        );
      })}
      {playhead != null && playhead >= 0 && <div className="ht-head" style={{ left: pct(playhead) }} />}
    </div>
  );
};
