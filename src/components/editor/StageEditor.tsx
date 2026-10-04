import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS } from '../../assets/registry';
import { stageRepository } from '../../data/stageRepository';
import { fit16x9, useElementSize } from '../../hooks/useElementSize';
import type { EnvironmentId, ObjectType, Stage, StageObject } from '../../types/stage';
import { newId } from '../../utils/random';
import { screenToStage } from '../../utils/view';
import { ENVIRONMENTS } from '../../assets/environments';
import { StageFormatError, createObject, createStage, exportStageFile, importStageFile } from '../../utils/stageIO';
import { StageCanvas } from '../stage/StageCanvas';
import { useStageHistory } from '../../hooks/useStageHistory';
import { AssetLibrary, DND_TYPE } from './AssetLibrary';
import { EditorToolbar } from './EditorToolbar';
import { PropertiesPanel } from './PropertiesPanel';
import { StageBrowser } from './StageBrowser';

const SNAP_STEP = 0.0125;
const DEFAULT_Y: Record<string, number> = { target: 0.62, barrier: 0.68, other: 0.97 };

interface Props {
  initial: Stage;
  /** Hidden while the player is open (state stays alive). */
  hidden: boolean;
  onPlay: (stage: Stage) => void;
  onStageIdChange: (id: string) => void;
}

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
};

export const StageEditor = ({ initial, hidden, onPlay, onStageIdChange }: Props) => {
  const { stage, update, commit, undo, redo, reset, canUndo, canRedo } = useStageHistory(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [areaRef, area] = useElementSize<HTMLDivElement>();
  const box = fit16x9(area.width, area.height);
  const dirty = JSON.stringify(stage) !== saved;
  const selectedObjs = stage.objects.filter((o) => selectedIds.includes(o.id));
  /** The single selected object (properties panel), undefined for none or many. */
  const selected = selectedObjs.length === 1 ? selectedObjs[0] : undefined;
  const selectedId = selected?.id ?? null;

  useEffect(() => onStageIdChange(stage.id), [stage.id, onStageIdChange]);
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
      update((s) => ({ ...s, objects: [...s.objects, obj] }));
      setSelectedIds([obj.id]);
    },
    [update, stage.objects, selectedId],
  );

  const duplicate = useCallback(() => {
    if (!selectedObjs.length) return;
    const copies: StageObject[] = selectedObjs.map((o) => ({
      ...structuredClone(o),
      id: newId(ASSETS[o.type].category),
      x: Math.min(1, o.x + 0.03),
      locked: false,
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

  const toggleLock = useCallback(() => {
    const lock = selectedObjs.some((o) => !o.locked);
    patchSelected(() => ({ locked: lock || undefined }));
  }, [selectedObjs, patchSelected]);

  /** Click: select only this (keeps a multi-selection when clicking one of its members, so the group can be dragged).
   *  Ctrl/Shift/Cmd-click: add or remove. Empty-area click without modifier: clear. */
  const onSelect = useCallback((id: string | null, additive = false) => {
    setSelectedIds((cur) => {
      if (id === null) return additive ? cur : [];
      if (additive) return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return cur.includes(id) ? cur : [id];
    });
  }, []);
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
      } else if (e.key.startsWith('Arrow') && selectedObjs.length) {
        e.preventDefault();
        const step = e.shiftKey ? 0.01 : 0.002;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] ?? [0, 0];
        patchSelected((o) => (o.locked ? null : { x: o.x + d[0], y: o.y + d[1] }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hidden, save, undo, redo, duplicate, remove, layer, toggleLock, patchSelected, selectedObjs, stage.objects]);

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
        onNew={() => confirmDiscard() && load(createStage())}
        onOpen={() => setBrowser(true)}
        onSave={save}
        onDuplicate={() => {
          const copy: Stage = { ...structuredClone(stage), id: newId('stage'), name: `${stage.name} (copy)` };
          load(copy);
          setSaved('');
          setToast('Duplicated — save to keep it');
        }}
        onImport={(f) =>
          importStageFile(f)
            .then((s) => {
              if (!confirmDiscard()) return;
              load(s);
              setSaved('');
              setToast(`Imported "${s.name}" — save to keep it`);
            })
            .catch((err) => alert(err instanceof StageFormatError ? err.message : 'Import failed.'))
        }
        onExport={() => exportStageFile(stage)}
        onReset={() => confirm('Revert to the last saved version?') && load(saved ? JSON.parse(saved) : createStage())}
        onUndo={undo}
        onRedo={redo}
        onToggleGrid={() => setShowGrid((v) => !v)}
        onToggleSnap={() => setSnap((v) => !v)}
        onPlay={() => onPlay(stage)}
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
        onToggleLock={toggleLock}
        onSelect={onPick}
        onClearSelection={() => setSelectedIds([])}
      />
      {browser && (
        <StageBrowser
          currentId={stage.id}
          onClose={() => setBrowser(false)}
          onOpen={(id) => {
            const s = stageRepository.get(id);
            if (s && confirmDiscard()) load(s);
            setBrowser(false);
          }}
          onPlay={(id) => {
            const s = stageRepository.get(id);
            setBrowser(false);
            if (s) onPlay(s);
          }}
        />
      )}
    </div>
  );
};
