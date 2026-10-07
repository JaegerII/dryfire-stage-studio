/**
 * A match is an ordered list of stages played as one session / one video:
 * logo → safety → stage 1 → stage 2 → … The stages themselves stay separate
 * stage files and are referenced by id (a stage can be part of several matches).
 */

export const MATCH_SCHEMA_VERSION = 1;

/** Match-wide timing (seconds) — missing values use MATCH_TIMING. */
export interface MatchTimingSettings {
  /** FORTH TRACE logo screen. */
  brand?: number;
  /** Safety screen. */
  safety?: number;
  /** Title card before every stage ("Stage 2 / 3"). */
  title?: number;
  /** MAKE READY lead-in while the camera pushes into the stage. */
  lead?: number;
}

/** Values applied to every stage of the match (unset = each stage keeps its own). */
export interface MatchStageOverrides {
  resetTime?: number;
  repetitions?: number;
  standbyDelay?: { min: number; max: number };
}

export interface MatchSettings {
  /** Logo + safety intro before the first stage (default on). */
  intro?: boolean;
  timing?: MatchTimingSettings;
  overrides?: MatchStageOverrides;
}

export interface Match {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  /** Stage ids in play order. */
  stageIds: string[];
  /** Archived matches are kept unchanged but hidden from the active list. */
  archived?: boolean;
  /** Match settings: intro, times between the stages, values for all stages. */
  settings?: MatchSettings;
  meta?: {
    author?: string;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  };
}

/** Export file: a match together with copies of its stages (imports anywhere). */
export interface MatchBundle {
  kind: 'dryfire-match';
  match: Match;
  stages: unknown[];
}
