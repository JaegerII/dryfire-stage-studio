import { useState } from 'react';
import { ENVIRONMENTS, ENVIRONMENT_LIST } from '../../assets/environments';
import { ASSETS } from '../../assets/registry';
import type { Difficulty, Discipline, Motion, MotionKind, Stage, StageObject } from '../../types/stage';
import { STANDBY_VOICE_LEAD } from '../../utils/audioEngine';
import { autoDepth, drawOrder } from '../../utils/perspective';
import { DEFAULT_AMPLITUDE, DEFAULT_SWING_ANGLE } from '../../utils/motion';
import { MAX_ZOOM } from '../../utils/view';
import { estimateDuration } from '../../utils/schedule';
import { NumberField, Row, Select, SliderField } from './fields';

interface Props {
  stage: Stage;
  selected?: StageObject;
  onStage: (patch: Partial<Stage>) => void;
  onObject: (id: string, patch: Partial<StageObject>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayer: (dir: 1 | -1) => void;
  onLayerOf: (id: string, dir: 1 | -1) => void;
  onGroup: () => void;
  onUngroup: () => void;
  onSelectGroup: (group: string) => void;
  onMove: (m: GroupMove) => void;
  onToggleLock: () => void;
  selectedIds: string[];
  onSelect: (id: string, additive: boolean) => void;
  onClearSelection: () => void;
}

/** Relative move in meters: across (+ right), depth (+ further away), up (+ higher). */
export interface GroupMove {
  across?: number;
  depth?: number;
  up?: number;
}

/**
 * Layers: every object in its real draw order (front at the top). Click selects it even when it
 * is hidden behind a wall (Ctrl/Shift adds); ▲ / ▼ moves it one layer to the front / back.
 * Grouped objects are marked with their group's colour.
 */
const GROUP_COLORS = ['#ff3131', '#f5b301', '#3fa7ff', '#36c46f', '#c36bff', '#ff8a3d'];

const Layers = ({ stage, selectedIds, onSelect, onLayerOf }: Pick<Props, 'stage' | 'selectedIds' | 'onSelect' | 'onLayerOf'>) => {
  const front = [...drawOrder(stage.objects)].reverse();
  const groups = [...new Set(stage.objects.map((o) => o.group).filter(Boolean))] as string[];
  return (
    <>
      <h4>Layers <span className="h4-note">front ↑ · back ↓</span></h4>
      <ul className="object-list layers">
        {front.map((o) => {
          const gi = o.group ? groups.indexOf(o.group) : -1;
          return (
            <li key={o.id} style={gi >= 0 ? { boxShadow: `inset 3px 0 0 ${GROUP_COLORS[gi % GROUP_COLORS.length]}` } : undefined}>
              <button className={selectedIds.includes(o.id) ? 'on' : ''} onClick={(e) => onSelect(o.id, e.ctrlKey || e.metaKey || e.shiftKey)}>
                <img src={ASSETS[o.type].src} alt="" />
                <span>{ASSETS[o.type].label}</span>
                <em>{o.locked ? '🔒' : ''}{gi >= 0 ? ` G${gi + 1}` : ''}</em>
              </button>
              <button className="layer-step" title="One layer to the front" onClick={() => onLayerOf(o.id, 1)}>▲</button>
              <button className="layer-step" title="One layer to the back" onClick={() => onLayerOf(o.id, -1)}>▼</button>
            </li>
          );
        })}
      </ul>
    </>
  );
};

const MOVE_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2];

/** Move the selection in real meters — works for one object or a whole group at once. */
const MoveInMeters = ({ onMove, disabled }: { onMove: (m: GroupMove) => void; disabled?: boolean }) => {
  const [step, setStep] = useState(0.25);
  return (
    <>
      <Row label="Step (m)">
        <Select value={String(step)} options={MOVE_STEPS.map((s) => ({ value: String(s), label: `${s} m` }))} onChange={(v) => setStep(Number(v))} />
      </Row>
      <Row label="Left / right" hint="Alt + ← / →">
        <span className="inline move">
          <button disabled={disabled} onClick={() => onMove({ across: -step })}>◀ Left</button>
          <button disabled={disabled} onClick={() => onMove({ across: step })}>Right ▶</button>
        </span>
      </Row>
      <Row label="Distance" hint="Alt + ↑ / ↓ — keeps the layout, sizes follow the perspective">
        <span className="inline move">
          <button disabled={disabled} onClick={() => onMove({ depth: -step })}>Closer</button>
          <button disabled={disabled} onClick={() => onMove({ depth: step })}>Further</button>
        </span>
      </Row>
      <Row label="Height" hint="Alt + Shift + ↑ / ↓ — elevation above the floor">
        <span className="inline move">
          <button disabled={disabled} onClick={() => onMove({ up: -step })}>▼ Down</button>
          <button disabled={disabled} onClick={() => onMove({ up: step })}>Up ▲</button>
        </span>
      </Row>
    </>
  );
};

const MOTIONS: { value: MotionKind; label: string }[] = [
  { value: 'static', label: 'Static' },
  { value: 'fall', label: 'Falls when hit (activator)' },
  { value: 'swing', label: 'Swing (pivots at the foot)' },
  { value: 'horizontal', label: 'Slide sideways' },
  { value: 'vertical', label: 'Vertical bob' },
  { value: 'popup', label: 'Pop-up (delay, duration)' },
  { value: 'appear', label: 'Appear' },
  { value: 'disappear', label: 'Disappear' },
];

/** Steel objects that fall — they can trigger other targets. */
const activators = (stage: Stage) =>
  stage.objects
    .filter((o) => o.motion?.kind === 'fall')
    .map((o, i) => ({ value: o.id, label: `${ASSETS[o.type].label} ${i + 1} (falls at ${(o.motion?.delay ?? 1).toFixed(1)} s)` }));

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

const ObjectProps = (props: Props & { selected: StageObject }) => {
  const { stage, selected: o, onObject, onDuplicate, onDelete, onLayer, onMove, onToggleLock, onSelectGroup, onUngroup } = props;
  const asset = ASSETS[o.type];
  const env = ENVIRONMENTS[stage.environment];
  const set = (patch: Partial<StageObject>) => onObject(o.id, patch);
  const motion: Motion = o.motion ?? { kind: 'static' };
  const setMotion = (patch: Partial<Motion>) => set({ motion: { ...motion, ...patch } });
  const manual = o.perspective === 'manual';
  const locked = !!o.locked;

  return (
    <>
      <div className="panel-head">
        <img src={asset.src} alt="" />
        <div>
          <div className="eyebrow">{asset.category}</div>
          <strong>{asset.label}</strong>
        </div>
      </div>
      <div className="actions">
        <button onClick={onDuplicate} title="Ctrl+D">Duplicate</button>
        <button onClick={onToggleLock} title="L">{locked ? 'Unlock' : 'Lock'}</button>
        <button className="danger" onClick={onDelete} disabled={locked} title="Del">Delete</button>
      </div>
      {o.group && (
        <div className="actions" style={{ marginTop: 6 }}>
          <button onClick={() => onSelectGroup(o.group!)} title="Select every member of this group">Select group</button>
          <button onClick={onUngroup} title="Ctrl+Shift+G">Ungroup</button>
        </div>
      )}

      <h4>Transform</h4>
      <Row label="X"><SliderField value={o.x} min={0} max={1} step={0.001} digits={3} disabled={locked} onChange={(x) => set({ x })} /></Row>
      <Row label="Y"><SliderField value={o.y} min={0} max={1} step={0.001} digits={3} disabled={locked} onChange={(y) => set({ y })} /></Row>
      <Row label="Scale" hint="Multiplier on top of the perspective size"><SliderField value={o.scale} min={0.1} max={3} step={0.01} disabled={locked} onChange={(scale) => set({ scale })} /></Row>
      <Row label="Rotation"><SliderField value={o.rotation} min={-180} max={180} step={0.5} digits={1} disabled={locked} onChange={(rotation) => set({ rotation })} /></Row>
      <Row label="Turn (yaw)" hint="Turn the object away from the shooter"><SliderField value={o.yaw ?? 0} min={-80} max={80} step={1} digits={0} disabled={locked} onChange={(yaw) => set({ yaw })} /></Row>
      <Row label="Mirror" hint="Flip left/right">
        <input type="checkbox" checked={!!o.flip} disabled={locked} onChange={(e) => set({ flip: e.target.checked || undefined })} />
      </Row>
      <Row label="Opacity"><SliderField value={o.opacity ?? 1} min={0} max={1} step={0.01} disabled={locked} onChange={(opacity) => set({ opacity })} /></Row>
      <Row label="Elevation (m)" hint="Height above the floor, e.g. 0.6 for the top of a box">
        <SliderField value={o.elevation ?? 0} min={0} max={2.5} step={0.01} digits={2} disabled={locked} onChange={(elevation) => set({ elevation: elevation || undefined })} />
      </Row>

      <h4>Move (meters)</h4>
      <MoveInMeters onMove={onMove} disabled={locked} />

      <h4>Depth & Layer</h4>
      <Row label="Perspective">
        <Select
          value={manual ? 'manual' : 'auto'}
          options={[{ value: 'auto', label: 'Auto (from Y)' }, { value: 'manual', label: 'Manual depth' }]}
          onChange={(v) => set(v === 'manual' ? { perspective: 'manual', depth: autoDepth(o.y, env) } : { perspective: 'auto' })}
        />
      </Row>
      <Row label="Depth" hint="0 = bottom edge (near), 1 = horizon (far)">
        <SliderField value={manual ? (o.depth ?? 0) : autoDepth(o.y, env)} min={0} max={1} step={0.005} digits={3} disabled={!manual || locked} onChange={(depth) => set({ depth })} />
      </Row>
      <Row label="Layer (z)">
        <span className="inline">
          <NumberField value={o.zIndex} step={1} digits={0} onChange={(zIndex) => set({ zIndex: Math.round(zIndex) })} />
          <button onClick={() => onLayer(-1)} title="Send backward ( [ )">↓</button>
          <button onClick={() => onLayer(1)} title="Bring forward ( ] )">↑</button>
        </span>
      </Row>

      {asset.category === 'target' && (
        <>
          <h4>Behaviour</h4>
          <Row label="Motion">
            <Select
              value={motion.kind}
              options={MOTIONS.filter((m) => m.value !== 'fall' || asset.canFall)}
              onChange={(kind) =>
                set({ motion: kind === 'static' ? undefined : { ...motion, kind, delay: kind === 'fall' ? 1 : motion.trigger ? 0 : 1 } })
              }
            />
          </Row>
          {motion.kind === 'fall' && (
            <>
              <Row label="Hit at (s)" hint="Seconds after the start beep — simulates your first shot on this steel">
                <SliderField value={motion.delay ?? 1} min={0} max={stage.parTime} step={0.1} digits={1} onChange={(delay) => setMotion({ delay })} />
              </Row>
              <p className="hint">Other targets can be set to start when this steel falls (Behaviour → Starts at).</p>
            </>
          )}
          {motion.kind !== 'static' && motion.kind !== 'fall' && (
            <Row label="Starts at" hint="Start beep, or when an activator steel falls">
              <Select
                value={motion.trigger ?? ''}
                options={[{ value: '', label: 'Start beep' }, ...activators(stage).filter((a) => a.value !== o.id)]}
                onChange={(trigger) => setMotion({ trigger: trigger || undefined })}
              />
            </Row>
          )}
          {motion.trigger && !stage.objects.some((x) => x.id === motion.trigger && x.motion?.kind === 'fall') && (
            <p className="hint warn">The activator for this target no longer falls — it will never start.</p>
          )}
          {motion.kind === 'swing' && (
            <>
              <Row label="Swing angle (°)" hint="Maximum tilt to each side around the foot (shown as ghosts + arc on the stage)">
                <SliderField
                  value={Math.abs(motion.angle ?? DEFAULT_SWING_ANGLE)}
                  min={5}
                  max={85}
                  step={1}
                  digits={0}
                  onChange={(a) => setMotion({ angle: a * Math.sign((motion.angle ?? 1) || 1) })}
                />
              </Row>
              <Row label="First move">
                <Select
                  value={(motion.angle ?? 1) < 0 ? 'neg' : 'pos'}
                  options={[{ value: 'pos', label: 'Right first' }, { value: 'neg', label: 'Left first' }]}
                  onChange={(v) => setMotion({ angle: Math.abs(motion.angle ?? DEFAULT_SWING_ANGLE) * (v === 'neg' ? -1 : 1) })}
                />
              </Row>
              <Row label="Full swing (s)" hint="Seconds for one complete left-right-left — smaller is faster">
                <SliderField value={motion.period ?? 1.6} min={0.3} max={8} step={0.1} digits={1} onChange={(period) => setMotion({ period })} />
              </Row>
              <Row label="Hidden first" hint="Invisible until the swing starts">
                <input type="checkbox" checked={!!motion.hiddenUntilStart} onChange={(e) => setMotion({ hiddenUntilStart: e.target.checked || undefined })} />
              </Row>
            </>
          )}
          {(motion.kind === 'horizontal' || motion.kind === 'vertical') && (
            <>
              <Row label={motion.kind === 'horizontal' ? 'Swing width (m)' : 'Bob height (m)'} hint="How far it moves to each side, in meters (shown as ghosts on the stage)">
                <SliderField
                  value={Math.abs(motion.amplitude ?? DEFAULT_AMPLITUDE)}
                  min={0}
                  max={motion.kind === 'horizontal' ? 3 : 1}
                  step={0.05}
                  digits={2}
                  onChange={(a) => setMotion({ amplitude: a * Math.sign((motion.amplitude ?? 1) || 1) })}
                />
              </Row>
              <Row label="First move">
                <Select
                  value={(motion.amplitude ?? 1) < 0 ? 'neg' : 'pos'}
                  options={motion.kind === 'horizontal' ? [{ value: 'pos', label: 'Right first' }, { value: 'neg', label: 'Left first' }] : [{ value: 'pos', label: 'Up first' }, { value: 'neg', label: 'Down first' }]}
                  onChange={(v) => setMotion({ amplitude: Math.abs(motion.amplitude ?? DEFAULT_AMPLITUDE) * (v === 'neg' ? -1 : 1) })}
                />
              </Row>
              <Row label="Full swing (s)" hint="Seconds for one complete back-and-forth — smaller is faster"><SliderField value={motion.period ?? 2} min={0.3} max={8} step={0.1} digits={1} onChange={(period) => setMotion({ period })} /></Row>
              <Row label="Hidden first" hint="Invisible until the motion starts (e.g. a swinger activated by a popper)">
                <input type="checkbox" checked={!!motion.hiddenUntilStart} onChange={(e) => setMotion({ hiddenUntilStart: e.target.checked || undefined })} />
              </Row>
            </>
          )}
          {(motion.kind === 'popup' || motion.kind === 'appear' || motion.kind === 'disappear' || motion.kind === 'swing' || motion.kind === 'horizontal' || motion.kind === 'vertical') && (
            <Row label="Delay (s)" hint={motion.trigger ? 'Seconds after the activator falls' : 'Seconds after the start beep'}>
              <SliderField value={motion.delay ?? 0} min={0} max={stage.parTime} step={0.1} digits={1} onChange={(delay) => setMotion({ delay })} />
            </Row>
          )}
          {motion.kind === 'popup' && (
            <Row label="Up for (s)"><SliderField value={motion.duration ?? 1.5} min={0.2} max={stage.parTime} step={0.1} digits={1} onChange={(duration) => setMotion({ duration })} /></Row>
          )}
        </>
      )}
      <Layers {...props} />
    </>
  );
};

const StageProps = ({ stage, onStage, onSelect, onLayerOf, selectedIds }: Props) => {
  const targets = stage.objects.filter((o) => ASSETS[o.type].category === 'target');
  const paper = targets.filter((o) => ASSETS[o.type].scoring && o.type.startsWith('paper')).length;
  const steel = targets.filter((o) => o.type.startsWith('steel')).length;
  const meta = stage.meta ?? {};
  return (
    <>
      <div className="panel-head">
        <div>
          <div className="eyebrow">Stage</div>
          <strong>{stage.name}</strong>
        </div>
      </div>
      <Row label="Name"><input value={stage.name} onChange={(e) => onStage({ name: e.target.value })} /></Row>
      <Row label="ID"><input value={stage.id} onChange={(e) => onStage({ id: e.target.value.replace(/[^\w-]/g, '_') })} /></Row>
      <Row label="Description"><textarea rows={2} value={stage.description ?? ''} onChange={(e) => onStage({ description: e.target.value })} /></Row>
      <Row label="Environment">
        <Select value={stage.environment} options={ENVIRONMENT_LIST.map((e) => ({ value: e.id, label: e.label }))} onChange={(environment) => onStage({ environment })} />
      </Row>
      <Row label="Zoom (closer)" hint="Brings the whole stage closer — 1 = full view. Same as a longer lens, perspective stays correct.">
        <SliderField value={stage.view?.zoom ?? 1} min={1} max={MAX_ZOOM} step={0.05} digits={2} onChange={(zoom) => onStage({ view: { ...stage.view, zoom } })} />
      </Row>

      <h4>Timing</h4>
      <Row label="Par time (s)"><NumberField value={stage.parTime} min={0.5} max={120} step={0.1} digits={2} onChange={(parTime) => onStage({ parTime })} /></Row>
      <Row label="Repetitions"><NumberField value={stage.repetitions} min={1} max={100} step={1} digits={0} onChange={(r) => onStage({ repetitions: Math.round(r) })} /></Row>
      <Row label="Reset time (s)"><NumberField value={stage.resetTime} min={0} max={60} step={0.5} digits={1} onChange={(resetTime) => onStage({ resetTime })} /></Row>
      <Row label="Standby min (s)">
        <NumberField value={stage.standbyDelay.min} min={0} max={10} step={0.1} digits={1} onChange={(min) => onStage({ standbyDelay: { min, max: Math.max(min, stage.standbyDelay.max) } })} />
      </Row>
      <Row label="Standby max (s)">
        <NumberField value={stage.standbyDelay.max} min={0} max={10} step={0.1} digits={1} onChange={(max) => onStage({ standbyDelay: { min: Math.min(max, stage.standbyDelay.min), max } })} />
      </Row>

      <h4>Library</h4>
      <Row label="Difficulty">
        <Select<Difficulty>
          value={meta.difficulty ?? 'beginner'}
          options={[{ value: 'beginner', label: 'Beginner' }, { value: 'intermediate', label: 'Intermediate' }, { value: 'advanced', label: 'Advanced' }]}
          onChange={(difficulty) => onStage({ meta: { ...meta, difficulty } })}
        />
      </Row>
      <Row label="Discipline">
        <Select<Discipline>
          value={meta.discipline ?? 'handgun'}
          options={[{ value: 'handgun', label: 'Handgun' }, { value: 'rifle', label: 'Rifle' }, { value: 'pcc', label: 'PCC' }]}
          onChange={(discipline) => onStage({ meta: { ...meta, discipline } })}
        />
      </Row>
      <Row label="Tags"><input value={(meta.tags ?? []).join(', ')} placeholder="steel, window" onChange={(e) => onStage({ meta: { ...meta, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) } })} /></Row>

      <div className="stats">
        <span><b>{paper}</b> paper</span>
        <span><b>{steel}</b> steel</span>
        <span><b>{stage.objects.length}</b> objects</span>
        <span>≈ <b>{fmt(estimateDuration(stage, 0, STANDBY_VOICE_LEAD))}</b> min</span>
      </div>
      <Layers stage={stage} selectedIds={selectedIds} onSelect={onSelect} onLayerOf={onLayerOf} />
      <p className="hint">Select on the stage or in this list (useful for objects hidden behind a box). Ctrl/Shift-click selects several, Ctrl+A all.</p>
    </>
  );
};

/** Several objects selected: group actions + the object list to refine the selection. */
const MultiProps = (props: Props) => {
  const { stage, selectedIds, onDuplicate, onDelete, onLayer, onToggleLock, onClearSelection, onGroup, onUngroup } = props;
  const sel = stage.objects.filter((o) => selectedIds.includes(o.id));
  const allLocked = sel.every((o) => o.locked);
  const oneGroup = sel[0]?.group && sel.every((o) => o.group === sel[0].group);
  const anyGroup = sel.some((o) => o.group);
  return (
    <>
      <div className="panel-head">
        <div>
          <div className="eyebrow">Selection</div>
          <strong>{sel.length} objects</strong>
        </div>
      </div>
      <div className="actions">
        <button onClick={onDuplicate} title="Ctrl+D">Duplicate</button>
        <button onClick={onToggleLock} title="L">{allLocked ? 'Unlock' : 'Lock'}</button>
        <button className="danger" onClick={onDelete} title="Del">Delete</button>
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        <button onClick={() => onLayer(-1)} title="[">Layer ↓</button>
        <button onClick={() => onLayer(1)} title="]">Layer ↑</button>
        <button onClick={onClearSelection} title="Esc">Deselect</button>
      </div>
      <div className="actions" style={{ marginTop: 6 }}>
        <button onClick={onGroup} disabled={!!oneGroup} title="Ctrl+G — clicking one member then selects all">Group</button>
        <button onClick={onUngroup} disabled={!anyGroup} title="Ctrl+Shift+G">Ungroup</button>
      </div>
      <h4>Move together</h4>
      <MoveInMeters onMove={props.onMove} disabled={allLocked} />
      <p className="hint">Drag any selected object to move the whole group; the handles scale / rotate it. Arrow keys nudge all on screen.</p>
      <Layers {...props} />
    </>
  );
};

/** Right sidebar: properties of the selected object, the multi-selection, or the stage. */
export const PropertiesPanel = (props: Props) => (
  <aside className="panel properties">
    {props.selected ? (
      <ObjectProps {...props} selected={props.selected} />
    ) : props.selectedIds.length > 1 ? (
      <MultiProps {...props} />
    ) : (
      <StageProps {...props} />
    )}
  </aside>
);
