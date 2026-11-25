import { useEffect, useState } from 'react';
import { fetchBdmScorecard } from '../lib/api';

export default function BdmScorecard({ owner, days, bbox, onOpenAlerts }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!owner) {
      setData(null);
      return undefined;
    }
  let cancelled = false;
    setErr(null);
    const params = { owner, days: days || 90 };
    if (bbox?.length === 4) params.bbox = bbox.join(',');
    fetchBdmScorecard(params)
      .then((r) => { if (!cancelled) setData(r); })
      .catch((e) => { if (!cancelled) { setData(null); setErr(e.message); } });
    return () => { cancelled = true; };
  }, [owner, days, bbox?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!owner) return null;
  if (err) {
    return (
      <div className="bdm-scorecard err" role="status">
        Could not load territory scorecard.
      </div>
    );
  }
  if (!data) {
    return <div className="bdm-scorecard loading" aria-busy="true">Loading territory score…</div>;
  }

  const visitPct = data.visits?.inTerritoryPct;

  return (
    <div className="bdm-scorecard" role="region" aria-label="Territory scorecard">
      <header className="bdm-scorecard-head">
        <strong>Territory score</strong>
        <span className="muted">{data.days}d · {data.assignedPincodes} PINs</span>
      </header>
      <div className="bdm-scorecard-grid">
        <div className="bdm-score-metric">
          <span className="val">{visitPct != null ? `${visitPct}%` : '—'}</span>
          <span className="lbl">Visits in assigned PINs</span>
          <span className="sub">
            {(data.visits?.inTerritory ?? 0).toLocaleString('en-IN')}
            {' / '}
            {((data.visits?.total ?? 0) - (data.visits?.noPin ?? 0)).toLocaleString('en-IN')}
          </span>
          </div>
        <div className="bdm-score-metric">
          <span className="val">{(data.leadsInTerritory ?? 0).toLocaleString('en-IN')}</span>
          <span className="lbl">Leads in territory (view)</span>
        </div>
        <div className="bdm-score-metric">
          <span className="val">
            {data.precision?.weakPct != null ? `${data.precision.weakPct}%` : '—'}
          </span>
          <span className="lbl">Weak location (leads/accounts in PINs)</span>
          {data.precision?.weak > 0 && onOpenAlerts && (
            <button type="button" className="bdm-score-link" onClick={onOpenAlerts}>
              Review on map
            </button>
          )}
        </div>
      </div>
    </div>
  );
}