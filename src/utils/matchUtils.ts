/** Small helpers around matches. */
import { stageRepository } from '../data/stageRepository';
import type { Match, MatchStageOverrides } from '../types/match';
import type { Stage } from '../types/stage';
import { STANDBY_VOICE_LEAD } from './audioEngine';
import { estimateMatchDuration } from './matchSchedule';

/** Stages of a match in play order — with the match's "values for all stages" applied. */
export const matchStages = (m: Match) =>
  m.stageIds
    .map((id) => stageRepository.get(id))
    .filter((s): s is Stage => !!s)
    .map((s) => applyOverrides(s, m.settings?.overrides));

export const applyOverrides = (s: Stage, o?: MatchStageOverrides): Stage =>
  !o
    ? s
    : {
        ...s,
        ...(o.resetTime !== undefined ? { resetTime: o.resetTime } : {}),
        ...(o.repetitions !== undefined ? { repetitions: o.repetitions } : {}),
        ...(o.standbyDelay ? { standbyDelay: { ...o.standbyDelay } } : {}),
      };

export const matchIntro = (m: Match) => m.settings?.intro ?? true;

export const matchLength = (m: Match) => estimateMatchDuration(matchStages(m), matchIntro(m), STANDBY_VOICE_LEAD, m.settings?.timing);

export const formatLength = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
