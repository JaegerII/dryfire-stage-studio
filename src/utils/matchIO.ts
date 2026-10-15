/** Export / import of match bundles (a match plus copies of its stages) and single stage files. */
import { matchRepository, normalizeMatch } from '../data/matchRepository';
import { readStageJson, stage3dRepository } from '../stage3d/repository';
import type { Stage3D } from '../stage3d/types';
import type { Match, MatchBundle } from '../types/match';
import { matchStages } from './matchUtils';

export class ImportError extends Error {}

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
  const bundle: MatchBundle = { kind: 'dryfire-match', match, stages: matchStages(match) };
  download(`${match.id}.json`, bundle);
};

export type ImportResult = { kind: 'stage'; stage: Stage3D } | { kind: 'match'; match: Match; stages: Stage3D[] };

/** Reads a stage file or a match bundle — 3D, or the old 2.5D format (converted). Nothing is saved yet. */
export const readImportFile = async (file: File): Promise<ImportResult> => {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new ImportError('File is not valid JSON.');
  }
  const r = data as Partial<MatchBundle>;
  if (r && r.kind === 'dryfire-match' && r.match) {
    return { kind: 'match', match: normalizeMatch(r.match), stages: (r.stages ?? []).map(readStageJson) };
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as { objects?: unknown }).objects)) throw new ImportError('This file is neither a stage nor a match.');
  return { kind: 'stage', stage: readStageJson(data) };
};

/** Saves an imported match bundle: its stages and the match itself. */
export const saveImportedMatch = (match: Match, stages: Stage3D[]) => {
  stages.forEach((s) => stage3dRepository.save(s));
  return matchRepository.save(match);
};
