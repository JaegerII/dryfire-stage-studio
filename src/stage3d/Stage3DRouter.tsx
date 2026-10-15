import { useRef, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { stageRepository } from '../data/stageRepository';
import { Editor3D } from './editor/Editor3D';
import { Player3D } from './Player3D';
import { createStage3D, fromStage2D, normalizeStage3D, stage3dRepository } from './repository';

export type Route3D = { kind: 'list' } | { kind: 'edit'; id: string } | { kind: 'play'; id: string };

interface Props {
  route: Route3D;
  go: (r: Route3D | 'home') => void;
}

/** All 3D pages (loaded on demand: three.js and the encoder stay out of the studio's main bundle). */
export default function Stage3DRouter({ route, go }: Props) {
  if (route.kind === 'edit') {
    const s = stage3dRepository.get(route.id);
    if (!s) return <Missing go={go} />;
    return <Editor3D key={route.id} initial={s} onExit={() => go({ kind: 'list' })} />;
  }
  if (route.kind === 'play') {
    const s = stage3dRepository.get(route.id);
    if (!s) return <Missing go={go} />;
    return <Player3D stage={s} onExit={() => go({ kind: 'list' })} />;
  }
  return <Stages3DPage go={go} />;
}

const Missing = ({ go }: { go: Props['go'] }) => (
  <div className="page">
    <main className="page-body">
      <p className="hint empty">This 3D stage does not exist (any more). <button onClick={() => go({ kind: 'list' })}>All 3D stages</button></p>
    </main>
  </div>
);

const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '');

/** Start page of the 3D stages: open, play, new, from a 2D stage, import. */
const Stages3DPage = ({ go }: { go: Props['go'] }) => {
  const [, refresh] = useState(0);
  const list = stage3dRepository.list();
  const stages2d = stageRepository.list();
  const file = useRef<HTMLInputElement>(null);

  const create = (s = createStage3D()) => {
    const saved = stage3dRepository.save(s);
    go({ kind: 'edit', id: saved.id });
  };

  return (
    <div className="page home stages3d">
      <header className="page-bar">
        <button className="brand-btn" onClick={() => go('home')} title="Back to the studio">
          <BrandMark height={28} />
          <div>
            <div className="brand-name">3D STAGES</div>
            <div className="brand-sub">FORTH TRACE · BETA</div>
          </div>
        </button>
        <div className="inline">
          <select
            value=""
            onChange={(e) => {
              const s2 = stageRepository.get(e.target.value);
              if (s2) create(fromStage2D(s2));
            }}
            title="Turn a classic stage into a 3D stage (targets and walls go to their floor positions)"
          >
            <option value="">From a 2D stage…</option>
            {stages2d.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button onClick={() => file.current?.click()}>Import JSON</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                create(normalizeStage3D(JSON.parse(await f.text())));
              } catch {
                alert('This file is not a 3D stage (JSON).');
              }
            }}
          />
          <button className="primary" onClick={() => create()}>
            + New 3D stage
          </button>
        </div>
      </header>
      <main className="page-body">
        <ul className="stage-list s3d-list">
          {list.map((s) => (
            <li key={s.id}>
              <div className="s3d-icon">3D</div>
              <div className="meta">
                <strong>{s.name}</strong>
                <span>
                  par {s.par.toFixed(1)} s · {s.positions} position{s.positions > 1 ? 's' : ''} · {s.objects} objects
                  {s.source ? ` · from 2D` : ''}
                  {s.builtIn ? ' · built-in' : s.updatedAt ? ` · ${date(s.updatedAt)}` : ''}
                </span>
              </div>
              <button onClick={() => go({ kind: 'edit', id: s.id })}>Edit</button>
              <button className="primary" onClick={() => go({ kind: 'play', id: s.id })}>
                ▶ Play / Render
              </button>
              {!s.builtIn && (
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(s.overridesBuiltIn ? `Discard your changes to "${s.name}"?` : `Delete "${s.name}" from this browser?`)) {
                      stage3dRepository.remove(s.id);
                      refresh((n) => n + 1);
                    }
                  }}
                >
                  {s.overridesBuiltIn ? 'Revert' : 'Delete'}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="hint">
          3D stages are saved in this browser. <b>Export JSON</b> in the editor keeps a copy; to ship a stage with the app, put the file into
          <code> src/stage3d/stages/</code>.
        </p>
      </main>
    </div>
  );
};
