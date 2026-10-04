import { forwardRef, useImperativeHandle, useRef } from 'react';
import type { Stage } from '../../types/stage';
import type { PlayerSnapshot } from '../../utils/schedule';

export interface OverlayHandle {
  update: (s: PlayerSnapshot) => void;
}

interface Props {
  stage: Stage;
  /** Small line above the stage name, e.g. "Match 01 · Stage 2/3". */
  caption?: string;
  showTimer: boolean;
  signalBorder: boolean;
}

/** Range commands: "Are you ready?" shows this long before STANDBY. */
const ASK_SECONDS = 1.6;

type Cue = 'ready' | 'reset' | 'time' | 'ask' | 'standby' | 'active' | '';

/** Range commands, all shown in the FORTH TRACE command card in the centre. */
const COMMAND: Partial<Record<Cue, string>> = {
  ready: 'Make Ready',
  ask: 'Are you ready?',
  standby: 'Standby',
  time: 'Time',
  reset: 'Reset',
};

/**
 * Minimal training HUD. Updated imperatively every animation frame
 * (no React re-render), so the clock stays smooth at 60 fps.
 */
export const PlayerOverlay = forwardRef<OverlayHandle, Props>(function PlayerOverlay({ stage, caption, showTimer, signalBorder }, ref) {
  const rep = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const timer = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const center = useRef<HTMLDivElement>(null);
  const cmdText = useRef<HTMLSpanElement>(null);
  const cmdRep = useRef<HTMLSpanElement>(null);
  const last = useRef({ cue: '' as Cue, rep: -1 });

  useImperativeHandle(ref, () => ({
    update(s) {
      const l = last.current;
      // "TIME" for the first second after the end beep, then "RESET" … "ARE YOU READY?" … "STANDBY"
      const afterEnd = s.phase === 'reset' && s.sinceStart < stage.parTime + 1;
      const cue: Cue = afterEnd
        ? 'time'
        : (s.phase === 'ready' || s.phase === 'reset') && s.untilStandby <= ASK_SECONDS
          ? 'ask'
          : (s.phase as Cue);
      if (s.rep !== l.rep && rep.current) rep.current.textContent = String(Math.max(1, s.rep));
      if (cue !== l.cue || s.rep !== l.rep) {
        const text = COMMAND[cue];
        if (text && cmdText.current) cmdText.current.textContent = text;
        if (cmdRep.current) cmdRep.current.textContent = `Rep ${Math.max(1, s.rep)} / ${stage.repetitions}`;
        if (center.current) center.current.className = `hud-cmd${text ? ` show ${cue}` : ''}`;
        if (root.current) root.current.dataset.signal = signalBorder ? (cue === 'time' ? 'time' : s.phase) : '';
      }
      if (bar.current) {
        bar.current.style.transform = `scaleX(${s.parProgress})`;
        bar.current.dataset.state = s.phase === 'active' ? 'active' : s.parProgress >= 1 ? 'done' : 'idle';
      }
      if (timer.current && showTimer) timer.current.textContent = s.elapsed.toFixed(2);
      last.current = { cue, rep: s.rep };
    },
  }));

  return (
    <div className="hud" ref={root}>
      <div className="hud-top">
        <div>
          {caption && <div className="hud-caption">{caption}</div>}
          <div className="hud-stage">{stage.name}</div>
        </div>
        <div className="hud-right">
          <div>
            <span className="hud-label">Par</span> {stage.parTime.toFixed(2)} s
          </div>
          <div>
            <span className="hud-label">Rep</span> <span ref={rep}>1</span>/{stage.repetitions}
          </div>
        </div>
      </div>
      <div className="hud-cmd" ref={center}>
        <span className="cmd-rep" ref={cmdRep} />
        <span className="cmd-text" ref={cmdText} />
        <span className="cmd-rule" />
      </div>
      <div className="hud-bottom">{showTimer && <div className="hud-timer" ref={timer}>0.00</div>}</div>
      <div className="hud-progress">
        <div ref={bar} />
      </div>
    </div>
  );
});
