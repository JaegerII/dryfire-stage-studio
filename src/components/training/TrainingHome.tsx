import { BrandMark } from '../BrandMark';
import { PROGRAMS } from '../../training/programs';
import { describePhase } from '../../training/TrainingPhase';

interface Props {
  onOpen: (id: string) => void;
  onHome: () => void;
}

/** Selection page: PP1 Training / NPA Training. */
export const TrainingHome = ({ onOpen, onHome }: Props) => (
  <div className="page training-home">
    <header className="page-bar">
      <button className="brand brand-btn" onClick={onHome} title="Back to matches">
        <BrandMark height={28} />
        <div>
          <div className="brand-name">DRYFIRE STAGE STUDIO</div>
          <div className="brand-sub">FORTH TRACE</div>
        </div>
      </button>
      <nav className="tabs">
        <button onClick={onHome}>Matches</button>
        <button className="on">Training</button>
      </nav>
    </header>
    <main className="page-body">
      <div className="program-grid">
        {PROGRAMS.map((p) => (
          <button key={p.id} className="program-card" onClick={() => onOpen(p.id)}>
            <span className="eyebrow">{p.discipline}</span>
            <strong>{p.name}</strong>
            <span className="program-desc">{p.description}</span>
            <ol>
              {p.phases.map((ph, i) => (
                <li key={i}>
                  {describePhase(ph)}
                  {ph.type === 'exposure' && (ph.rounds ?? 1) > 1 ? ` · ${ph.rounds} rounds` : ''}
                </li>
              ))}
            </ol>
            <span className="program-go">Open ▶</span>
          </button>
        ))}
      </div>
      <p className="disclaimer">Unofficial dry-fire training simulation. Not affiliated with or endorsed by any shooting association.</p>
    </main>
  </div>
);
