import { TrainingHome } from './components/training/TrainingHome';
import { TrainingRunner } from './components/training/TrainingRunner';
import { programById } from './training/programs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StageEditor } from './components/editor/StageEditor';
import { HomePage } from './components/home/HomePage';
import { MatchPage } from './components/match/MatchPage';
import { TrainingPlayer } from './components/player/TrainingPlayer';
import { matchRepository } from './data/matchRepository';
import { stageRepository } from './data/stageRepository';
import type { MatchSettings } from './types/match';
import type { Stage } from './types/stage';
import { createStage } from './utils/stageIO';
import { matchStages } from './utils/matchUtils';

/**
 * Routes (hash based, so the app works from any static host):
 *   #/                          start page: matches (active / archive) + all stages
 *   #/match/<id>                one match: its stages
 *   #/match/<id>/play           play the whole match (logo → safety → stages) — e.g. for OBS
 *   #/match/<id>/edit/<stage>   edit a stage of that match (breadcrumb back to the match)
 *   #/edit/<stage>              edit a stage on its own
 *   #/play/<stage>              play one stage
 *   #/training                  training programs (PP1 / NPA)
 *   #/training/<program>        run a training program
 */
type View =
  | { page: 'home' }
  | { page: 'match'; matchId: string }
  | { page: 'edit'; stageId: string; matchId?: string }
  | { page: 'training' }
  | { page: 'program'; programId: string };

interface Playing {
  stages: Stage[];
  matchName?: string;
  matchId?: string;
  settings?: MatchSettings;
}

const dec = decodeURIComponent;
const enc = encodeURIComponent;

const parse = (hash: string): { view: View; playing: Playing | null } => {
  let m: RegExpMatchArray | null;
  if ((m = hash.match(/^#\/match\/([^/]+)\/play$/))) {
    const match = matchRepository.get(dec(m[1]));
    const stages = match ? matchStages(match) : [];
    return {
      view: { page: 'match', matchId: dec(m[1]) },
      playing: match && stages.length ? { stages, matchName: match.name, matchId: match.id, settings: match.settings } : null,
    };
  }
  if ((m = hash.match(/^#\/match\/([^/]+)\/edit\/(.+)$/))) return { view: { page: 'edit', matchId: dec(m[1]), stageId: dec(m[2]) }, playing: null };
  if ((m = hash.match(/^#\/match\/([^/]+)$/))) return { view: { page: 'match', matchId: dec(m[1]) }, playing: null };
  if ((m = hash.match(/^#\/edit\/(.+)$/))) return { view: { page: 'edit', stageId: dec(m[1]) }, playing: null };
  if ((m = hash.match(/^#\/play\/(.+)$/))) {
    const s = stageRepository.get(dec(m[1]));
    return { view: { page: 'edit', stageId: dec(m[1]) }, playing: s ? { stages: [s] } : null };
  }
  if ((m = hash.match(/^#\/training\/(.+)$/)) && programById(dec(m[1]))) return { view: { page: 'program', programId: dec(m[1]) }, playing: null };
  if (hash === '#/training') return { view: { page: 'training' }, playing: null };
  return { view: { page: 'home' }, playing: null };
};

const toHash = (view: View, playing: Playing | null) => {
  if (playing?.matchId) return `#/match/${enc(playing.matchId)}/play`;
  if (playing) return `#/play/${enc(playing.stages[0].id)}`;
  if (view.page === 'match') return `#/match/${enc(view.matchId)}`;
  if (view.page === 'edit') return view.matchId ? `#/match/${enc(view.matchId)}/edit/${enc(view.stageId)}` : `#/edit/${enc(view.stageId)}`;
  if (view.page === 'training') return '#/training';
  if (view.page === 'program') return `#/training/${enc(view.programId)}`;
  return '#/';
};

export const App = () => {
  const [state, setState] = useState(() => parse(location.hash));
  const { view, playing } = state;
  const editorDirty = useRef(false);

  // keep the address bar in sync (new history entry per page, so browser back works)
  useEffect(() => {
    const target = toHash(view, playing);
    if (location.hash !== target) history.pushState(null, '', target);
  }, [view, playing]);

  useEffect(() => {
    const onPop = () => setState(parse(location.hash));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /** Navigate to another page — asks first when the editor has unsaved changes. */
  const go = useCallback(
    (next: View) => {
      if (view.page === 'edit' && editorDirty.current && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
      editorDirty.current = false;
      setState({ view: next, playing: null });
    },
    [view],
  );

  const play = useCallback((p: Playing) => setState((s) => ({ ...s, playing: { ...p, stages: structuredClone(p.stages) } })), []);
  const playMatch = useCallback(
    (id: string) => {
      const m = matchRepository.get(id);
      const stages = m ? matchStages(m) : [];
      if (m && stages.length) play({ stages, matchName: m.name, matchId: m.id, settings: m.settings });
    },
    [play],
  );
  const playStage = useCallback(
    (id: string) => {
      const s = stageRepository.get(id);
      if (s) play({ stages: [s] });
    },
    [play],
  );

  const match = (view.page === 'match' || view.page === 'edit') && view.matchId ? matchRepository.get(view.matchId) : undefined;

  return (
    <>
      {view.page === 'home' && (
        <HomePage
          onOpenMatch={(id) => go({ page: 'match', matchId: id })}
          onPlayMatch={playMatch}
          onOpenStage={(id) => go({ page: 'edit', stageId: id })}
          onPlayStage={playStage}
          onOpenTraining={() => go({ page: 'training' })}
        />
      )}
      {view.page === 'training' && <TrainingHome onHome={() => go({ page: 'home' })} onOpen={(id) => go({ page: 'program', programId: id })} />}
      {view.page === 'program' && programById(view.programId) && (
        <TrainingRunner key={`program:${view.programId}`} program={programById(view.programId)!} onExit={() => go({ page: 'training' })} />
      )}
      {view.page === 'match' && (
        <MatchPage
          key={`match:${view.matchId}`}
          matchId={view.matchId}
          onHome={() => go({ page: 'home' })}
          onOpenMatch={(id) => go({ page: 'match', matchId: id })}
          onOpenStage={(stageId) => go({ page: 'edit', stageId, matchId: view.matchId })}
          onPlayStage={playStage}
          onPlayMatch={playMatch}
        />
      )}
      {view.page === 'edit' && (
        <StageEditor
          key={`edit:${view.stageId}`}
          initial={stageRepository.get(view.stageId) ?? { ...createStage(), id: view.stageId }}
          hidden={!!playing}
          matchName={match?.name}
          onHome={() => go({ page: 'home' })}
          onBackToMatch={match ? () => go({ page: 'match', matchId: match.id }) : undefined}
          stageNav={(() => {
            const ids = match?.stageIds ?? [];
            const i = ids.indexOf(view.stageId);
            if (!match || i < 0 || ids.length < 2) return undefined;
            const to = (j: number) => () => go({ page: 'edit', stageId: ids[j], matchId: match.id });
            return { index: i, count: ids.length, onPrev: i > 0 ? to(i - 1) : undefined, onNext: i < ids.length - 1 ? to(i + 1) : undefined };
          })()}
          onDirtyChange={(d) => {
            editorDirty.current = d;
          }}
          onPlay={(stages) => play({ stages })}
        />
      )}
      {playing && (
        <TrainingPlayer
          key={`play:${playing.matchId ?? playing.stages[0].id}`}
          stages={playing.stages}
          matchName={playing.matchName}
          matchSettings={playing.settings}
          onExit={() => setState((s) => ({ ...s, playing: null }))}
        />
      )}
    </>
  );
};
