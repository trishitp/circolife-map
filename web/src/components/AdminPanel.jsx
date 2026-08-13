import { useCallback, useEffect, useState } from 'react';
import {
  fetchAdminDashboard, fetchAdminJob, triggerSync, triggerAssetsSync, triggerRegeocode,
  clearFailedCache, clearAllCache, refreshTerritories, overridePoint,
  bulkOverride, searchPoints, fetchCacheSample, triggerRebuildDiscrepancies,
  fetchZohoStatus, refreshZohoToken, exchangeZohoCode,
} from '../lib/api';
import ApiCostPanel from './ApiCostPanel';
import UsersAdmin from './UsersAdmin';

const LAYER_LABEL = {
  leads: 'Leads', accounts: 'Accounts', meetings: 'Meetings', assets: 'Assets',
};

export default function AdminPanel({ me }) {
  const [dash, setDash] = useState(null);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState([]);
  const [override, setOverride] = useState({ layer: '', id: '', lat: '', lng: '', notes: '' });
  const [csv, setCsv] = useState('layer,source_id,lat,lng\n');
  const [cacheSample, setCacheSample] = useState(null);
  const [zoho, setZoho] = useState(null);
  const [authCode, setAuthCode] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, z] = await Promise.all([
        fetchAdminDashboard(),
        fetchZohoStatus().catch((e) => ({ accessValid: false, error: e.message })),
      ]);
      setDash(d);
      setJob(d.job);
      setZoho(z);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (job?.status !== 'running') return undefined;
    const t = setInterval(async () => {
      try {
        const j = await fetchAdminJob();
        setJob(j);
        if (j.status !== 'running') load();
      } catch { /* */ }
    }, 2000);
    return () => clearInterval(t);
  }, [job?.status, load]);

  const run = async (label, fn) => {
    setError(null); setMsg(null);
    try {
      const r = await fn();
      setMsg(`${label} started`);
      setJob(r);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const coveragePivot = () => {
    if (!dash) return {};
    const m = {};
    for (const r of dash.coverage) {
      if (!m[r.layer]) m[r.layer] = { total: 0 };
      m[r.layer][r.precision] = r.n;
      m[r.layer].total += r.n;
    }
    return m;
  };

  const pivot = coveragePivot();

  return (
    <div className="page-panel admin-panel">
      <header className="page-head">
        <div>
          <h1>Admin</h1>
          <p>Sync, geocode queue, cache, discrepancies rebuild, API cost, and manual pins.</p>
        </div>
      </header>

      {error && <div className="banner err">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}
      {job?.status === 'running' && (
        <div className="banner run">Job running: {job.kind}…</div>
      )}
      {job?.status === 'ok' && job.result && (
        <div className="banner ok">
          Last job ({job.kind}) ok
          {job.result.upgraded != null && ` — upgraded ${job.result.upgraded}`}
          {job.durationMs != null && ` in ${(job.durationMs / 1000).toFixed(0)}s`}
        </div>
      )}
      {job?.status === 'error' && (
        <div className="banner err">Job failed: {job.error}</div>
      )}

      <ApiCostPanel />
      <UsersAdmin me={me} />

      {dash && (
        <>
          <section className="soft-block">
            <h2>Zoho auth</h2>
            <p className="muted">
              Access tokens auto-refresh on every Zoho call (and ~60s before expiry).
              Rotated refresh tokens are written to <code>.env</code> automatically.
              If the stored refresh token is revoked, generate a Self Client code at{' '}
              <a href="https://api-console.zoho.in/" target="_blank" rel="noreferrer">
                api-console.zoho.in
              </a>
              {' '}(scope: <code>ZohoAnalytics.fullaccess.all</code>) and exchange it here.
            </p>
            <div className="meta-row">
              <span>
                Status:{' '}
                <strong className={zoho?.accessValid ? '' : 'warn'}>
                  {zoho?.accessValid
                    ? 'connected'
                    : zoho?.needsReauth
                      ? 'refresh token revoked — re-auth required'
                      : zoho?.coolingDown
                        ? `cooling down (${zoho.coolDownSeconds}s)`
                        : 'not connected'}
                </strong>
              </span>
              <span>Client: {zoho?.hasClient ? 'set' : 'missing'}</span>
              <span>Refresh token: {zoho?.hasRefresh ? 'set' : 'missing'}</span>
              {zoho?.accessExpiresAt && (
                <span>
                  Access exp:{' '}
                  {new Date(zoho.accessExpiresAt).toLocaleTimeString('en-IN')}
                </span>
              )}
            </div>
            {zoho?.error && <div className="banner err">{zoho.error}</div>}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  setError(null); setMsg(null);
                  try {
                    const z = await refreshZohoToken();
                    setZoho(z);
                    setMsg('Zoho access token refreshed');
                  } catch (e) {
                    setError(e.message);
                    load();
                  }
                }}
              >
                Refresh access token
              </button>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <input
                className="input"
                placeholder="Paste Zoho grant code (one-time re-auth)"
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
              />
              <button
                type="button"
                className="btn ghost"
                disabled={!authCode.trim()}
                onClick={async () => {
                  setError(null); setMsg(null);
                  try {
                    const z = await exchangeZohoCode(authCode.trim());
                    setZoho(z);
                    setAuthCode('');
                    setMsg(z.hasRefresh
                      ? 'New refresh token saved to .env'
                      : 'Access token obtained (no refresh token in response)');
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Exchange code
              </button>
            </div>
          </section>

          <section className="soft-block">
            <h2>Coverage</h2>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Layer</th>
                    <th>Total</th>
                    <th>Exact</th>
                    <th>Geocoded</th>
                    <th>Pincode</th>
                    <th>Territory</th>
                    <th>Approx</th>
                    <th>Inherited</th>
                    <th>None</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(pivot).map(([layer, c]) => (
                    <tr key={layer}>
                      <td>{LAYER_LABEL[layer] || layer}</td>
                      <td>{c.total?.toLocaleString('en-IN')}</td>
                      <td>{c.exact || 0}</td>
                      <td>{c.geocoded || 0}</td>
                      <td>{c.pincode || 0}</td>
                      <td>{c.territory || 0}</td>
                      <td>{c.approx || 0}</td>
                      <td>{c.inherited || 0}</td>
                      <td className="warn">{c.none || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="meta-row">
              <span>Geocoder: <strong>{dash.geocoder}</strong>
                {dash.hasGoogleKey ? ' · Google key set' : ' · no Google key'}
                {dash.hasOlaKey ? ' · Ola key set' : ''}
              </span>
              <span>Cache: {dash.cache.ok} ok / {dash.cache.failed} failed</span>
              <span>Pincodes: {dash.pincodeCentroids}</span>
              <span>Territories: {dash.territoryCentroids}</span>
            </div>
          </section>

          <section className="soft-block">
            <h2>Operations</h2>
            <div className="btn-row">
              <button type="button" className="btn" disabled={job?.status === 'running'}
                onClick={() => run('Full sync', triggerSync)}>
                Run full sync
              </button>
              <button type="button" className="btn" disabled={job?.status === 'running'}
                onClick={() => run('Assets sync', triggerAssetsSync)}>
                Re-sync assets (shipping fallback)
              </button>
              <button type="button" className="btn" disabled={job?.status === 'running'}
                onClick={() => run('Re-geocode', () => triggerRegeocode({ clearFailed: true }))}>
                Clear failed + re-geocode
              </button>
              <button type="button" className="btn ghost" disabled={job?.status === 'running'}
                onClick={() => run('Discrepancies', triggerRebuildDiscrepancies)}>
                Rebuild discrepancies
              </button>
              <button type="button" className="btn ghost"
                onClick={async () => {
                  const r = await clearFailedCache();
                  setMsg(`Cleared ${r.deleted} failed cache rows`);
                  load();
                }}>
                Clear failed cache
              </button>
              <button type="button" className="btn ghost"
                onClick={async () => {
                  if (!confirm('Delete entire geocode cache?')) return;
                  const r = await clearAllCache();
                  setMsg(`Cleared ${r.deleted} cache rows`);
                  load();
                }}>
                Clear all cache
              </button>
              <button type="button" className="btn ghost"
                onClick={async () => {
                  const r = await refreshTerritories();
                  setMsg(`Refreshed ${r.territories} territory centroids`);
                  load();
                }}>
                Refresh territory centroids
              </button>
              <button type="button" className="btn ghost"
                onClick={async () => {
                  setCacheSample(await fetchCacheSample(true));
                }}>
                Sample failed cache
              </button>
            </div>
            {cacheSample && (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="data-table compact">
                  <thead><tr><th>Query</th><th>Provider</th><th>When</th></tr></thead>
                  <tbody>
                    {cacheSample.map((c, i) => (
                      <tr key={i}>
                        <td className="cell-reason">{c.query}</td>
                        <td>{c.provider}</td>
                        <td>{c.created_at ? new Date(c.created_at).toLocaleString('en-IN') : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="soft-block">
            <h2>Manual pin override</h2>
            <div className="toolbar">
              <input className="input" placeholder="Search points…" value={search}
                onChange={(e) => setSearch(e.target.value)} />
              <button type="button" className="btn ghost" onClick={async () => {
                setHits(await searchPoints(search));
              }}>Search</button>
            </div>
            {hits.length > 0 && (
              <ul className="hit-list">
                {hits.map((h) => (
                  <li key={`${h.layer}-${h.source_id}`}>
                    <button type="button" className="hit" onClick={() => setOverride({
                      layer: h.layer, id: h.source_id,
                      lat: h.lat ?? '', lng: h.lng ?? '', notes: '',
                    })}>
                      <strong>{h.title || h.source_id}</strong>
                      <span>{LAYER_LABEL[h.layer]} · {h.precision} · {h.territory || '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-grid">
              <label>Layer<input className="input" value={override.layer}
                onChange={(e) => setOverride({ ...override, layer: e.target.value })} /></label>
              <label>Source ID<input className="input" value={override.id}
                onChange={(e) => setOverride({ ...override, id: e.target.value })} /></label>
              <label>Lat<input className="input" value={override.lat}
                onChange={(e) => setOverride({ ...override, lat: e.target.value })} /></label>
              <label>Lng<input className="input" value={override.lng}
                onChange={(e) => setOverride({ ...override, lng: e.target.value })} /></label>
              <label className="span2">Notes<input className="input" value={override.notes}
                onChange={(e) => setOverride({ ...override, notes: e.target.value })} /></label>
            </div>
            <button type="button" className="btn" onClick={async () => {
              try {
                await overridePoint(override.layer, override.id, {
                  lat: Number(override.lat), lng: Number(override.lng), notes: override.notes,
                });
                setMsg(`Pinned ${override.layer}/${override.id}`);
                load();
              } catch (e) { setError(e.message); }
            }}>
              Save pin
            </button>
          </section>

          <section className="soft-block">
            <h2>Bulk CSV pin upload</h2>
            <p className="muted">Columns: layer, source_id, lat, lng</p>
            <textarea className="input textarea" rows={6} value={csv}
              onChange={(e) => setCsv(e.target.value)} />
            <button type="button" className="btn" onClick={async () => {
              try {
                const r = await bulkOverride(csv);
                setMsg(`Bulk: ${r.ok} ok, ${r.fail} failed`);
                load();
              } catch (e) { setError(e.message); }
            }}>
              Upload overrides
            </button>
          </section>

          <section className="soft-block">
            <h2>Recent runs</h2>
            <div className="table-wrap">
              <table className="data-table compact">
                <thead>
                  <tr><th>ID</th><th>Kind</th><th>Status</th><th>Started</th><th>Duration</th><th>Error</th></tr>
                </thead>
                <tbody>
                  {(dash.lastRuns || []).map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.kind}</td>
                      <td>{r.status}</td>
                      <td>{r.started_at ? new Date(r.started_at).toLocaleString('en-IN') : ''}</td>
                      <td>{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(0)}s` : '—'}</td>
                      <td className="cell-reason">{r.error || ''}</td>
                    </tr>
                  ))}
                  {!dash.lastRuns?.length && (
                    <tr><td colSpan={6} className="empty">No runs yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
