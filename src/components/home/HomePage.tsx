import { useRef, useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { createMatch, matchRepository } from '../../data/matchRepository';
import type { Match } from '../../types/match';
import { createStage3D, stage3dRepository } from '../../stage3d/repository';
import { ImportError, exportMatchFile, readImportFile, saveImportedMatch } from '../../utils/matchIO';
import { formatLength, matchLength } from '../../utils/matchUtils';
import { BrandMark } from '../BrandMark';

type Tab = 'active' | 'archived' | 'stages';

interface Props {
  onOpenMatch: (id: string) => void;
  onPlayMatch: (id: string) => void;
  onOpenStage: (id: string) => void;
  onPlayStage: (id: string) => void;
  onOpenTraining: () => void;
  onOpenTrace: () => void;
  onOpenHunt: () => void;
}

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '');

/** Start page: all matches as cards (active / archived) plus every stage. */
export const HomePage = ({ onOpenMatch, onPlayMatch, onOpenStage, onPlayStage, onOpenTraining, onOpenTrace, onOpenHunt }: Props) => {
  const [tab, setTab] = useState<Tab>('active');
  const [, refresh] = useState(0);
  const reload = () => refresh((n) => n + 1);
  const file = useRef<HTMLInputElement>(null);
  const matches = matchRepository.list();
  const stages = stage3dRepository.list();
  const shown = matches
    .filter((m) => (tab === 'archived' ? m.archived : !m.archived))
    .sort((a, b) => a.name.localeCompare(b.name));

  const importFile = async (f: File) => {
    try {
      const res = await readImportFile(f);
      if (res.kind === 'match') {
        saveImportedMatch(res.match, res.stages);
        setTab(res.match.archived ? 'archived' : 'active');
      } else {
        stage3dRepository.save(res.stage);
        setTab('stages');
      }
      reload();
    } catch (err) {
      alert(err instanceof ImportError ? err.message : 'Import failed.');
    }
  };

  const archive = (m: Match, archived: boolean) => {
    matchRepository.save({ ...m, archived });
    reload();
  };

  return (
    <div className="page home">
      <header className="page-bar">
        <div className="brand">
          <BrandMark height={28} />
          <div>
            <div className="brand-name">DRYFIRE STAGE STUDIO</div>
            <div className="brand-sub">FORTH TRACE</div>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === 'active' ? 'on' : ''} onClick={() => setTab('active')}>
            Matches <em>{matches.filter((m) => !m.archived).length}</em>
          </button>
          <button className={tab === 'archived' ? 'on' : ''} onClick={() => setTab('archived')}>
            Archive <em>{matches.filter((m) => m.archived).length}</em>
          </button>
          <button className={tab === 'stages' ? 'on' : ''} onClick={() => setTab('stages')}>
            All stages <em>{stages.length}</em>
          </button>
          <button onClick={onOpenTraining}>Training</button>
          <button onClick={onOpenTrace}>Trace · Tracking</button>
          <button onClick={onOpenHunt}>Drückjagd</button>
        </nav>
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
          {tab === 'stages' ? (
            <button
              className="primary"
              onClick={() => {
                const s = stage3dRepository.save(createStage3D());
                onOpenStage(s.id);
              }}
            >
              + New stage
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => {
                const m = matchRepository.save(createMatch());
                onOpenMatch(m.id);
              }}
            >
              + New match
            </button>
          )}
        </div>
      </header>

      <main className="page-body">
        {tab !== 'stages' ? (
          <div className="match-grid">
            {shown.map((m) => {
              const first = stages.find((s) => s.id === m.stageIds[0]);
              return (
                <article key={m.id} className={`match-card${m.archived ? ' archived' : ''}`}>
                  <button className="card-main" onClick={() => onOpenMatch(m.id)} title="Open match">
                    <div className="card-thumb" style={first ? { backgroundImage: `url(${ENVIRONMENTS[first.environment].src})` } : undefined}>
                      {m.archived && <span className="badge archived">Archived</span>}
                    </div>
                    <div className="card-text">
                      <strong>{m.name}</strong>
                      <span>
                        {m.stageIds.length} stages · ≈ {formatLength(matchLength(m))} min
                        {m.meta?.updatedAt ? ` · ${date(m.meta.updatedAt)}` : m.builtIn ? ' · built-in' : ''}
                      </span>
                    </div>
                  </button>
                  <div className="card-actions">
                    <button className="primary" disabled={!m.stageIds.length} onClick={() => onPlayMatch(m.id)}>
                      ▶ Play
                    </button>
                    <button onClick={() => archive(m, !m.archived)}>{m.archived ? 'Restore' : 'Archive'}</button>
                    <button onClick={() => exportMatchFile(m)}>Export</button>
                  </div>
                </article>
              );
            })}
            {!shown.length && (
              <p className="hint empty">{tab === 'archived' ? 'No archived matches.' : 'No matches yet — create one with “+ New match”.'}</p>
            )}
          </div>
        ) : (
          <ul className="stage-list">
            {stages.map((s) => (
              <li key={s.id}>
                <img src={ENVIRONMENTS[s.environment].src} alt="" />
                <div className="meta">
                  <strong>{s.name}</strong>
                  <span>
                    par {s.par.toFixed(1)} s · {s.repetitions} reps · {s.positions} position{s.positions > 1 ? 's' : ''} · {ENVIRONMENTS[s.environment].label}
                    {s.builtIn ? ' · built-in' : ''}
                    {matches.filter((m) => m.stageIds.includes(s.id)).map((m) => ` · ${m.name}`).join('')}
                  </span>
                </div>
                <button onClick={() => onOpenStage(s.id)}>Open</button>
                <button onClick={() => onPlayStage(s.id)}>Play</button>
                {!s.builtIn && (
                  <button
                    className="danger"
                    onClick={() => {
                      const msg = s.overridesBuiltIn ? `Discard your changes to "${s.name}" and restore the built-in version?` : `Delete "${s.name}" from this browser?`;
                      if (confirm(msg)) {
                        stage3dRepository.remove(s.id);
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
        )}
      </main>
    </div>
  );
};
