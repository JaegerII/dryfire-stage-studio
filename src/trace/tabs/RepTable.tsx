import type { RepResult } from '../../motion/analyzer';
import { STATUS_TEXT, pct, sec } from '../format';

/** Per-rep measurements with uncertainty and confidence; missing values stay "—". */
export const RepTable = ({ reps }: { reps: RepResult[] }) => (
  <div className="table-wrap">
    <table className="rep-table">
      <thead>
        <tr>
          <th>Rep</th>
          <th>Reaction</th>
          <th>Presentation</th>
          <th>Stabilised</th>
          <th>Total</th>
          <th>Conf.</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {[...reps]
          .sort((a, b) => a.rep - b.rep)
          .map((r) => (
            <tr key={r.rep} className={r.earlyMovement ? 'early' : ''}>
              <td>{r.rep}</td>
              <td>{sec(r.metrics.reaction)}</td>
              <td>{sec(r.metrics.presentation)}</td>
              <td>{sec(r.metrics.stabilization)}</td>
              <td>{sec(r.metrics.total)}</td>
              <td>{r.metrics.total ? pct(r.metrics.total.confidence) : r.metrics.presentation ? pct(r.metrics.presentation.confidence) : '—'}</td>
              <td>
                {STATUS_TEXT[r.status]}
                {r.earlyMovement && ' · moved before signal'}
                {!r.usedDepth && r.metrics.presentation && ' · 2D only'}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  </div>
);
