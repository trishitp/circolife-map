import { useCallback, useEffect, useState } from 'react';
import { fetchGaps, fetchGapsSummary, markGapReviewed } from '../lib/api';

const LAYER_LABEL = {
  leads: 'Leads', accounts: 'Accounts', meetings: 'Meetings', assets: 'Assets',
};

function toCsv(rows) {
  const cols = ['layer', 'source_id', 'title', 'owner_name', 'territory', 'reason', 'address_raw', 'pincode', 'crm_url'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export default function GapsPanel({ onFocusMap }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [layer, setLayer] = useState('');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [reviewed, setReviewed] = useState('no');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const limit = 100;

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadSummary = useCallback(() => {
    fetchGapsSummary().then(setSummary).catch((e) => setError(e.message));
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGaps({ layer, q: qDebounced, reviewed, limit, offset });
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [layer, qDebounced, reviewed, offset]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `circolife-gaps-${layer || 'all'}-${Date.now()}.csv`;
    a.click();
  };

  return (
    <div className="page-panel gaps-panel">
      <header className="page-head">
        <div>
          <h1>Gaps</h1>
          <p>Records we cannot place on the map — CRM address debt and inheritance failures.</p>
        </div>
        <button type="button" className="btn" onClick={exportCsv} disabled={!rows.length}>
          Export page CSV
        </button>
      </header>

      {error && <div className="banner err">{error}</div>}

      {summary && (
        <div className="stat-grid">
          {summary.layers.map((l) => (
            <button
              key={l.layer}
              type="button"
              className={`stat-card ${layer === l.layer ? 'on' : ''}`}
              onClick={() => { setLayer(layer === l.layer ? '' : l.layer); setOffset(0); }}
            >
              <span className="stat-label">{LAYER_LABEL[l.layer]}</span>
              <span className="stat-value">{l.unplottable.toLocaleString('en-IN')}</span>
              <span className="stat-sub">
                {l.pctUnplottable}% of {l.total.toLocaleString('en-IN')}
              </span>
            </button>
          ))}
        </div>
      )}

      {summary?.byReason?.length > 0 && (
        <section className="soft-block">
          <h2>Why they’re missing</h2>
          <ul className="reason-list">
            {summary.byReason.slice(0, 8).map((r) => (
              <li key={`${r.layer}-${r.reason}`}>
                <span className="layer-chip">{LAYER_LABEL[r.layer] || r.layer}</span>
                <span className="reason-text">{r.reason}</span>
                <strong>{r.n.toLocaleString('en-IN')}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary?.softGaps?.length > 0 && (
        <section className="soft-block">
          <h2>Soft gaps (plotted, but weak precision)</h2>
          <p className="muted">Pincode / approx / territory / inherited — usable for territory view, not door-level.</p>
          <div className="chip-row">
            {summary.softGaps.map((s) => (
              <span key={`${s.layer}-${s.precision}`} className="chip static">
                {LAYER_LABEL[s.layer]} · {s.precision}: {s.n.toLocaleString('en-IN')}
              </span>
            ))}
          </div>
        </section>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search title, owner, territory, id…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
        />
        <select
          className="input"
          value={reviewed}
          onChange={(e) => { setReviewed(e.target.value); setOffset(0); }}
        >
          <option value="">All review states</option>
          <option value="no">Unreviewed</option>
          <option value="yes">Reviewed</option>
        </select>
        <button type="button" className="btn ghost" onClick={() => loadRows()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Title</th>
              <th>Reason</th>
              <th>Owner</th>
              <th>Territory</th>
              <th>Pin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.layer}-${r.source_id}`}>
                <td><span className={`layer-chip ${r.layer}`}>{LAYER_LABEL[r.layer]}</span></td>
                <td>
                  <div className="cell-title">{r.title || r.source_id}</div>
                  {r.address_raw && <div className="cell-sub">{r.address_raw}</div>}
                </td>
                <td className="cell-reason">{r.reason}</td>
                <td>{r.owner_name || '—'}</td>
                <td>{r.territory || '—'}</td>
                <td>{r.pincode || '—'}</td>
                <td className="cell-actions">
                  {r.crm_url && (
                    <a href={r.crm_url} target="_blank" rel="noreferrer" className="link">CRM</a>
                  )}
                  {r.territory && onFocusMap && (
                    <button
                      type="button"
                      className="link btn-link"
                      onClick={() => onFocusMap({ territory: r.territory, layer: r.layer })}
                    >
                      Map
                    </button>
                  )}
                  {!r.reviewed_at && (
                    <button
                      type="button"
                      className="link btn-link"
                      onClick={async () => {
                        await markGapReviewed(r.layer, r.source_id);
                        loadRows();
                        loadSummary();
                      }}
                    >
                      Review
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && !loading && (
              <tr><td colSpan={7} className="empty">No gaps match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span>{total.toLocaleString('en-IN')} records</span>
        <div className="pager-btns">
          <button type="button" className="btn ghost" disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}>Prev</button>
          <button type="button" className="btn ghost" disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}>Next</button>
        </div>
      </div>
    </div>
  );
}
