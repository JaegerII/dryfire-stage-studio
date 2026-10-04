import { useCallback, useEffect, useState } from 'react';
import { StageEditor } from './components/editor/StageEditor';
import { TrainingPlayer } from './components/player/TrainingPlayer';
import { stageRepository } from './data/stageRepository';
import type { Stage } from './types/stage';
import { createStage } from './utils/stageIO';

/**
 * Routes (hash based, so the app works from any static host / file):
 *   #/edit/<stageId>   editor
 *   #/play/<stageId>   player (e.g. a browser source / window for OBS)
 */
const parseHash = () => {
  const [, mode, id] = location.hash.match(/^#\/(edit|play)\/(.+)$/) ?? [];
  return { mode: (mode as 'edit' | 'play') ?? 'edit', id: id ? decodeURIComponent(id) : undefined };
};

const initialStage = (): Stage => {
  const { id } = parseHash();
  return (id && stageRepository.get(id)) || stageRepository.get(stageRepository.list()[0]?.id ?? '') || createStage();
};

export const App = () => {
  const [editorStage] = useState(initialStage);
  const [playing, setPlaying] = useState<Stage | null>(() => (parseHash().mode === 'play' ? editorStage : null));
  const [currentId, setCurrentId] = useState(editorStage.id);

  useEffect(() => {
    const target = `#/${playing ? 'play' : 'edit'}/${encodeURIComponent(playing?.id ?? currentId)}`;
    if (location.hash !== target) history.replaceState(null, '', target);
  }, [playing, currentId]);

  const onStageIdChange = useCallback((id: string) => setCurrentId(id), []);
  const onPlay = useCallback((s: Stage) => setPlaying(structuredClone(s)), []);

  return (
    <>
      <StageEditor initial={editorStage} hidden={!!playing} onPlay={onPlay} onStageIdChange={onStageIdChange} />
      {playing && <TrainingPlayer key={playing.id} stage={playing} onExit={() => setPlaying(null)} />}
    </>
  );
};
