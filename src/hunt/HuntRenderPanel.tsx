import { Row, Select } from '../components/fields';
import { fmtTime } from './HuntPlan';
import type { HuntProgram } from './program';
import type { RenderQuality } from './renderService';
import type { HuntFormat, HuntScenario } from './types';
import { PHASES, type useHuntRender } from './useHuntRender';

/** Format, quality, Blender render (one scenario or a whole hunt) and the MP4 export. */
export const HuntRenderPanel = ({
  r,
  scenarios,
  program,
  name,
  format,
  quality,
  onFormat,
  onQuality,
  beforeRender,
}: {
  r: ReturnType<typeof useHuntRender>;
  scenarios: HuntScenario[];
  program: HuntProgram;
  name: string;
  format: HuntFormat;
  quality: RenderQuality;
  onFormat: (f: HuntFormat) => void;
  onQuality: (q: RenderQuality) => void;
  /** e.g. save unsaved changes first */
  beforeRender?: () => void;
}) => {
  const missing = r.frames.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  const stale = scenarios.filter((s) => r.stale(s));
  const multi = scenarios.length > 1;
  return (
    <section className="render-box">
      <h3>Rendern (Blender)</h3>
      <Row label="Format">
        <Select value={format} options={[{ value: '16x9', label: '16:9 · YouTube' }, { value: '9x16', label: '9:16 · Shorts' }]} onChange={onFormat} />
      </Row>
      <Row label="Qualität">
        <Select value={quality} options={[{ value: 'preview', label: 'Vorschau (halbe Auflösung)' }, { value: 'final', label: 'Final (Full HD, 256 Samples)' }]} onChange={onQuality} />
      </Row>
      {r.service && !r.service.ok && <p className="hint warn">Rendern geht nur, wenn das Studio lokal läuft (npm run dev). Die 3D-Vorschau geht überall.</p>}
      {r.service?.ok && !r.service.blender && <p className="hint warn">Blender nicht gefunden (Umgebungsvariable BLENDER setzen).</p>}
      {multi && <p className="hint">Gerendert: {scenarios.length - missing.length} / {scenarios.length} Szenarien</p>}
      {r.running && r.job && (
        <div className="render-progress">
          <span>
            {r.queue && multi ? `Szenario ${r.queue.index + 1} / ${r.queue.total} · ` : ''}
            {PHASES[r.job.phase]}
            {r.job.total > 0 ? ` · ${Math.round((100 * r.job.done) / r.job.total)} %` : ''} · {r.job.seconds} s
          </span>
          <div className="p3-bar">
            <div style={{ width: `${r.job.total ? (100 * r.job.done) / r.job.total : 0}%` }} />
          </div>
        </div>
      )}
      {!r.running && r.job?.error && <p className="hint warn">{r.job.error}</p>}
      <div className="inline">
        <button
          className="primary"
          disabled={!r.service?.ok || !r.service.blender || r.running}
          onClick={() => {
            beforeRender?.();
            void r.render(multi && missing.length && missing.length < scenarios.length ? missing : undefined);
          }}
        >
          {multi ? (missing.length && missing.length < scenarios.length ? `Fehlende rendern (${missing.length})` : 'Alle rendern') : 'In Blender rendern'}
        </button>
        {r.running && <button onClick={r.cancel}>Abbrechen</button>}
      </div>
      <p className="hint">Die Schneise wird je Stand und Format einmal gerendert, danach nur noch das Wild. Unveränderte Szenarien werden nicht neu gerendert.</p>
      <h4>Video</h4>
      {r.exporting ? (
        <div className="render-progress">
          <span>MP4 · {Math.round((100 * r.exporting.done) / r.exporting.total)} %</span>
          <div className="p3-bar">
            <div style={{ width: `${(100 * r.exporting.done) / r.exporting.total}%` }} />
          </div>
          <button onClick={r.abortExport}>Abbrechen</button>
        </div>
      ) : (
        <button className="primary" disabled={!!missing.length || r.running} onClick={() => void r.exportMp4(program, name)} title={missing.length ? 'Erst alle Szenarien in Blender rendern' : ''}>
          MP4 exportieren
        </button>
      )}
      {!!stale.length && <p className="hint warn">Geändert seit dem Render: {stale.map((s) => s.name).join(', ')} – neu rendern.</p>}
      <p className="hint">Video {fmtTime(program.end)} · 30 fps</p>
    </section>
  );
};
