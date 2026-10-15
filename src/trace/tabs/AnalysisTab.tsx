import { useEffect, useMemo, useRef, useState } from 'react';
import { type MetricSummary, type TrainingSession, summarize, trainingLog } from '../../analytics/trainingLog';
import type { RepResult } from '../../motion/analyzer';
import { downloadBlob } from '../../utils/recorder';
import { secPlain } from '../format';
import { useTrace } from '../useTrace';
import { RepTable } from './RepTable';

const METRICS = [
  ['reaction', 'Signal → first movement'],
  ['presentation', 'Signal → presentation zone'],
  ['movement', 'Movement duration'],
  ['stabilization', 'Stabilisation'],
  ['total', 'Signal → stable in zone'],
] as const;

const Summary = ({ s }: { s: MetricSummary }) =>
  s.n ? (
    <span>
      <b>{secPlain(s.median)}</b> median · best {secPlain(s.best)} · sd {secPlain(s.sd)} · {s.n}/{s.of} reps · ±{secPlain(s.maxUncertainty)}
    </span>
  ) : (
    <span className="muted">no measurement (0/{s.of} reps)</span>
  );

/** Median total time per session of one stage, oldest → newest (only sessions that measured something). */
const Trend = ({ sessions, metric }: { sessions: TrainingSession[]; metric: 'presentation' | 'total' }) => {
  const pts = sessions
    .map((s) => ({ at: s.createdAt, v: summarize(s.reps, metric).median }))
    .filter((p): p is { at: string; v: number } => p.v !== undefined)
    .reverse();
  if (pts.length < 2) return <p className="hint">The trend appears after two sessions of this stage with measurements.</p>;
  const W = 320;
  const H = 120;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const pad = Math.max(50, (hi - lo) * 0.15);
  const y = (v: number) => H - 14 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 28);
  const x = (i: number) => 24 + (i * (W - 40)) / (pts.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend" role="img" aria-label={`Median ${metric} per session`}>
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={p.at}>
          <circle cx={x(i)} cy={y(p.v)} r="3.5" fill="var(--text)" />
          {(i === 0 || i === pts.length - 1) && (
            <text x={x(i)} y={y(p.v) - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {(p.v / 1000).toFixed(2)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

/** Replay of the last run's video with the detected events as seek marks. */
const Replay = ({ reps, video }: { reps: RepResult[]; video: { blob: Blob; ext: string; startedAt: number } }) => {
  const url = useMemo(() => URL.createObjectURL(video.blob), [video.blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const ref = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(0);
  const events = reps
    .flatMap((r) => r.events.filter((e) => e.type !== 'tracking_restored').map((e) => ({ ...e, rep: r.rep, at: (e.t - video.startedAt) / 1000 })))
    .filter((e) => e.at >= 0)
    .sort((a, b) => a.at - b.at);
  const current = [...events].reverse().find((e) => e.at <= now && now - e.at < 1.2);
  return (
    <section className="tcard">
      <h3>Replay (this run)</h3>
      <div className="replay">
        <video ref={ref} src={url} controls playsInline onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)} />
        {current && (
          <div className="replay-tag">
            Rep {current.rep} · {current.type.replace(/_/g, ' ')}
          </div>
        )}
      </div>
      <div className="chips">
        {events.map((e, i) => (
          <button key={i} onClick={() => ref.current && (ref.current.currentTime = Math.max(0, e.at - 0.5))}>
            R{e.rep} {e.type.replace(/_/g, ' ')} · {e.at.toFixed(2)} s
          </button>
        ))}
      </div>
      <p className="hint">Video times are aligned via the recording start (±1 frame plus encoder start-up). The video is kept only until you leave this page.</p>
      <button onClick={() => downloadBlob(video.blob, `forth-trace-run.${video.ext}`)}>Download video</button>
    </section>
  );
};

export const AnalysisTab = () => {
  const c = useTrace();
  const sessions = trainingLog.list();
  const [openId, setOpenId] = useState<string | null>(sessions[0]?.id ?? null);
  const [compareId, setCompareId] = useState<string>('');
  const open = sessions.find((s) => s.id === openId);
  const compare = sessions.find((s) => s.id === compareId);
  const sameStage = open ? sessions.filter((s) => s.stageId === open.stageId) : [];
  const lastRun = c.run && c.run.recording && c.run.view().savedSessionId === open?.id ? c.run : null;

  if (!sessions.length)
    return (
      <div className="trace-stack">
        <p className="hint empty">No training sessions yet. Start one in the Training tab — results appear here.</p>
      </div>
    );

  return (
    <div className="trace-stack">
      <section className="tcard">
        <h3>Sessions</h3>
        <select value={openId ?? ''} onChange={(e) => setOpenId(e.target.value)}>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {new Date(s.createdAt).toLocaleString()} · {s.stageName} · {s.reps.filter((r) => r.metrics.total).length}/{s.reps.length} measured
            </option>
          ))}
        </select>
      </section>

      {open && (
        <>
          <section className="tcard">
            <h3>{open.stageName}</h3>
            <p className="muted small">
              {new Date(open.createdAt).toLocaleString()} · par {open.parTime}s · signal on {open.timing.signalSource} (±{open.timing.signalUncertaintyMs.toFixed(0)} ms) ·{' '}
              {open.timing.fps.toFixed(0)} fps ({open.timing.frameTimeSource} timestamps) · model {open.model}
            </p>
            {METRICS.map(([k, label]) => (
              <div className="kv metric" key={k}>
                <span>{label}</span>
                <Summary s={summarize(open.reps, k)} />
              </div>
            ))}
            <p className="hint">
              Presentation = hands in the configured zone in front of the body. It is not the time of a first shot and does not indicate aim. Experimental values,
              not yet validated against a reference measurement.
            </p>
          </section>

          <section className="tcard">
            <h3>Reps</h3>
            <RepTable reps={open.reps} />
          </section>

          {lastRun?.recording && <Replay reps={open.reps} video={lastRun.recording} />}

          <section className="tcard">
            <h3>Trend · this stage</h3>
            <Trend sessions={sameStage} metric="total" />
          </section>

          <section className="tcard">
            <h3>Compare</h3>
            <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
              <option value="">Choose a session…</option>
              {sessions
                .filter((s) => s.id !== open.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.createdAt).toLocaleString()} · {s.stageName}
                  </option>
                ))}
            </select>
            {compare && (
              <div className="table-wrap">
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Median</th>
                      <th>{new Date(open.createdAt).toLocaleDateString()}</th>
                      <th>{new Date(compare.createdAt).toLocaleDateString()}</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map(([k, label]) => {
                      const a = summarize(open.reps, k).median;
                      const b = summarize(compare.reps, k).median;
                      return (
                        <tr key={k}>
                          <td>{label}</td>
                          <td>{secPlain(a)}</td>
                          <td>{secPlain(b)}</td>
                          <td>{a !== undefined && b !== undefined ? `${a - b > 0 ? '+' : ''}${((a - b) / 1000).toFixed(2)} s` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {compare && compare.analyzerVersion !== open.analyzerVersion && <p className="hint warn">Different analyzer versions — values are not directly comparable.</p>}
          </section>

          <div className="inline wrap">
            <button onClick={() => downloadBlob(new Blob([JSON.stringify(open, null, 2)], { type: 'application/json' }), `forth-trace-${open.id}.json`)}>Export JSON</button>
            <button
              className="danger"
              onClick={() => {
                if (confirm('Delete this session?')) {
                  trainingLog.remove(open.id);
                  setOpenId(trainingLog.list()[0]?.id ?? null);
                }
              }}
            >
              Delete session
            </button>
          </div>
        </>
      )}
    </div>
  );
};
