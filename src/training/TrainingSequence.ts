/**
 * Turns a TrainingProgram into a list of series with exact timelines.
 *
 * One series = one block the shooter runs without interruption:
 *   brief (task card) → READY → hold / random delay → countdown → active → end
 * An exposure phase with `rounds: 2` becomes two series; the training / reload pause
 * between them is the pause between those series.
 *
 * Exposure timing: the visible time starts when the target is FULLY turned in and ends
 * when it starts turning away — the turn itself (TRAINING_CONFIG.turnTime) happens
 * outside the visible time and never shortens it.
 */
import type { TrainingConfig } from './config';
import { type TargetSlot, type TrainingPhase, type TrainingProgram, describePhase, phaseReps } from './TrainingPhase';

export type Sound = 'start' | 'end' | 'tick';

export interface Cue {
  /** Seconds from the start of the series. */
  at: number;
  sound: Sound;
}

export interface Window {
  from: number;
  to: number;
}

export interface Series {
  index: number;
  phaseIndex: number;
  phase: TrainingPhase;
  round: number;
  rounds: number;
  /** "15 m · 6 × 2 sec · 1 rep per exposure" */
  task: string;
  /** Times of the series (seconds from its start). */
  readyAt: number;
  holdAt: number;
  countAt: number;
  activeFrom: number;
  activeTo: number;
  /** Exposure windows (fully facing); a continuous phase has one window = the whole active time. */
  windows: Window[];
  cues: Cue[];
  /** End of the series incl. the end hold. */
  duration: number;
  /** Pause after this series before the next one (null = wait for NEXT); 'round' = reload pause. */
  pauseAfter: { seconds: number | null; kind: 'round' | 'phase' } | null;
}

export type Stage = 'brief' | 'ready' | 'hold' | 'count' | 'active' | 'end';

export interface SeriesState {
  stage: Stage;
  /** 3, 2, 1 during the countdown. */
  count?: number;
  /** 0 = edge-on (turned away) … 1 = facing the shooter, per target slot. */
  facing: Record<TargetSlot, number>;
  /** Seconds left in the running window (continuous: whole series; exposure: this exposure). */
  remaining?: number;
  /** 1-based index of the current / last exposure. */
  exposure?: number;
  exposures?: number;
}

/** Random in [min, max) from a seed (repeatable runs when the seed is the same). */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

export function buildSeries(program: TrainingProgram, cfg: TrainingConfig, seed = Date.now()): Series[] {
  const rnd = seeded(seed);
  const out: Series[] = [];
  program.phases.forEach((phase, phaseIndex) => {
    const rounds = phase.type === 'exposure' ? (phase.rounds ?? 1) : 1;
    for (let round = 1; round <= rounds; round++) {
      const readyAt = cfg.briefTime;
      const holdAt = readyAt + cfg.readyTime;
      const hold = cfg.randomStartDelay.enabled
        ? cfg.randomStartDelay.min + rnd() * (cfg.randomStartDelay.max - cfg.randomStartDelay.min)
        : cfg.holdTime;
      const countAt = holdAt + hold;
      const activeFrom = countAt + cfg.countdown;
      const cues: Cue[] = [];
      for (let i = 0; i < cfg.countdown; i++) cues.push({ at: countAt + i, sound: 'tick' });
      cues.push({ at: activeFrom, sound: 'start' });

      let windows: Window[];
      let activeTo: number;
      if (phase.type === 'continuous') {
        windows = [{ from: activeFrom, to: activeFrom + phase.duration }];
        activeTo = activeFrom + phase.duration;
      } else {
        const gap = phase.gap ?? cfg.gapBetweenExposures;
        windows = Array.from({ length: phase.exposures }, (_, i) => {
          const from = activeFrom + i * (phase.exposureTime + gap);
          return { from, to: from + phase.exposureTime };
        });
        // the last target has fully turned away
        activeTo = windows[windows.length - 1].to + cfg.turnTime;
      }
      cues.push({ at: activeTo, sound: 'end' });

      const lastOfPhase = round === rounds;
      const lastOfProgram = lastOfPhase && phaseIndex === program.phases.length - 1;
      out.push({
        index: out.length,
        phaseIndex,
        phase,
        round,
        rounds,
        task: describePhase(phase),
        readyAt,
        holdAt,
        countAt,
        activeFrom,
        activeTo,
        windows,
        cues,
        duration: activeTo + cfg.endHold,
        pauseAfter: lastOfProgram ? null : lastOfPhase ? { seconds: cfg.autoAdvance, kind: 'phase' } : { seconds: cfg.roundPause, kind: 'round' },
      });
    }
  });
  return out;
}

/** How far a target is turned towards the shooter at time t for one window (incl. the turns outside it). */
const facingFor = (w: Window, t: number, turn: number) => {
  if (t <= w.from - turn || t >= w.to + turn) return 0;
  if (t < w.from) return (t - (w.from - turn)) / turn;
  if (t <= w.to) return 1;
  return 1 - (t - w.to) / turn;
};

export function seriesState(s: Series, t: number, layout: TargetSlot[], cfg: TrainingConfig): SeriesState {
  const facing = { center: 0, left: 0, right: 0 } as Record<TargetSlot, number>;
  let f = 0;
  for (const w of s.windows) f = Math.max(f, facingFor(w, t, cfg.turnTime));
  for (const slot of layout) facing[slot] = s.phase.active.includes(slot) ? f : 0;

  const stage: Stage =
    t < s.readyAt ? 'brief' : t < s.holdAt ? 'ready' : t < s.countAt ? 'hold' : t < s.activeFrom ? 'count' : t < s.activeTo ? 'active' : 'end';
  const state: SeriesState = { stage, facing };
  if (stage === 'count') state.count = Math.max(1, Math.ceil(s.activeFrom - t));
  if (stage === 'active' || stage === 'end') {
    if (s.phase.type === 'continuous') state.remaining = Math.max(0, s.windows[0].to - t);
    else {
      // current exposure = last one that has started
      let i = 0;
      while (i < s.windows.length - 1 && t >= s.windows[i + 1].from - cfg.turnTime) i++;
      const w = s.windows[i];
      state.exposure = i + 1;
      state.exposures = s.windows.length;
      state.remaining = t >= w.from && t < w.to ? w.to - t : undefined;
    }
  }
  return state;
}

/** Short summary for SERIES COMPLETE. */
export const seriesSummary = (s: Series) => {
  const p = s.phase;
  const reps = phaseReps(p);
  const time = p.type === 'continuous' ? `${p.duration} s` : `${p.exposures} × ${p.exposureTime} s exposures`;
  return `${p.distance} m · ${reps} reps planned · ${time}${s.rounds > 1 ? ` · round ${s.round} / ${s.rounds}` : ''}`;
};
