import { useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { fmtTime } from './HuntPlan';
import { MAPS, standThumb } from './maps';
import { huntProgram } from './program';
import { createHunt, createScenario, huntRepository, huntScenarios, scenarioRepository } from './repository';

type Tab = 'hunts' | 'archived' | 'scenarios';

/** Driven hunts (≙ matches) as cards, plus every scenario (≙ stage) — like the studio's start page. */
export const HuntHome = ({ onHome, onOpenHunt, onOpenScenario }: { onHome: () => void; onOpenHunt: (id: string) => void; onOpenScenario: (id: string) => void }) => {
  const [tab, setTab] = useState<Tab>('hunts');
  const [, refresh] = useState(0);
  const hunts = huntRepository.list();
  const shown = hunts.filter((h) => (tab === 'archived' ? h.archived : !h.archived));
  const scenarios = scenarioRepository.list();
  return (
    <div className="page home">
      <header className="page-bar">
        <button className="brand linkish" onClick={onHome} title="Zum Studio">
          <BrandMark height={28} />
          <div>
            <div className="brand-name">DRÜCKJAGD</div>
            <div className="brand-sub">FORTH TRACE · DRYFIRE</div>
          </div>
        </button>
        <nav className="tabs">
          <button className={tab === 'hunts' ? 'on' : ''} onClick={() => setTab('hunts')}>
            Drückjagden <em>{hunts.filter((h) => !h.archived).length}</em>
          </button>
          <button className={tab === 'archived' ? 'on' : ''} onClick={() => setTab('archived')}>
            Archiv <em>{hunts.filter((h) => h.archived).length}</em>
          </button>
          <button className={tab === 'scenarios' ? 'on' : ''} onClick={() => setTab('scenarios')}>
            Alle Szenarien <em>{scenarios.length}</em>
          </button>
          <button onClick={onHome}>IPSC-Studio</button>
        </nav>
        <div className="inline">
          {tab === 'scenarios' ? (
            <button className="primary" onClick={() => onOpenScenario(scenarioRepository.save(createScenario()).id)}>
              + Neues Szenario
            </button>
          ) : (
            <button className="primary" onClick={() => onOpenHunt(huntRepository.save(createHunt()).id)}>
              + Neue Drückjagd
            </button>
          )}
        </div>
      </header>
      <main className="page-body">
        {tab !== 'scenarios' ? (
          <div className="match-grid">
            {shown.map((h) => {
              const list = huntScenarios(h);
              const first = list[0];
              const p = huntProgram({ name: h.name, scenarios: list, isHunt: true }, '16x9');
              return (
                <article key={h.id} className={`match-card${h.archived ? ' archived' : ''}`}>
                  <button className="card-main" onClick={() => onOpenHunt(h.id)} title="Drückjagd öffnen">
                    <div className="card-thumb" style={first ? { backgroundImage: `url(${standThumb(first.map, first.stand)})` } : undefined} />
                    <div className="card-text">
                      <strong>{h.name}</strong>
                      <span>
                        {list.length} Szenarien · {[...new Set(list.map((s) => MAPS[s.map].short))].join(', ') || 'leer'} · Video ≈ {fmtTime(p.end)}
                        {h.builtIn ? ' · Beispiel' : ''}
                      </span>
                    </div>
                  </button>
                  <div className="card-actions">
                    <button className="primary" onClick={() => onOpenHunt(h.id)}>Öffnen</button>
                    <button
                      onClick={() => {
                        huntRepository.save({ ...h, archived: !h.archived });
                        refresh((n) => n + 1);
                      }}
                    >
                      {h.archived ? 'Wiederherstellen' : 'Archivieren'}
                    </button>
                  </div>
                </article>
              );
            })}
            {!shown.length && <p className="hint empty">{tab === 'archived' ? 'Keine archivierten Drückjagden.' : 'Noch keine Drückjagd – mit „+ Neue Drückjagd“ anlegen.'}</p>}
          </div>
        ) : (
          <ul className="stage-list hunt-scenarios">
            {scenarios.map((s) => (
              <li key={s.id}>
                <img className="hs-thumb" src={standThumb(s.map, s.stand)} alt="" />
                <button className="card-main" onClick={() => onOpenScenario(s.id)}>
                  <strong>{s.name}</strong>
                  <span>
                    {MAPS[s.map].label} · Stand {s.stand + 1} · {s.crossings.length} Anläufe{s.builtIn ? ' · Beispiel' : ''}
                  </span>
                </button>
                <div className="inline">
                  <button className="primary" onClick={() => onOpenScenario(s.id)}>Öffnen</button>
                  {!s.builtIn && (
                    <button
                      onClick={() => {
                        if (!confirm(`„${s.name}“ löschen?`)) return;
                        scenarioRepository.remove(s.id);
                        refresh((n) => n + 1);
                      }}
                    >
                      Löschen
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
};
