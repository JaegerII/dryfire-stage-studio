/** Small helpers around matches. */
import { stageRepository } from '../data/stageRepository';
import type { Match } from '../types/match';
import type { Stage } from '../types/stage';
import { STANDBY_VOICE_LEAD } from './audioEngine';
import { estimateMatchDuration } from './matchSchedule';

export const matchStages = (m: Match) => m.stageIds.map((id) => stageRepository.get(id)).filter((s): s is Stage => !!s);

export const matchLength = (m: Match) => estimateMatchDuration(matchStages(m), true, STANDBY_VOICE_LEAD);

export const formatLength = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
