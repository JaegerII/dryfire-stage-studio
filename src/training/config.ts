/**
 * Central timing / display configuration for the training programs.
 * Every duration used by the sequence lives here — nothing is hard-coded elsewhere.
 * All values are seconds unless noted. None of them is an official value of any
 * discipline; adjust freely.
 */
export const TRAINING_CONFIG = {
  /** Task card before every series ("15 m · 6 × 2 sec · 1 rep per exposure"). */
  briefTime: 3,
  /** "READY" card. */
  readyTime: 1.5,
  /** Short pause after READY before the countdown / start signal. */
  holdTime: 1,
  /** Countdown 3…2…1 before the start signal (0 = off). One number per second. */
  countdown: 3,
  /** Optional random delay instead of the fixed hold (off by default). */
  randomStartDelay: { enabled: false, min: 1, max: 4 },
  /** Time the target needs to turn 90° (towards or away). Not part of the visible time. */
  turnTime: 0.18,
  /** Target turned away between two exposures of an exposure phase (training value). */
  gapBetweenExposures: 7,
  /** Training / reload pause between two rounds of the same phase. */
  roundPause: 15,
  /** After SERIES COMPLETE: start the next series automatically after this many seconds (null = wait for NEXT). */
  autoAdvance: 10 as number | null,
  /** How long the end of a series ("TIME") stays before SERIES COMPLETE. */
  endHold: 1.2,
  /** Target height as a fraction of the screen height at 10 m; it shrinks with the simulated distance. */
  targetHeightAt10m: 0.56,
  /** Smallest target height (fraction of the screen), so far targets stay usable on a TV. */
  minTargetHeight: 0.2,
};

export type TrainingConfig = typeof TRAINING_CONFIG;
