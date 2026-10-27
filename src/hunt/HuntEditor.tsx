import { useEffect, useMemo, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { NumberField, Row, Select, SliderField } from '../components/fields';
import { downloadBlob } from '../utils/recorder';
import { newId } from '../utils/random';
import { HuntPlan, HuntTimeline, fmtTime } from './HuntPlan';
import { HuntPlayer } from './HuntPlayer';
import { HuntRenderPanel } from './HuntRenderPanel';
import { MAPS, MAP_IDS, type StandIndex, standThumb } from './maps';
import { huntProgram } from './program';
import type { RenderQuality } from './renderService';
import { driveDuration, newCrossing, scenarioRepository } from './repository';
import { crossingWindow, describe, leadCm, sounderOrder } from './rules';
import { type Crossing, GAITS, GAME_CLASSES, GAME_ORDER, type GameClass, type Hunt, type HuntFormat, type HuntScenario } from './types';
import { useHuntRender } from './useHuntRender';

/** Animals as counts per class → the list Blender gets (sow / boar first: the sounder's lead). */
const animalsFrom = (counts: Record<GameClass, number>): GameClass[] => GAME_ORDER.flatMap((k) => Array<GameClass>(counts[k]).fill(k));
const countsOf = (animals: GameClass[]) => Object.fromEntries(GAME_ORDER.map((k) => [k, animals.filter((a) => a === k).length])) as Record<GameClass, number>;

/**
 * Scenario editor (≙ stage editor): map (Revier) and stand, crossings on a plan of the lane and a
 * timeline, the live 3D preview, Blender render and MP4.
 */
export const HuntEditor = ({
  initial,
  hunt,
  onExit,
  onDirtyChange,
  nav,
}: {
  initial: HuntScenario;
  hunt?: Hunt;
  onExit: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  nav?: { index: number; count: number; onPrev?: () => void; onNext?: () => void };
}) => {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [selected, setSelected] = useState<string | null>(initial.crossings[0]?.id ?? null);
  const [format, setFormat] = useState<HuntFormat>('16x9');
  const [quality, setQuality] = useState<RenderQuality>('preview');
  const [driveT, setDriveT] = useState<number | null>(null);
  const dirty = JSON.stringify(s) !== saved;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const sel = s.crossings.find((c) => c.id === selected) ?? null;
  const patch = (id: string, p: Partial<Crossing>) => setS((x) => ({ ...x, crossings: x.crossings.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const save = () => {
    const out = scenarioRepository.save({ ...s, crossings: [...s.crossings].sort((a, b) => a.at - b.at) });
    setS(out);
    setSaved(JSON.stringify(out));
  };
  const leave = (go: () => void) => () => {
    if (dirty && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    onDirtyChange?.(false);
    go();
  };

  const scenarios = useMemo(() => [s], [s]);
  const r = useHuntRender(scenarios, format, quality);
  const frames = r.frames[0] ?? null;
  const program = useMemo(() => {
    const order = [...s.crossings].sort((a, b) => a.at - b.at);
    const leaveT = frames && !r.stale(s) ? [s.crossings.map((c) => frames.lastVisible(c.at, order.find((n) => n.at > c.at)?.at ?? 1e9))] : undefined;
    return huntProgram({ name: s.name, scenarios: [s] }, format, leaveT);
  }, [s, format, frames]);
  const duration = driveDuration(s);

  const counts = sel ? countsOf(sel.animals) : null;
  const tooClose = s.crossings.some((c) => {
    const next = s.crossings.filter((n) => n.at > c.at).sort((a, b) => a.at - b.at)[0];
    return !!next && next.at < crossingWindow(c).leave + 0.6 + s.revealSeconds;
  });

  return (
    <div className="hunt-editor">
      <header className="toolbar">
        <button className="brand linkish" onClick={leave(onExit)} title="Zurück">
          <BrandMark height={24} />
        </button>
        <div className="crumbs">
          <button className="linkish" onClick={leave(onExit)}>{hunt ? hunt.name : 'Szenarien'}</button>
          <span>/</span>
          <input className="name-input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          {dirty && <span className="dirty">● nicht gespeichert</span>}
          {nav && (
            <span className="stage-nav">
              <button className="linkish" disabled={!nav.onPrev} onClick={nav.onPrev && leave(nav.onPrev)} title="Voriges Szenario">‹</button>
              Szenario {nav.index + 1} / {nav.count}
              <button className="linkish" disabled={!nav.onNext} onClick={nav.onNext && leave(nav.onNext)} title="Nächstes Szenario">›</button>
            </span>
          )}
        </div>
        <nav>
          <div className="group">
            <button className="primary" onClick={save}>Speichern</button>
            <button
              onClick={() => {
                const copy = { ...structuredClone(s), id: newId('hs'), name: `${s.name} (Kopie)` };
                setS(copy);
                setSaved('');
              }}
            >
              Duplizieren
            </button>
            <button onClick={() => downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), `${s.id}.json`)}>Export JSON</button>
          </div>
          <button onClick={leave(onExit)}>Zurück</button>
        </nav>
      </header>

      <aside className="panel library">
        <section>
          <h3>Revier</h3>
          <div className="env-list">
            {MAP_IDS.map((m) => (
              <button key={m} className={`env-tile${m === s.map ? ' active' : ''}`} onClick={() => setS({ ...s, map: m })} title={MAPS[m].label}>
                <img src={standThumb(m, 0)} alt="" />
                <span>{MAPS[m].label}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Stand</h3>
          <div className="stand-list">
            {([0, 1, 2] as StandIndex[]).map((k) => (
              <button key={k} className={`env-tile${k === s.stand ? ' active' : ''}`} onClick={() => setS({ ...s, stand: k })} title={MAPS[s.map].stands[k].name}>
                <img src={standThumb(s.map, k)} alt="" />
                <span>{MAPS[s.map].stands[k].name}</span>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Auflösung</h3>
          <Row label="Karte (s)" hint="Wie lange nach jedem Anlauf die Auflösung steht; 0 = nur am Ende">
            <SliderField value={s.revealSeconds} min={0} max={12} step={1} digits={0} onChange={(v) => setS({ ...s, revealSeconds: v })} />
          </Row>
        </section>
        <section>
          <h3>Anläufe</h3>
          <ul className="hunt-list">
            {[...s.crossings]
              .sort((a, b) => a.at - b.at)
              .map((c) => {
                return (
                  <li key={c.id}>
                    <button className={c.id === selected ? 'on' : ''} onClick={() => setSelected(c.id)}>
                      <strong>{fmtTime(c.at)}</strong> {describe(c.animals)}
                      <span>
                        {GAITS[c.gait].label} · {Math.round(c.distance)} m · {c.direction === 'ltr' ? 'von links' : 'von rechts'} · Vorhalt ≈ {leadCm(c)} cm
                      </span>
                    </button>
                  </li>
                );
              })}
          </ul>
          <button
            onClick={() => {
              const at = Math.ceil(Math.max(4, ...s.crossings.map((c) => crossingWindow(c).leave + s.revealSeconds + 4)));
              const c = newCrossing(at);
              setS({ ...s, crossings: [...s.crossings, c] });
              setSelected(c.id);
            }}
          >
            + Anlauf
          </button>
          {tooClose && <p className="hint warn">Anläufe überlappen mit der Auflösungskarte – mehr Abstand lassen.</p>}
        </section>
      </aside>

      <main className="hunt-center">
        <div className="hunt-top">
          <HuntPlan scenario={s} selected={selected} onSelect={setSelected} onChange={patch} onStand={(k) => setS({ ...s, stand: k })} />
          <HuntPlayer program={program} format={format} frames={r.frames} onDriveTime={(d) => setDriveT(d ? d.time : null)} />
        </div>
        <HuntTimeline scenario={s} duration={duration} selected={selected} playhead={driveT} onSelect={setSelected} onChange={patch} />
      </main>

      <aside className="panel properties">
        {sel && counts ? (
          <section>
            <h3>Anlauf {s.crossings.indexOf(sel) + 1}</h3>
            <Row label="Start (s)">
              <NumberField value={sel.at} min={0} step={0.5} digits={1} onChange={(v) => patch(sel.id, { at: v })} />
            </Row>
            <Row label="Richtung">
              <Select value={sel.direction} options={[{ value: 'ltr', label: 'von links' }, { value: 'rtl', label: 'von rechts' }]} onChange={(v) => patch(sel.id, { direction: v })} />
            </Row>
            <Row label="Entfernung (m)">
              <SliderField value={sel.distance} min={15} max={80} step={1} digits={0} onChange={(v) => patch(sel.id, { distance: v })} />
            </Row>
            <Row label="Gangart">
              <Select value={sel.gait} options={Object.entries(GAITS).map(([v, g]) => ({ value: v as Crossing['gait'], label: g.label }))} onChange={(v) => patch(sel.id, { gait: v, speed: GAITS[v].speed })} />
            </Row>
            <Row label="Tempo (m/s)">
              <SliderField value={sel.speed} min={1} max={12} step={0.1} digits={1} onChange={(v) => patch(sel.id, { speed: v })} />
            </Row>
            <h4>Wild</h4>
            {GAME_ORDER.map((k) => (
              <Row key={k} label={GAME_CLASSES[k].label}>
                <NumberField
                  value={counts[k]}
                  min={0}
                  max={10}
                  step={1}
                  digits={0}
                  onChange={(v) => {
                    const next = animalsFrom({ ...counts, [k]: Math.round(v) });
                    if (next.length) patch(sel.id, { animals: next });
                  }}
                />
              </Row>
            ))}
            <Row label="Aufstellung" hint="Reihenfolge, Abstände und Größen der Rotte">
              <button onClick={() => patch(sel.id, { seed: Math.floor(Math.random() * 1e6) })}>neu würfeln</button>
            </Row>
            <h4>Auflösung</h4>
            <ol className="verdicts">
              {sounderOrder(sel.animals).map((k, i) => (
                <li key={i}>
                  <span>{GAME_CLASSES[k].label}</span>
                  {i === 0 && sel.animals.length > 1 && <em>vorn</em>}
                </li>
              ))}
            </ol>
            <p className="hint">Vorhalt ≈ {leadCm(sel)} cm vor das Blatt · sichtbar ca. {(crossingWindow(sel).leave - crossingWindow(sel).enter).toFixed(1)} s</p>
            <div className="inline">
              <button
                onClick={() => {
                  const c = { ...structuredClone(sel), id: newId('x'), at: sel.at + 20 };
                  setS({ ...s, crossings: [...s.crossings, c] });
                  setSelected(c.id);
                }}
              >
                Duplizieren
              </button>
              <button
                className="danger"
                onClick={() => {
                  setS({ ...s, crossings: s.crossings.filter((c) => c.id !== sel.id) });
                  setSelected(null);
                }}
              >
                Löschen
              </button>
            </div>
          </section>
        ) : (
          <p className="hint">Anlauf auswählen – im Plan, in der Zeitleiste oder in der Liste.</p>
        )}
        <HuntRenderPanel r={r} scenarios={scenarios} program={program} name={s.name} format={format} quality={quality} onFormat={setFormat} onQuality={setQuality} beforeRender={() => dirty && save()} />
      </aside>
    </div>
  );
};
