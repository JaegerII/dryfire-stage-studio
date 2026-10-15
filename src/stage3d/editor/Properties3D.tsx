import { ASSETS } from '../../assets/registry';
import { NumberField, Row, SliderField } from '../../components/fields';
import { MotionFields } from './MotionFields';
import { STANDBY_VOICE_LEAD } from '../../utils/audioEngine';
import { buildVideoTimeline } from '../timeline';
import { type Stage3D, parTime3D, shakeOf } from '../types';
import { type Selection, groupObjects, patchLeg, patchObjects, patchPosition, ungroupObjects } from './ops';

interface Props {
  stage: Stage3D;
  selection: Selection;
  onUpdate: (fn: (s: Stage3D) => Stage3D) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

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
      <Row label="Repetitions"><NumberField value={stage.repetitions} min={1} max={30} step={1} digits={0} onChange={(r) => set({ repetitions: Math.round(r) })} /></Row>
      <Row label="Reset time (s)"><NumberField value={stage.resetTime} min={0} max={60} step={0.5} digits={1} onChange={(resetTime) => set({ resetTime })} /></Row>
      <Row label="Standby min (s)"><NumberField value={stage.standbyDelay.min} min={0} max={10} step={0.1} digits={1} onChange={(min) => set({ standbyDelay: { min, max: Math.max(min, stage.standbyDelay.max) } })} /></Row>
      <Row label="Standby max (s)"><NumberField value={stage.standbyDelay.max} min={0} max={10} step={0.1} digits={1} onChange={(max) => set({ standbyDelay: { min: Math.min(max, stage.standbyDelay.min), max } })} /></Row>
      <h4>Camera</h4>
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

/** Common start conditions of practical shooting stages. */
const START_PRESETS = [
  'Hands relaxed at the sides, pistol loaded and holstered',
  'Wrists above the shoulders, pistol loaded and holstered',
  'Facing uprange, pistol loaded and holstered',
  'Pistol unloaded on the table, magazines on the table',
  'Pistol loaded on the table, hands on the marks',
  'Seated, pistol loaded and holstered',
];
