import { useRef } from 'react';
import { BrandMark } from '../BrandMark';

export interface StageNav {
  index: number;
  count: number;
  onPrev?: () => void;
  onNext?: () => void;
}

interface Props {
  stageName: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  snap: boolean;
  matchName?: string;
  onHome: () => void;
  onBackToMatch?: () => void;
  /** Stage switcher inside a match: "◀ 2 / 3 ▶". */
  stageNav?: StageNav;
  onSave: () => void;
  onDuplicate: () => void;
  onImport: (file: File) => void;
  onExport: () => void;
  onReset: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onPlay: () => void;
}

export const EditorToolbar = (p: Props) => {
  const file = useRef<HTMLInputElement>(null);
  return (
    <header className="toolbar">
      <button className="brand linkish" onClick={p.onHome} title="All matches">
        <BrandMark height={26} />
      </button>
      <div className="crumbs stage-title">
        <button className="linkish" onClick={p.onHome}>Matches</button>
        <span>/</span>
        {p.matchName && p.onBackToMatch && (
          <>
            <button className="linkish" onClick={p.onBackToMatch}>{p.matchName}</button>
            <span>/</span>
          </>
        )}
        <strong>{p.stageName}</strong>
        {p.dirty && <span className="dirty" title="Unsaved changes">●</span>}
        {p.stageNav && (
          <span className="stage-nav">
            <button onClick={p.stageNav.onPrev} disabled={!p.stageNav.onPrev} title="Previous stage of this match">
              ◀
            </button>
            <em>
              Stage {p.stageNav.index + 1} / {p.stageNav.count}
            </em>
            <button onClick={p.stageNav.onNext} disabled={!p.stageNav.onNext} title="Next stage of this match">
              ▶
            </button>
          </span>
        )}
      </div>
      <nav>
        <div className="group">
          <button onClick={p.onSave} title="Ctrl+S">Save</button>
          <button onClick={p.onDuplicate}>Duplicate</button>
          <button onClick={p.onReset} disabled={!p.dirty} title="Revert to the last saved version">Reset</button>
        </div>
        <div className="group">
          <button onClick={() => file.current?.click()}>Import JSON</button>
          <button onClick={p.onExport}>Export JSON</button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onImport(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="group">
          <button onClick={p.onUndo} disabled={!p.canUndo} title="Ctrl+Z">Undo</button>
          <button onClick={p.onRedo} disabled={!p.canRedo} title="Ctrl+Y">Redo</button>
          <button className={p.showGrid ? 'on' : ''} onClick={p.onToggleGrid}>Grid</button>
          <button className={p.snap ? 'on' : ''} onClick={p.onToggleSnap}>Snap</button>
        </div>
        <button className="primary" onClick={p.onPlay}>▶ Play</button>
      </nav>
    </header>
  );
};
