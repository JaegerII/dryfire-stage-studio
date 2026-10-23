/**
 * Release decisions and crossing timing for the driven hunt.
 *
 * Release (Freigabe) per animal, in this order of reasons:
 *   too far → fleeing game not released → leading sow (a sow with piglets in the sounder: parent
 *   protection, § 22 (4) BJagdG; the lead sow is never shot) → the class's release.
 * Timing mirrors hunt.py: animals start just outside one frame edge and run to just outside the other.
 */
import { type Crossing, GAME_CLASSES, type GameClass, type HuntFormat, type HuntRelease } from './types';

/** Stand and view, as in hunt.py. */
export const STAND = { x: -6.5, y: 0, eye: 3.3 };
export const AIM = { x: 0, y: 35 };
export const HFOV: Record<HuntFormat, number> = { '16x9': 42, '9x16': 30 };
/** Mean bullet speed over 30–60 m for the lead estimate (m/s). */
export const BULLET_SPEED = 800;

export const laneX = (y: number) => 0.0005 * Math.max(0, y - 30) ** 2;

export interface AnimalVerdict {
  kind: GameClass;
  free: boolean;
  reason: string;
  /** The animal leading the sounder. */
  lead: boolean;
}

/** Order as the sounder runs: the lead sow / boar in front, piglets close behind, yearlings strung out. */
export const sounderOrder = (animals: GameClass[]): GameClass[] => {
  const lead = animals.findIndex((k) => k === 'bache' || k === 'keiler');
  const li = lead < 0 ? 0 : lead;
  const rank = (k: GameClass) => (GAME_CLASSES[k].young ? 1 : k === 'ueberlaeufer' ? 2 : 0);
  const rest = animals.filter((_, i) => i !== li).sort((a, b) => rank(a) - rank(b));
  return [animals[li], ...rest];
};

export const judge = (c: Crossing, r: HuntRelease): AnimalVerdict[] => {
  const order = sounderOrder(c.animals);
  const young = order.some((k) => GAME_CLASSES[k].young);
  return order.map((kind, i) => {
    const lead = i === 0 && order.length > 1;
    const v = (free: boolean, reason: string): AnimalVerdict => ({ kind, free, reason, lead });
    if (c.distance > r.maxDistance) return v(false, `zu weit (${Math.round(c.distance)} m > ${r.maxDistance} m)`);
    if (c.gait === 'gallop' && !r.gallop) return v(false, 'flüchtig – kein Schuss freigegeben');
    if (kind === 'bache' && young) return v(false, lead ? 'Leitbache, führend – Elterntierschutz' : 'führende Bache – Elterntierschutz');
    if (kind === 'bache' && lead) return v(false, 'Leitbache – nie schießen');
    const released = { keiler: r.keiler, bache: r.bache, ueberlaeufer: r.ueberlaeufer, frischling: r.frischling, frischling_gestreift: r.frischling }[kind];
    return v(released, released ? 'frei' : 'nicht freigegeben');
  });
};

/** Lead (Vorhalt) in cm for a broadside shot: speed × bullet flight time. */
export const leadCm = (c: Crossing) => Math.round((c.speed * c.distance * 100) / BULLET_SPEED);

/** Rough length of the sounder in meters (bodies + gaps), for timing. */
export const groupLength = (animals: GameClass[]) =>
  animals.reduce((s, k) => s + 1.65 * GAME_CLASSES[k].scale, 0) + Math.max(0, animals.length - 1) * 0.9;

/**
 * When the crossing is on screen: from the lead animal entering the frame to the last one leaving it
 * (estimated; the render's crop rects give the exact frames).
 */
export const crossingWindow = (c: Crossing, format: HuntFormat = '16x9') => {
  const half = Math.tan((HFOV[format] * Math.PI) / 360) * (c.distance - STAND.y);
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
