import { useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { fmtTime } from './HuntPlan';
import { huntProgram } from './program';
import { createHunt, huntRepository } from './repository';
import { describe } from './rules';
import { LANES } from './types';

/** Driven-hunt scenarios: open, create, delete. */
export const HuntHome = ({ onHome, onOpen }: { onHome: () => void; onOpen: (id: string) => void }) => {
  const [, refresh] = useState(0);
  const list = huntRepository.list();
  return (
    <div className="page">
      <header className="page-bar">
        <button className="brand linkish" onClick={onHome} title="Zum Studio">
          <BrandMark height={28} />
          <div>
            <div className="brand-name">DRÜCKJAGD</div>
            <div className="brand-sub">FORTH TRACE · DRYFIRE</div>
          </div>
        </button>
        <div className="inline">
          <button onClick={onHome}>Zurück</button>
          <button
            className="primary"
            onClick={() => {
              const s = huntRepository.save(createHunt());
              onOpen(s.id);
            }}
          >
            + Neue Drückjagd
          </button>
        </div>
      </header>
      <main className="page-body">
        <ul className="stage-list hunt-scenarios">
          {list.map((s) => (
            <li key={s.id}>
              <button className="card-main" onClick={() => onOpen(s.id)}>
                <strong>{s.name}</strong>
                <span>
                  {LANES[s.lane]} · {s.crossings.length} Anläufe · Video ≈ {fmtTime(huntProgram(s, '16x9').end)}
                  {huntRepository.isBuiltIn(s.id) ? ' · Beispiel' : ''}
                </span>
                <span className="hint">{s.crossings.map((c) => describe(c.animals)).join(' · ')}</span>
              </button>
              <div className="inline">
                <button className="primary" onClick={() => onOpen(s.id)}>Öffnen</button>
                {!huntRepository.isBuiltIn(s.id) && (
                  <button
                    onClick={() => {
                      if (!confirm(`„${s.name}“ löschen?`)) return;
                      huntRepository.remove(s.id);
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
      </main>
    </div>
  );
};
