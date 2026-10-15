import { useCallback, useEffect, useRef, useState } from 'react';
import { ENVIRONMENT_LIST } from '../../assets/environments';
import { ASSET_LIST } from '../../assets/registry';
import { BrandMark } from '../../components/BrandMark';
import type { ObjectType } from '../../types/stage';
import { newId } from '../../utils/random';
import { downloadBlob } from '../../utils/recorder';
import { Player3D } from '../Player3D';
import { readStageJson, stage3dRepository } from '../repository';
import { type Stage3D, isEnv3D } from '../types';
import { DND_TYPE, addObject, addPosition, duplicateObjects, groupObjects, moveObjects, patchObjects, patchPosition, removeObjects, removePosition, type Selection, setEnvironment, ungroupObjects } from './ops';
import { PlanView, type Tool } from './PlanView';
import { Preview3D, type PreviewMode } from './Preview3D';
import { Properties3D } from './Properties3D';
import { useHistory } from './useHistory';

const LIBRARY = [
  { title: 'Targets', items: ASSET_LIST.filter((a) => a.category === 'target') },
  { title: 'Barriers', items: ASSET_LIST.filter((a) => a.category === 'barrier') },
  { title: 'Other', items: ASSET_LIST.filter((a) => a.category === 'other' && a.type !== 'start_box') },
];
/** Things that sit on a box when a box is selected (like in the 2D editor). */
const STACKABLE = (t: ObjectType) => /_card$|^no_shoot_overlay$|^steel_/.test(t);
const BOX_TOP: Partial<Record<ObjectType, number>> = { crate: 0.6, crate_wide: 0.6 };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

interface Props {
  initial: Stage3D;
  /** Back to where the editor was opened from (the studio or a match). */
  onExit: () => void;
  /** Set when the stage is edited as part of a match: shown in the breadcrumb. */
  matchName?: string;
  /** Previous / next stage of that match. */
  stageNav?: { index: number; count: number; onPrev?: () => void; onNext?: () => void };
  /** Unsaved changes (the app asks before leaving). */
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * Top-view editor for 3D stages: plan in meters on the left, live 3D view on
 * the right, exact values in the panel. Saves to this browser; JSON export
 * for the archive / for shipping a stage with the app.
 */
export const Editor3D = ({ initial, onExit, matchName, stageNav, onDirtyChange }: Props) => {
  const { doc: stage, update, commit, undo, redo, reset, canUndo, canRedo } = useHistory<Stage3D>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [snap, setSnap] = useState(true);
  const [mode, setMode] = useState<PreviewMode>('pov');
  const [povIndex, setPovIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(stage) !== saved;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // the preview follows the selected position
  useEffect(() => {
    if (selection?.kind === 'position') setPovIndex(selection.index);
    if (selection?.kind === 'leg') setPovIndex(selection.index + 1);
  }, [selection]);

  // warn before closing the tab with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useCallback(() => {
    const s = stage3dRepository.save(stage);
    reset(s);
    setSaved(JSON.stringify(s));
    setToast('Stage saved');
  }, [stage, reset]);

  const leave = (to: () => void) => () => {
    if (dirty && !confirm('Leave the editor? Unsaved changes will be lost.')) return;
    onDirtyChange?.(false);
    to();
  };
  const exit = leave(onExit);

  // ---------------------------------------------------------------- adding
  /** Where a clicked library item lands: ~7 m in front of the position in view. */
  const spawnPoint = () => {
    const p = stage.positions[Math.min(povIndex, stage.positions.length - 1)];
    const h = (p.heading * Math.PI) / 180;
    const n = stage.objects.length % 5;
    return { x: p.x + Math.sin(h) * 7 + (n - 2) * 0.8, d: p.d + Math.cos(h) * 7 };
  };

  const add = (type: ObjectType, x?: number, d?: number) => {
    // a box is selected → cards / steel go on top of it
    const sel = selection?.kind === 'objects' && selection.ids.length === 1 ? stage.objects.find((o) => o.id === selection.ids[0]) : undefined;
    const top = sel && BOX_TOP[sel.type];
    let r;
    if (top && STACKABLE(type) && x === undefined) r = addObject(stage, type, sel.x, sel.d, { elevation: top + (sel.elevation ?? 0), yaw: sel.yaw });
    else {
      const p = x === undefined || d === undefined ? spawnPoint() : { x, d };
      r = addObject(stage, type, p.x, p.d);
    }
    update(() => r.stage);
    setSelection({ kind: 'objects', ids: [r.id] });
    setTool('select');
  };

  const placePosition = (x: number, d: number) => {
    const prev = stage.positions[stage.positions.length - 1];
    const r = addPosition(stage, x, d, prev?.heading ?? 0);
    update(() => r.stage);
    setSelection({ kind: 'position', index: r.index });
    setTool('select');
  };

  const remove = useCallback(() => {
    if (selection?.kind === 'objects') update((s) => removeObjects(s, selection.ids));
    else if (selection?.kind === 'position') update((s) => removePosition(s, selection.index));
    else return;
    setSelection(null);
  }, [selection, update]);

  const duplicate = useCallback(() => {
    if (selection?.kind !== 'objects') return;
    const r = duplicateObjects(stage, selection.ids);
    update(() => r.stage);
    setSelection({ kind: 'objects', ids: r.ids });
  }, [selection, stage, update]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (playing) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if (isTyping(e)) return;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
      } else if (mod && e.key.toLowerCase() === 'g' && selection?.kind === 'objects') {
        e.preventDefault();
        if (e.shiftKey) update((s) => ungroupObjects(s, selection.ids));
        else update((s) => groupObjects(s, selection.ids));
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection({ kind: 'objects', ids: stage.objects.map((o) => o.id) });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        remove();
      } else if (e.key === 'Escape') {
        setSelection(null);
        setTool('select');
      } else if (e.key.toLowerCase() === 'p') {
        setTool((t) => (t === 'position' ? 'select' : 'position'));
      } else if ((e.key.toLowerCase() === 'q' || e.key.toLowerCase() === 'e') && selection) {
        const step = (e.shiftKey ? 5 : 15) * (e.key.toLowerCase() === 'q' ? -1 : 1);
        if (selection.kind === 'objects') update((s) => patchObjects(s, selection.ids, (o) => ({ yaw: ((o.yaw ?? 0) + step + 540) % 360 - 180 })));
        if (selection.kind === 'position') update((s) => patchPosition(s, selection.index, { heading: s.positions[selection.index].heading + step }));
      } else if (e.key.startsWith('Arrow') && selection?.kind === 'objects') {
        e.preventDefault();
        const st = e.shiftKey ? 0.5 : 0.05;
        const [dx, dd] = ({ ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] } as Record<string, number[]>)[e.key] ?? [0, 0];
        update((s) => moveObjects(s, selection.ids, dx, dd));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, save, undo, redo, duplicate, remove, selection, stage.objects, update]);

  // ---------------------------------------------------------------- import / export
  const importFile = async (f: File) => {
    try {
      const s = readStageJson(JSON.parse(await f.text()));
      if (dirty && !confirm('Discard unsaved changes?')) return;
      reset(s);
      setSaved('');
      setSelection(null);
      setToast(`Imported "${s.name}" — save to keep it`);
    } catch {
      alert('This file is not a stage (JSON).');
    }
  };

  return (
    <div className="editor3d">
      <header className="toolbar">
        <button className="brand linkish" onClick={exit} title={matchName ? 'Back to the match' : 'Back to the studio'}>
          <BrandMark height={24} />
        </button>
        <div className="crumbs">
          <button className="linkish" onClick={exit}>{matchName ?? 'Stages'}</button>
          <span>/</span>
          <strong>{stage.name}</strong>
          {dirty && <span className="dirty">● unsaved</span>}
          {stageNav && (
            <span className="stage-nav">
              <button className="linkish" disabled={!stageNav.onPrev} onClick={stageNav.onPrev && leave(stageNav.onPrev)} title="Previous stage of the match">‹</button>
              Stage {stageNav.index + 1} / {stageNav.count}
              <button className="linkish" disabled={!stageNav.onNext} onClick={stageNav.onNext && leave(stageNav.onNext)} title="Next stage of the match">›</button>
            </span>
          )}
        </div>
        <nav>
          <div className="group">
            <button className="primary" onClick={save} title="Ctrl+S">Save</button>
            <button
              onClick={() => {
                const copy = { ...structuredClone(stage), id: newId('stage'), name: `${stage.name} (copy)` };
                reset(copy);
                setSaved('');
                setToast('Duplicated — save to keep it');
              }}
            >
              Duplicate
            </button>
          </div>
          <div className="group">
            <button onClick={undo} disabled={!canUndo} title="Ctrl+Z">Undo</button>
            <button onClick={redo} disabled={!canRedo} title="Ctrl+Y">Redo</button>
          </div>
          <div className="group">
            <button className={tool === 'position' ? 'on' : ''} onClick={() => setTool((t) => (t === 'position' ? 'select' : 'position'))} title="P — then click the floor">
              + Position
            </button>
            <button className={snap ? 'on' : ''} onClick={() => setSnap((v) => !v)} title="Move in 10 cm steps">Snap</button>
          </div>
          <div className="group">
            <button onClick={() => file.current?.click()}>Import JSON</button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            <button onClick={() => downloadBlob(new Blob([JSON.stringify(stage, null, 2)], { type: 'application/json' }), `${stage.id}.json`)}>Export JSON</button>
          </div>
          <button className="primary" onClick={() => setPlaying(true)}>
            ▶ Play / Render
          </button>
        </nav>
      </header>

      <aside className="panel library">
        <section>
          <h3>Environment</h3>
          <div className="env-list">
            {ENVIRONMENT_LIST.map((env) => {
              const available = isEnv3D(env.id);
              return (
                <button
                  key={env.id}
                  className={`env-tile${env.id === stage.environment ? ' active' : ''}`}
                  disabled={!available}
                  title={available ? `Stage in ${env.label}` : 'Not available in 3D yet'}
                  onClick={() => available && update((s) => setEnvironment(s, env.id as Stage3D['environment']))}
                >
                  <img src={env.src} alt="" />
                  <span>
                    {env.label}
                    {!available && ' · soon'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {LIBRARY.map((sec) => (
          <section key={sec.title}>
            <h3>{sec.title}</h3>
            <div className="asset-grid">
              {sec.items.map((a) => (
                <button
                  key={a.type}
                  className="asset-tile"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, a.type);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => add(a.type)}
                  title={`Add ${a.label} — click, or drag onto the plan`}
                >
                  <span className="thumb">
                    <img src={a.src} alt="" draggable={false} />
                  </span>
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </aside>

      <main className="e3d-center">
        <PlanView
          stage={stage}
          selection={selection}
          onSelect={(s) => setSelection(s)}
          onUpdate={update}
          onCommit={commit}
          tool={tool}
          onPlacePosition={placePosition}
          snap={snap}
          onDropAsset={(type, x, d) => add(type, x, d)}
        />
        <Preview3D stage={stage} position={povIndex} mode={mode} onMode={setMode} />
        {tool === 'position' && <div className="toast">Click the floor to place shooting position {stage.positions.length + 1} · Esc cancels</div>}
        {toast && <div className="toast">{toast}</div>}
      </main>

      <Properties3D stage={stage} selection={selection} onUpdate={(fn) => update(fn)} onDelete={remove} onDuplicate={duplicate} />

      {playing && <Player3D stages={[stage]} onExit={() => setPlaying(false)} />}
    </div>
  );
};
