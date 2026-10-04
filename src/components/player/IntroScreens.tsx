import topo from '../../assets/brand/topo.svg';
import { BrandMark } from '../BrandMark';

const RULES = [
  'Remove all live ammunition from the room.',
  'Check chamber and magazine — visually and physically.',
  'Aim only at a safe backstop.',
  'Never load the firearm during a dry-fire session.',
];

/** Shown first: the firearm must be unloaded at all times. */
export const SafetyScreen = () => (
  <div className="screen safety fade-in">
    <div className="eyebrow accent">⚠ Safety First</div>
    <h1>
      Your firearm must be
      <br />
      <em>unloaded</em> at all times.
    </h1>
    <ol>
      {RULES.map((r, i) => (
        <li key={i}>
          <span>0{i + 1}</span>
          {r}
        </li>
      ))}
    </ol>
  </div>
);

/** Black screen with the topo pattern, mark and wordmark. */
export const BrandScreen = () => (
  <div className="screen brand-screen fade-in">
    <div className="topo" style={{ backgroundImage: `url(${topo})` }} />
    <div className="vignette" />
    <div className="brand-center">
      <BrandMark height={0} color="#EDEDE6" />
      <div className="wordmark">FORTH TRACE</div>
      <div className="rule" />
      <div className="tagline">Virtual Dryfire Trainer</div>
    </div>
  </div>
);

export const CompleteScreen = ({ reps, onRestart, onExit }: { reps: number; onRestart: () => void; onExit: () => void }) => (
  <div className="screen complete fade-in">
    <div className="eyebrow go">Session ended</div>
    <h1>Training Complete</h1>
    <p>{reps} repetitions</p>
    <div className="complete-actions">
      <button onClick={onRestart}>Run again</button>
      <button onClick={onExit}>Back to editor</button>
    </div>
  </div>
);
