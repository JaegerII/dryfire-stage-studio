/**
 * Edit operations of the 3D stage editor — pure functions, stage in → stage out.
 */
import type { ObjectType } from '../../types/stage';
import { newId } from '../../utils/random';
import { HALL, type Leg, type ShooterPosition, type Stage3D, type StageObject3D } from '../types';

export type Selection =
  | { kind: 'objects'; ids: string[] }
  | { kind: 'position'; index: number }
  | { kind: 'leg'; index: number }
  | null;

export const DEFAULT_LEG: Leg = { after: 3, duration: 2.5, reload: false };

const round = (v: number, step = 0.01) => Math.round(v / step) * step;
export const clampToHall = (x: number, d: number) => ({
  x: Math.max(HALL.x0 + 0.2, Math.min(HALL.x1 - 0.2, x)),
  d: Math.max(HALL.d0 + 0.5, Math.min(HALL.d1 - 2, d)),
});

export const snapTo = (v: number, step: number) => (step ? round(v, step) : round(v));

export const addObject = (s: Stage3D, type: ObjectType, x: number, d: number, extra: Partial<StageObject3D> = {}) => {
  const p = clampToHall(x, d);
  const obj: StageObject3D = { id: newId(type.split('_')[0]), type, x: round(p.x), d: round(p.d), ...extra };
  return { stage: { ...s, objects: [...s.objects, obj] }, id: obj.id };
};

export const patchObjects = (s: Stage3D, ids: string[], fn: (o: StageObject3D) => Partial<StageObject3D> | null): Stage3D => ({
  ...s,
  objects: s.objects.map((o) => {
    if (!ids.includes(o.id)) return o;
    const p = fn(o);
    return p ? { ...o, ...p } : o;
  }),
});

export const moveObjects = (s: Stage3D, ids: string[], dx: number, dd: number) =>
  patchObjects(s, ids, (o) => {
    const p = clampToHall(o.x + dx, o.d + dd);
    return { x: round(p.x), d: round(p.d) };
  });

export const removeObjects = (s: Stage3D, ids: string[]): Stage3D => ({ ...s, objects: s.objects.filter((o) => !ids.includes(o.id)) });

export const duplicateObjects = (s: Stage3D, ids: string[]) => {
  const copies = s.objects.filter((o) => ids.includes(o.id)).map((o) => ({ ...structuredClone(o), id: newId(o.type.split('_')[0]), x: round(o.x + 0.5) }));
  return { stage: { ...s, objects: [...s.objects, ...copies] }, ids: copies.map((c) => c.id) };
};

/** Default labels follow the order (START, P2, P3 …); custom labels are kept. */
const relabel = (positions: ShooterPosition[]) =>
  positions.map((p, i) => (!p.label || /^(START|P\d+)$/.test(p.label) ? { ...p, label: i === 0 ? 'START' : `P${i + 1}` } : p));

/** New position at the end of the course, with a leg from the previous one. */
export const addPosition = (s: Stage3D, x: number, d: number, heading = 0) => {
  const p = clampToHall(x, d);
  const pos: ShooterPosition = { id: newId('pos'), x: round(p.x), d: round(p.d), heading };
  return { stage: { ...s, positions: relabel([...s.positions, pos]), legs: [...s.legs, { ...DEFAULT_LEG }] }, index: s.positions.length };
};

export const patchPosition = (s: Stage3D, i: number, patch: Partial<ShooterPosition>): Stage3D => ({
  ...s,
  positions: s.positions.map((p, k) => (k === i ? { ...p, ...patch } : p)),
});

/**
 * Removes a position; the course stays connected: the leg into it disappears and
 * the leg out of it now starts at the position before. The start can only go when
 * another position takes over.
 */
export const removePosition = (s: Stage3D, i: number): Stage3D => {
  if (s.positions.length <= 1) return s;
  const positions = relabel(s.positions.filter((_, k) => k !== i));
  const legs = i === 0 ? s.legs.slice(1) : s.legs.filter((_, k) => k !== i - 1);
  return { ...s, positions, legs };
};

export const patchLeg = (s: Stage3D, i: number, patch: Partial<Leg>): Stage3D => ({ ...s, legs: s.legs.map((l, k) => (k === i ? { ...l, ...patch } : l)) });

const distToSegment = (px: number, pd: number, a: { x: number; d: number }, b: { x: number; d: number }) => {
  const vx = b.x - a.x;
  const vd = b.d - a.d;
  const len2 = vx * vx + vd * vd || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pd - a.d) * vd) / len2));
  return Math.hypot(px - (a.x + t * vx), pd - (a.d + t * vd));
};

/** Adds a corner point to leg `i` at (x, d), in the segment it is closest to. */
export const insertVia = (s: Stage3D, i: number, x: number, d: number): Stage3D => {
  const via = s.legs[i].via ?? [];
  const pts = [s.positions[i], ...via, s.positions[i + 1]];
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < pts.length - 1; k++) {
    const dist = distToSegment(x, d, pts[k], pts[k + 1]);
    if (dist < bestDist) {
      bestDist = dist;
      best = k;
    }
  }
  const next = [...via];
  next.splice(best, 0, { x: round(x), d: round(d) });
  return patchLeg(s, i, { via: next });
};

export const moveVia = (s: Stage3D, i: number, k: number, x: number, d: number): Stage3D => {
  const p = clampToHall(x, d);
  return patchLeg(s, i, { via: (s.legs[i].via ?? []).map((v, j) => (j === k ? { x: round(p.x), d: round(p.d) } : v)) });
};

export const removeVia = (s: Stage3D, i: number, k: number): Stage3D => {
  const via = (s.legs[i].via ?? []).filter((_, j) => j !== k);
  const { via: _drop, ...rest } = s.legs[i];
  return { ...s, legs: s.legs.map((l, j) => (j === i ? (via.length ? { ...rest, via } : rest) : l)) };
};
