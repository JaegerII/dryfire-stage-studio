import { ASSETS } from '../../assets/registry';
import type { Motion, MotionKind, ObjectType } from '../../types/stage';
import { DEFAULT_AMPLITUDE, DEFAULT_SWING_ANGLE } from '../../utils/motion';
import { Row, Select, SliderField } from '../../components/fields';

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

interface MotionObject {
  id: string;
  type: ObjectType;
  motion?: Motion;
}

/** Steel objects that fall — they can trigger other targets. */
const activators = (objects: MotionObject[]) =>
  objects
    .filter((o) => o.motion?.kind === 'fall')
    .map((o, i) => ({ value: o.id, label: `${ASSETS[o.type].label} ${i + 1} (falls at ${(o.motion?.delay ?? 1).toFixed(1)} s)` }));

interface Props {
  object: MotionObject;
  /** Every object of the stage (activators are picked from them). */
  objects: MotionObject[];
  parTime: number;
  onMotion: (motion: Motion | undefined) => void;
}

/**
 * Target behaviour during the par window — shared by the 2D and the 3D editor:
 * falling steel (activators), swingers, movers, pop-ups, appear / disappear,
 * started by the beep or by an activator falling.
 */
export const MotionFields = ({ object: o, objects, parTime, onMotion }: Props) => {
  const asset = ASSETS[o.type];
  if (asset.category !== 'target') return null;
  const motion: Motion = o.motion ?? { kind: 'static' };
  const setMotion = (patch: Partial<Motion>) => onMotion({ ...motion, ...patch });
  return (
    <>
      <h4>Behaviour</h4>
      <Row label="Motion">
        <Select
          value={motion.kind}
          options={MOTIONS.filter((m) => m.value !== 'fall' || asset.canFall)}
          onChange={(kind) => onMotion(kind === 'static' ? undefined : { ...motion, kind, delay: kind === 'fall' ? 1 : motion.trigger ? 0 : 1 })}
        />
      </Row>
      {motion.kind === 'fall' && (
        <>
          <Row label="Hit at (s)" hint="Seconds after the start beep — simulates your first shot on this steel">
            <SliderField value={motion.delay ?? 1} min={0} max={parTime} step={0.1} digits={1} onChange={(delay) => setMotion({ delay })} />
          </Row>
          <p className="hint">Other targets can be set to start when this steel falls (Behaviour → Starts at).</p>
        </>
      )}
      {motion.kind !== 'static' && motion.kind !== 'fall' && (
        <Row label="Starts at" hint="Start beep, or when an activator steel falls">
          <Select
            value={motion.trigger ?? ''}
            options={[{ value: '', label: 'Start beep' }, ...activators(objects).filter((a) => a.value !== o.id)]}
            onChange={(trigger) => setMotion({ trigger: trigger || undefined })}
          />
        </Row>
      )}
      {motion.trigger && !objects.some((x) => x.id === motion.trigger && x.motion?.kind === 'fall') && (
        <p className="hint warn">The activator for this target no longer falls — it will never start.</p>
      )}
      {motion.kind === 'swing' && (
        <>
          <Row label="Swing angle (°)" hint="Maximum tilt to each side around the foot">
            <SliderField value={Math.abs(motion.angle ?? DEFAULT_SWING_ANGLE)} min={5} max={85} step={1} digits={0} onChange={(a) => setMotion({ angle: a * Math.sign((motion.angle ?? 1) || 1) })} />
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
          <Row label={motion.kind === 'horizontal' ? 'Swing width (m)' : 'Bob height (m)'} hint="How far it moves to each side, in meters">
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
          <Row label="Full swing (s)" hint="Seconds for one complete back-and-forth — smaller is faster">
            <SliderField value={motion.period ?? 2} min={0.3} max={8} step={0.1} digits={1} onChange={(period) => setMotion({ period })} />
          </Row>
          <Row label="Hidden first" hint="Invisible until the motion starts (e.g. a swinger activated by a popper)">
            <input type="checkbox" checked={!!motion.hiddenUntilStart} onChange={(e) => setMotion({ hiddenUntilStart: e.target.checked || undefined })} />
          </Row>
        </>
      )}
      {(motion.kind === 'popup' || motion.kind === 'appear' || motion.kind === 'disappear' || motion.kind === 'swing' || motion.kind === 'horizontal' || motion.kind === 'vertical') && (
        <Row label="Delay (s)" hint={motion.trigger ? 'Seconds after the activator falls' : 'Seconds after the start beep'}>
          <SliderField value={motion.delay ?? 0} min={0} max={parTime} step={0.1} digits={1} onChange={(delay) => setMotion({ delay })} />
        </Row>
      )}
      {motion.kind === 'popup' && (
        <Row label="Up for (s)">
          <SliderField value={motion.duration ?? 1.5} min={0.2} max={parTime} step={0.1} digits={1} onChange={(duration) => setMotion({ duration })} />
        </Row>
      )}
    </>
  );
};
