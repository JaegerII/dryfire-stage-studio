import { useRef, useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { createMatch, matchRepository } from '../../data/matchRepository';
import { stageRepository } from '../../data/stageRepository';
import type { Match } from '../../types/match';
import { exportMatchFile, readImportFile, saveImportedMatch } from '../../utils/matchIO';
import { newId } from '../../utils/random';
import { StageFormatError } from '../../utils/stageIO';

interface Props {
  currentStageId: string;
  onOpenStage: (id: string) => void;
  onPlayStage: (id: string) => void;
  onPlayMatch: (matchId: string) => void;
  /** Create a new stage, add it to the match and open it in the editor. */
  onNewStageInMatch: (matchId: string) => void;
  onClose: () => void;
}

const ALL = '__all__';

/**
 * Library: matches as folders (left), the selected folder's stages (right).
 * "All stages" lists every stage, saved or built-in.
 */
export const Library = ({ currentStageId, onOpenStage, onPlayStage, onPlayMatch, onNewStageInMatch, onClose }: Props) => {
  const [, refresh] = useState(0);
  const reload = () => refresh((n) => n + 1);
  const matches = matchRepository.list();
  const stages = stageRepository.list();
  const [folder, setFolder] = useState<string>(() => matches[0]?.id ?? ALL);
  const file = useRef<HTMLInputElement>(null);
  const match = folder === ALL ? undefined : matchRepository.get(folder);
  const listed = matches.find((m) => m.id === folder);

  const saveMatch = (m: Match) => {
    matchRepository.save(m);
    reload();
  };
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name;

  const importFile = async (f: File) => {
    try {
      const res = await readImportFile(f);
      if (res.kind === 'match') {
        const m = saveImportedMatch(res.match, res.stages);
        setFolder(m.id);
      } else {
        stageRepository.save(res.stage);
        setFolder(ALL);
      }
      reload();
    } catch (err) {
      alert(err instanceof StageFormatError ? err.message : 'Import failed.');
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal library-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Library</h2>
          <div className="inline">
            <button onClick={() => file.current?.click()}>Import</button>
            <input
              ref={file}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importFile(f);
                e.target.value = '';
              }}
            />
            <button onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="library-body">
          {/* ------------------------------------------------ folders */}
          <nav className="folders">
            <button className={`folder${folder === ALL ? ' active' : ''}`} onClick={() => setFolder(ALL)}>
              <span className="folder-icon">▤</span>
              <span>All stages</span>
              <em>{stages.length}</em>
            </button>
            <div className="folders-title">Matches</div>
            {matches.map((m) => (
              <button key={m.id} className={`folder${folder === m.id ? ' active' : ''}`} onClick={() => setFolder(m.id)}>
                <span className="folder-icon">▸</span>
                <span>{m.name}</span>
                <em>{m.stageIds.length}</em>
              </button>
            ))}
            <button
              className="folder new"
              onClick={() => {
                const m = matchRepository.save(createMatch());
                setFolder(m.id);
                reload();
              }}
            >
              + New match
            </button>
          </nav>

          {/* ------------------------------------------------ contents */}
          <section className="folder-content">
            {match ? (
              <>
                <div className="match-head">
                  <input className="match-name" value={match.name} onChange={(e) => saveMatch({ ...match, name: e.target.value })} />
                  <button className="primary" disabled={!match.stageIds.length} onClick={() => onPlayMatch(match.id)}>
                    ▶ Play match
                  </button>
                </div>
                <textarea
                  rows={2}
                  placeholder="Description"
                  value={match.description ?? ''}
                  onChange={(e) => saveMatch({ ...match, description: e.target.value })}
                />
                <div className="inline match-actions">
                  <button onClick={() => exportMatchFile(match)}>Export</button>
                  <button
                    onClick={() => {
                      const copy = matchRepository.save({ ...structuredClone(match), id: newId('match'), name: `${match.name} (copy)` });
                      setFolder(copy.id);
                      reload();
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
                          : `Delete the match "${match.name}"? Its stages are kept.`;
                        if (!confirm(msg)) return;
                        matchRepository.remove(match.id);
                        if (!listed?.overridesBuiltIn) setFolder(ALL);
                        reload();
                      }}
                    >
                      {listed?.overridesBuiltIn ? 'Revert' : 'Delete'}
                    </button>
                  )}
                </div>

                <ol className="stage-list match-stages">
                  {match.stageIds.map((id, i) => {
                    const s = stages.find((x) => x.id === id);
                    const move = (d: number) => {
                      const ids = [...match.stageIds];
                      [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
                      saveMatch({ ...match, stageIds: ids });
                    };
                    return (
                      <li key={`${id}-${i}`} className={id === currentStageId ? 'current' : ''}>
                        <span className="order">{i + 1}</span>
                        {s ? <img src={ENVIRONMENTS[s.environment].src} alt="" /> : <span className="missing-thumb" />}
                        <div className="meta">
                          <strong>{s?.name ?? id}</strong>
                          <span>{s ? `par ${s.parTime}s · ${s.repetitions} reps · ${ENVIRONMENTS[s.environment].label}` : 'Stage not found'}</span>
                        </div>
                        <button disabled={i === 0} onClick={() => move(-1)} title="Move up">↑</button>
                        <button disabled={i === match.stageIds.length - 1} onClick={() => move(1)} title="Move down">↓</button>
                        <button disabled={!s} onClick={() => onOpenStage(id)}>Open</button>
                        <button disabled={!s} onClick={() => onPlayStage(id)}>Play</button>
                        <button className="danger" onClick={() => saveMatch({ ...match, stageIds: match.stageIds.filter((_, j) => j !== i) })} title="Remove from match (the stage is kept)">
                          Remove
                        </button>
                      </li>
                    );
                  })}
                  {!match.stageIds.length && <p className="hint">No stages yet — add existing ones or create a new stage.</p>}
                </ol>

                <div className="inline match-add">
                  <select
                    value=""
                    onChange={(e) => e.target.value && saveMatch({ ...match, stageIds: [...match.stageIds, e.target.value] })}
                  >
                    <option value="">+ Add existing stage…</option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <button onClick={() => onNewStageInMatch(match.id)}>+ New stage in this match</button>
                </div>
              </>
            ) : (
              <>
                <div className="match-head">
                  <h3>All stages</h3>
                </div>
                <ul className="stage-list">
                  {stages.map((s) => (
                    <li key={s.id} className={s.id === currentStageId ? 'current' : ''}>
                      <img src={ENVIRONMENTS[s.environment].src} alt="" />
                      <div className="meta">
                        <strong>{s.name}</strong>
                        <span>
                          {s.id} · par {s.parTime}s · {s.repetitions} reps {s.builtIn ? '· built-in' : ''}
                          {matches.filter((m) => m.stageIds.includes(s.id)).map((m) => ` · ${m.name}`).join('')}
                        </span>
                      </div>
                      <select
                        value=""
                        onChange={(e) => {
                          const m = matchRepository.get(e.target.value);
                          if (m) saveMatch({ ...m, stageIds: [...m.stageIds, s.id] });
                        }}
                        title="Add to a match"
                      >
                        <option value="">Add to match…</option>
                        {matches.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <button onClick={() => onOpenStage(s.id)}>Open</button>
                      <button onClick={() => onPlayStage(s.id)}>Play</button>
                      {!s.builtIn && (
                        <button
                          className="danger"
                          onClick={() => {
                            const msg = s.overridesBuiltIn
                              ? `Discard your changes to "${s.name}" and restore the built-in version?`
                              : `Delete "${s.name}" from this browser?`;
                            if (confirm(msg)) {
                              stageRepository.remove(s.id);
                              reload();
                            }
                          }}
                        >
                          {s.overridesBuiltIn ? 'Revert' : 'Delete'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {match && match.stageIds.some((id) => !stageName(id)) && (
              <p className="hint warn">Some stages of this match are missing (deleted or not imported).</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
