import { useEffect, useRef } from 'react';
import { CAL_STEPS } from '../../motion/bodyCalibration';
import { drawSkeleton } from '../../pose/drawSkeleton';
import { stage3dRepository } from '../../stage3d/repository';
import { useTicker, useTrace } from '../useTrace';

const tvUrl = (room: string) => `${location.origin}${location.pathname}#/tv/${room}`;

const Slider = ({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) => (
  <label className="kv">
    <span>{label}</span>
    <b style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 120 }} />
      <span style={{ minWidth: 52, textAlign: 'right' }}>
        {value.toFixed(step < 0.1 ? 2 : 1)}
        {unit}
      </span>
    </b>
  </label>
);

/** Body camera: the athlete's movement in front of the phone drives the view on the TV. */
export const BodyTab = () => {
  const c = useTrace();
  const b = c.body;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const snap = c.pipeline.poll();
  useTicker(250, snap.camera === 'live');
  const live = snap.camera === 'live' && snap.tracker === 'ready';
  const mirror = c.settings.mirrorPreview;
  const stage = c.stage;
  const tvs = c.sessionInfo?.peers.filter((p) => p.role === 'tv') ?? [];

  useEffect(() => {
    const el = box.current;
    const v = c.pipeline.video;
    if (!el) return;
    el.prepend(v);
    void v.play().catch(() => undefined);
    return () => v.remove();
  }, [c.pipeline]);

  // skeleton + calibrated range + current position, at camera rate, drawn straight onto the canvas
  useEffect(() => {
    return c.pipeline.onFrame((f, q) => {
      const cv = canvas.current;
      if (!cv) return;
      if (cv.width !== f.width || cv.height !== f.height) {
        cv.width = f.width;
        cv.height = f.height;
      }
      drawSkeleton(cv, f, q.level, mirror);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const W = cv.width;
      const H = cv.height;
      const X = (x: number) => (mirror ? W - x : x);
      const cal = b.calibration;
      const lw = Math.max(2, W / 400);
      if (cal && b.phase !== 'calibrating') {
        const xl = cal.hipX0 + cal.flip * cal.limitLeftPx;
        const xr = cal.hipX0 + cal.flip * cal.limitRightPx;
        ctx.fillStyle = 'rgba(43,217,107,0.12)';
        const a = Math.min(X(xl), X(xr));
        ctx.fillRect(a, 0, Math.abs(X(xl) - X(xr)), H);
        ctx.strokeStyle = 'rgba(43,217,107,0.9)';
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
        for (const x of [xl, xr]) {
          ctx.beginPath();
          ctx.moveTo(X(x), 0);
          ctx.lineTo(X(x), H);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(237,237,230,0.8)';
        ctx.setLineDash([lw * 3, lw * 3]);
        ctx.beginPath();
        ctx.moveTo(X(cal.hipX0), 0);
        ctx.lineTo(X(cal.hipX0), H);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const last = b.last;
      if (b.phase === 'live' && last?.result) {
        const o = last.result.offset;
        const lane = b.cfg.laneHalfWidth;
        const bw = W * 0.5;
        const bx = (W - bw) / 2;
        const by = H - lw * 14;
        ctx.fillStyle = 'rgba(8,9,9,0.7)';
        ctx.fillRect(bx - 6, by - lw * 6, bw + 12, lw * 12);
        ctx.strokeStyle = '#edede6';
        ctx.lineWidth = lw;
        ctx.strokeRect(bx, by - lw * 3, bw, lw * 6);
        ctx.fillStyle = last.result.tracked ? '#2bd96b' : '#ff3131';
        const px = bx + bw / 2 + (mirror ? 1 : -1) * (o.dx / lane) * (bw / 2);
        ctx.beginPath();
        ctx.arc(px, by, lw * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#edede6';
        ctx.font = `${Math.round(W / 40)}px system-ui, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(`x ${o.dx.toFixed(2)} m   yaw ${o.yaw.toFixed(0)}°   roll ${o.roll.toFixed(0)}°   fwd ${o.dz.toFixed(2)}   up ${o.dy.toFixed(2)}`, bx, by - lw * 9);
      }
    });
  }, [c.pipeline, b, mirror]);

  const pl = b.placement;
  const cal = b.cal;
  const link = c.tv?.body;
  const q = snap.quality;
  const calibrating = b.phase === 'calibrating';

  return (
    <div className="trace-stack">
      <section className="tcard">
        <h3>1 · Stage & TV</h3>
        <select value={c.stageId ?? ''} disabled={b.phase === 'live'} onChange={(e) => (b.setPos(0), c.selectStage(e.target.value))}>
          {stage3dRepository.list().map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {stage && stage.positions.length > 1 && (
          <div className="kv">
            <span>Position to look from</span>
            <select value={b.pos} onChange={(e) => b.setPos(Number(e.target.value))}>
              {stage.positions.map((p, i) => (
                <option key={p.id} value={i}>
                  {i + 1}. {p.label ?? `Position ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}
        {!c.session ? (
          <button className="primary" onClick={() => void c.connectTv()}>
            Connect TV
          </button>
        ) : (
          <>
            <div className="kv">
              <span>Room</span>
              <b className="room">{c.room}</b>
            </div>
            <p className="muted small">
              TV: <code>{tvUrl(c.room)}</code>
            </p>
            <div className="kv">
              <span>TV</span>
              <b className={tvs.length ? 'ok' : 'warn'}>{tvs.length ? 'connected' : 'waiting for TV…'}</b>
            </div>
          </>
        )}
      </section>

      <div className={`cam${mirror ? ' mirror' : ''}`} ref={box}>
        <canvas ref={canvas} className="cam-overlay" />
        {snap.camera !== 'live' && <div className="cam-empty">{snap.camera === 'starting' ? 'Starting camera…' : snap.camera === 'error' ? snap.cameraError : 'Camera off'}</div>}
        {snap.camera === 'live' && snap.tracker !== 'ready' && <div className="cam-badge">{snap.tracker === 'loading' ? 'Loading pose model…' : snap.trackerError}</div>}
        {snap.camera === 'live' && q && <div className={`cam-quality q-${q.level}`}>{q.level === 'good' ? 'Tracking good' : q.level === 'partial' ? 'Tracking partial' : q.level === 'poor' ? 'Tracking poor' : 'No tracking'}</div>}
        {calibrating && cal && (
          <div className="cam-calib">
            {cal.phase === 'prep' ? '' : '● '}
            {cal.prompt} ({Math.ceil(cal.remainingMs / 1000)})
          </div>
        )}
      </div>

      <div className="inline wrap">
        {snap.camera !== 'live' ? (
          <button className="primary" onClick={() => void c.startCamera()} disabled={snap.camera === 'starting'}>
            Start camera
          </button>
        ) : (
          <button
            onClick={() => {
              b.stopLive();
              c.pipeline.stop();
            }}
          >
            Stop camera
          </button>
        )}
        <label className="inline" style={{ gap: 6 }}>
          <input type="checkbox" checked={mirror} onChange={(e) => c.updateSettings({ mirrorPreview: e.target.checked })} /> mirror preview
        </label>
      </div>

      <section className="tcard">
        <h3>2 · Calibration</h3>
        <button disabled={!live || calibrating || b.phase === 'live'} onClick={() => (b.phase === 'placement' ? b.stopLive() : b.startPlacement())}>
          {b.phase === 'placement' ? 'Stop placement check' : 'Placement check'}
        </button>
        {b.phase === 'placement' && pl && (
          <ul className="issues">
            {pl.items.map((i) => (
              <li key={i.id} className={i.ok ? 'ok' : 'bad'}>
                {i.ok ? '✓' : '✗'} {i.text}
              </li>
            ))}
          </ul>
        )}
        <div className="kv">
          <span>Your height (optional)</span>
          <input type="number" min={1.2} max={2.2} step={0.01} value={b.bodyHeightM} style={{ width: 90 }} onChange={(e) => ((b.bodyHeightM = Number(e.target.value) || 1.78), c.bump())} />
        </div>
        <button className="primary" disabled={!live || calibrating || b.phase === 'live'} onClick={() => b.startCalibration()}>
          Calibrate (≈ {Math.round(CAL_STEPS.reduce((s, x) => s + x.prepMs + x.holdMs, 0) / 1000)} s)
        </button>
        <p className="hint">
          Put the phone on the tripod (portrait or landscape, whole body in view, 2–3 m). The TV and the phone beeps guide you: stand on the centre mark, step left, step right, turn left, turn right — each as far as is
          comfortable. LEFT / RIGHT are <b>your</b> left and right.
        </p>
        {cal?.phase === 'failed' && cal.problems.map((p) => (
          <p key={p} className="hint bad">
            {p}
          </p>
        ))}
        {b.calibration && !calibrating && (
          <>
            <div className="kv">
              <span>Calibrated</span>
              <b className="ok">{new Date(b.calibration.at).toLocaleTimeString()}</b>
            </div>
            <div className="kv">
              <span>Comfort range</span>
              <b>
                {Math.round(-b.calibration.limitLeftPx)} px left · {Math.round(b.calibration.limitRightPx)} px right
                {b.calibration.bodyHeightM ? ` (≈ ${((-b.calibration.limitLeftPx + b.calibration.limitRightPx) * ((b.calibration.bodyHeightM * 0.29) / b.calibration.torso0)).toFixed(2)} m)` : ''}
              </b>
            </div>
            <div className="kv">
              <span>Max comfortable turn</span>
              <b>
                {b.calibration.turnLeftDeg.toFixed(0)}° left · {b.calibration.turnRightDeg.toFixed(0)}° right
              </b>
            </div>
            <div className="kv">
              <span>Torso / shoulders</span>
              <b>
                {Math.round(b.calibration.torso0)} / {Math.round(b.calibration.shoulderW0)} px
              </b>
            </div>
            {b.calibration.warnings.map((w) => (
              <p key={w} className="hint warn">
                {w}
              </p>
            ))}
            <div className="inline">
              <button onClick={() => b.setFlip(b.flip === -1 ? 1 : -1)}>Swap left / right (now {b.flip === -1 ? 'normal' : 'swapped'})</button>
              <button onClick={() => b.clearCalibration()}>Delete calibration</button>
            </div>
          </>
        )}
      </section>

      <section className="tcard">
        <h3>3 · Body camera</h3>
        {b.phase !== 'live' ? (
          <button className="primary big" disabled={!live || !b.calibration || !c.session || calibrating} onClick={() => b.startLive()}>
            Start body camera
          </button>
        ) : (
          <button className="big" onClick={() => b.stopLive()}>
            Stop
          </button>
        )}
        {!c.session && <p className="hint warn">Connect a TV first.</p>}
        {!b.calibration && <p className="hint warn">Calibrate first.</p>}
        {b.phase === 'live' && b.last?.result && !b.last.result.tracked && <p className="hint bad">Person not tracked — the view holds, then eases back to the start view.</p>}
      </section>

      <section className="tcard">
        <h3>Feel</h3>
        <Slider label="Lane half width" unit=" m" value={b.cfg.laneHalfWidth} min={0.2} max={1.6} step={0.05} onChange={(v) => b.updateConfig({ laneHalfWidth: v })} />
        <Slider label="Lateral gain" value={b.cfg.gain} min={0.5} max={2} step={0.05} onChange={(v) => b.updateConfig({ gain: v })} />
        <Slider label="Dead zone" value={b.cfg.deadZone} min={0} max={0.2} step={0.01} onChange={(v) => b.updateConfig({ deadZone: v })} />
        <Slider label="Yaw at max turn" unit="°" value={b.cfg.maxYaw} min={0} max={50} step={1} onChange={(v) => b.updateConfig({ maxYaw: v })} />
        <Slider label="Roll at max lean" unit="°" value={b.cfg.maxRoll} min={0} max={35} step={1} onChange={(v) => b.updateConfig({ maxRoll: v })} />
        <Slider label="Head shift when leaning" unit=" m" value={b.cfg.leanShift} min={0} max={0.5} step={0.05} onChange={(v) => b.updateConfig({ leanShift: v })} />
        <Slider label="Forward / back travel" unit=" m" value={b.cfg.depthRange} min={0} max={0.6} step={0.05} onChange={(v) => b.updateConfig({ depthRange: v })} />
        <Slider label="Crouch travel" unit=" m" value={b.cfg.heightDown} min={0} max={0.8} step={0.05} onChange={(v) => b.updateConfig({ heightDown: v })} />
        <Slider
          label="Smoothing (low = calm)"
          value={b.cfg.filterLateral.minCutoff}
          min={0.3}
          max={5}
          step={0.1}
          onChange={(v) => b.updateConfig({ filterLateral: { ...b.cfg.filterLateral, minCutoff: v }, filterYaw: { ...b.cfg.filterYaw, minCutoff: v } })}
        />
        <Slider label="Lag reduction (beta)" value={b.cfg.filterLateral.beta} min={0} max={3} step={0.1} onChange={(v) => b.updateConfig({ filterLateral: { ...b.cfg.filterLateral, beta: v }, filterYaw: { ...b.cfg.filterYaw, beta: v } })} />
      </section>

      {live && (
        <section className="tcard">
          <h3>Latency & rate</h3>
          <div className="stats-grid">
            <span>Tracking</span>
            <b>
              {snap.fps.toFixed(1)} fps · inference {snap.inferenceMs.toFixed(1)} ms ({snap.delegate ?? '–'})
            </b>
            <span>Camera</span>
            <b>
              {snap.actual?.width}×{snap.actual?.height}
              {snap.actual?.fps ? ` @ ${Math.round(snap.actual.fps)} fps` : ''} · {snap.tSource ?? '–'}
            </b>
            <span>Capture → sent (phone)</span>
            <b>{b.phase === 'live' ? `${b.stats.captureToSendMs.toFixed(0)} ms median` : '–'}</b>
            <span>Messages sent</span>
            <b>{b.phase === 'live' ? `${b.stats.sendHz} / s` : '–'}</b>
            <span>Capture → TV received</span>
            <b>{link ? `${link.arriveMs.p50.toFixed(0)} ms · p95 ${link.arriveMs.p95.toFixed(0)} · max ${link.arriveMs.max.toFixed(0)}` : '–'}</b>
            <span>Capture → TV rendered</span>
            <b>{link ? `${link.paintMs.p50.toFixed(0)} ms · p95 ${link.paintMs.p95.toFixed(0)} · max ${link.paintMs.max.toFixed(0)}` : '–'}</b>
            <span>Clock-sync uncertainty</span>
            <b>{link?.syncUncertaintyMs != null ? `±${link.syncUncertaintyMs.toFixed(1)} ms` : '–'}</b>
          </div>
          <p className="hint">
            “Capture” is the camera frame time (browser timestamp, may already lie some ms after the sensor). Not included: the TV&apos;s own display delay (HDMI / panel, typically 20–80 ms; use game mode) —
            the browser cannot measure it.
          </p>
        </section>
      )}
    </div>
  );
};
