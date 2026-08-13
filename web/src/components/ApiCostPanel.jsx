import { useEffect, useState } from 'react';
import { fetchAdminUsage, saveAdminUsageRates } from '../lib/api';

function moneyUsd(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyInr(n) {
  const v = Number(n) || 0;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

export default function ApiCostPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [usdInr, setUsdInr] = useState('87');
  const [skuRates, setSkuRates] = useState({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const u = await fetchAdminUsage();
      setData(u);
      setUsdInr(String(u.rates?.usdInr ?? 87));
      setSkuRates(u.rates?.skus || {});
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    setError(null);
    try {
      await saveAdminUsageRates({
        usdInr: Number(usdInr),
        skus: skuRates,
      });
      setMsg('Rate card saved');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!data && !error) {
    return (
      <section className="soft-block">
        <h2>API cost</h2>
        <p className="muted">Loading usage…</p>
      </section>
    );
  }

  const totals = data?.totals || {};
  const estimates = data?.estimates || {};

  return (
    <section className="soft-block api-cost">
      <h2>API cost</h2>
      <p className="muted">
        Estimated spend from Maps API calls this app logs. This is not a Google Cloud invoice.
      </p>
      {error && <div className="banner err">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      {data && (
        <>
          <div className="stat-grid api-cost-stats">
            <div className="stat-card">
              <span className="stat-label">Today</span>
              <span className="stat-value">{moneyUsd(totals.usdToday)}</span>
              <span className="stat-sub">{moneyInr(totals.inrToday)} · {totals.unitsToday || 0} units</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">This month</span>
              <span className="stat-value">{moneyUsd(totals.usdMonth)}</span>
              <span className="stat-sub">{moneyInr(totals.inrMonth)} · {totals.unitsMonth || 0} units</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Failed geocode cache</span>
              <span className="stat-value">{(estimates.failedCache || 0).toLocaleString('en-IN')}</span>
              <span className="stat-sub">
                Re-geocode ≈ {moneyUsd(estimates.regeocodeUsd)} ({moneyInr(estimates.regeocodeInr)})
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">USD → INR</span>
              <span className="stat-value">{data.rates?.usdInr}</span>
              <span className="stat-sub">Edit in the rate card below</span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Today</th>
                  <th>Month</th>
                  <th>$ / 1k</th>
                  <th>Est. month</th>
                </tr>
              </thead>
              <tbody>
                {(data.bySku || []).map((s) => (
                  <tr key={s.sku}>
                    <td>
                      <strong>{s.label}</strong>
                      {s.note && <div className="stat-sub">{s.note}</div>}
                    </td>
                    <td>{s.unitsToday}</td>
                    <td>{s.unitsMonth}</td>
                    <td>{moneyUsd(s.usdPer1000)}</td>
                    <td>
                      {moneyUsd(s.usdMonth)}
                      <div className="stat-sub">{moneyInr(s.usdMonth * (data.rates?.usdInr || 0))}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="api-rate-card">
            <summary>Rate card (USD per 1,000 calls)</summary>
            <p className="muted">
              Defaults match Google Maps Platform list prices. Change them to match
              your contract or INR FX. Saved for everyone on this server.
            </p>
            <div className="activity-field" style={{ maxWidth: 200, marginBottom: 12 }}>
              <label htmlFor="usd-inr">USD → INR</label>
              <input
                id="usd-inr"
                className="input"
                type="number"
                min="1"
                max="500"
                step="0.1"
                value={usdInr}
                onChange={(e) => setUsdInr(e.target.value)}
              />
            </div>
            <div className="api-rate-grid">
              {(data.bySku || []).map((s) => (
                <label key={s.sku} className="activity-field">
                  {s.label}
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="500"
                    step="0.01"
                    value={skuRates[s.sku] ?? ''}
                    onChange={(e) => setSkuRates((prev) => ({
                      ...prev,
                      [s.sku]: e.target.value,
                    }))}
                  />
                </label>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={saving} onClick={save}>
                {saving ? 'Saving…' : 'Save rates'}
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
