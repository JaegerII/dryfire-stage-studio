import { useEffect, useMemo, useRef, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { NumberField, Row, Select, SliderField } from '../components/fields';
import { downloadBlob } from '../utils/recorder';
import { newId } from '../utils/random';
import { HuntRenderAborted, renderHuntMp4 } from './exportHunt';
import { HuntPlan, HuntTimeline, fmtTime } from './HuntPlan';
import { HuntPlayer } from './HuntPlayer';
import { huntProgram } from './program';
import { HuntFrames, type RenderJob, type RenderQuality, cancelRender, jobKey, pingService, renderStatus, startRender } from './renderService';
import { driveDuration, huntRepository, newCrossing, renderScenario } from './repository';
import { crossingWindow, describe, judge, leadCm } from './rules';
import { type Crossing, GAITS, GAME_CLASSES, GAME_ORDER, type GameClass, type HuntFormat, type HuntScenario, LANES } from './types';

const PHASES: Record<RenderJob['phase'], string> = {
  plate: 'Schneise (einmalig je Format)',
  animals: 'Wild, Bild für Bild',
  compose: 'Ausschnitte vorbereiten',
  done: 'Fertig',
  error: 'Fehler',
  cancelled: 'Abgebrochen',
};

/** Animals as counts per class → the list Blender gets (sow / boar first: the sounder's lead). */
const animalsFrom = (counts: Record<GameClass, number>): GameClass[] => GAME_ORDER.flatMap((k) => Array<GameClass>(counts[k]).fill(k));
const countsOf = (animals: GameClass[]) => Object.fromEntries(GAME_ORDER.map((k) => [k, animals.filter((a) => a === k).length])) as Record<GameClass, number>;

/**
 * Driven-hunt editor: release, crossings on a plan of the lane and a timeline, render in Blender through
 * the local render service, play it back with briefing and answer cards, export the MP4.
 */
export const HuntEditor = ({ initial, onExit, onDirtyChange }: { initial: HuntScenario; onExit: () => void; onDirtyChange?: (dirty: boolean) => void }) => {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [selected, setSelected] = useState<string | null>(initial.crossings[0]?.id ?? null);
  const [format, setFormat] = useState<HuntFormat>('16x9');
  const [quality, setQuality] = useState<RenderQuality>('preview');
  const [service, setService] = useState<{ ok: boolean; blender: boolean } | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const [frames, setFrames] = useState<HuntFrames | null>(null);
  const [driveT, setDriveT] = useState<number | null>(null);
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(s) !== saved;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const sel = s.crossings.find((c) => c.id === selected) ?? null;
  const patch = (id: string, p: Partial<Crossing>) => setS((x) => ({ ...x, crossings: x.crossings.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
  const save = () => {
    const out = huntRepository.save({ ...s, crossings: [...s.crossings].sort((a, b) => a.at - b.at) });
    setS(out);
    setSaved(JSON.stringify(out));
  };

  // ---------------------------------------------------------------- render service
  useEffect(() => {
    void pingService().then(setService);
  }, []);
  const key = jobKey(s, format, quality);
  const loadFrames = async () => {
    try {
      setFrames(await new HuntFrames(key).load());
    } catch {
      setFrames(null);
    }
  };
  useEffect(() => {
    setFrames(null);
    if (!service?.ok) return;
    // the running job, and an earlier render of this scenario / format that may be on disk
    void renderStatus().then(setJob);
    void loadFrames();
  }, [service, key]);
  useEffect(() => {
    if (!job || ['done', 'error', 'cancelled'].includes(job.phase)) return;
    const id = setInterval(async () => {
      const j = await renderStatus();
      setJob(j);
      if (j?.phase === 'done' && j.key === key) void loadFrames();
    }, 1000);
    return () => clearInterval(id);
  }, [job?.phase, key]);
  const running = !!job && !['done', 'error', 'cancelled'].includes(job.phase);
  const [renderedAs, setRenderedAs] = useState<string | null>(null);
  const render = async () => {
    if (dirty) save();
    try {
      setFrames(null);
      setRenderedAs(JSON.stringify(renderScenario(s)));
      setJob(await startRender(s, format, quality));
    } catch (e) {
      alert(`Render nicht gestartet: ${(e as Error).message}`);
    }
  };

  // ---------------------------------------------------------------- program (video timeline)
  const stale = !!frames && renderedAs !== null && renderedAs !== JSON.stringify(renderScenario(s));
  const program = useMemo(() => {
    const order = [...s.crossings].sort((a, b) => a.at - b.at);
    const leave = frames && !stale ? s.crossings.map((c) => frames.lastVisible(c.at, order.find((n) => n.at > c.at)?.at ?? 1e9)) : undefined;
    return huntProgram(s, format, leave);
  }, [s, format, frames, stale]);
  const duration = driveDuration(s);

  const exportMp4 = async () => {
    if (!frames) return;
    const ac = new AbortController();
    abort.current = ac;
    setExporting({ done: 0, total: 1 });
    try {
      const blob = await renderHuntMp4(program, format, frames, { signal: ac.signal, onProgress: (done, total) => setExporting({ done, total }) });
      downloadBlob(blob, `${s.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}_${format}_${frames.height}p.mp4`);
    } catch (e) {
      if (!(e instanceof HuntRenderAborted)) alert(`Export fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setExporting(null);
      abort.current = null;
    }
  };

  const verdicts = sel ? judge(sel, s.release) : [];
  const counts = sel ? countsOf(sel.animals) : null;
  const tooClose = s.crossings.some((c) => {
    const next = s.crossings.filter((n) => n.at > c.at).sort((a, b) => a.at - b.at)[0];
    return !!next && next.at < crossingWindow(c).leave + 0.6 + s.revealSeconds;
  });

  return (
    <div className="hunt-editor">
      <header className="toolbar">
        <button className="brand linkish" onClick={onExit} title="Zurück zur Übersicht">
          <BrandMark height={24} />
        </button>
        <div className="crumbs">
          <button className="linkish" onClick={onExit}>Drückjagd</button>
          <span>/</span>
          <input className="name-input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          {dirty && <span className="dirty">● nicht gespeichert</span>}
        </div>
        <nav>
          <div className="group">
            <button className="primary" onClick={save}>Speichern</button>
            <button
              onClick={() => {
                const copy = { ...structuredClone(s), id: newId('hunt'), name: `${s.name} (Kopie)` };
                setS(copy);
                setSaved('');
              }}
            >
              Duplizieren
            </button>
            <button onClick={() => downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), `${s.id}.json`)}>Export JSON</button>
          </div>
          <button onClick={onExit}>Zurück</button>
        </nav>
      </header>

      <aside className="panel library">
        <section>
          <h3>Schneise</h3>
          <p className="hint">{LANES[s.lane]} · Stand am linken Rand, Blick die Schneise hinunter</p>
        </section>
        <section>
          <h3>Freigabe</h3>
          {(
            [
              ['keiler', 'Keiler'],
              ['bache', 'Bache (nicht führend)'],
              ['ueberlaeufer', 'Überläufer'],
              ['frischling', 'Frischlinge'],
              ['gallop', 'Flüchtiges Wild'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={s.release[k]} onChange={(e) => setS({ ...s, release: { ...s.release, [k]: e.target.checked } })} /> {label}
            </label>
          ))}
          <Row label="Max. Entfernung">
            <SliderField value={s.release.maxDistance} min={20} max={80} step={5} digits={0} onChange={(v) => setS({ ...s, release: { ...s.release, maxDistance: v } })} />
          </Row>
          <p className="hint">Führende Bache und Leitbache sind nie frei.</p>
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
                const free = judge(c, s.release).filter((v) => v.free).length;
                return (
                  <li key={c.id}>
                    <button className={c.id === selected ? 'on' : ''} onClick={() => setSelected(c.id)}>
                      <strong>{fmtTime(c.at)}</strong> {describe(c.animals)}
                      <span>
                        {GAITS[c.gait].label} · {Math.round(c.distance)} m · {c.direction === 'ltr' ? '→' : '←'} · <em className={free ? 'go' : 'no'}>{free ? `${free} frei` : 'kein Schuss'}</em>
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
          <HuntPlan scenario={s} selected={selected} onSelect={setSelected} onChange={patch} />
          <HuntPlayer program={program} format={format} frames={frames} onDriveTime={setDriveT} />
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
            <ul className="verdicts">
              {verdicts.map((v, i) => (
                <li key={i} className={v.free ? 'go' : 'no'}>
                  <span>{v.free ? '✓' : '✕'} {GAME_CLASSES[v.kind].label}{v.lead ? ' (vorn)' : ''}</span>
                  <em>{v.free ? 'frei' : v.reason}</em>
                </li>
              ))}
            </ul>
            <p className="hint">Vorhalt ≈ {leadCm(sel)} cm · sichtbar ca. {(crossingWindow(sel).leave - crossingWindow(sel).enter).toFixed(1)} s</p>
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

        <section className="render-box">
          <h3>Rendern (Blender)</h3>
          <Row label="Format">
            <Select value={format} options={[{ value: '16x9', label: '16:9 · YouTube' }, { value: '9x16', label: '9:16 · Shorts' }]} onChange={setFormat} />
          </Row>
          <Row label="Qualität">
            <Select value={quality} options={[{ value: 'preview', label: 'Vorschau (halbe Auflösung)' }, { value: 'final', label: 'Final (Full HD, 256 Samples)' }]} onChange={setQuality} />
          </Row>
          {service && !service.ok && <p className="hint warn">Rendern geht nur, wenn das Studio lokal läuft (npm run dev).</p>}
          {service?.ok && !service.blender && <p className="hint warn">Blender nicht gefunden (Umgebungsvariable BLENDER setzen).</p>}
          {job && job.key === key && (
            <div className="render-progress">
              <span>
                {PHASES[job.phase]}
                {running && job.total > 0 ? ` · ${Math.round((100 * job.done) / job.total)} %` : ''} · {job.seconds} s
              </span>
              {running && (
                <div className="p3-bar">
                  <div style={{ width: `${job.total ? (100 * job.done) / job.total : 0}%` }} />
                </div>
              )}
              {job.error && <p className="hint warn">{job.error}</p>}
            </div>
          )}
          <div className="inline">
            <button className="primary" disabled={!service?.ok || !service.blender || running} onClick={() => void render()}>
              In Blender rendern
            </button>
            {running && <button onClick={() => void cancelRender()}>Abbrechen</button>}
          </div>
          <p className="hint">
            Die Schneise wird je Format einmal gerendert, danach nur noch das Wild. {dirty ? 'Ungespeicherte Änderungen werden vorher gespeichert.' : ''}
          </p>
          <h4>Video</h4>
          {exporting ? (
            <div className="render-progress">
              <span>MP4 · {Math.round((100 * exporting.done) / exporting.total)} %</span>
              <div className="p3-bar">
                <div style={{ width: `${(100 * exporting.done) / exporting.total}%` }} />
              </div>
              <button onClick={() => abort.current?.abort()}>Abbrechen</button>
            </div>
          ) : (
            <button className="primary" disabled={!frames} onClick={() => void exportMp4()} title={frames ? '' : 'Erst in Blender rendern'}>
              MP4 exportieren
            </button>
          )}
          {stale && <p className="hint warn">Szenario geändert – das Video zeigt noch den letzten Render.</p>}
          <p className="hint">Video {fmtTime(program.end)} · Briefing, Treiben, Auflösung · 30 fps</p>
        </section>
      </aside>
    </div>
  );
};
