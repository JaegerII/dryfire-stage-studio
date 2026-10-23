import { useMemo, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { newId } from '../utils/random';
import { ReleaseFields } from './HuntEditor';
import { fmtTime } from './HuntPlan';
import { HuntPlayer } from './HuntPlayer';
import { HuntRenderPanel } from './HuntRenderPanel';
import { MAPS, MAP_IDS, type MapId, standThumb } from './maps';
import { huntProgram } from './program';
import type { RenderQuality } from './renderService';
import { createScenario, huntRepository, huntScenarios, scenarioRepository } from './repository';
import { judge } from './rules';
import { type Hunt, type HuntFormat, MAX_SCENARIOS } from './types';
import { useHuntRender } from './useHuntRender';

/**
 * One driven hunt (≙ match page): up to nine scenarios in play order (add, reorder, open, remove), the
 * release for the whole hunt, and the whole hunt played / rendered / exported as one video.
 */
export const HuntMatchPage = ({ huntId, onHome, onOpenHunt, onOpenScenario }: { huntId: string; onHome: () => void; onOpenHunt: (id: string) => void; onOpenScenario: (id: string) => void }) => {
  const [hunt, setHunt] = useState<Hunt | undefined>(() => huntRepository.get(huntId));
  const [format, setFormat] = useState<HuntFormat>('16x9');
  const [quality, setQuality] = useState<RenderQuality>('preview');
  const [addMap, setAddMap] = useState<MapId>('buche_herbst');
  const listed = huntRepository.list().find((h) => h.id === huntId);
  const scenarios = useMemo(() => (hunt ? huntScenarios(hunt) : []), [hunt]);
  const r = useHuntRender(scenarios, format, quality);
  const program = useMemo(() => {
    const leave = scenarios.map((s, i) => {
      const f = r.frames[i];
      if (!f || r.stale(s)) return s.crossings.map(() => null);
      const order = [...s.crossings].sort((a, b) => a.at - b.at);
      return s.crossings.map((c) => f.lastVisible(c.at, order.find((n) => n.at > c.at)?.at ?? 1e9));
    });
    return huntProgram({ name: hunt?.name ?? '', release: hunt?.release ?? scenarios[0]?.release, scenarios, isHunt: true, intro: hunt?.intro }, format, leave);
  }, [hunt, scenarios, format, r.frames]);

  if (!hunt)
    return (
      <div className="page">
        <p className="hint empty">
          Drückjagd nicht gefunden. <button onClick={onHome}>Zurück</button>
        </p>
      </div>
    );

  const save = (h: Hunt) => setHunt(huntRepository.save(h));
  const all = scenarioRepository.list();
  const full = hunt.scenarioIds.length >= MAX_SCENARIOS;

  return (
    <div className="page match-page hunt-page">
      <header className="page-bar">
        <button className="brand linkish" onClick={onHome} title="Alle Drückjagden">
          <BrandMark height={28} />
        </button>
        <div className="crumbs">
          <button className="linkish" onClick={onHome}>Drückjagden</button>
          <span>/</span>
          <strong>{hunt.name}</strong>
          {hunt.archived && <span className="badge archived">Archiviert</span>}
        </div>
        <div className="inline">
          <button onClick={() => save({ ...hunt, archived: !hunt.archived })}>{hunt.archived ? 'Wiederherstellen' : 'Archivieren'}</button>
          <button
            onClick={() => {
              const copy = huntRepository.save({ ...structuredClone(hunt), id: newId('hunt'), name: `${hunt.name} (Kopie)`, archived: false });
              onOpenHunt(copy.id);
            }}
          >
            Duplizieren
          </button>
          {!listed?.builtIn && (
            <button
              className="danger"
              onClick={() => {
                if (!confirm(`Drückjagd „${hunt.name}“ löschen? Die Szenarien bleiben erhalten.`)) return;
                huntRepository.remove(hunt.id);
                onHome();
              }}
            >
              Löschen
            </button>
          )}
        </div>
      </header>

      <main className="hunt-page-body">
        <section className="hunt-page-left">
          <input className="match-name" value={hunt.name} onChange={(e) => save({ ...hunt, name: e.target.value })} />
          <textarea rows={2} placeholder="Beschreibung" value={hunt.description ?? ''} onChange={(e) => save({ ...hunt, description: e.target.value })} />
          <div className="hint">
            {scenarios.length} / {MAX_SCENARIOS} Szenarien · Video ≈ {fmtTime(program.end)}
          </div>
          <label className="check-row">
            <input type="checkbox" checked={hunt.intro !== false} onChange={(e) => save({ ...hunt, intro: e.target.checked })} /> Briefing vor dem ersten Szenario
          </label>

          <h3>Szenarien</h3>
          <ol className="stage-list match-stages">
            {hunt.scenarioIds.map((id, i) => {
              const s = scenarios.find((x) => x.id === id);
              const move = (d: number) => {
                const ids = [...hunt.scenarioIds];
                [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
                save({ ...hunt, scenarioIds: ids });
              };
              const free = s ? s.crossings.flatMap((c) => judge(c, hunt.release)).filter((v) => v.free).length : 0;
              return (
                <li key={`${id}-${i}`}>
                  <span className="order">{i + 1}</span>
                  {s ? <img src={standThumb(s.map, s.stand)} alt="" /> : <span className="missing-thumb" />}
                  <button className="meta linkish" disabled={!s} onClick={() => onOpenScenario(id)} title="Szenario bearbeiten">
                    <strong>{s?.name ?? id}</strong>
                    <span>{s ? `${MAPS[s.map].label} · Stand ${s.stand + 1} · ${s.crossings.length} Anläufe · ${free} frei` : 'Szenario nicht gefunden'}</span>
                  </button>
                  <div className="inline">
                    <button disabled={i === 0} onClick={() => move(-1)} title="Nach oben">↑</button>
                    <button disabled={i === hunt.scenarioIds.length - 1} onClick={() => move(1)} title="Nach unten">↓</button>
                    <button onClick={() => save({ ...hunt, scenarioIds: hunt.scenarioIds.filter((_, k) => k !== i) })} title="Aus der Drückjagd entfernen">✕</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="inline add-row">
            <select value={addMap} onChange={(e) => setAddMap(e.target.value as MapId)} disabled={full}>
              {MAP_IDS.map((m) => (
                <option key={m} value={m}>{MAPS[m].label}</option>
              ))}
            </select>
            <button
              className="primary"
              disabled={full}
              onClick={() => {
                const s = scenarioRepository.save(createScenario(addMap, (hunt.scenarioIds.length % 3) as 0 | 1 | 2));
                save({ ...hunt, scenarioIds: [...hunt.scenarioIds, s.id] });
              }}
            >
              + Neues Szenario
            </button>
            <select
              value=""
              disabled={full}
              onChange={(e) => e.target.value && save({ ...hunt, scenarioIds: [...hunt.scenarioIds, e.target.value] })}
            >
              <option value="">+ Vorhandenes Szenario …</option>
              {all.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({MAPS[s.map].short}, Stand {s.stand + 1})
                </option>
              ))}
            </select>
          </div>
          {full && <p className="hint">Höchstens {MAX_SCENARIOS} Szenarien pro Drückjagd.</p>}

          <h3>Freigabe (ganze Drückjagd)</h3>
          <ReleaseFields release={hunt.release} onChange={(release) => save({ ...hunt, release })} />
        </section>

        <section className="hunt-page-right">
          {scenarios.length ? (
            <HuntPlayer program={program} format={format} frames={r.frames} />
          ) : (
            <p className="hint empty">Noch keine Szenarien – links eines hinzufügen.</p>
          )}
          <HuntRenderPanel r={r} scenarios={scenarios} program={program} name={hunt.name} format={format} quality={quality} onFormat={setFormat} onQuality={setQuality} />
        </section>
      </main>
    </div>
  );
};
