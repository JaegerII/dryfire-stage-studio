import { stageRepository } from '../../data/stageRepository';
import { CAMERA_ERROR_TEXT, cameraSupport } from '../../capture/camera';
import { STATE_TEXT, STATUS_TEXT, sec } from '../format';
import { useTicker, useTrace } from '../useTrace';
import { RepTable } from './RepTable';

const tvUrl = (room: string) => `${location.origin}${location.pathname}#/tv/${room}`;

export const TrainingTab = ({ onGoLive }: { onGoLive: () => void }) => {
  const c = useTrace();
  const run = c.run;
  const view = run?.view();
  useTicker(100, view?.status === 'running' || view?.status === 'countdown');
  const stages = stageRepository.list();
  const snap = c.pipeline.snap;
  const support = cameraSupport();
  const busy = view && (view.status === 'running' || view.status === 'countdown');
  const info = c.sessionInfo;
  const tvs = info?.peers.filter((p) => p.role === 'tv') ?? [];

  return (
    <div className="trace-stack">
      <section className="tcard">
        <h3>1 · Stage</h3>
        <select value={c.stageId ?? ''} disabled={!!busy} onChange={(e) => c.selectStage(e.target.value)}>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — par {s.parTime}s · {s.repetitions} reps
            </option>
          ))}
        </select>
      </section>

      <section className="tcard">
        <h3>2 · TV</h3>
        {!c.session ? (
          <>
            <p className="muted">Show the stage on a TV browser on the same Wi-Fi. Optional — training also works phone-only.</p>
            <button className="primary" onClick={() => void c.connectTv()}>Connect TV</button>
          </>
        ) : (
          <>
            <div className="kv">
              <span>Room code</span>
              <b className="room">{c.room}</b>
            </div>
            <p className="muted small">
              On the TV open <code>{tvUrl(c.room)}</code>
            </p>
            <div className="kv">
              <span>Link</span>
              <b className={info?.status === 'open' ? 'ok' : 'warn'}>
                {info?.kind === 'broadcast' ? 'same browser only (no relay server)' : `relay · ${info?.status}`}
                {info?.detail ? ` · ${info.detail}` : ''}
              </b>
            </div>
            <div className="kv">
              <span>TV</span>
              <b className={tvs.length ? 'ok' : 'warn'}>{tvs.length ? `connected (${tvs.length})` : 'waiting for TV…'}</b>
            </div>
            {c.tv && tvs.length > 0 && (
              <div className="kv">
                <span>Clock sync</span>
                <b className={c.tv.sync && c.tv.sync.uncertainty < 20 ? 'ok' : 'warn'}>
                  {c.tv.sync ? `±${c.tv.sync.uncertainty.toFixed(1)} ms (rtt ${c.tv.sync.rtt.toFixed(0)} ms)` : 'measuring…'}
                  {!c.tv.soundEnabled && ' · TV sound off'}
                </b>
              </div>
            )}
            {info?.kind === 'broadcast' && (
              <p className="hint warn">
                No relay server on this host, so only tabs of this browser can join. For phone + TV start the app with <code>npm run dev:lan</code> on a computer in
                the same Wi-Fi and open its https address on both devices.
              </p>
            )}
            <div className="inline">
              <button onClick={() => c.newRoom()}>New code</button>
              <button onClick={() => c.disconnectTv()}>Disconnect</button>
            </div>
          </>
        )}
      </section>

      <section className="tcard">
        <h3>3 · Camera & calibration</h3>
        {support ? (
          <p className="hint warn">{CAMERA_ERROR_TEXT[support]}</p>
        ) : (
          <>
            <div className="kv">
              <span>Camera</span>
              <b className={snap.camera === 'live' ? 'ok' : snap.camera === 'error' ? 'bad' : ''}>
                {snap.camera === 'live' ? `${snap.actual?.width}×${snap.actual?.height}` : snap.camera}
              </b>
            </div>
            <div className="kv">
              <span>Pose model</span>
              <b className={snap.tracker === 'ready' ? 'ok' : snap.tracker === 'error' ? 'bad' : ''}>{snap.tracker}</b>
            </div>
            <div className="kv">
              <span>Calibration</span>
              <b className={c.settings.calibration?.ok ? 'ok' : 'warn'}>
                {c.settings.calibration ? (c.settings.calibration.ok ? `ok · ${new Date(c.settings.calibration.at).toLocaleString()}` : 'failed — repeat') : 'not done'}
              </b>
            </div>
            <button onClick={onGoLive}>Open Live view</button>
          </>
        )}
      </section>

      <section className="tcard">
        <h3>4 · Run</h3>
        <div className="kv">
          <span>Start signal</span>
          <select value={c.settings.audio} disabled={!!busy} onChange={(e) => c.updateSettings({ audio: e.target.value as typeof c.settings.audio })}>
            <option value="phone">Phone (most accurate timing)</option>
            <option value="tv">TV only</option>
            <option value="both">Phone + TV</option>
          </select>
        </div>
        {c.settings.audio === 'tv' && (
          <p className="hint warn">
            TV-only signal: the measured times include the clock-sync error, but NOT the TV's own sound delay (HDMI / sound processing), which the browser cannot see.
          </p>
        )}
        {c.error && <p className="hint bad">{c.error}</p>}
        {!busy ? (
          <button className="primary big" onClick={() => void c.startRun()}>
            Start training
          </button>
        ) : (
          <button className="big" onClick={() => c.stopRun()}>
            Stop
          </button>
        )}
        {view && (
          <div className="run-status">
            {view.status === 'countdown' && <div className="run-big">Starting in {Math.ceil(view.untilStart / 1000)}</div>}
            {view.status === 'running' && view.snapshot && (
              <>
                <div className="run-big">
                  Rep {view.snapshot.rep}/{run!.stage.repetitions} · {view.snapshot.phase.toUpperCase()}
                </div>
                {view.snapshot.phase === 'active' && <div className="run-clock">{view.snapshot.elapsed.toFixed(2)} s</div>}
                <div className="muted">{view.analyzerState ? STATE_TEXT[view.analyzerState] : 'analysis waiting for the next rep'}</div>
              </>
            )}
            {(view.status === 'complete' || view.status === 'stopped') && (
              <div className="run-big">{view.status === 'complete' ? 'Training complete' : 'Stopped'}{view.savedSessionId ? ' · saved' : ''}</div>
            )}
            {view.recording && <div className="rec">● REC</div>}
            {view.results.length > 0 && (
              <>
                <p className="muted small">Last rep: {STATUS_TEXT[view.results.at(-1)!.status]} · presentation {sec(view.results.at(-1)!.metrics.presentation)}</p>
                <RepTable reps={view.results} />
              </>
            )}
          </div>
        )}
        <p className="hint">
          Times are measured from the camera image and are <b>experimental</b>: not yet validated against a reference. “Presentation” means the hands reached the
          configured zone in front of the body — it is not the time of a shot and says nothing about aim.
        </p>
      </section>
    </div>
  );
};
