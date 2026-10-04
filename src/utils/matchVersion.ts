/**
 * Match versions. "New version" freezes the current version: the new one gets
 * its own COPIES of all stages, so editing v2 never changes the archived v1.
 */
import { matchRepository } from '../data/matchRepository';
import { stageRepository } from '../data/stageRepository';
import type { Match } from '../types/match';
import type { Stage } from '../types/stage';
import { STANDBY_VOICE_LEAD } from './audioEngine';
import { estimateMatchDuration } from './matchSchedule';
import { newId } from './random';

export const matchVersion = (m: Match) => m.version ?? 1;
export const matchFamily = (m: Match) => m.family ?? m.id;

/** Id with any trailing _v<n> removed. */
const baseId = (id: string) => id.replace(/_v\d+$/, '');

const freeStageId = (id: string) => (stageRepository.get(id) ? newId(id) : id);
const freeMatchId = (id: string) => (matchRepository.get(id) ? newId(id) : id);

/** Creates and saves the next version of a match (with copied stages). Optionally archives the old one. */
export const createNextVersion = (m: Match, opts: { archiveOld: boolean; note?: string }): Match => {
  const next = Math.max(matchVersion(m), ...matchRepository.list().filter((x) => matchFamily(x) === matchFamily(m)).map(matchVersion)) + 1;
  const stageIds = m.stageIds.map((id) => {
    const s = stageRepository.get(id);
    if (!s) return id;
    const copy: Stage = { ...structuredClone(s), id: freeStageId(`${baseId(s.id)}_v${next}`) };
    return stageRepository.save(copy).id;
  });
  const created = matchRepository.save({
    ...structuredClone(m),
    id: freeMatchId(`${baseId(m.id)}_v${next}`),
    version: next,
    family: matchFamily(m),
    versionNote: opts.note || undefined,
    archived: false,
    stageIds,
    meta: { ...m.meta, createdAt: new Date().toISOString() },
  });
  if (opts.archiveOld) matchRepository.save({ ...m, family: matchFamily(m), version: matchVersion(m), archived: true });
  return created;
};

export const matchStages = (m: Match) => m.stageIds.map((id) => stageRepository.get(id)).filter((s): s is Stage => !!s);

export const matchLength = (m: Match) => estimateMatchDuration(matchStages(m), true, STANDBY_VOICE_LEAD);

export const formatLength = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
