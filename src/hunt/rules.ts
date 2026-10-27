/**
 * Crossing timing and the lead for the driven hunt. Timing mirrors hunt.py: animals start just outside
 * one frame edge and run to just outside the other.
 */
import { type MapId, type StandIndex, laneX, standView } from './maps';
import { type Crossing, GAME_CLASSES, type GameClass, type HuntFormat } from './types';

export const HFOV: Record<HuntFormat, number> = { '16x9': 42, '9x16': 30 };
/** Mean bullet speed over 30–60 m for the lead estimate (m/s). */
export const BULLET_SPEED = 800;

/** Order as the sounder runs: the lead sow / boar in front, piglets close behind, yearlings strung out. */
export const sounderOrder = (animals: GameClass[]): GameClass[] => {
  const lead = animals.findIndex((k) => k === 'bache' || k === 'keiler');
  const li = lead < 0 ? 0 : lead;
  const rank = (k: GameClass) => (GAME_CLASSES[k].young ? 1 : k === 'ueberlaeufer' ? 2 : 0);
  const rest = animals.filter((_, i) => i !== li).sort((a, b) => rank(a) - rank(b));
  return [animals[li], ...rest];
};

/** Lead (Vorhalt) in cm for a broadside shot: speed × bullet flight time. */
export const leadCm = (c: Crossing) => Math.round((c.speed * c.distance * 100) / BULLET_SPEED);

/** Rough length of the sounder in meters (bodies + gaps), for timing. */
export const groupLength = (animals: GameClass[]) =>
  animals.reduce((s, k) => s + 1.65 * GAME_CLASSES[k].scale, 0) + Math.max(0, animals.length - 1) * 0.9;

/**
 * Where game crosses the lane `d` meters from the stand (hunt.py crossing_line): the lane station y,
 * centre and half width of the view at that depth (+4 m: animals start / end just outside the frame),
 * and which way the stand looks along the lane (+1 / −1).
 */
export const crossingLine = (map: MapId, stand: StandIndex, d: number, format: HuntFormat = '16x9') => {
  const s = standView(map, stand);
  const [ax, ay] = s.aim;
  const look = ay >= s.y ? 1 : -1;
  let lo = 0;
  let hi = 250;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const yy = s.y + look * mid;
    if (Math.hypot(laneX(map, yy) - s.x, yy - s.y) < d) lo = mid;
    else hi = mid;
  }
  const y = s.y + look * lo;
  const half = Math.tan((HFOV[format] * Math.PI) / 360) * Math.abs(y - s.y) + 4;
  const xc = s.x + ((ax - s.x) * (y - s.y)) / (ay - s.y);
  return { y, xc, half, look };
};

/**
 * When the crossing is on screen: from the lead animal entering the frame to the last one leaving it
 * (estimated; the render's crop rects give the exact frames).
 */
export const crossingWindow = (c: Crossing, format: HuntFormat = '16x9') => {
  const half = Math.tan((HFOV[format] * Math.PI) / 360) * c.distance;
  const enter = c.at + 4 / c.speed;
  const leave = c.at + (2 * half + 4 + groupLength(c.animals)) / c.speed;
  return { enter, leave, run: c.at + (2 * half + 8.5 + groupLength(c.animals)) / c.speed };
};

/** One-line description: "Rotte · 1 Bache, 4 Frischlinge" / "Überläufer". */
export const describe = (animals: GameClass[]) => {
  if (animals.length === 1) return GAME_CLASSES[animals[0]].label;
  const counts = new Map<GameClass, number>();
  for (const k of animals) counts.set(k, (counts.get(k) ?? 0) + 1);
  const parts = [...counts].map(([k, n]) => `${n} ${n > 1 ? GAME_CLASSES[k].plural : GAME_CLASSES[k].label}`);
  return `Rotte · ${parts.join(', ')}`;
};
