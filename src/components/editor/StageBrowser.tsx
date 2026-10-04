import { useState } from 'react';
import { ENVIRONMENTS } from '../../assets/environments';
import { stageRepository } from '../../data/stageRepository';

interface Props {
  currentId: string;
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  onClose: () => void;
}

/** Modal list of saved + built-in stages. */
export const StageBrowser = ({ currentId, onOpen, onPlay, onClose }: Props) => {
  const [, refresh] = useState(0);
  const stages = stageRepository.list();
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Stages</h2>
          <button onClick={onClose}>Close</button>
        </header>
        <ul className="stage-list">
          {stages.map((s) => (
            <li key={s.id} className={s.id === currentId ? 'current' : ''}>
              <img src={ENVIRONMENTS[s.environment].src} alt="" />
              <div className="meta">
                <strong>{s.name}</strong>
                <span>
                  {s.id} · {ENVIRONMENTS[s.environment].label} · par {s.parTime}s · {s.repetitions} reps {s.builtIn ? '· built-in' : ''}
                </span>
              </div>
              <button onClick={() => onOpen(s.id)}>Open</button>
              <button onClick={() => onPlay(s.id)}>Play</button>
              {!s.builtIn && (
                <button
                  className="danger"
                  onClick={() => {
                    const msg = s.overridesBuiltIn ? `Discard your changes to "${s.name}" and restore the built-in version?` : `Delete "${s.name}" from this browser?`;
                    if (confirm(msg)) {
                      stageRepository.remove(s.id);
                      refresh((n) => n + 1);
                    }
                  }}
                >
                  {s.overridesBuiltIn ? 'Revert' : 'Delete'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
