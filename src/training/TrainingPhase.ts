/**
 * Data model of a training program. Programs are plain objects (see PP1Program / NPAProgram):
 * a new discipline is a new object — no change to the sequence, timer or view.
 */

/** Target positions on screen. A program decides which of them it shows. */
export type TargetSlot = 'center' | 'left' | 'right';

interface BasePhase {
  /** Simulated distance in meters (scales the target and labels the phase). */
  distance: number;
  /** Targets that turn towards the shooter in this phase. */
  active: TargetSlot[];
  /** Planned reps per target, e.g. { left: 3, right: 3 } → "3 LEFT + 3 RIGHT". */
  split?: Partial<Record<TargetSlot, number>>;
}

/** Targets face the shooter for the whole duration (start signal … end signal). */
export interface ContinuousPhase extends BasePhase {
  type: 'continuous';
  duration: number;
  reps: number;
}

/** Targets turn in for exposureTime, then away; repeated `exposures` times, in `rounds` series. */
export interface ExposurePhase extends BasePhase {
  type: 'exposure';
  exposures: number;
  exposureTime: number;
  repsPerExposure: number;
  /** Number of identical series (with a training / reload pause in between). Default 1. */
  rounds?: number;
  /** Override of TRAINING_CONFIG.gapBetweenExposures for this phase. */
  gap?: number;
}

export type TrainingPhase = ContinuousPhase | ExposurePhase;

export interface TrainingProgram {
  id: string;
  discipline: string;
  name: string;
  description: string;
  /** Targets shown on screen (left to right). */
  layout: TargetSlot[];
  /** Target design id (see targets.tsx) — swap the SVG without touching the logic. */
  design: string;
  phases: TrainingPhase[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Total planned reps of a phase (one round). */
export const phaseReps = (p: TrainingPhase) => (p.type === 'continuous' ? p.reps : p.exposures * p.repsPerExposure);

/** "15 m · 6 × 2 sec · 1 rep per exposure", "25 m · 12 reps · 120 sec", "… · 3 LEFT + 3 RIGHT". */
export const describePhase = (p: TrainingPhase) => {
  const parts = [`${p.distance} m`];
  if (p.type === 'continuous') parts.push(plural(p.reps, 'rep'), `${p.duration} sec`);
  else parts.push(`${p.exposures} × ${p.exposureTime} sec`, `${plural(p.repsPerExposure, 'rep')} per exposure`);
  if (p.split) {
    parts.push(
      Object.entries(p.split)
        .map(([slot, n]) => `${n} ${slot.toUpperCase()}`)
        .join(' + '),
    );
  } else if (p.active.length === 1 && p.active[0] !== 'center') parts.push(`${p.active[0].toUpperCase()} only`);
  return parts.join(' · ');
};
