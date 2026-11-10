import { useEffect, useState } from 'react';
import { BrandMark } from '../components/BrandMark';
import { AnalysisTab } from './tabs/AnalysisTab';
import { BodyTab } from './tabs/BodyTab';
import { LiveTab } from './tabs/LiveTab';
import { SettingsTab } from './tabs/SettingsTab';
import { TrainingTab } from './tabs/TrainingTab';
import { TraceController } from './TraceController';
import { TraceContext } from './useTrace';
import './trace.css';

export type TraceTab = 'training' | 'body' | 'live' | 'analysis' | 'settings';
export const TRACE_TABS: TraceTab[] = ['training', 'body', 'live', 'analysis', 'settings'];

interface Props {
  tab: TraceTab;
  onTab: (t: TraceTab) => void;
  onStageBuilder: () => void;
}

const LABEL: Record<TraceTab, string> = { training: 'Training', body: 'Body cam', live: 'Live', analysis: 'Analysis', settings: 'Settings' };

/**
 * FORTH TRACE on the phone: training control, camera tracking, analysis.
 * Mobile-first; the controller lives as long as this page (leaving it stops the camera).
 */
export const TraceApp = ({ tab, onTab, onStageBuilder }: Props) => {
  const [ctl] = useState(() => new TraceController());
  useEffect(() => () => ctl.dispose(), [ctl]);
  // dev builds only: a handle for the browser console (synthetic-frame latency test)
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __trace?: TraceController }).__trace = ctl;
  }, [ctl]);

  return (
    <TraceContext.Provider value={ctl}>
      <div className="trace">
        <header className="trace-bar">
          <div className="brand">
            <BrandMark height={22} />
            <div>
              <div className="brand-name">FORTH TRACE</div>
              <div className="brand-sub">MOTION TRACKING · EXPERIMENTAL</div>
            </div>
          </div>
        </header>
        <main className="trace-body">
          {tab === 'training' && <TrainingTab onGoLive={() => onTab('live')} />}
          {tab === 'body' && <BodyTab />}
          {tab === 'live' && <LiveTab />}
          {tab === 'analysis' && <AnalysisTab />}
          {tab === 'settings' && <SettingsTab />}
        </main>
        <nav className="trace-nav">
          <button onClick={onStageBuilder}>
            <span className="ico">▦</span>Stages
          </button>
          {TRACE_TABS.map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => onTab(t)}>
              <span className="ico">{t === 'training' ? '◎' : t === 'body' ? '◈' : t === 'live' ? '●' : t === 'analysis' ? '▤' : '⚙'}</span>
              {LABEL[t]}
            </button>
          ))}
        </nav>
      </div>
    </TraceContext.Provider>
  );
};
