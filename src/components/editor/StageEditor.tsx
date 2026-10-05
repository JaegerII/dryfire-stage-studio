import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS } from '../../assets/registry';
import { stageRepository } from '../../data/stageRepository';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import type { EnvironmentId, ObjectType, Stage, StageObject } from '../../types/stage';
import { newId } from '../../utils/random';
import { screenToStage } from '../../utils/view';
import { drawOrder, fromWorld, toWorld } from '../../utils/perspective';
import { ENVIRONMENTS } from '../../assets/environments';
import { StageFormatError, createObject, createStage, exportStageFile } from '../../utils/stageIO';
import { readImportFile, saveImportedMatch } from '../../utils/matchIO';
import { StageCanvas } from '../stage/StageCanvas';
import { useStageHistory } from '../../hooks/useStageHistory';
import { AssetLibrary, DND_TYPE } from './AssetLibrary';
import { EditorToolbar } from './EditorToolbar';
import { PropertiesPanel, type GroupMove } from './PropertiesPanel';

const SNAP_STEP = 0.0125;
const DEFAULT_Y: Record<string, number> = { target: 0.62, barrier: 0.68, banner: 0.68, other: 0.97 };

interface Props {
  initial: Stage;
  /** Hidden while the player is open (state stays alive). */
  hidden: boolean;
  /** Play the stage being edited (with unsaved changes). */
  onPlay: (stages: Stage[]) => void;
  /** Breadcrumb: "Matches / <matchName> / <stage>". */
  matchName?: string;
  onHome: () => void;
  onBackToMatch?: () => void;
  /** Lets the app warn before navigating away from unsaved changes. */
  onDirtyChange: (dirty: boolean) => void;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

export const StageEditor = ({ initial, hidden, onPlay, matchName, onHome, onBackToMatch, onDirtyChange }: Props) => {
  const { stage, update, commit, undo, redo, reset, canUndo, canRedo } = useStageHistory(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const dirty = JSON.stringify(stage) !== saved;
  const selectedObjs = stage.objects.filter((o) => selectedIds.includes(o.id));
  /** The single selected object (properties panel), undefined for none or many. */
  const selected = selectedObjs.length === 1 ? selectedObjs[0] : undefined;
  const selectedId = selected?.id ?? null;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // ---------------------------------------------------------------- stage ops
  const load = useCallback(
    (s: Stage) => {
      reset(s);
      setSaved(JSON.stringify(s));
      setSelectedIds([]);
    },
    [reset],
  );

  const confirmDiscard = () => !dirty || confirm('Discard unsaved changes?');

  const save = useCallback(() => {
    const s = stageRepository.save(stage);
    reset(s);
    setSaved(JSON.stringify(s));
    setToast('Stage saved');
  }, [stage, reset]);

  const patchStage = useCallback((patch: Partial<Stage>) => update((s) => ({ ...s, ...patch })), [update]);

  // Several objects can report a change in the same gesture (group drag / transform):
  // apply them all transiently and close the gesture once → one undo step.
  const commitQueued = useRef(false);
  const patchObject = useCallback(
    (id: string, patch: Partial<StageObject>, opts?: { transient?: boolean }) => {
      update((s) => ({ ...s, objects: s.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), { transient: true });
      if (opts?.transient || commitQueued.current) return;
      commitQueued.current = true;
      queueMicrotask(() => {
        commitQueued.current = false;
        commit();
      });
    },
    [update, commit],
  );

  /** One undoable change applied to every selected object. */
  const patchSelected = useCallback(
    (fn: (o: StageObject) => Partial<StageObject> | null) =>
      update((s) => ({
        ...s,
        objects: s.objects.map((o) => {
          if (!selectedIds.includes(o.id)) return o;
          const p = fn(o);
          return p ? { ...o, ...p } : o;
        }),
      })),
    [update, selectedIds],
  );

  const addObject = useCallback(
    (type: ObjectType, x = 0.5, y?: number) => {
      let obj = createObject(type, x, y ?? DEFAULT_Y[ASSETS[type].category]);
      // a box is selected → put stackable objects (card targets, steel) on top of it
      const base = stage.objects.find((o) => o.id === selectedId);
      const top = base && ASSETS[base.type].topHeight;
      if (top && ASSETS[type].stackable && y === undefined) {
        obj = { ...obj, x: base.x, y: base.y, zIndex: base.zIndex, elevation: +(top * base.scale + (base.elevation ?? 0)).toFixed(3) };
      }
      // a wall is selected → hang the banner on it (same spot and angle, drawn in front)
      if (base && ASSETS[base.type].category === 'barrier' && ASSETS[type].banner && y === undefined) {
        obj = { ...obj, x: base.x, y: base.y, yaw: base.yaw, zIndex: base.zIndex + 1, elevation: +(1.0 * base.scale + (base.elevation ?? 0)).toFixed(3) };
      }
      update((s) => ({ ...s, objects: [...s.objects, obj] }));
      setSelectedIds([obj.id]);
    },
    [update, stage.objects, selectedId],
  );

  const duplicate = useCallback(() => {
    if (!selectedObjs.length) return;
    // copied groups become new groups of their own
    const groups = new Map<string, string>();
    const copies: StageObject[] = selectedObjs.map((o) => ({
      ...structuredClone(o),
      id: newId(ASSETS[o.type].category),
      x: Math.min(1, o.x + 0.03),
      locked: false,
      group: o.group && (groups.get(o.group) ?? groups.set(o.group, newId('group')).get(o.group)),
    }));
    update((s) => ({ ...s, objects: [...s.objects, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  }, [selectedObjs, update]);

  const remove = useCallback(() => {
    const ids = selectedObjs.filter((o) => !o.locked).map((o) => o.id);
    if (!ids.length) return;
    update((s) => ({ ...s, objects: s.objects.filter((o) => !ids.includes(o.id)) }));
    setSelectedIds((cur) => cur.filter((id) => !ids.includes(id)));
  }, [selectedObjs, update]);

  const layer = useCallback((dir: 1 | -1) => patchSelected((o) => ({ zIndex: o.zIndex + dir })), [patchSelected]);

  /** Layers list: one object one layer to the front / back, without touching the selection. */
  const layerOf = useCallback(
    (id: string, dir: 1 | -1) =>
      update((s) => {
        // exactly one step past the neighbour in the real draw order: everything beyond the neighbour
        // moves one zIndex further out (keeps its own order), the object slots in between
        const order = drawOrder(s.objects);
        const i = order.findIndex((o) => o.id === id);
        const n = order[i + dir];
        if (i < 0 || !n) return s;
        const beyond = new Set(order.filter((_, k) => (dir > 0 ? k > i + 1 : k < i - 1)).map((o) => o.id));
        return {
          ...s,
          objects: s.objects.map((o) =>
            o.id === id ? { ...o, zIndex: n.zIndex + dir * 0.5 } : beyond.has(o.id) ? { ...o, zIndex: o.zIndex + dir } : o,
          ),
        };
      }),
    [update],
  );

  /** Group the selection (Ctrl+G) / dissolve the groups of the selection (Ctrl+Shift+G). */
  const group = useCallback(() => {
    if (selectedObjs.length < 2) return;
    const id = newId('group');
    patchSelected(() => ({ group: id }));
  }, [selectedObjs, patchSelected]);
  const ungroup = useCallback(() => patchSelected((o) => (o.group ? { group: undefined } : null)), [patchSelected]);

  /**
   * Move every selected object together in real meters: across, closer / further, up / down.
   * Positions go through the 3D floor, so a group keeps its layout and shrinks / grows with distance.
   */
  const moveGroup = useCallback(
    (m: GroupMove) => {
      const env = ENVIRONMENTS[stage.environment];
      patchSelected((o) => {
        if (o.locked) return null;
        const p: Partial<StageObject> = {};
        if (m.across || m.depth) {
          const w = toWorld(o.x, o.y, env);
          const n = fromWorld(w.X + (m.across ?? 0), Math.max(1, w.D + (m.depth ?? 0)), env);
          p.x = +n.x.toFixed(4);
          p.y = +Math.min(1.5, n.y).toFixed(4);
        }
        if (m.up) p.elevation = +Math.max(0, (o.elevation ?? 0) + m.up).toFixed(3) || undefined;
        return p;
      });
    },
    [patchSelected, stage.environment],
  );

  const toggleLock = useCallback(() => {
    const lock = selectedObjs.some((o) => !o.locked);
    patchSelected(() => ({ locked: lock || undefined }));
  }, [selectedObjs, patchSelected]);

  /** Click: select only this (keeps a multi-selection when clicking one of its members, so the group can be dragged).
   *  Ctrl/Shift/Cmd-click: add or remove. Empty-area click without modifier: clear. */
  const onSelect = useCallback(
    (id: string | null, additive = false) => {
      // a grouped object brings its whole group along
      const g = id && stage.objects.find((o) => o.id === id)?.group;
      const ids = id === null ? [] : g ? stage.objects.filter((o) => o.group === g).map((o) => o.id) : [id];
      setSelectedIds((cur) => {
        if (id === null) return additive ? cur : [];
        if (additive) return cur.includes(id) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((x) => !cur.includes(x))];
        return cur.includes(id) ? cur : ids;
      });
    },
    [stage.objects],
  );
  /** Object list: plain click always selects just that object. */
  const onPick = useCallback((id: string, additive: boolean) => {
    if (additive) onSelect(id, true);
    else setSelectedIds([id]);
  }, [onSelect]);
  const onEnvironment = useCallback((environment: EnvironmentId) => patchStage({ environment }), [patchStage]);
  const onAdd = useCallback((type: ObjectType) => addObject(type), [addObject]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    if (hidden) return;
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
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (e.shiftKey) ungroup();
        else group();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelectedIds(stage.objects.map((o) => o.id));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        remove();
      } else if (e.key === 'Escape') {
        setSelectedIds([]);
      } else if (e.key === ']' || e.key === 'PageUp') {
        layer(1);
      } else if (e.key === '[' || e.key === 'PageDown') {
        layer(-1);
      } else if (e.key.toLowerCase() === 'l' && !mod && selectedObjs.length) {
        toggleLock();
      } else if (e.key.startsWith('Arrow') && e.altKey && selectedObjs.length) {
        // Alt+arrows: move in meters (←/→ across, ↑/↓ further / closer); Alt+Shift+↑/↓: up / down
        e.preventDefault();
        if (e.shiftKey) {
          if (e.key === 'ArrowUp') moveGroup({ up: 0.05 });
          if (e.key === 'ArrowDown') moveGroup({ up: -0.05 });
        } else {
          const d = { ArrowLeft: { across: -0.25 }, ArrowRight: { across: 0.25 }, ArrowUp: { depth: 0.5 }, ArrowDown: { depth: -0.5 } }[e.key];
          if (d) moveGroup(d);
        }
      } else if (e.key.startsWith('Arrow') && selectedObjs.length) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        patchSelected((o) => (o.locked ? null : { x: o.x + d[0], y: o.y + d[1] }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, save, undo, redo, duplicate, remove, layer, group, ungroup, toggleLock, patchSelected, moveGroup, selectedObjs, stage.objects]);

  // ---------------------------------------------------------------- drop from library
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const type = e.dataTransfer.getData(DND_TYPE) as ObjectType;
    if (!type || !(type in ASSETS)) return;
    e.preventDefault();
    const r = (e.currentTarget.querySelector('.canvas-box') as HTMLElement).getBoundingClientRect();
    const sx = (e.clientX - r.left) / r.width;
    const sy = (e.clientY - r.top) / r.height;
    if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
    const { x, y } = screenToStage(sx, sy, stage, ENVIRONMENTS[stage.environment]);
    addObject(type, x, y);
  };

  const canvas = useMemo(
    () => (
      <StageCanvas
        stage={stage}
        width={box.width}
        height={box.height}
        interactive
        selectedIds={selectedIds}
        onSelect={onSelect}
        onChange={patchObject}
        showGrid={showGrid}
        snap={snap ? SNAP_STEP : 0}
      />
    ),
    [stage, box.width, box.height, selectedIds, onSelect, patchObject, showGrid, snap],
  );

  return (
    <div className="editor" style={hidden ? { display: 'none' } : undefined}>
      <EditorToolbar
        stageName={stage.name}
        dirty={dirty}
        canUndo={canUndo}
        canRedo={canRedo}
        showGrid={showGrid}
        snap={snap}
        matchName={matchName}
        onHome={onHome}
        onBackToMatch={onBackToMatch}
        onSave={save}
        onDuplicate={() => {
          const copy: Stage = { ...structuredClone(stage), id: newId('stage'), name: `${stage.name} (copy)` };
          load(copy);
          setSaved('');
          setToast('Duplicated — save to keep it');
        }}
        onImport={(f) =>
          readImportFile(f)
            .then((res) => {
              if (res.kind === 'match') {
                // a match bundle: store its stages + the match; it appears on the start page
                saveImportedMatch(res.match, res.stages);
                setToast(`Imported match "${res.match.name}" (${res.stages.length} stages) — see Matches`);
                return;
              }
              if (!confirmDiscard()) return;
              load(res.stage);
              setSaved('');
              setToast(`Imported "${res.stage.name}" — save to keep it`);
            })
            .catch((err) => alert(err instanceof StageFormatError ? err.message : 'Import failed.'))
        }
        onExport={() => exportStageFile(stage)}
        onReset={() => confirm('Revert to the last saved version?') && load(saved ? JSON.parse(saved) : createStage())}
        onUndo={undo}
        onRedo={redo}
        onToggleGrid={() => setShowGrid((v) => !v)}
        onToggleSnap={() => setSnap((v) => !v)}
        onPlay={() => onPlay([stage])}
      />
      <AssetLibrary environment={stage.environment} onAdd={onAdd} onEnvironment={onEnvironment} />
      <main className="canvas-area" ref={areaRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="canvas-box" style={{ width: box.width, height: box.height }}>
          {canvas}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </main>
      <PropertiesPanel
        stage={stage}
        selected={selected}
        selectedIds={selectedIds}
        onStage={patchStage}
        onObject={patchObject}
        onDuplicate={duplicate}
        onDelete={remove}
        onLayer={layer}
        onLayerOf={layerOf}
        onGroup={group}
        onUngroup={ungroup}
        onSelectGroup={(g) => setSelectedIds(stage.objects.filter((o) => o.group === g).map((o) => o.id))}
        onMove={moveGroup}
        onToggleLock={toggleLock}
        onSelect={onPick}
        onClearSelection={() => setSelectedIds([])}
      />
    </div>
  );
};
