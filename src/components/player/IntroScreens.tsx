import topo from '../../assets/brand/topo.svg';
import { ASSETS } from '../../assets/registry';
import type { Stage } from '../../types/stage';
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

/** Title card before each stage: "Stage 2 / 3", name, par, reps. */
export const StageTitleScreen = ({ stage, index, count, matchName }: { stage: Stage; index: number; count: number; matchName?: string }) => {
  const targets = stage.objects.filter((o) => ASSETS[o.type].scoring).length;
  return (
    <div className="screen stage-title-card fade-in">
      {matchName && <div className="eyebrow">{matchName}</div>}
      <div className="title-index">
        Stage {index + 1}
        <span> / {count}</span>
      </div>
      <h1>{stage.name}</h1>
      {stage.description && <p className="title-desc">{stage.description}</p>}
      <div className="title-stats">
        <div><span>Par time</span><b>{stage.parTime.toFixed(1)} s</b></div>
        <div><span>Reps</span><b>{stage.repetitions}</b></div>
        <div><span>Targets</span><b>{targets}</b></div>
      </div>
    </div>
  );
};

export const CompleteScreen = ({ title, detail, onRestart, onExit }: { title: string; detail: string; onRestart: () => void; onExit: () => void }) => (
  <div className="screen complete fade-in">
    <div className="eyebrow go">Session ended</div>
    <h1>{title}</h1>
    <p>{detail}</p>
    <div className="complete-actions">
      <button onClick={onRestart}>Run again</button>
      <button onClick={onExit}>Back</button>
    </div>
  </div>
);
