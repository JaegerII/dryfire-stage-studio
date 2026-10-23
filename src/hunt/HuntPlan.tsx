import { useRef } from 'react';
import { type StandIndex, laneX, standView } from './maps';
import { HFOV, crossingLine, crossingWindow, judge } from './rules';
import type { Crossing, HuntRelease, HuntScenario } from './types';

/**
 * Top view of the map: forest, lane and gravel track (bending as on the map), the three stands (click to
 * change), the chosen stand's field of view (16:9 solid, 9:16 dashed), the maximum shooting distance, and
 * every crossing as an arrow across the lane. Drag a crossing to change its distance from the stand.
 */
const X0 = -40;
const X1 = 40;
const Y0 = -14;
const Y1 = 136;

export const HuntPlan = ({
  scenario,
  release,
  selected,
  onSelect,
  onChange,
  onStand,
  onCommit,
}: {
  scenario: HuntScenario;
  release: HuntRelease;
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Crossing>) => void;
  onStand?: (stand: StandIndex) => void;
  onCommit?: () => void;
}) => {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<string | null>(null);
  const { map, stand } = scenario;
  const st = standView(map, stand);
  const sy = (y: number) => Y1 - y; // svg y grows down, lane y grows up

  const lane = (w: number) => {
    const pts: string[] = [];
    for (let y = Y0; y <= Y1; y += 2) pts.push(`${laneX(map, y) - w},${sy(y)}`);
    for (let y = Y1; y >= Y0; y -= 2) pts.push(`${laneX(map, y) + w},${sy(y)}`);
    return pts.join(' ');
  };
  const wedge = (format: '16x9' | '9x16') => {
    const [ax, ay] = st.aim;
    const len = 160;
    const dir = Math.atan2(ay - st.y, ax - st.x);
    const h = (HFOV[format] * Math.PI) / 360;
    const p = (a: number) => `${st.x + Math.cos(a) * len},${sy(st.y + Math.sin(a) * len)}`;
    return `${st.x},${sy(st.y)} ${p(dir - h)} ${p(dir + h)}`;
  };
  const toPoint = (e: React.PointerEvent) => {
    const el = svg.current!;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const q = pt.matrixTransform(el.getScreenCTM()!.inverse());
    return { x: q.x, y: Y1 - q.y };
  };

  return (
    <svg
      ref={svg}
      className="hunt-plan"
      viewBox={`${X0} 0 ${X1 - X0} ${Y1 - Y0}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={(e) => {
        if (!drag.current) return;
        const q = toPoint(e);
        const d = Math.round(Math.min(80, Math.max(15, Math.hypot(q.x - st.x, q.y - st.y))));
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
      <defs>
        <clipPath id="hp-clip">
          <rect x={X0} y={0} width={X1 - X0} height={Y1 - Y0} />
        </clipPath>
      </defs>
      <g clipPath="url(#hp-clip)">
        <rect x={X0} y={0} width={X1 - X0} height={Y1 - Y0} fill={map === 'buche_winter' ? '#2a2e30' : map === 'fichte' ? '#18201a' : '#1c2018'} />
        {Array.from({ length: 13 }, (_, i) => i * 10).map((d) => (
          <g key={d}>
            <line x1={X0} x2={X1} y1={sy(d)} y2={sy(d)} stroke="rgba(237,237,230,0.06)" strokeWidth={0.2} />
            <text x={X0 + 1} y={sy(d) - 0.6} className="hp-grid">{d} m</text>
          </g>
        ))}
        <polygon points={lane(4.5)} fill={map === 'buche_winter' ? '#6b6f72' : '#3a3a2c'} />
        <polygon points={lane(1.5)} fill={map === 'buche_winter' ? '#8a8e92' : '#5c5a52'} />
        <polygon points={wedge('9x16')} fill="none" stroke="rgba(237,237,230,0.22)" strokeWidth={0.25} strokeDasharray="1 1" />
        <polygon points={wedge('16x9')} fill="rgba(237,237,230,0.05)" stroke="rgba(237,237,230,0.35)" strokeWidth={0.25} />
        <circle cx={st.x} cy={sy(st.y)} r={release.maxDistance} fill="none" stroke="rgba(255,49,49,0.55)" strokeWidth={0.3} strokeDasharray="1.5 1" />
        {scenario.crossings.map((c, i) => {
          const { y, xc, half } = crossingLine(map, stand, c.distance);
          const look = st.aim[1] >= st.y ? 1 : -1;
          const dir = (c.direction === 'ltr' ? 1 : -1) * look;
          const from = xc - dir * half;
          const to = xc + dir * half;
          const free = judge(c, release).some((v) => v.free);
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
        {([0, 1, 2] as StandIndex[]).map((k) => {
          const s = standView(map, k);
          const on = k === stand;
          return (
            <g key={k} className={`hp-stand${on ? ' on' : ''}`} onPointerDown={(e) => { e.stopPropagation(); onStand?.(k); }}>
              <rect x={s.x - 1.6} y={sy(s.y) - 1.6} width={3.2} height={3.2} fill={on ? '#ff3131' : '#5a625b'} />
              <text x={s.x + (s.x < 0 ? -2.4 : 2.4)} y={sy(s.y) + 0.9} textAnchor={s.x < 0 ? 'end' : 'start'} className="hp-label">
                Stand {k + 1}
              </text>
            </g>
          );
        })}
      </g>
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
