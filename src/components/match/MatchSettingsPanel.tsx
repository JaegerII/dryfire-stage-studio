import type { Match, MatchSettings, MatchStageOverrides } from '../../types/match';
import type { Stage } from '../../types/stage';
import { MATCH_TIMING, type MatchTiming } from '../../utils/matchSchedule';
import { NumberField } from '../editor/fields';

interface Props {
  match: Match;
  /** The match's stages as stored (for sensible starting values of the overrides). */
  stages: Stage[];
  onChange: (settings: MatchSettings) => void;
}

const TIMES: { key: keyof MatchTiming; label: string; hint: string }[] = [
  { key: 'brand', label: 'Logo screen', hint: 'FORTH TRACE logo at the start (0 = skip)' },
  { key: 'safety', label: 'Safety screen', hint: 'Safety instructions after the logo (0 = skip)' },
  { key: 'title', label: 'Stage title card', hint: '"Stage 2 / 3" card before every stage — the break between two stages (0 = none)' },
  { key: 'lead', label: 'Make Ready lead-in', hint: 'Camera push-in into the stage before the first standby' },
];

/**
 * Match-wide settings: intro, the times between the stages, and values that apply to
 * every stage of this match (unchecked = each stage keeps its own value).
 */
export const MatchSettingsPanel = ({ match, stages, onChange }: Props) => {
  const st = match.settings ?? {};
  const timing = st.timing ?? {};
  const ov = st.overrides ?? {};
  const first = stages[0];
  const set = (patch: Partial<MatchSettings>) => onChange({ ...st, ...patch });
  const setTime = (key: keyof MatchTiming, v: number) => set({ timing: { ...timing, [key]: v } });
  const setOv = (patch: Partial<MatchStageOverrides>) => {
    const next = { ...ov, ...patch };
    (Object.keys(next) as (keyof MatchStageOverrides)[]).forEach((k) => next[k] === undefined && delete next[k]);
    set({ overrides: Object.keys(next).length ? next : undefined });
  };
  const changed = Object.keys(timing).length > 0 || st.intro === false || Object.keys(ov).length > 0;

  return (
    <details className="match-settings" open>
      <summary>
        Match settings <span className="hint">intro, times between the stages, values for all stages</span>
      </summary>
      <div className="ms-grid">
        <div className="ms-col">
          <h4>Intro &amp; timing</h4>
          <label className="ms-row">
            <span>Logo + safety intro</span>
            <input type="checkbox" checked={st.intro ?? true} onChange={(e) => set({ intro: e.target.checked ? undefined : false })} />
          </label>
          {TIMES.map((f) => (
            <label key={f.key} className="ms-row" title={f.hint}>
              <span>
                {f.label} <small>(default {MATCH_TIMING[f.key]} s)</small>
              </span>
              <span className="ms-field">
                <NumberField value={timing[f.key] ?? MATCH_TIMING[f.key]} min={0} max={60} step={0.5} digits={1} onChange={(v) => setTime(f.key, v)} /> s
              </span>
            </label>
          ))}
        </div>
        <div className="ms-col">
          <h4>For all stages</h4>
          <p className="hint">Checked values replace the value of every stage in this match.</p>
          <label className="ms-row">
            <span>
              <input type="checkbox" checked={ov.resetTime !== undefined} onChange={(e) => setOv({ resetTime: e.target.checked ? (first?.resetTime ?? 4) : undefined })} /> Reset time
            </span>
            <span className="ms-field">
              <NumberField value={ov.resetTime ?? first?.resetTime ?? 4} min={0} max={60} step={0.5} digits={1} disabled={ov.resetTime === undefined} onChange={(v) => setOv({ resetTime: v })} /> s
            </span>
          </label>
          <label className="ms-row">
            <span>
              <input type="checkbox" checked={ov.repetitions !== undefined} onChange={(e) => setOv({ repetitions: e.target.checked ? (first?.repetitions ?? 6) : undefined })} /> Repetitions
            </span>
            <span className="ms-field">
              <NumberField value={ov.repetitions ?? first?.repetitions ?? 6} min={1} max={100} step={1} digits={0} disabled={ov.repetitions === undefined} onChange={(v) => setOv({ repetitions: Math.round(v) })} />
            </span>
          </label>
          <label className="ms-row">
            <span>
              <input
                type="checkbox"
                checked={!!ov.standbyDelay}
                onChange={(e) => setOv({ standbyDelay: e.target.checked ? { ...(first?.standbyDelay ?? { min: 1, max: 3 }) } : undefined })}
              />{' '}
              Standby delay
            </span>
            <span className="ms-field">
              <NumberField
                value={ov.standbyDelay?.min ?? first?.standbyDelay.min ?? 1}
                min={0}
                max={10}
                step={0.1}
                digits={1}
                disabled={!ov.standbyDelay}
                onChange={(min) => setOv({ standbyDelay: { min, max: Math.max(min, ov.standbyDelay?.max ?? min) } })}
              />
              –
              <NumberField
                value={ov.standbyDelay?.max ?? first?.standbyDelay.max ?? 3}
                min={0}
                max={10}
                step={0.1}
                digits={1}
                disabled={!ov.standbyDelay}
                onChange={(max) => setOv({ standbyDelay: { min: Math.min(max, ov.standbyDelay?.min ?? max), max } })}
              />{' '}
              s
            </span>
          </label>
        </div>
      </div>
      <div className="ms-actions">
        <button disabled={!changed} onClick={() => onChange({})}>
          Reset to defaults
        </button>
      </div>
    </details>
  );
};
