import { memo } from 'react';
import { ENVIRONMENT_LIST } from '../../assets/environments';
import { ASSET_LIST, type AssetCategory } from '../../assets/registry';
import type { EnvironmentId, ObjectType } from '../../types/stage';

export const DND_TYPE = 'application/x-dryfire-asset';

const SECTIONS: { title: string; category: AssetCategory }[] = [
  { title: 'Targets', category: 'target' },
  { title: 'Barriers', category: 'barrier' },
  { title: 'Other', category: 'other' },
];

interface Props {
  environment: EnvironmentId;
  onAdd: (type: ObjectType) => void;
  onEnvironment: (id: EnvironmentId) => void;
}

/** Left sidebar: click or drag an asset onto the stage; pick the environment. */
export const AssetLibrary = memo(function AssetLibrary({ environment, onAdd, onEnvironment }: Props) {
  return (
    <aside className="panel library">
      {SECTIONS.map((s) => (
        <section key={s.category}>
          <h3>{s.title}</h3>
          <div className="asset-grid">
            {ASSET_LIST.filter((a) => a.category === s.category).map((a) => (
              <button
                key={a.type}
                className="asset-tile"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_TYPE, a.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onAdd(a.type)}
                title={`Add ${a.label} (click or drag onto the stage)`}
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
      <section>
        <h3>Environments</h3>
        <div className="env-list">
          {ENVIRONMENT_LIST.map((e) => (
            <button key={e.id} className={`env-tile${e.id === environment ? ' active' : ''}`} onClick={() => onEnvironment(e.id)}>
              <img src={e.src} alt="" />
              <span>{e.label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
});
