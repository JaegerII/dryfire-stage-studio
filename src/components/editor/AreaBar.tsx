import type { AreaTransition, Stage } from '../../types/stage';
import { DEFAULT_AREA_TIME, areaCount, transitionOf } from '../../utils/areas';
import { NumberField } from './fields';

interface Props {
  stage: Stage;
  /** Area being edited (0 = area 1). */
  active: number;
  onSelect: (k: number) => void;
  onAdd: () => void;
  onRemove: (k: number) => void;
  onTime: (k: number, seconds: number) => void;
  onTransition: (t: AreaTransition) => void;
}

/**
 * Dynamic stages: switch between the areas of a stage, set how long each is
 * shown and how the barrier moves between them (the reload window).
 */
export const AreaBar = ({ stage, active, onSelect, onAdd, onRemove, onTime, onTransition }: Props) => {
  const n = areaCount(stage);
  const time = (k: number) => (k === 0 ? (stage.areaTime ?? DEFAULT_AREA_TIME) : stage.areas![k - 1].time);
  const tr = transitionOf(stage);
  return (
    <div className="area-bar">
      <div className="area-tabs">
        {Array.from({ length: n }, (_, k) => (
          <button key={k} className={k === active ? 'on' : ''} onClick={() => onSelect(k)} title={n > 1 ? `Shown ${time(k)} s` : undefined}>
            Area {k + 1}
            {n > 1 && <em>{time(k)} s</em>}
          </button>
        ))}
        <button onClick={onAdd} title="Add an area: after a barrier sweeps across the screen the shooter is at a new position with new targets">
          + Area
        </button>
      </div>
      {n > 1 && (
        <div className="area-opts">
          <label>
            Area {active + 1} shown
            <NumberField value={time(active)} min={0.5} max={60} step={0.5} digits={1} onChange={(v) => onTime(active, v)} />s
          </label>
          <label title="Time the barrier needs to cross the screen — the shooter reloads / moves in this window">
            Move + reload
            <NumberField value={tr.duration} min={0.8} max={10} step={0.1} digits={1} onChange={(duration) => onTransition({ ...tr, duration })} />s
          </label>
          <label>
            Barrier
            <select value={tr.style} onChange={(e) => onTransition({ ...tr, style: e.target.value as AreaTransition['style'] })}>
              <option value="mesh">Mesh wall</option>
              <option value="wood">Wood wall</option>
            </select>
          </label>
          <label>
            Direction
            <select value={tr.direction} onChange={(e) => onTransition({ ...tr, direction: e.target.value as AreaTransition['direction'] })}>
              <option value="ltr">Left → right</option>
              <option value="rtl">Right → left</option>
            </select>
          </label>
          {active > 0 && (
            <button className="danger" onClick={() => confirm(`Delete area ${active + 1} and its objects?`) && onRemove(active)}>
              Delete area
            </button>
          )}
          <span className="area-par">Par {stage.parTime.toFixed(1)} s</span>
        </div>
      )}
    </div>
  );
};
