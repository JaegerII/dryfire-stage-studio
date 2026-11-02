import { ASSETS } from '../../assets/registry';
import { useEffect, useState } from 'react';
import { NumberField, Row, SliderField } from '../../components/fields';
import { MotionFields } from './MotionFields';
import { STANDBY_VOICE_LEAD } from '../../utils/audioEngine';
import { EYE_HEIGHT, buildVideoTimeline } from '../timeline';
import { type ParLadder, type Stage3D, parTime3D, shakeOf } from '../types';
import { type Selection, groupObjects, patchLeg, patchObjects, patchPosition, ungroupObjects } from './ops';

interface Props {
  stage: Stage3D;
  selection: Selection;
  onUpdate: (fn: (s: Stage3D) => Stage3D) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

/** Eye heights for the stance select. */
const STANCES: [number, string][] = [
  [EYE_HEIGHT, 'Standing'],
  [1.25, 'Crouched'],
  [1.0, 'Kneeling'],
  [0.35, 'Prone'],
];

/** A ladder from its first par, the step down per level and the number of levels. */
export const makeLadder = (from: number, step: number, levels: number, repsPerLevel: number): ParLadder => ({
  pars: Array.from({ length: Math.max(1, Math.round(levels)) }, (_, i) => Math.max(0.2, +(from - i * step).toFixed(2))),
  repsPerLevel: Math.max(1, Math.round(repsPerLevel)),
});

/** The par times of a ladder as text ("2.00, 1.80, 1.60"), applied on Enter / leaving the field. */
const ParList = ({ pars, onChange }: { pars: number[]; onChange: (pars: number[]) => void }) => {
  const text = pars.map((p) => p.toFixed(2)).join(', ');
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const apply = () => {
    const next = draft.split(/[,;s]+/).map((v) => parseFloat(v.replace(',', '.'))).filter((v) => v > 0).map((v) => Math.max(0.2, +v.toFixed(2)));
    if (next.length) onChange(next);
    else setDraft(text);
  };
  return <input value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Right panel: exact values of the selection, or the stage settings when nothing is selected. */
export const Properties3D = ({ stage, selection, onUpdate, onDelete, onDuplicate }: Props) => {
  if (selection?.kind === 'objects' && selection.ids.length) {
    const objs = stage.objects.filter((o) => selection.ids.includes(o.id));
    const o = objs[0];
    if (!o) return null;
    const set = (patch: Partial<typeof o>) => onUpdate((s) => patchObjects(s, selection.ids, () => patch));
    // the whole selection is exactly one group
    const grouped = !!o.group && objs.every((x) => x.group === o.group) && stage.objects.filter((x) => x.group === o.group).length === objs.length;
    return (
      <aside className="panel properties p3d-props">
        <div className="panel-head">
          <img src={ASSETS[o.type].src} alt="" />
          <div>
            <div className="eyebrow">{objs.length > 1 ? `${objs.length} objects` : 'Object'}</div>
            <strong>{objs.length > 1 ? 'Multiple' : ASSETS[o.type].label}</strong>
          </div>
        </div>
        {objs.length === 1 && (
          <>
            <Row label="Across (m)" hint="Meters right of the range centre line"><NumberField value={o.x} step={0.05} digits={2} onChange={(x) => set({ x })} /></Row>
            <Row label="Downrange (m)"><NumberField value={o.d} step={0.05} digits={2} onChange={(d) => set({ d })} /></Row>
          </>
        )}
        <Row label="Turn (°)" hint="Clockwise seen from above. Q / E turn by 15° (Shift: 5°)"><NumberField value={o.yaw ?? 0} step={5} digits={1} onChange={(yaw) => set({ yaw })} /></Row>
        <Row label="Tilt (°)" hint="Lean forward (+, top away from the shooter) or back (−)"><NumberField value={o.tilt ?? 0} min={-90} max={90} step={5} digits={1} onChange={(tilt) => set({ tilt: tilt || undefined })} /></Row>
        <Row label="Lean sideways (°)" hint="+ = top to the right, − = to the left"><NumberField value={o.roll ?? 0} min={-90} max={90} step={5} digits={1} onChange={(roll) => set({ roll: roll || undefined })} /></Row>
        <Row label="Elevation (m)" hint="Height above the floor — e.g. 0.6 for a card on a box"><NumberField value={o.elevation ?? 0} min={0} max={3} step={0.05} digits={2} onChange={(e) => set({ elevation: e || undefined })} /></Row>
        <Row label="Scale"><NumberField value={o.scale ?? 1} min={0.3} max={3} step={0.05} digits={2} onChange={(sc) => set({ scale: sc === 1 ? undefined : sc })} /></Row>
        <Row label="Mirror"><input type="checkbox" checked={!!o.flip} onChange={(e) => set({ flip: e.target.checked || undefined })} /></Row>
        <Row label="Up from (s)" hint="Only up during part of the run, seconds after the start beep (e.g. the areas of a dynamic stage). Untick = from the beep.">
          <input type="checkbox" checked={o.shown?.from !== undefined} onChange={(e) => set({ shown: window_(o.shown, { from: e.target.checked ? 0 : undefined }) })} />
          {o.shown?.from !== undefined && <NumberField value={o.shown.from} min={0} max={120} step={0.25} digits={2} onChange={(from) => set({ shown: window_(o.shown, { from }) })} />}
        </Row>
        <Row label="Down at (s)" hint="Goes down this many seconds after the start beep. Untick = up until the end.">
          <input type="checkbox" checked={o.shown?.until !== undefined} onChange={(e) => set({ shown: window_(o.shown, { until: e.target.checked ? parTime3D(stage) : undefined }) })} />
          {o.shown?.until !== undefined && <NumberField value={o.shown.until} min={0} max={120} step={0.25} digits={2} onChange={(until) => set({ shown: window_(o.shown, { until }) })} />}
        </Row>
        <Row label="Briefing note" hint="Red pen circle around it in the briefing, with this text — e.g. where the first shot goes for an activator">
          <input type="checkbox" checked={o.note !== undefined} onChange={(e) => set({ note: e.target.checked ? 'FIRST SHOT' : undefined })} />
          {o.note !== undefined && (
            <input list="p3d-note-presets" value={o.note} placeholder="FIRST SHOT" onChange={(e) => set({ note: e.target.value })} />
          )}
          <datalist id="p3d-note-presets">
            {NOTE_PRESETS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Row>
        <div className="actions">
          <button onClick={onDuplicate}>Duplicate</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
        <div className="actions" style={{ marginTop: 6 }}>
          {objs.length > 1 && !grouped && (
            <button onClick={() => onUpdate((s) => groupObjects(s, selection.ids))} title="Ctrl+G — one click then selects all of them">Group</button>
          )}
          {objs.some((x) => x.group) && (
            <button onClick={() => onUpdate((s) => ungroupObjects(s, selection.ids))} title="Ctrl+Shift+G">Ungroup</button>
          )}
        </div>
        {objs.length === 1 && (
          <MotionFields object={o} objects={stage.objects} parTime={parTime3D(stage)} onMotion={(motion) => set({ motion })} />
        )}
        <p className="hint">
          Drag to move · drag on the floor selects several · round handle turns · Q / E turn · arrows nudge (Shift: 0.5 m) · Ctrl+G group · Del deletes · Ctrl+D duplicates
        </p>
      </aside>
    );
  }

  if (selection?.kind === 'position') {
    const i = selection.index;
    const p = stage.positions[i];
    if (!p) return null;
    const set = (patch: Partial<typeof p>) => onUpdate((s) => patchPosition(s, i, patch));
    return (
      <aside className="panel properties p3d-props">
        <div className="eyebrow">Shooting position {i + 1} / {stage.positions.length}</div>
        <h3>{p.label}</h3>
        <Row label="Label"><input value={p.label ?? ''} onChange={(e) => set({ label: e.target.value })} /></Row>
        <Row label="Across (m)"><NumberField value={p.x} step={0.05} digits={2} onChange={(x) => set({ x })} /></Row>
        <Row label="Downrange (m)"><NumberField value={p.d} step={0.05} digits={2} onChange={(d) => set({ d })} /></Row>
        <Row label="Looks (°)" hint="0 = straight downrange, + = to the right. Drag the round handle in front of the box."><NumberField value={p.heading} step={5} digits={1} onChange={(heading) => set({ heading })} /></Row>
        <Row label="Look up / down (°)" hint="− = down (e.g. through a low window), + = up. R / F change it by 5°.">
          <NumberField value={p.pitch ?? 0} min={-80} max={60} step={5} digits={1} onChange={(pitch) => set({ pitch: pitch || undefined })} />
        </Row>
        <Row label="Stance" hint="Eye height at this position">
          <select value={String(p.eye ?? EYE_HEIGHT)} onChange={(e) => { const eye = +e.target.value; set({ eye: eye === EYE_HEIGHT ? undefined : eye }); }}>
            {!STANCES.some(([v]) => v === (p.eye ?? EYE_HEIGHT)) && <option value={String(p.eye)}>{p.eye} m</option>}
            {STANCES.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}
          </select>
        </Row>
        {i < stage.legs.length && (
          <Row label="Stay (s)" hint="Seconds at this position before moving on (after the beep / after arriving)">
            <NumberField value={stage.legs[i].after} min={0} max={60} step={0.5} digits={1} onChange={(after) => onUpdate((s) => patchLeg(s, i, { after }))} />
          </Row>
        )}
        {i === stage.positions.length - 1 && (
          <Row label="Stay (s)" hint="Seconds at the last position until the end beep">
            <NumberField value={stage.finalTime} min={0.5} max={60} step={0.5} digits={1} onChange={(finalTime) => onUpdate((s) => ({ ...s, finalTime }))} />
          </Row>
        )}
        <div className="actions">
          <button className="danger" disabled={stage.positions.length < 2} onClick={onDelete}>Delete position</button>
        </div>
        <p className="hint">The preview shows the view from the selected position.</p>
      </aside>
    );
  }

  if (selection?.kind === 'leg') {
    const i = selection.index;
    const l = stage.legs[i];
    if (!l) return null;
    const set = (patch: Partial<typeof l>) => onUpdate((s) => patchLeg(s, i, patch));
    return (
      <aside className="panel properties p3d-props">
        <div className="eyebrow">Move</div>
        <h3>
          {stage.positions[i].label} → {stage.positions[i + 1].label}
        </h3>
        <Row label="Go after (s)" hint="Seconds at the previous position before this move starts"><NumberField value={l.after} min={0} max={60} step={0.5} digits={1} onChange={(after) => set({ after })} /></Row>
        <Row label="Move takes (s)"><NumberField value={l.duration} min={0.3} max={20} step={0.1} digits={1} onChange={(duration) => set({ duration })} /></Row>
        <Row label="Reload"><input type="checkbox" checked={l.reload} onChange={(e) => set({ reload: e.target.checked })} /></Row>
        <Row label="Corner points"><span>{l.via?.length ?? 0}</span></Row>
        <div className="actions">
          <button disabled={!l.via?.length} onClick={() => set({ via: undefined })}>Straight line</button>
        </div>
        <p className="hint">Double-click the path to add a corner point (e.g. around a wall end), drag it, double-click it to remove.</p>
      </aside>
    );
  }

  // stage settings
  const par = parTime3D(stage);
  const length = buildVideoTimeline(stage, { seed: stage.id, voiceLead: STANDBY_VOICE_LEAD }).end;
  const set = (patch: Partial<Stage3D>) => onUpdate((s) => ({ ...s, ...patch }));
  const ladder = stage.ladder;
  // the step between the first two levels (the generator keeps it when the first par or the count changes)
  const ladderStep = ladder && ladder.pars.length > 1 ? +(ladder.pars[0] - ladder.pars[1]).toFixed(2) : 0.2;
  const setLadder = (l: ParLadder | undefined) =>
    onUpdate((s) => {
      const { ladder: _, ...rest } = s;
      return l ? { ...rest, ladder: l, repetitions: l.pars.length * l.repsPerLevel } : rest;
    });
  return (
    <aside className="panel properties p3d-props">
      <div className="eyebrow">3D stage</div>
      <h3>{stage.name}</h3>
      <Row label="Name"><input value={stage.name} onChange={(e) => set({ name: e.target.value })} /></Row>
      <Row label="Description"><textarea rows={2} value={stage.description ?? ''} onChange={(e) => set({ description: e.target.value })} /></Row>
      <Row label="Start" hint="Start condition — shown in the briefing and on the title card">
        <select value={START_PRESETS.includes(stage.start ?? '') ? stage.start : stage.start ? '__custom' : ''} onChange={(e) => e.target.value !== '__custom' && set({ start: e.target.value || undefined })}>
          <option value="">— none —</option>
          {START_PRESETS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
          {stage.start && !START_PRESETS.includes(stage.start) && <option value="__custom">{stage.start}</option>}
        </select>
      </Row>
      <Row label="" hint="Your own wording"><input placeholder="…or type a start condition" value={stage.start ?? ''} onChange={(e) => set({ start: e.target.value || undefined })} /></Row>
      <h4>Timing</h4>
      <Row label="Par time (s)" hint="All stays + moves"><b>{par.toFixed(2)}</b></Row>
      {stage.legs.length === 0 && (
        <Row label="Stay at start (s)"><NumberField value={stage.finalTime} min={0.5} max={60} step={0.5} digits={1} onChange={(finalTime) => set({ finalTime })} /></Row>
      )}
      <Row label="Par ladder" hint="The reps run level by level, every level with a shorter par. Moves and moving targets speed up with the par.">
        <input
          type="checkbox"
          checked={!!stage.ladder}
          onChange={(e) => setLadder(e.target.checked ? makeLadder(Math.max(0.6, par), Math.max(0.1, +(par * 0.1).toFixed(1)), 5, 2) : undefined)}
        />
      </Row>
      {ladder ? (
        <>
          <Row label="Levels (par, s)" hint="Par of every level, separated by commas — e.g. 2.0, 1.8, 1.6, 1.4"><ParList pars={ladder.pars} onChange={(pars) => setLadder({ ...ladder, pars })} /></Row>
          <Row label="First par (s)" hint="Rebuilds the levels from here down"><NumberField value={ladder.pars[0]} min={0.2} max={60} step={0.1} digits={2} onChange={(from) => setLadder(makeLadder(from, ladderStep, ladder.pars.length, ladder.repsPerLevel))} /></Row>
          <Row label="Faster per level (s)" hint="Rebuilds the levels: the par gets this much shorter every level"><NumberField value={ladderStep} min={0} max={5} step={0.05} digits={2} onChange={(st) => setLadder(makeLadder(ladder.pars[0], st, ladder.pars.length, ladder.repsPerLevel))} /></Row>
          <Row label="Number of levels"><NumberField value={ladder.pars.length} min={1} max={12} step={1} digits={0} onChange={(n) => setLadder(makeLadder(ladder.pars[0], ladderStep, n, ladder.repsPerLevel))} /></Row>
          <Row label="Reps per level"><NumberField value={ladder.repsPerLevel} min={1} max={10} step={1} digits={0} onChange={(r) => setLadder({ ...ladder, repsPerLevel: Math.max(1, Math.round(r)) })} /></Row>
          <Row label="Repetitions" hint="Levels × reps per level"><b>{stage.repetitions}</b></Row>
        </>
      ) : (
        <Row label="Repetitions"><NumberField value={stage.repetitions} min={1} max={30} step={1} digits={0} onChange={(r) => set({ repetitions: Math.round(r) })} /></Row>
      )}
      <Row label="Reset time (s)"><NumberField value={stage.resetTime} min={0} max={60} step={0.5} digits={1} onChange={(resetTime) => set({ resetTime })} /></Row>
      <Row label="Standby min (s)"><NumberField value={stage.standbyDelay.min} min={0} max={10} step={0.1} digits={1} onChange={(min) => set({ standbyDelay: { min, max: Math.max(min, stage.standbyDelay.max) } })} /></Row>
      <Row label="Standby max (s)"><NumberField value={stage.standbyDelay.max} min={0} max={10} step={0.1} digits={1} onChange={(max) => set({ standbyDelay: { min: Math.min(max, stage.standbyDelay.min), max } })} /></Row>
      <h4>Camera</h4>
      <Row label="Brightness" hint="Darker / lighter range and targets (1 = as the range is). Saved with the stage, used in the video too.">
        <SliderField value={stage.brightness ?? 1} min={0.4} max={1.6} step={0.05} digits={2} onChange={(b) => set({ brightness: Math.abs(b - 1) < 0.001 ? undefined : b })} />
      </Row>
      <Row label="Walking shake" hint="Head movement while moving between positions: 0 = steady like a gimbal, 1 = natural, 2 = strong">
        <SliderField value={shakeOf(stage)} min={0} max={2} step={0.05} digits={2} onChange={(shake) => set({ camera: { ...stage.camera, shake } })} />
      </Row>
      <div className="stats">
        <span><b>{stage.objects.length}</b> objects</span>
        <span><b>{stage.positions.length}</b> positions</span>
        <span>video ≈ <b>{fmt(length)}</b></span>
      </div>
      <h4>How to build</h4>
      <ol className="p3d-help">
        <li>Click or drag targets and walls from the left onto the plan.</li>
        <li><b>+ Position</b>, then click the floor: a new shooting box. The course goes START → P2 → P3 …</li>
        <li>Click a box to set how long to stay; click a path for the move time and <b>reload</b>.</li>
        <li>The preview shows the view from the selected box. <b>▶ Play / Render</b> for the video.</li>
      </ol>
    </aside>
  );
};

/** The "up from / down at" window with one end changed; empty → no window. */
const window_ = (w: { from?: number; until?: number } | undefined, patch: { from?: number; until?: number }) => {
  const next = { ...w, ...patch };
  if (next.from === undefined) delete next.from;
  if (next.until === undefined) delete next.until;
  return Object.keys(next).length ? next : undefined;
};

/** Briefing notes offered in the note field (any text works). */
const NOTE_PRESETS = ['FIRST SHOT', 'ACTIVATOR', 'LAST SHOT', 'NO SHOOT', 'STRONG HAND', 'WEAK HAND'];

/** Common start conditions of practical shooting stages. */
const START_PRESETS = [
  'Hands relaxed at the sides, pistol loaded and holstered',
  'Wrists above the shoulders, pistol loaded and holstered',
  'Facing uprange, pistol loaded and holstered',
  'Pistol unloaded on the table, magazines on the table',
  'Pistol loaded on the table, hands on the marks',
  'Seated, pistol loaded and holstered',
];
