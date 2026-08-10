import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchActivityCompare } from '../lib/api';

function fmtKm(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n < 1 && n > 0) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1)} km`;
}

function defaultRange() {
  const fmt = (d) => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return { from: fmt(from), to: fmt(to) };
}

const SORT_OPTS = [
  { id: 'path_km', label: 'Path km' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'checkin_rate', label: 'Check-in %' },
  { id: 'late_rate', label: 'Late %' },
];

const OPEN_REASON = {
  longest_path: 'longest path day',
  busiest_meetings: 'busiest day',
  most_late: 'most late day',
};

export default function RmCompareView({ territories = [], onOpenWalk }) {
  const range0 = useMemo(() => defaultRange(), []);
  const [from, setFrom] = useState(range0.from);
  const [to, setTo] = useState(range0.to);
  const [territory, setTerritory] = useState('');
  const [sort, setSort] = useState('path_km');
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);

  const rangeDays = useMemo(() => {
    if (!from || !to) return 0;
    const a = new Date(`${from}T00:00:00+05:30`).getTime();
    const b = new Date(`${to}T00:00:00+05:30`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return Math.floor((b - a) / 864e5) + 1;
  }, [from, to]);

  const load = useCallback(async () => {
    if (!from || !to) return;
    if (rangeDays > 31) {
      setError('Compare range must be 31 days or less');
      setOwners([]);
      setMeta(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivityCompare({
        from,
        to,
        sort,
        territory: territory || undefined,
      });
      setOwners(data.owners || []);
      setMeta({ total: data.total_owners, from: data.from, to: data.to, sort: data.sort });
    } catch (e) {
      setError(e.message);
      setOwners([]);
    } finally {
      setLoading(false);
    }
  }, [from, to, sort, territory, rangeDays]);

  useEffect(() => { load(); }, [load]);

  const openWalk = (row) => {
    onOpenWalk?.({
      owner: row.owner,
      date: row.open_day || row.busiest_day || from,
    });
  };

  return (
    <div className="activity-compare">
      <div className="toolbar activity-toolbar">
        <div className="activity-field">
          <label htmlFor="cmp-from">From</label>
          <input id="cmp-from" className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="activity-field">
          <label htmlFor="cmp-to">To</label>
          <input id="cmp-to" className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="activity-field">
          <label htmlFor="cmp-terr">Territory</label>
          <select
            id="cmp-terr"
            className="input"
            value={territory}
            onChange={(e) => setTerritory(e.target.value)}
          >
            <option value="">All territories</option>
            {territories.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="activity-field">
          <label htmlFor="cmp-sort">Sort by</label>
          <select
            id="cmp-sort"
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {SORT_OPTS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="banner err">{error}</p>}
      {loading && <p className="muted">Loading comparison…</p>}
      {rangeDays > 31 && (
        <p className="banner err">Pick a range of 31 days or less for agent compare.</p>
      )}

      {meta && (
        <p className="muted">
          {meta.total} field agents · {meta.from} → {meta.to} (IST).
          Path km uses check-in GPS only (not inherited pins).
          Open walk uses the day that matches the current sort metric.
        </p>
      )}

      <div className={`soft-block activity-table-wrap ${loading ? 'is-loading' : ''}`}>
        <table className="activity-table">
          <thead>
            <tr>
              <th>Field agent</th>
              <th>Meetings</th>
              <th>Check-in %</th>
              <th>Missed</th>
              <th>Late %</th>
              <th>Days active</th>
              <th>Avg / day</th>
              <th>Path km</th>
              <th>Open day</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {!loading && owners.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">No meetings in this range.</td>
              </tr>
            )}
            {owners.map((row) => (
              <tr
                key={row.owner}
                className="activity-row"
                onClick={() => openWalk(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openWalk(row);
                  }
                }}
                tabIndex={0}
                role="button"
              >
                <td className="activity-owner">{row.owner}</td>
                <td>{row.meetings}</td>
                <td>{row.checkin_rate}%</td>
                <td>{row.missed_checkin}</td>
                <td>{row.late_rate}%</td>
                <td>{row.days_active}</td>
                <td>{row.avg_meetings_per_active_day}</td>
                <td>{fmtKm(row.path_km)}</td>
                <td className="activity-open-day">
                  <span>{row.open_day || row.busiest_day || '—'}</span>
                  {row.open_day_reason && (
                    <span className="muted activity-open-reason">
                      {OPEN_REASON[row.open_day_reason] || row.open_day_reason}
                    </span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWalk(row);
                    }}
                  >
                    Open walk
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
