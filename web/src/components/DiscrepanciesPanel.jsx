import { useCallback, useEffect, useState } from 'react';
import {
  fetchDiscSummary, fetchDiscrepancies, fetchDiscrepancyDetail, exportDiscrepanciesCsv,
} from '../lib/api';

const SOURCE_LABEL = {
  mmi: 'MapMyIndia',
  billing: 'Billing',
  shipping: 'Shipping',
  checkin: 'Check-in',
};

const LAYER_LABEL = { leads: 'Lead', accounts: 'Account' };

function SourceDots({ present = [] }) {
  return (
    <div className="source-dots" title={present.map((s) => SOURCE_LABEL[s] || s).join(', ')}>
      {['mmi', 'billing', 'shipping', 'checkin'].map((s) => (
        <span
          key={s}
          className={`source-dot ${present.includes(s) ? 'on' : ''} ${s}`}
          title={SOURCE_LABEL[s]}
        />
      ))}
    </div>
  );
}

function fmtKm(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1)} km`;
}

function fmtCoord(lat, lng) {
  if (lat == null || lng == null) return '—';
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

export default function DiscrepanciesPanel({ onFocusMap }) {
  const [summary, setSummary] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [severity, setSeverity] = useState('alert');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [territory, setTerritory] = useState('');
  const [sourceMissing, setSourceMissing] = useState('');
  const [minKm, setMinKm] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const limit = 100;

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadSummary = useCallback(() => {
    fetchDiscSummary().then(setSummary).catch((e) => setError(e.message));
  }, []);

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDiscrepancies({
        severity: severity || undefined,
        q: qDebounced || undefined,
        territory: territory || undefined,
        source_missing: sourceMissing || undefined,
        min_km: minKm || undefined,
        limit,
        offset,
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [severity, qDebounced, territory, sourceMissing, minKm, offset]);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadRows(); }, [loadRows]);

  const openDetail = async (row) => {
    setDetailLoading(true);
    setError(null);
    try {
      const d = await fetchDiscrepancyDetail(row.entity_layer, row.entity_id);
      setDetail(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const exportCsv = async () => {
    try {
      const text = await exportDiscrepanciesCsv({ severity: severity || undefined });
      const blob = new Blob([text], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `circolife-discrepancies-${severity || 'all'}-${Date.now()}.csv`;
      a.click();
    } catch (e) {
      setError(e.message);
    }
  };

  const jumpMap = (layer, id, territoryName) => {
    onFocusMap?.({ layer, territory: territoryName, sourceId: id });
  };

  const disc = detail?.discrepancy;
  const signalsBySource = {};
  for (const s of detail?.signals || []) {
    if (!signalsBySource[s.source] || s.source === 'checkin') {
      if (s.source === 'checkin') {
        if (!signalsBySource.checkin) signalsBySource.checkin = [];
        signalsBySource.checkin.push(s);
      } else {
        signalsBySource[s.source] = s;
      }
    }
  }

  return (
    <div className="page-panel disc-panel">
      <header className="page-head">
        <div>
          <h1>Discrepancies</h1>
          <p>
            Records where MapMyIndia, billing, shipping, and field check-ins do not agree.
          </p>
        </div>
        <button type="button" className="btn" onClick={exportCsv}>
          Export CSV
        </button>
      </header>

      {error && <div className="banner err">{error}</div>}

      {summary && (
        <div className="stat-grid disc-stats">
          {(['alert', 'watch', 'ok']).map((sev) => (
            <button
              key={sev}
              type="button"
              className={`stat-card sev-${sev} ${severity === sev ? 'on' : ''}`}
              onClick={() => { setSeverity(severity === sev ? '' : sev); setOffset(0); }}
            >
              <span className="stat-label">
                {sev === 'alert' ? 'Alert' : sev === 'watch' ? 'Watch' : 'Aligned'}
              </span>
              <span className="stat-value">
                {(summary.bySeverity[sev] || 0).toLocaleString('en-IN')}
              </span>
              <span className="stat-sub">
                {sev === 'alert' && `≥ ${summary.thresholds.alertKm} km`}
                {sev === 'watch' && `≥ ${summary.thresholds.watchKm} km or pin mismatch`}
                {sev === 'ok' && 'sources agree'}
              </span>
            </button>
          ))}
          <div className="stat-card static">
            <span className="stat-label">Multi-source</span>
            <span className="stat-value">{summary.pctMultiSource}%</span>
            <span className="stat-sub">
              {summary.multiSource.toLocaleString('en-IN')} of {summary.total.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {summary?.topConflictPairs?.length > 0 && (
        <section className="soft-block">
          <h2>Most common conflicts</h2>
          <ul className="reason-list">
            {summary.topConflictPairs.map((p) => (
              <li key={p.pair}>
                <span className="layer-chip">{p.n}</span>
                <span className="reason-text">{p.pair}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search name, owner, territory, or ID"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
        />
        <input
          className="input"
          style={{ flex: '0 0 140px' }}
          placeholder="Territory"
          value={territory}
          onChange={(e) => { setTerritory(e.target.value); setOffset(0); }}
        />
        <select
          className="input"
          style={{ flex: '0 0 160px' }}
          value={sourceMissing}
          onChange={(e) => { setSourceMissing(e.target.value); setOffset(0); }}
        >
          <option value="">Any missing source</option>
          {Object.entries(SOURCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>Missing {v}</option>
          ))}
        </select>
        <input
          className="input"
          style={{ flex: '0 0 120px' }}
          type="number"
          min="0"
          step="0.5"
          placeholder="Min km"
          value={minKm}
          onChange={(e) => { setMinKm(e.target.value); setOffset(0); }}
        />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th>Territory</th>
              <th>Sources</th>
              <th>Spread</th>
              <th>Worst pair</th>
              <th>Severity</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="muted">Loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="muted">No records match these filters.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.entity_layer}-${r.entity_id}`}>
                <td>
                  <div className="entity-cell">
                    <span className={`layer-chip ${r.entity_layer}`}>
                      {LAYER_LABEL[r.entity_layer] || r.entity_layer}
                    </span>
                    <strong>{r.title || r.entity_id}</strong>
                    {r.owner_name && <span className="muted block">{r.owner_name}</span>}
                  </div>
                </td>
                <td>{r.territory || '—'}</td>
                <td><SourceDots present={r.present} /></td>
                <td className="mono">{fmtKm(r.max_spread_km)}</td>
                <td>{r.worst_pair || '—'}</td>
                <td><span className={`sev-pill ${r.severity}`}>{r.severity}</span></td>
                <td className="row-actions">
                  <button type="button" className="btn ghost sm" onClick={() => openDetail(r)}>
                    Detail
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => jumpMap(r.entity_layer, r.entity_id, r.territory)}
                  >
                    Map
                  </button>
                  {r.crm_url && (
                    <a className="btn ghost sm" href={r.crm_url} target="_blank" rel="noreferrer">
                      CRM
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span className="muted">
          {total.toLocaleString('en-IN')} rows · page {Math.floor(offset / limit) + 1}
        </span>
        <div className="pager-btns">
          <button
            type="button"
            className="btn ghost sm"
            disabled={offset <= 0}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Prev
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={offset + limit >= total}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </button>
        </div>
      </div>

      {(detail || detailLoading) && (
        <div className="disc-drawer-backdrop" onClick={() => setDetail(null)} role="presentation">
          <aside
            className="disc-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Discrepancy detail"
          >
            <header className="disc-drawer-head">
              <div>
                <h2>{disc?.title || detail?.mapPoint?.title || 'Detail'}</h2>
                <p className="muted">
                  {disc?.entity_layer || ''} · {disc?.entity_id || ''}
                  {disc?.severity && (
                    <> · <span className={`sev-pill ${disc.severity}`}>{disc.severity}</span></>
                  )}
                  {disc?.max_spread_km != null && <> · max {fmtKm(disc.max_spread_km)}</>}
                </p>
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setDetail(null)}>
                Close
              </button>
            </header>

            {detailLoading && <p className="muted">Loading location sources…</p>}

            {!detailLoading && disc && (
              <>
                <div className="source-cards">
                  {['mmi', 'billing', 'shipping', 'checkin'].map((src) => {
                    const addrKey = `${src}_address`;
                    const latKey = `${src}_lat`;
                    const lngKey = `${src}_lng`;
                    const pinKey = `${src}_pincode`;
                    const precKey = `${src}_precision`;
                    const has = disc[latKey] != null || disc[addrKey] || disc[pinKey]
                      || (src === 'checkin' && disc.checkin_meeting_id);
                    return (
                      <div key={src} className={`source-card ${has ? 'has' : 'missing'}`}>
                        <h3>{SOURCE_LABEL[src]}</h3>
                        {!has && <p className="muted">Source absent</p>}
                        {has && (
                          <>
                            {disc[addrKey] && <p className="addr-text">{disc[addrKey]}</p>}
                            {disc[pinKey] && <p className="muted">PIN {disc[pinKey]}</p>}
                            <p className="mono">{fmtCoord(disc[latKey], disc[lngKey])}</p>
                            {disc[precKey] && (
                              <p className="muted">Precision: {disc[precKey]}</p>
                            )}
                            {src === 'checkin' && disc.checkin_meeting_id && (
                              <p className="muted">Meeting {disc.checkin_meeting_id}</p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>

                <section className="soft-block">
                  <h2>Pairwise distances</h2>
                  <div className="pair-grid">
                    {[
                      ['mmi_billing_km', 'MMI vs billing'],
                      ['mmi_shipping_km', 'MMI vs shipping'],
                      ['billing_shipping_km', 'Billing vs shipping'],
                      ['mmi_checkin_km', 'MMI vs check-in'],
                      ['billing_checkin_km', 'Billing vs check-in'],
                      ['shipping_checkin_km', 'Shipping vs check-in'],
                    ].map(([k, label]) => (
                      <div key={k} className="pair-cell">
                        <span>{label}</span>
                        <strong className="mono">{fmtKm(disc[k])}</strong>
                      </div>
                    ))}
                  </div>
                </section>

                {Array.isArray(signalsBySource.checkin) && signalsBySource.checkin.length > 1 && (
                  <section className="soft-block">
                    <h2>All check-ins ({signalsBySource.checkin.length})</h2>
                    <ul className="reason-list">
                      {signalsBySource.checkin.map((c) => (
                        <li key={c.meeting_id || c.record_ts}>
                          <span className="mono">{fmtCoord(c.lat, c.lng)}</span>
                          <span className="reason-text">
                            {c.meeting_id || 'meeting'} · {c.precision}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <div className="drawer-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      jumpMap(disc.entity_layer, disc.entity_id, disc.territory);
                      setDetail(null);
                    }}
                  >
                    Show on map
                  </button>
                  {disc.crm_url && (
                    <a className="btn ghost" href={disc.crm_url} target="_blank" rel="noreferrer">
                      Open in CRM
                    </a>
                  )}
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
