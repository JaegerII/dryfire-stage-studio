import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Stage } from '../../types/stage';
import type { Phase, PlayerSnapshot } from '../../utils/schedule';

export interface OverlayHandle {
  update: (s: PlayerSnapshot) => void;
}

interface Props {
  stage: Stage;
  showTimer: boolean;
  signalBorder: boolean;
}

const STATUS: Partial<Record<Phase, { text: string; cls: string }>> = {
  ready: { text: 'Make Ready', cls: 'reset' },
  reset: { text: 'Reset', cls: 'reset' },
  standby: { text: 'Stand By', cls: 'standby' },
  active: { text: '', cls: 'active' },
};

/**
 * Minimal training HUD. Updated imperatively every animation frame
 * (no React re-render), so the clock stays smooth at 60 fps.
 */
export const PlayerOverlay = forwardRef<OverlayHandle, Props>(function PlayerOverlay({ stage, showTimer, signalBorder }, ref) {
  const rep = useRef<HTMLSpanElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const last = useRef({ phase: '' as Phase | '', rep: -1, timeShown: false });

  useImperativeHandle(ref, () => ({
    update(s) {
      const l = last.current;
      // "TIME" for the first second after the end beep, then "RESET"
      const afterEnd = s.phase === 'reset' && s.sinceStart < stage.parTime + 1;
      if (s.rep !== l.rep && rep.current) rep.current.textContent = String(Math.max(1, s.rep));
      if (s.phase !== l.phase || afterEnd !== l.timeShown) {
        const st = afterEnd ? { text: 'Time', cls: 'time' } : STATUS[s.phase] ?? { text: '', cls: '' };
        if (status.current) {
          status.current.textContent = st.text;
          status.current.className = `hud-status ${st.cls}`;
        }
        if (root.current) root.current.dataset.signal = signalBorder ? (afterEnd ? 'time' : s.phase) : '';
      }
      if (bar.current) {
        bar.current.style.transform = `scaleX(${s.parProgress})`;
        bar.current.dataset.state = s.phase === 'active' ? 'active' : s.parProgress >= 1 ? 'done' : 'idle';
      }
      if (timer.current && showTimer) timer.current.textContent = s.elapsed.toFixed(2);
      last.current = { phase: s.phase, rep: s.rep, timeShown: afterEnd };
    },
  }));

  return (
    <div className="hud" ref={root}>
      <div className="hud-top">
        <div className="hud-stage">{stage.name}</div>
        <div className="hud-right">
          <div>
            <span className="hud-label">Par</span> {stage.parTime.toFixed(2)} s
          </div>
          <div>
            <span className="hud-label">Rep</span> <span ref={rep}>1</span>/{stage.repetitions}
          </div>
        </div>
      </div>
      <div className="hud-bottom">
        {showTimer && <div className="hud-timer" ref={timer}>0.00</div>}
        <div className="hud-status" ref={status} />
      </div>
      <div className="hud-progress">
        <div ref={bar} />
      </div>
    </div>
  );
});
