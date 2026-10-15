import { useEffect, useRef, useState } from 'react';
import { CALIBRATION_MS, type CalibrationResult, calibrate } from '../../motion/calibration';
import { type BodyFrame, toBodyFrame } from '../../motion/features';
import { drawSkeleton } from '../../pose/drawSkeleton';
import { ISSUE_TEXT } from '../../pose/quality';
import { STATE_TEXT } from '../format';
import { analyzerConfig } from '../TrainingRun';
import { useTicker, useTrace } from '../useTrace';

/** Time to walk from the phone to the training position before calibration starts. */
const WALK_MS = 6000;

/** Short sine beep — the athlete stands meters away and cannot read the screen. */
const beep = (() => {
  let ctx: AudioContext | null = null;
  return (freq: number, dur = 0.18) => {
    ctx ??= new AudioContext();
    void ctx.resume();
    if (!freq) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
  };
})();

export const LiveTab = () => {
  const c = useTrace();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const snap = c.pipeline.poll();
  useTicker(250, snap.camera === 'live');
  const [calib, setCalib] = useState<{ from: number; until: number; frames: (BodyFrame | null)[] } | null>(null);
  const [calibResult, setCalibResult] = useState<CalibrationResult | null>(null);
  const mirror = c.settings.mirrorPreview;

  // the pipeline's <video> lives outside React: mount it here while this tab is open
  useEffect(() => {
    const el = box.current;
    const v = c.pipeline.video;
    if (!el) return;
    el.prepend(v);
    void v.play().catch(() => undefined);
    return () => v.remove();
  }, [c.pipeline]);

  // skeleton at camera rate, drawn directly (no React render per frame)
  useEffect(() => {
    if (!c.settings.showSkeleton) {
      const cv = canvas.current;
      cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
      return;
    }
    return c.pipeline.onFrame((f, q) => {
      const cv = canvas.current;
      if (!cv) return;
      if (cv.width !== f.width || cv.height !== f.height) {
        cv.width = f.width;
        cv.height = f.height;
      }
      drawSkeleton(cv, f, q.level, mirror);
    });
  }, [c.pipeline, c.settings.showSkeleton, mirror]);

  // calibration: time to walk to the position, beep, collect 3 s of frames, beep, evaluate
  useEffect(() => {
    if (!calib) return;
    const minQ = analyzerConfig(c.settings).minQuality;
    const startBeep = window.setTimeout(() => beep(880), calib.from - performance.now());
    const off = c.pipeline.onFrame((f, q) => {
      if (f.t < calib.from) return;
      calib.frames.push(toBodyFrame(f, q, minQ));
      if (f.t >= calib.until) {
        off();
        beep(660, 0.35);
        const r = calibrate(calib.frames);
        setCalibResult(r);
        setCalib(null);
        c.updateSettings({ calibration: r });
      }
    });
    return () => {
      clearTimeout(startBeep);
      off();
    };
  }, [calib, c]);

  const q = snap.quality;
  const view = c.run?.view();
  const live = snap.camera === 'live';

  return (
    <div className="trace-stack">
      <div className={`cam${mirror ? ' mirror' : ''}`} ref={box}>
        <canvas ref={canvas} className="cam-overlay" />
        {!live && (
          <div className="cam-empty">
            {snap.camera === 'starting' ? 'Starting camera…' : snap.camera === 'error' ? snap.cameraError : 'Camera off'}
          </div>
        )}
        {live && snap.tracker !== 'ready' && <div className="cam-badge">{snap.tracker === 'loading' ? 'Loading pose model…' : snap.trackerError}</div>}
        {live && q && <div className={`cam-quality q-${q.level}`}>{q.level === 'good' ? 'Tracking good' : q.level === 'partial' ? 'Tracking partial' : q.level === 'poor' ? 'Tracking poor' : 'No tracking'}</div>}
        {calib && (
          <div className="cam-calib">
            {performance.now() < calib.from
              ? `Go to your start position… ${Math.ceil((calib.from - performance.now()) / 1000)}`
              : `Stand still… ${Math.max(0, Math.ceil((calib.until - performance.now()) / 1000))}`}
          </div>
        )}
      </div>

      <div className="inline wrap">
        {!live ? (
          <button className="primary" onClick={() => void c.startCamera()} disabled={snap.camera === 'starting'}>
            Start camera
          </button>
        ) : (
          <button onClick={() => c.pipeline.stop()}>Stop camera</button>
        )}
        <button
          disabled={!live || snap.tracker !== 'ready' || !!calib}
          onClick={() => {
            beep(0, 0); // unlock audio inside the click
            const from = performance.now() + WALK_MS;
            setCalib({ from, until: from + CALIBRATION_MS, frames: [] });
          }}
        >
          Calibrate
        </button>
      </div>

      {q && q.issues.length > 0 && (
        <ul className="issues">
          {q.issues.map((i) => (
            <li key={i}>{ISSUE_TEXT[i]}</li>
          ))}
        </ul>
      )}

      {view && (view.status === 'running' || view.status === 'countdown') && (
        <section className="tcard">
          <h3>Run</h3>
          <div className="run-big">
            {view.status === 'countdown' ? `Starting in ${Math.ceil(view.untilStart / 1000)}` : `Rep ${view.snapshot?.rep} · ${view.snapshot?.phase.toUpperCase()}`}
          </div>
          {view.snapshot?.phase === 'active' && <div className="run-clock">{view.snapshot.elapsed.toFixed(2)} s</div>}
          <div className="state-chain">
            {(['READY', 'MOVEMENT', 'PRESENTATION', 'STABILIZATION', 'COMPLETE'] as const).map((s) => (
              <span key={s} className={view.analyzerState === s ? 'on' : ''}>
                {s}
              </span>
            ))}
          </div>
          <p className="muted small">{view.analyzerState ? STATE_TEXT[view.analyzerState] : 'between reps'}</p>
        </section>
      )}

      {(calibResult || c.settings.calibration) && (
        <section className="tcard">
          <h3>Calibration</h3>
          {(() => {
            const r = calibResult ?? c.settings.calibration!;
            return (
              <>
                <div className={r.ok ? 'ok' : 'bad'}>{r.ok ? 'Passed' : 'Not passed'}</div>
                {r.problems.map((p) => (
                  <p key={p} className="hint warn">{p}</p>
                ))}
                <div className="kv"><span>Usable frames</span><b>{Math.round(r.usable * 100)} % of {r.frames}</b></div>
                <div className="kv"><span>Still-body jitter (p95)</span><b>{r.noiseFloor.toFixed(3)} torso/s</b></div>
                <div className="kv"><span>Torso size</span><b>{Math.round(r.torsoPx)} px</b></div>
              </>
            );
          })()}
          <p className="hint">Calibration checks the tracking at your position and sets the movement thresholds above the measured jitter. It does not calibrate aim.</p>
        </section>
      )}

      {live && (
        <section className="tcard">
          <h3>Signal</h3>
          <div className="stats-grid">
            <span>Camera</span><b>{snap.actual?.width}×{snap.actual?.height}{snap.actual?.fps ? ` @ ${Math.round(snap.actual.fps)} fps` : ''}</b>
            <span>Processed</span><b>{snap.fps.toFixed(1)} fps</b>
            <span>Frame interval</span><b>{snap.frameIntervalMs.toFixed(1)} ms</b>
            <span>Inference</span><b>{snap.inferenceMs.toFixed(1)} ms ({snap.delegate ?? '–'})</b>
            <span>Dropped</span><b>{snap.dropped}</b>
            <span>Timestamp</span><b>{snap.tSource ?? '–'}</b>
            <span>Light (luma)</span><b>{snap.luma !== undefined ? Math.round(snap.luma) : '–'}</b>
            <span>Screen lock</span><b>{snap.wakeLock ? 'held awake' : 'not held'}</b>
          </div>
          {q && (
            <div className="groups">
              {Object.entries(q.groups).map(([g, v]) => (
                <span key={g} className={v >= 0.6 ? 'ok' : 'bad'}>
                  {g} {Math.round(v * 100)}
                </span>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
