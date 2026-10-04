import { useRef } from 'react';
import { BrandMark } from '../BrandMark';

interface Props {
  stageName: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  snap: boolean;
  onNew: () => void;
  onOpen: () => void;
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
      <div className="brand">
        <BrandMark height={26} />
        <div>
          <div className="brand-name">DRYFIRE STAGE STUDIO</div>
          <div className="brand-sub">FORTH TRACE</div>
        </div>
      </div>
      <div className="stage-title">
        {p.stageName}
        {p.dirty && <span className="dirty" title="Unsaved changes">●</span>}
      </div>
      <nav>
        <div className="group">
          <button onClick={p.onNew}>New</button>
          <button onClick={p.onOpen}>Load</button>
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
