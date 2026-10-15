import type { Measured } from '../motion/analyzer';

/** "1.23 s ±0.02" — or "—" when nothing was measured (never a made-up zero). */
export const sec = (m?: Pick<Measured, 'ms' | 'uncertaintyMs'> | null, digits = 2) =>
  m ? `${(m.ms / 1000).toFixed(digits)} s ±${(m.uncertaintyMs / 1000).toFixed(digits)}` : '—';

export const secPlain = (ms?: number, digits = 2) => (ms === undefined || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(digits)} s`);

export const pct = (v: number) => `${Math.round(v * 100)} %`;

export const STATUS_TEXT: Record<string, string> = {
  complete: 'measured',
  no_presentation: 'no presentation detected',
  no_movement: 'no movement detected',
  tracking_lost: 'tracking lost',
};

export const STATE_TEXT: Record<string, string> = {
  READY: 'Ready — hands still',
  MOVEMENT: 'Movement',
  PRESENTATION: 'Presentation zone reached',
  STABILIZATION: 'Stabilising',
  COMPLETE: 'Complete',
};
