/**
 * A match is an ordered list of stages played as one session / one video:
 * logo → safety → stage 1 → stage 2 → … The stages themselves stay separate
 * stage files and are referenced by id (a stage can be part of several matches).
 */

export const MATCH_SCHEMA_VERSION = 1;

export interface Match {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  /** Stage ids in play order. */
  stageIds: string[];
  /** Archived matches are kept unchanged but hidden from the active list. */
  archived?: boolean;
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
