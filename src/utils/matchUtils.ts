/** Small helpers around matches. */
import { buildProgram } from '../stage3d/program';
import { stage3dRepository } from '../stage3d/repository';
import type { Stage3D } from '../stage3d/types';
import type { Match } from '../types/match';
import { STANDBY_VOICE_LEAD } from './audioEngine';

/** Stages of a match in play order, as stored (the player applies the match's "values for all stages"). */
export const matchStages = (m: Match) => m.stageIds.map((id) => stage3dRepository.get(id)).filter((s): s is Stage3D => !!s);

export const matchIntro = (m: Match) => m.settings?.intro ?? true;

/** Length of the match video in seconds. */
export const matchLength = (m: Match) => {
  const stages = matchStages(m);
  return stages.length ? buildProgram(stages, { seed: m.id, voiceLead: STANDBY_VOICE_LEAD, matchName: m.name, settings: m.settings }).end : 0;
};

export const formatLength = (s: number) => {
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
};
