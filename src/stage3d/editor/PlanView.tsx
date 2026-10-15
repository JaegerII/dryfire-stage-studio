import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useElementSize } from '../../hooks/useElementSize';
import type { ObjectType } from '../../types/stage';
import { type Footprint, footprintOf } from '../StageScene3D';
import { legPath } from '../timeline';
import { type Room, type Stage3D, roomOf } from '../types';
import { DND_TYPE, type Selection, clampToRoom, insertVia, moveVia, patchObjects, patchPosition, removeVia, snapTo, withGroups } from './ops';

export type Tool = 'select' | 'position';

interface Props {
  stage: Stage3D;
  selection: Selection;
  onSelect: (s: Selection, additive?: boolean) => void;
  onUpdate: (fn: (s: Stage3D) => Stage3D, opts?: { transient?: boolean }) => void;
  onCommit: () => void;
  tool: Tool;
  onPlacePosition: (x: number, d: number) => void;
  snap: boolean;
  onDropAsset: (type: ObjectType, x: number, d: number) => void;
}

type Drag =
  | { kind: 'objects'; start: { x: number; d: number }; orig: Map<string, { x: number; d: number }>; moved: boolean }
  | { kind: 'rotate'; id: string; cx: number; cd: number }
  | { kind: 'position'; index: number; start: { x: number; d: number }; orig: { x: number; d: number }; moved: boolean }
  | { kind: 'heading'; index: number }
  | { kind: 'via'; leg: number; k: number }
  | { kind: 'pan'; client: { x: number; y: number }; view: View; moved: boolean }
  /** rubber-band selection on the empty floor */
  | { kind: 'box'; start: { x: number; d: number }; additive: boolean; base: string[]; moved: boolean };

interface View {
  cx: number;
  cy: number;
  /** Visible width in meters. */
  w: number;
}

const viewOf = (room: Room): View => ({ cx: (room.x0 + room.x1) / 2, cy: -(room.d0 + room.d1) / 2, w: room.x1 - room.x0 + 3 });

const MOTION_BADGE: Record<string, string> = { fall: '▼', swing: '↺', horizontal: '↔', vertical: '↕', popup: '↑', appear: '↑', disappear: '×' };
const FALLBACK: Record<string, Footprint> = {
  target: { x0: -0.24, x1: 0.24, z0: -0.15, z1: 0.15, height: 1.5 },
  barrier: { x0: -0.95, x1: 0.95, z0: -0.15, z1: 0.15, height: 1.85 },
  other: { x0: -0.3, x1: 0.3, z0: -0.3, z1: 0.3, height: 0.6 },
};

const category = (t: string) => (t.startsWith('paper') || t.startsWith('no_shoot') || t.startsWith('steel') ? 'target' : t.startsWith('mesh') || t.startsWith('wood') || t.startsWith('barrel') ? 'barrier' : 'other');

const fill = (t: string) =>
  t.startsWith('no_shoot') ? '#f1efe8' : t.startsWith('paper_hc') ? '#9a7a55' : t.startsWith('paper') ? '#d7b385' : t.startsWith('steel') ? '#a7adb2' : t.startsWith('mesh') ? 'rgba(255,122,48,0.55)' : t === 'wood_wall' ? '#c9a26b' : t.startsWith('barrel') ? '#2b62a8' : '#3b3d3c';

const short = (t: string) => (t.startsWith('no_shoot') ? 'NS' : t.startsWith('steel') ? 'S' : t.startsWith('paper') ? 'T' : '');

const DEG = 180 / Math.PI;
const angleTo = (cx: number, cd: number, x: number, d: number) => Math.atan2(x - cx, d - cd) * DEG;

/**
 * Top view of a 3D stage in meters (downrange is up). Objects show their real
 * outline from above (from the 3D models) with the front edge marked; shooting
 * boxes show where the shooter looks; legs show the path with corner points.
 */
export const PlanView = ({ stage, selection, onSelect, onUpdate, onCommit, tool, onPlacePosition, snap, onDropAsset }: Props) => {
  const [wrapRef, size] = useElementSize<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const room = roomOf(stage.environment);
  const [view, setView] = useState<View>(() => viewOf(room));
  /** The whole room, whatever the shape of the plan area. */
  const fit = useCallback(() => {
    if (!size.width || !size.height) return;
    const r = roomOf(stage.environment);
    const w = r.x1 - r.x0 + 1.5;
    const h = r.d1 - r.d0 + 1.5;
    setView({ ...viewOf(r), w: Math.max(w, (h * size.width) / size.height) });
  }, [size.width, size.height, stage.environment]);
  // fit once the size is known, and again when the environment (room) changes
  const fittedFor = useRef('');
  useEffect(() => {
    if (!size.width || fittedFor.current === stage.environment) return;
    fittedFor.current = stage.environment;
    fit();
  }, [size.width, fit, stage.environment]);
  const [band, setBand] = useState<{ x0: number; d0: number; x1: number; d1: number } | null>(null);
  const [prints, setPrints] = useState<Record<string, Footprint>>({});
  const drag = useRef<Drag | null>(null);
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // real outlines of the models (loaded once per type)
  const types = [...new Set(stage.objects.map((o) => o.type))].join(',');
  useEffect(() => {
    for (const t of types.split(',').filter(Boolean)) {
      if (prints[t]) continue;
      void footprintOf(t).then((f) => f && setPrints((p) => ({ ...p, [t]: f })));
    }
  }, [types]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = size.width ? (view.w * size.height) / size.width : view.w;
  const viewBox = `${view.cx - view.w / 2} ${view.cy - h / 2} ${view.w} ${h}`;

  /** Pointer → floor point in meters. */
  const toFloor = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, d: -p.y };
  }, []);

  const step = snap ? 0.1 : 0;

  // ---------------------------------------------------------------- dragging (window listeners)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = drag.current;
      if (!g) return;
      if (g.kind === 'pan') {
        const svg = svgRef.current!;
        const scale = g.view.w / svg.clientWidth;
        const dx = (e.clientX - g.client.x) * scale;
        const dy = (e.clientY - g.client.y) * scale;
        if (Math.abs(dx) + Math.abs(dy) > 0.05) g.moved = true;
        setView({ ...g.view, cx: g.view.cx - dx, cy: g.view.cy - dy });
        return;
      }
      const p = toFloor(e.clientX, e.clientY);
      if (g.kind === 'box') {
        if (Math.hypot(p.x - g.start.x, p.d - g.start.d) > 0.1) g.moved = true;
        setBand({ x0: g.start.x, d0: g.start.d, x1: p.x, d1: p.d });
        return;
      }
      if (g.kind === 'objects') {
        const dx = snapTo(p.x - g.start.x, step);
        const dd = snapTo(p.d - g.start.d, step);
        if (!g.moved && Math.hypot(dx, dd) < 0.03) return;
        g.moved = true;
        onUpdate(
          (s) =>
            patchObjects(s, [...g.orig.keys()], (o) => {
              const q = clampToRoom(roomOf(stageRef.current.environment), g.orig.get(o.id)!.x + dx, g.orig.get(o.id)!.d + dd);
              return { x: +q.x.toFixed(2), d: +q.d.toFixed(2) };
            }),
          { transient: true },
        );
      } else if (g.kind === 'rotate') {
        // the handle sits behind the object (downrange): pointing straight downrange = yaw 0
        let yaw = angleTo(g.cx, g.cd, p.x, p.d);
        if (!e.shiftKey) yaw = Math.round(yaw / 5) * 5;
        onUpdate((s) => patchObjects(s, [g.id], () => ({ yaw })), { transient: true });
      } else if (g.kind === 'position') {
        const q = clampToRoom(roomOf(stageRef.current.environment), g.orig.x + snapTo(p.x - g.start.x, step), g.orig.d + snapTo(p.d - g.start.d, step));
        g.moved = true;
        onUpdate((s) => patchPosition(s, g.index, { x: +q.x.toFixed(2), d: +q.d.toFixed(2) }), { transient: true });
      } else if (g.kind === 'heading') {
        const pos = stageRef.current.positions[g.index];
        let heading = angleTo(pos.x, pos.d, p.x, p.d);
        if (!e.shiftKey) heading = Math.round(heading / 5) * 5;
        onUpdate((s) => patchPosition(s, g.index, { heading }), { transient: true });
      } else if (g.kind === 'via') {
        onUpdate((s) => moveVia(s, g.leg, g.k, snapTo(p.x, step), snapTo(p.d, step)), { transient: true });
      }
    };
    const up = (e: PointerEvent) => {
      const g = drag.current;
      drag.current = null;
      if (!g) return;
      if (g.kind === 'box') {
        setBand(null);
        if (!g.moved) {
          if (!g.additive) onSelect(null);
          return;
        }
        const p = toFloor(e.clientX, e.clientY);
        const [x0, x1] = [Math.min(g.start.x, p.x), Math.max(g.start.x, p.x)];
        const [d0, d1] = [Math.min(g.start.d, p.d), Math.max(g.start.d, p.d)];
        const st = stageRef.current;
        const hit = st.objects.filter((o) => o.x >= x0 && o.x <= x1 && o.d >= d0 && o.d <= d1).map((o) => o.id);
        const ids = withGroups(st, [...new Set([...g.base, ...hit])]);
        onSelect(ids.length ? { kind: 'objects', ids } : null);
        return;
      }
      if (g.kind === 'pan') {
        // a click on the empty floor (no pan) clears the selection / places a position
        if (!g.moved) onSelect(null);
        return;
      }
      onCommit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [toFloor, onUpdate, onCommit, onSelect, step]);

  // wheel zoom around the pointer (passive: false so the page does not scroll)
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toFloor(e.clientX, e.clientY);
      const f = Math.exp(e.deltaY * 0.0015);
      setView((v) => {
        const w = Math.max(3, Math.min(60, v.w * f));
        const k = w / v.w;
        return { w, cx: p.x - (p.x - v.cx) * k, cy: -p.d - (-p.d - v.cy) * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toFloor]);

  const selectedIds = selection?.kind === 'objects' ? selection.ids : [];

  const startPan = (e: React.PointerEvent) => {
    drag.current = { kind: 'pan', client: { x: e.clientX, y: e.clientY }, view, moved: false };
  };

  const startObjectDrag = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    if (e.button !== 0) return startPan(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    // a grouped object brings its whole group along
    const members = withGroups(stage, [id]);
    let ids = selectedIds;
    if (additive) {
      onSelect({ kind: 'objects', ids: ids.includes(id) ? ids.filter((x) => !members.includes(x)) : [...new Set([...ids, ...members])] });
      return;
    }
    if (!ids.includes(id)) {
      ids = members;
      onSelect({ kind: 'objects', ids });
    }
    const orig = new Map(stage.objects.filter((o) => ids.includes(o.id)).map((o) => [o.id, { x: o.x, d: o.d }]));
    drag.current = { kind: 'objects', start: toFloor(e.clientX, e.clientY), orig, moved: false };
  };

  /** Empty floor: left = rubber-band selection (or place a position), right / middle = pan. */
  const onFloorDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return startPan(e);
    if (tool === 'position') {
      const p = toFloor(e.clientX, e.clientY);
      onPlacePosition(snapTo(p.x, step), snapTo(p.d, step));
      return;
    }
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    drag.current = { kind: 'box', start: toFloor(e.clientX, e.clientY), additive, base: additive ? selectedIds : [], moved: false };
  };

  // grid lines (meters)
  const grid: React.ReactNode[] = [];
  for (let x = Math.ceil(room.x0); x <= room.x1; x++)
    grid.push(<line key={`x${x}`} x1={x} y1={-room.d1} x2={x} y2={-room.d0} className={x % 5 === 0 ? 'g5' : 'g1'} />);
  for (let d = Math.ceil(room.d0); d <= room.d1; d++) {
    grid.push(<line key={`d${d}`} x1={room.x0} y1={-d} x2={room.x1} y2={-d} className={d % 5 === 0 ? 'g5' : 'g1'} />);
    if (d % 5 === 0)
      grid.push(
        <text key={`t${d}`} x={room.x0 + 0.25} y={-d - 0.12} className="plan-dist">
          {d} m
        </text>,
      );
  }

  const objects = [...stage.objects].sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0));
  const singleSel = selectedIds.length === 1 ? stage.objects.find((o) => o.id === selectedIds[0]) : undefined;

  return (
    <div
      className={`plan-wrap${tool === 'position' ? ' placing' : ''}`}
      ref={wrapRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(DND_TYPE) as ObjectType;
        if (!type) return;
        e.preventDefault();
        const p = toFloor(e.clientX, e.clientY);
        onDropAsset(type, snapTo(p.x, step), snapTo(p.d, step));
      }}
    >
      <svg ref={svgRef} className="plan" viewBox={viewBox} onPointerDown={onFloorDown} onContextMenu={(e) => e.preventDefault()}>
        <defs>
          <marker id="plan-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#ff3131" />
          </marker>
          <pattern id="berm" width="0.5" height="0.5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="0.5" stroke="rgba(237,237,230,0.12)" strokeWidth="0.12" />
          </pattern>
        </defs>
        {/* hall */}
        <rect x={room.x0} y={-room.d1} width={room.x1 - room.x0} height={room.d1 - room.d0} className="plan-floor" />
        {grid}
        {room.kind === 'indoor' ? (
          <>
            <rect x={room.x0} y={-room.d1} width={room.x1 - room.x0} height={2.2} fill="url(#berm)" />
            <text x={0} y={-room.d1 + 1.3} className="plan-note">BACKSTOP</text>
            <rect x={room.x0} y={-room.d1} width={room.x1 - room.x0} height={room.d1 - room.d0} className="plan-wall" />
          </>
        ) : room.berms ? (
          // outdoors the bounds are the feet of the berms: the berms rise outside them
          <>
            <path d={`M${room.x0 - 1.5},${-room.d0} V${-room.d1 - 1.5} H${room.x1 + 1.5} V${-room.d0} H${room.x1} V${-room.d1} H${room.x0} V${-room.d0} Z`} fill="url(#berm)" />
            <text x={0} y={-room.d1 - 0.45} className="plan-note">BERM</text>
          </>
        ) : (
          <text x={0} y={-room.d1 - 0.45} className="plan-note">COVERED FIRING LINE ↑</text>
        )}
        <text x={0} y={-room.d0 - 0.3} className="plan-note">UPRANGE</text>

        {/* path */}
        {stage.legs.map((leg, i) => {
          // the line as it will be walked (smooth through the corner points)
          const pts = legPath(stage, i);
          const sel = selection?.kind === 'leg' && selection.index === i;
          const line = pts.map((p) => `${p.x},${-p.d}`).join(' ');
          const mid = pts[Math.floor(pts.length / 2)];
          const mid2 = pts[Math.floor((pts.length - 1) / 2)];
          return (
            <g key={`leg${i}`} className={`plan-leg${sel ? ' sel' : ''}`}>
              <polyline points={line} className="leg-hit" onPointerDown={(e) => (e.stopPropagation(), onSelect({ kind: 'leg', index: i }))} onDoubleClick={(e) => {
                const p = toFloor(e.clientX, e.clientY);
                onUpdate((s) => insertVia(s, i, p.x, p.d));
              }} />
              <polyline points={line} className="leg-line" markerEnd="url(#plan-arrow)" />
              <text x={(mid.x + mid2.x) / 2} y={-(mid.d + mid2.d) / 2 - 0.25} className={`plan-leg-label${leg.reload ? ' reload' : ''}`}>
                {leg.after}s → {leg.duration}s{leg.reload ? ' · RELOAD' : ''}
              </text>
              {(leg.via ?? []).map((v, k) => (
                <circle
                  key={k}
                  cx={v.x}
                  cy={-v.d}
                  r={0.16}
                  className="via"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'leg', index: i });
                    drag.current = { kind: 'via', leg: i, k };
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onUpdate((s) => removeVia(s, i, k));
                  }}
                />
              ))}
            </g>
          );
        })}

        {/* objects */}
        {objects.map((o) => {
          const f = prints[o.type] ?? FALLBACK[category(o.type)];
          const s = o.scale ?? 1;
          const sel = selectedIds.includes(o.id);
          const w = Math.max(f.x1 - f.x0, 0.06);
          const dpt = Math.max(f.z1 - f.z0, 0.06);
          return (
            <g key={o.id} transform={`translate(${o.x} ${-o.d}) rotate(${o.yaw ?? 0}) scale(${o.flip ? -s : s} ${s})`} className={`plan-obj${sel ? ' sel' : ''}`} onPointerDown={(e) => startObjectDrag(e, o.id)}>
              {/* generous hit area: cards are only a centimetre thin */}
              <rect x={f.x0 - 0.12} y={f.z0 - 0.15} width={w + 0.24} height={dpt + 0.3} className="hit" />
              <rect x={f.x0} y={f.z0} width={w} height={dpt} fill={fill(o.type)} className="body" />
              <line x1={f.x0} y1={f.z1} x2={f.x1} y2={f.z1} className="front" />
            </g>
          );
        })}
        {objects.map((o) =>
          short(o.type) || o.motion ? (
            <text key={`l${o.id}`} x={o.x} y={-o.d + 0.55} className="plan-obj-label">
              {short(o.type)}
              {o.motion && MOTION_BADGE[o.motion.kind] ? ` ${MOTION_BADGE[o.motion.kind]}` : ''}
              {o.elevation ? ` ↑${o.elevation}` : ''}
            </text>
          ) : null,
        )}

        {/* rotation handle of a single selected object: behind it (downrange) */}
        {singleSel &&
          (() => {
            const f = prints[singleSel.type] ?? FALLBACK[category(singleSel.type)];
            const r = -(f.z0 * (singleSel.scale ?? 1)) + 0.55;
            const yaw = ((singleSel.yaw ?? 0) * Math.PI) / 180;
            const hx = singleSel.x + Math.sin(yaw) * r;
            const hy = -singleSel.d - Math.cos(yaw) * r;
            return (
              <g className="rot-handle">
                <line x1={singleSel.x} y1={-singleSel.d} x2={hx} y2={hy} />
                <circle
                  cx={hx}
                  cy={hy}
                  r={0.17}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag.current = { kind: 'rotate', id: singleSel.id, cx: singleSel.x, cd: singleSel.d };
                  }}
                />
              </g>
            );
          })()}

        {band && (
          <rect
            x={Math.min(band.x0, band.x1)}
            y={-Math.max(band.d0, band.d1)}
            width={Math.abs(band.x1 - band.x0)}
            height={Math.abs(band.d1 - band.d0)}
            className="plan-band"
          />
        )}

        {/* shooting positions */}
        {stage.positions.map((p, i) => {
          const sel = selection?.kind === 'position' && selection.index === i;
          return (
            <g key={p.id} className={`plan-pos${sel ? ' sel' : ''}${i === 0 ? ' start' : ''}`}>
              <g transform={`translate(${p.x} ${-p.d}) rotate(${p.heading})`}>
                <rect
                  x={-0.5}
                  y={-0.5}
                  width={1}
                  height={1}
                  className="box"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'position', index: i });
                    drag.current = { kind: 'position', index: i, start: toFloor(e.clientX, e.clientY), orig: { x: p.x, d: p.d }, moved: false };
                  }}
                />
                <line x1={0} y1={0} x2={0} y2={-1.1} className="look" />
                <circle
                  cx={0}
                  cy={-1.25}
                  r={0.16}
                  className="look-handle"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'position', index: i });
                    drag.current = { kind: 'heading', index: i };
                  }}
                />
              </g>
              <text x={p.x} y={-p.d + 0.95} className="plan-pos-label">
                {p.label ?? (i === 0 ? 'START' : `P${i + 1}`)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="plan-tools">
        <button onClick={fit} title="Show the whole hall">
          Fit
        </button>
        <span className="hint">Drag: select · right-drag: pan · wheel: zoom · double-click a path: corner point</span>
      </div>
    </div>
  );
};
