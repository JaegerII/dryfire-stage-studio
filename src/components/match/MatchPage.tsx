import { useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { matchRepository } from '../../data/matchRepository';
import { stageRepository } from '../../data/stageRepository';
import type { Match } from '../../types/match';
import { exportMatchFile } from '../../utils/matchIO';
import { formatLength, matchIntro, matchLength } from '../../utils/matchUtils';
import { MatchSettingsPanel } from './MatchSettingsPanel';
import { newId } from '../../utils/random';
import { createStage } from '../../utils/stageIO';
import { BrandMark } from '../BrandMark';

interface Props {
  matchId: string;
  onHome: () => void;
  onOpenMatch: (id: string) => void;
  onOpenStage: (stageId: string) => void;
  onPlayStage: (stageId: string) => void;
  onPlayMatch: (id: string) => void;
}

/** One match: its stages in play order and match-level actions. */
export const MatchPage = ({ matchId, onHome, onOpenMatch, onOpenStage, onPlayStage, onPlayMatch }: Props) => {
  const [, refresh] = useState(0);
  const reload = () => refresh((n) => n + 1);
  const match = matchRepository.get(matchId);
  const listed = matchRepository.list().find((m) => m.id === matchId);
  const stages = stageRepository.list();

  if (!match) {
    return (
      <div className="page">
        <p className="hint empty">
          Match not found. <button onClick={onHome}>Back to matches</button>
        </p>
      </div>
    );
  }

  const save = (m: Match) => {
    matchRepository.save(m);
    reload();
  };
  return (
    <div className="page match-page">
      <header className="page-bar">
        <button className="brand linkish" onClick={onHome} title="All matches">
          <BrandMark height={28} />
        </button>
        <div className="crumbs">
          <button className="linkish" onClick={onHome}>Matches</button>
          <span>/</span>
          <strong>{match.name}</strong>
          {match.archived && <span className="badge archived">Archived</span>}
        </div>
        <div className="inline">
          <button onClick={() => save({ ...match, archived: !match.archived })}>{match.archived ? 'Restore' : 'Archive'}</button>
          <button onClick={() => exportMatchFile(match)}>Export</button>
          <button
            onClick={() => {
              const copy = matchRepository.save({ ...structuredClone(match), id: newId('match'), name: `${match.name} (copy)`, archived: false });
              onOpenMatch(copy.id);
            }}
          >
            Duplicate
          </button>
          {!listed?.builtIn && (
            <button
              className="danger"
              onClick={() => {
                const msg = listed?.overridesBuiltIn
                  ? `Discard your changes to "${match.name}" and restore the built-in version?`
                  : `Delete the match "${match.name}"? Its stages are kept (see "All stages").`;
                if (!confirm(msg)) return;
                matchRepository.remove(match.id);
                if (listed?.overridesBuiltIn) reload();
                else onHome();
              }}
            >
              {listed?.overridesBuiltIn ? 'Revert' : 'Delete'}
            </button>
          )}
          <button className="primary" disabled={!match.stageIds.length} onClick={() => onPlayMatch(match.id)}>
            ▶ Play match
          </button>
        </div>
      </header>

      <main className="page-body">
        <section>
          <input className="match-name" value={match.name} onChange={(e) => save({ ...match, name: e.target.value })} />
          <textarea rows={2} placeholder="Description" value={match.description ?? ''} onChange={(e) => save({ ...match, description: e.target.value })} />
          <div className="hint">
            {match.stageIds.length} stages · ≈ {formatLength(matchLength(match))} min{matchIntro(match) ? ' with logo + safety intro' : ''}
          </div>

          <MatchSettingsPanel
            match={match}
            stages={match.stageIds.map((id) => stageRepository.get(id)).filter((x): x is NonNullable<typeof x> => !!x)}
            onChange={(settings) => save({ ...match, settings: Object.keys(settings).length ? settings : undefined })}
          />

          <ol className="stage-list match-stages">
            {match.stageIds.map((id, i) => {
              const stored = stages.find((x) => x.id === id);
              // what the match actually plays (its "for all stages" repetitions applied)
              const s = stored && { ...stored, repetitions: match.settings?.overrides?.repetitions ?? stored.repetitions };
              const move = (d: number) => {
                const ids = [...match.stageIds];
                [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
                save({ ...match, stageIds: ids });
              };
              return (
                <li key={`${id}-${i}`}>
                  <span className="order">{i + 1}</span>
                  {s ? <img src={ENVIRONMENTS[s.environment].src} alt="" /> : <span className="missing-thumb" />}
                  <button className="meta linkish" disabled={!s} onClick={() => onOpenStage(id)} title="Edit stage">
                    <strong>{s?.name ?? id}</strong>
                    <span>{s ? `par ${s.parTime}s · ${s.repetitions} reps · ${ENVIRONMENTS[s.environment].label}` : 'Stage not found'}</span>
                  </button>
                  <button disabled={i === 0} onClick={() => move(-1)} title="Move up">↑</button>
                  <button disabled={i === match.stageIds.length - 1} onClick={() => move(1)} title="Move down">↓</button>
                  <button disabled={!s} onClick={() => onOpenStage(id)}>Edit</button>
                  <button disabled={!s} onClick={() => onPlayStage(id)}>Play</button>
                  <button className="danger" onClick={() => save({ ...match, stageIds: match.stageIds.filter((_, j) => j !== i) })} title="Remove from match (the stage is kept)">
                    Remove
                  </button>
                </li>
              );
            })}
            {!match.stageIds.length && <p className="hint">No stages yet — create a new one or add existing stages.</p>}
          </ol>

          <div className="inline match-add">
            <button
              className="primary"
              onClick={() => {
                const s = stageRepository.save({ ...createStage(), name: `Stage ${match.stageIds.length + 1}` });
                matchRepository.save({ ...match, stageIds: [...match.stageIds, s.id] });
                onOpenStage(s.id);
              }}
            >
              + New stage
            </button>
            <select value="" onChange={(e) => e.target.value && save({ ...match, stageIds: [...match.stageIds, e.target.value] })}>
              <option value="">+ Add existing stage…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id})
                </option>
              ))}
            </select>
          </div>
        </section>

      </main>
    </div>
  );
};
