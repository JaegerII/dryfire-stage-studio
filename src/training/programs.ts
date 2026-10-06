/**
 * Training programs as data. Unofficial dry-fire simulations — not affiliated with or
 * endorsed by any shooting association. Pauses between exposures and rounds are
 * training values from TRAINING_CONFIG, not official values.
 */
import type { TrainingProgram } from './TrainingPhase';

export const PP1Program: TrainingProgram = {
  id: 'pp1',
  discipline: 'PP1',
  name: 'PP1 Training',
  description: 'One target · 25 m precision, 15 m and 10 m exposures.',
  layout: ['center'],
  design: 'neutral',
  phases: [
    { distance: 25, type: 'continuous', duration: 120, reps: 12, active: ['center'] },
    { distance: 15, type: 'exposure', rounds: 2, exposures: 6, exposureTime: 2, repsPerExposure: 1, active: ['center'] },
    { distance: 10, type: 'exposure', exposures: 3, exposureTime: 2, repsPerExposure: 2, active: ['center'] },
  ],
};

export const NPAProgram: TrainingProgram = {
  id: 'npa',
  discipline: 'NPA',
  name: 'NPA Training',
  description: 'Two targets, LEFT and RIGHT · 25 m to 10 m.',
  layout: ['left', 'right'],
  design: 'neutral',
  phases: [
    { distance: 25, type: 'continuous', duration: 15, reps: 6, active: ['left'] },
    { distance: 20, type: 'continuous', duration: 10, reps: 6, active: ['left', 'right'], split: { left: 3, right: 3 } },
    { distance: 15, type: 'exposure', exposures: 3, exposureTime: 3, repsPerExposure: 2, active: ['right'] },
    { distance: 10, type: 'continuous', duration: 6, reps: 6, active: ['left', 'right'], split: { left: 3, right: 3 } },
  ],
};

/** All programs, in the order of the selection page. Add new disciplines here. */
export const PROGRAMS: TrainingProgram[] = [PP1Program, NPAProgram];

export const programById = (id: string) => PROGRAMS.find((p) => p.id === id);
