import { useCallback, useEffect, useState } from 'react';
import { StageEditor } from './components/editor/StageEditor';
import { TrainingPlayer } from './components/player/TrainingPlayer';
import { matchRepository } from './data/matchRepository';
import { stageRepository } from './data/stageRepository';
import type { Stage } from './types/stage';
import { createStage } from './utils/stageIO';

/**
 * Routes (hash based, so the app works from any static host / file):
 *   #/edit/<stageId>    editor
 *   #/play/<stageId>    play one stage (e.g. a browser window for OBS)
 *   #/match/<matchId>   play a whole match (logo → safety → stages)
 */
const parseHash = () => {
  const [, mode, id] = location.hash.match(/^#\/(edit|play|match)\/(.+)$/) ?? [];
  return { mode: (mode as 'edit' | 'play' | 'match') ?? 'edit', id: id ? decodeURIComponent(id) : undefined };
};

interface Playing {
  stages: Stage[];
  matchName?: string;
  matchId?: string;
}

const initialPlaying = (editorStage: Stage): Playing | null => {
  const { mode, id } = parseHash();
  if (mode === 'play') return { stages: [editorStage] };
  if (mode === 'match' && id) {
    const m = matchRepository.get(id);
    const stages = m?.stageIds.map((sid) => stageRepository.get(sid)).filter((s): s is Stage => !!s) ?? [];
    if (m && stages.length) return { stages, matchName: m.name, matchId: m.id };
  }
  return null;
};

const initialStage = (): Stage => {
  const { mode, id: hashId } = parseHash();
  // for a match route, open the match's first stage in the editor
  const id = mode === 'match' && hashId ? matchRepository.get(hashId)?.stageIds[0] : hashId;
  return (id && stageRepository.get(id)) || stageRepository.get(stageRepository.list()[0]?.id ?? '') || createStage();
};

export const App = () => {
  const [editorStage] = useState(initialStage);
  const [playing, setPlaying] = useState<Playing | null>(() => initialPlaying(editorStage));
  const [currentId, setCurrentId] = useState(editorStage.id);

  useEffect(() => {
    const target = playing?.matchId
      ? `#/match/${encodeURIComponent(playing.matchId)}`
      : `#/${playing ? 'play' : 'edit'}/${encodeURIComponent(playing?.stages[0]?.id ?? currentId)}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  }, [playing, currentId]);

  const onStageIdChange = useCallback((id: string) => setCurrentId(id), []);
  const onPlay = useCallback(
    (stages: Stage[], matchName?: string, matchId?: string) => setPlaying({ stages: structuredClone(stages), matchName, matchId }),
    [],
  );

  return (
    <>
      <StageEditor initial={editorStage} hidden={!!playing} onPlay={onPlay} onStageIdChange={onStageIdChange} />
      {playing && (
        <TrainingPlayer
          key={playing.matchId ?? playing.stages[0].id}
          stages={playing.stages}
          matchName={playing.matchName}
          onExit={() => setPlaying(null)}
        />
      )}
    </>
  );
};
