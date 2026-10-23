import { TrainingHome } from './components/training/TrainingHome';
import { TrainingRunner } from './components/training/TrainingRunner';
import { programById } from './training/programs';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { HomePage } from './components/home/HomePage';
import { MatchPage } from './components/match/MatchPage';
import { matchRepository } from './data/matchRepository';
import { stage3dRepository } from './stage3d/repository';
import { matchStages } from './utils/matchUtils';
import { TRACE_TABS, TraceApp, type TraceTab } from './trace/TraceApp';
import { HuntHome } from './hunt/HuntHome';
import { huntRepository, scenarioRepository } from './hunt/repository';

// three.js + the encoder only load when the editor or the player opens
const Editor3D = lazy(() => import('./stage3d/editor/Editor3D').then((m) => ({ default: m.Editor3D })));
const Player3D = lazy(() => import('./stage3d/Player3D').then((m) => ({ default: m.Player3D })));
const HuntEditor = lazy(() => import('./hunt/HuntEditor').then((m) => ({ default: m.HuntEditor })));
const HuntMatchPage = lazy(() => import('./hunt/HuntMatchPage').then((m) => ({ default: m.HuntMatchPage })));
const TvReceiver = lazy(() => import('./trace/tv/TvReceiver').then((m) => ({ default: m.TvReceiver })));

/**
 * Routes (hash based, so the app works from any static host):
 *   #/                          start page: matches (active / archive) + all stages
 *   #/match/<id>                one match: its stages
 *   #/match/<id>/play           play the whole match (logo → safety → stages) / render it to MP4
 *   #/match/<id>/edit/<stage>   edit a stage of that match (breadcrumb back to the match)
 *   #/edit/<stage>              edit a stage on its own
 *   #/play/<stage>              play one stage
 *   #/training                  training programs (PP1 / NPA)
 *   #/training/<program>        run a training program
 *   #/trace[/<tab>]             FORTH TRACE on the phone: training, live tracking, analysis, settings
 *   #/tv[/<room>]               TV renderer that joins a phone's training session
 *   #/hunt                      driven hunts (Drückjagd, ≙ matches) and all their scenarios (≙ stages)
 *   #/hunt/<id>                 one hunt: its scenarios, release, play / render / MP4 of the whole hunt
 *   #/hunt/<id>/edit/<scenario> edit a scenario of that hunt (map, stand, crossings)
 *   #/hunt-scenario/<scenario>  edit a scenario on its own
 * Old links of the 3D beta (#/3d, #/3d/edit/<id>, #/3d/play/<id>) lead to the same pages.
 */
type View =
  | { page: 'home' }
  | { page: 'match'; matchId: string }
  | { page: 'edit'; stageId: string; matchId?: string }
  | { page: 'training' }
  | { page: 'program'; programId: string }
  | { page: 'trace'; tab: TraceTab }
  | { page: 'tv'; room?: string }
  | { page: 'hunts' }
  | { page: 'hunt'; huntId: string }
  | { page: 'huntScenario'; scenarioId: string; huntId?: string };

/** What the player shows on top of the page: one stage, or a whole match. */
type Playing = { kind: 'stage'; id: string } | { kind: 'match'; id: string };

const dec = decodeURIComponent;
const enc = encodeURIComponent;
/** Ids of the 3D beta's copies of built-in stages ("stage_001_3d") are the plain ids now. */
const betaId = (id: string) => (id.endsWith('_3d') && !stage3dRepository.get(id) ? id.slice(0, -3) : id);

const parse = (hash: string): { view: View; playing: Playing | null } => {
  let m: RegExpMatchArray | null;
  if ((m = hash.match(/^#\/match\/([^/]+)\/play$/))) return { view: { page: 'match', matchId: dec(m[1]) }, playing: { kind: 'match', id: dec(m[1]) } };
  if ((m = hash.match(/^#\/match\/([^/]+)\/edit\/(.+)$/))) return { view: { page: 'edit', matchId: dec(m[1]), stageId: dec(m[2]) }, playing: null };
  if ((m = hash.match(/^#\/match\/([^/]+)$/))) return { view: { page: 'match', matchId: dec(m[1]) }, playing: null };
  if ((m = hash.match(/^#\/(?:3d\/)?edit\/(.+)$/))) return { view: { page: 'edit', stageId: betaId(dec(m[1])) }, playing: null };
  if ((m = hash.match(/^#\/(?:3d\/)?play\/(.+)$/))) return { view: { page: 'home' }, playing: { kind: 'stage', id: betaId(dec(m[1])) } };
  if ((m = hash.match(/^#\/training\/(.+)$/)) && programById(dec(m[1]))) return { view: { page: 'program', programId: dec(m[1]) }, playing: null };
  if (hash === '#/training') return { view: { page: 'training' }, playing: null };
  if (hash === '#/hunt') return { view: { page: 'hunts' }, playing: null };
  if ((m = hash.match(/^#\/hunt\/([^/]+)\/edit\/(.+)$/))) return { view: { page: 'huntScenario', huntId: dec(m[1]), scenarioId: dec(m[2]) }, playing: null };
  if ((m = hash.match(/^#\/hunt\/([^/]+)$/))) return { view: { page: 'hunt', huntId: dec(m[1]) }, playing: null };
  if ((m = hash.match(/^#\/hunt-scenario\/(.+)$/))) return { view: { page: 'huntScenario', scenarioId: dec(m[1]) }, playing: null };
  if ((m = hash.match(/^#\/trace(?:\/([a-z]+))?$/))) {
    const tab = (TRACE_TABS as string[]).includes(m[1] ?? '') ? (m[1] as TraceTab) : 'training';
    return { view: { page: 'trace', tab }, playing: null };
  }
  if ((m = hash.match(/^#\/tv(?:\/([A-Za-z0-9]{3,8}))?$/))) return { view: { page: 'tv', room: m[1]?.toUpperCase() }, playing: null };
  return { view: { page: 'home' }, playing: null };
};

const toHash = (view: View, playing: Playing | null) => {
  if (playing?.kind === 'match') return `#/match/${enc(playing.id)}/play`;
  if (playing) return `#/play/${enc(playing.id)}`;
  if (view.page === 'match') return `#/match/${enc(view.matchId)}`;
  if (view.page === 'edit') return view.matchId ? `#/match/${enc(view.matchId)}/edit/${enc(view.stageId)}` : `#/edit/${enc(view.stageId)}`;
  if (view.page === 'training') return '#/training';
  if (view.page === 'program') return `#/training/${enc(view.programId)}`;
  if (view.page === 'trace') return `#/trace/${view.tab}`;
  if (view.page === 'tv') return view.room ? `#/tv/${enc(view.room)}` : '#/tv';
  if (view.page === 'hunts') return '#/hunt';
  if (view.page === 'hunt') return `#/hunt/${enc(view.huntId)}`;
  if (view.page === 'huntScenario') return view.huntId ? `#/hunt/${enc(view.huntId)}/edit/${enc(view.scenarioId)}` : `#/hunt-scenario/${enc(view.scenarioId)}`;
  return '#/';
};

const Loading = () => <div className="page-loading">Loading…</div>;

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
      if ((view.page === 'edit' || view.page === 'huntScenario') && editorDirty.current && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
      editorDirty.current = false;
      setState({ view: next, playing: null });
    },
    [view],
  );
  const play = useCallback((p: Playing) => setState((s) => ({ ...s, playing: p })), []);
  const onDirty = useCallback((d: boolean) => {
    editorDirty.current = d;
  }, []);

  const match = (view.page === 'match' || view.page === 'edit') && view.matchId ? matchRepository.get(view.matchId) : undefined;

  // the player: one stage, or a match with its settings (intro, times, values for all stages)
  let player = null;
  if (playing) {
    const exit = () => setState((s) => ({ ...s, playing: null }));
    const pm = playing.kind === 'match' ? matchRepository.get(playing.id) : undefined;
    const stages = pm ? matchStages(pm) : playing.kind === 'stage' ? [stage3dRepository.get(playing.id)].filter((s) => !!s) : [];
    player = stages.length ? (
      <Suspense fallback={<Loading />}>
        <Player3D key={`${playing.kind}:${playing.id}`} stages={stages as NonNullable<(typeof stages)[number]>[]} matchName={pm?.name} settings={pm?.settings} onExit={exit} />
      </Suspense>
    ) : null;
  }

  return (
    <>
      {view.page === 'home' && (
        <HomePage
          onOpenMatch={(id) => go({ page: 'match', matchId: id })}
          onPlayMatch={(id) => play({ kind: 'match', id })}
          onOpenStage={(id) => go({ page: 'edit', stageId: id })}
          onPlayStage={(id) => play({ kind: 'stage', id })}
          onOpenTraining={() => go({ page: 'training' })}
          onOpenTrace={() => go({ page: 'trace', tab: 'training' })}
          onOpenHunt={() => go({ page: 'hunts' })}
        />
      )}
      {view.page === 'hunts' && (
        <HuntHome
          onHome={() => go({ page: 'home' })}
          onOpenHunt={(id) => go({ page: 'hunt', huntId: id })}
          onOpenScenario={(id) => go({ page: 'huntScenario', scenarioId: id })}
        />
      )}
      {view.page === 'hunt' && (
        <Suspense fallback={<Loading />}>
          <HuntMatchPage
            key={`hunt:${view.huntId}`}
            huntId={view.huntId}
            onHome={() => go({ page: 'hunts' })}
            onOpenHunt={(id) => go({ page: 'hunt', huntId: id })}
            onOpenScenario={(id) => go({ page: 'huntScenario', scenarioId: id, huntId: view.huntId })}
          />
        </Suspense>
      )}
      {view.page === 'huntScenario' && (
        <Suspense fallback={<Loading />}>
          {(() => {
            const sc = scenarioRepository.get(view.scenarioId);
            const hunt = view.huntId ? huntRepository.get(view.huntId) : undefined;
            const back = () => go(hunt ? { page: 'hunt', huntId: hunt.id } : { page: 'hunts' });
            if (!sc)
              return (
                <div className="page">
                  <p className="hint empty">
                    Dieses Szenario gibt es nicht (mehr). <button onClick={back}>Zurück</button>
                  </p>
                </div>
              );
            const ids = hunt?.scenarioIds ?? [];
            const i = ids.indexOf(view.scenarioId);
            const to = (j: number) => () => go({ page: 'huntScenario', scenarioId: ids[j], huntId: hunt!.id });
            return (
              <HuntEditor
                key={`hs:${view.scenarioId}`}
                initial={sc}
                hunt={hunt}
                onExit={back}
                onDirtyChange={onDirty}
                nav={hunt && i >= 0 && ids.length > 1 ? { index: i, count: ids.length, onPrev: i > 0 ? to(i - 1) : undefined, onNext: i < ids.length - 1 ? to(i + 1) : undefined } : undefined}
              />
            );
          })()}
        </Suspense>
      )}
      {view.page === 'trace' && <TraceApp tab={view.tab} onTab={(tab) => go({ page: 'trace', tab })} onStageBuilder={() => go({ page: 'home' })} />}
      {view.page === 'tv' && (
        <Suspense fallback={<Loading />}>
          <TvReceiver room={view.room} onJoin={(room) => go({ page: 'tv', room })} onExit={() => go({ page: 'home' })} />
        </Suspense>
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
          onPlayStage={(id) => play({ kind: 'stage', id })}
          onPlayMatch={(id) => play({ kind: 'match', id })}
        />
      )}
      {view.page === 'edit' && (
        <Suspense fallback={<Loading />}>
          {(() => {
            const s = stage3dRepository.get(view.stageId);
            if (!s)
              return (
                <div className="page">
                  <p className="hint empty">
                    This stage does not exist (any more). <button onClick={() => go(match ? { page: 'match', matchId: match.id } : { page: 'home' })}>Back</button>
                  </p>
                </div>
              );
            const ids = match?.stageIds ?? [];
            const i = ids.indexOf(view.stageId);
            const to = (j: number) => () => go({ page: 'edit', stageId: ids[j], matchId: match!.id });
            return (
              <Editor3D
                key={`edit:${view.stageId}`}
                initial={s}
                matchName={match?.name}
                onExit={() => go(match ? { page: 'match', matchId: match.id } : { page: 'home' })}
                stageNav={match && i >= 0 && ids.length > 1 ? { index: i, count: ids.length, onPrev: i > 0 ? to(i - 1) : undefined, onNext: i < ids.length - 1 ? to(i + 1) : undefined } : undefined}
                onDirtyChange={onDirty}
              />
            );
          })()}
        </Suspense>
      )}
      {player}
    </>
  );
};
