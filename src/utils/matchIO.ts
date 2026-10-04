/** Export / import of match bundles (a match plus copies of its stages). */
import { matchRepository, normalizeMatch } from '../data/matchRepository';
import { stageRepository } from '../data/stageRepository';
import type { Match, MatchBundle } from '../types/match';
import type { Stage } from '../types/stage';
import { StageFormatError, normalizeStage } from './stageIO';

const download = (filename: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

export const exportMatchFile = (match: Match) => {
  const stages = match.stageIds.map((id) => stageRepository.get(id)).filter((s): s is Stage => !!s);
  const bundle: MatchBundle = { kind: 'dryfire-match', match, stages };
  download(`${match.id}.json`, bundle);
};

export type ImportResult = { kind: 'stage'; stage: Stage } | { kind: 'match'; match: Match; stages: Stage[] };

/** Reads a stage file or a match bundle. Nothing is saved yet. */
export const readImportFile = async (file: File): Promise<ImportResult> => {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new StageFormatError('File is not valid JSON.');
  }
  const r = data as Partial<MatchBundle>;
  if (r && r.kind === 'dryfire-match' && r.match) {
    return { kind: 'match', match: normalizeMatch(r.match), stages: (r.stages ?? []).map(normalizeStage) };
  }
  return { kind: 'stage', stage: normalizeStage(data) };
};

/** Saves an imported match bundle: its stages and the match itself. */
export const saveImportedMatch = (match: Match, stages: Stage[]) => {
  stages.forEach((s) => stageRepository.save(s));
  return matchRepository.save(match);
};
