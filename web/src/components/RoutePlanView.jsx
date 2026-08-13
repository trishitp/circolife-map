import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchRouteCandidates,
  fetchRouteNearby,
  optimizeRoute,
  fetchRoutePlan,
  saveRoutePlan,
  deleteRoutePlan,
  shareRoutePlan,
  googleMapsNavUrl,
  googleMapsStopUrl,
} from '../lib/api';
import { decodePolyline } from '../lib/polyline';
import RouteMap from './RouteMap';
import PeopleFilters from './PeopleFilters';

function todayIST() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function fmtTime(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return '—';
  }
}

function fmtKm(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1)} km`;
}

function fmtMin(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Math.round(Number(v));
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function RoutePlanView({ options = {} }) {
  const [owner, setOwner] = useState('');
  const [ownerQ, setOwnerQ] = useState('');
  const [date, setDate] = useState(todayIST());
  const [territory, setTerritory] = useState([]);
  const [userStatus, setUserStatus] = useState([]);
  const [role, setRole] = useState([]);
  const [source, setSource] = useState([]);
  const [radiusKm, setRadiusKm] = useState(3);

  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);

  const [candidates, setCandidates] = useState(null);
  const [planStops, setPlanStops] = useState([]);
  const [nearby, setNearby] = useState([]);
  const [origin, setOrigin] = useState(null);
  const [legs, setLegs] = useState([]);
  const [routeCoords, setRouteCoords] = useState([]);
  const [polyline, setPolyline] = useState(null);
  const [totals, setTotals] = useState(null);
  const [provider, setProvider] = useState(null);
  const [warning, setWarning] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [unmapped, setUnmapped] = useState([]);

  const legByTo = useMemo(() => {
    const m = new Map();
    for (const L of legs) if (L.toId) m.set(L.toId, L);
    return m;
  }, [legs]);

  const planIdSet = useMemo(() => new Set(planStops.map((s) => s.id)), [planStops]);

  const load = useCallback(async () => {
    if (!owner || !date) return;
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const data = await fetchRouteCandidates({
        owner,
        date,
        territory: territory.length ? territory.join(',') : undefined,
        source: source.length ? source.join(',') : undefined,
        radiusKm,
      });
      setCandidates(data);
      setUnmapped(data.unmapped || []);
      setOrigin(data.origin || null);
      setNearby(data.nearby || []);

      // Prefer saved plan if any
      let usedSaved = false;
      try {
        const saved = await fetchRoutePlan(owner, date);
        if (saved?.stops?.length) {
          setPlanStops(saved.stops.map((s, i) => ({ ...s, order: s.order || i + 1 })));
          setLegs([]);
          setTotals(saved.totals || null);
          setPolyline(saved.polyline || null);
          if (saved.polyline) {
            const coords = decodePolyline(saved.polyline);
            setRouteCoords(coords.length >= 2 ? coords : []);
          } else {
            setRouteCoords([]);
          }
          if (saved.origin_lat != null) {
            setOrigin({
              lat: saved.origin_lat,
              lng: saved.origin_lng,
              label: saved.origin_label || 'Saved origin',
            });
          }
          if (saved.share_token) {
            setShareUrl(`${window.location.origin}${window.location.pathname}#/r/${saved.share_token}`);
          } else {
            setShareUrl(null);
          }
          setMsg('Loaded saved draft plan');
          usedSaved = true;
        }
      } catch {
        // 404 — no draft
      }

      if (!usedSaved) {
        const meetings = (data.meetings || []).map((s, i) => ({ ...s, order: i + 1 }));
        setPlanStops(meetings);
        setRouteCoords([]);
        setLegs([]);
        setTotals(null);
        setPolyline(null);
        setShareUrl(null);
        setProvider(null);
        setWarning(null);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [owner, date, territory, source, radiusKm]);

  useEffect(() => {
    if (owner && date) load();
  }, [owner, date, territory, source]); // eslint-disable-line react-hooks/exhaustive-deps -- radius via Load

  const addToPlan = (stop) => {
    if (planIdSet.has(stop.id)) return;
    setPlanStops((prev) => [
      ...prev,
      { ...stop, order: prev.length + 1, kind: stop.kind || 'nearby' },
    ]);
    setRouteCoords([]);
    setLegs([]);
    setTotals(null);
    setPolyline(null);
    setMsg(`Added ${stop.title} to plan`);
  };

  const removeFromPlan = (id) => {
    setPlanStops((prev) => prev
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i + 1 })));
    setRouteCoords([]);
    setLegs([]);
    setTotals(null);
    setPolyline(null);
  };

  const moveStop = (id, dir) => {
    setPlanStops((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx < 0) return prev;
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    setRouteCoords([]);
    setLegs([]);
    setTotals(null);
    setPolyline(null);
  };

  const planPayload = () => ({
    origin,
    originLat: origin?.lat,
    originLng: origin?.lng,
    originLabel: origin?.label,
    stops: planStops,
    polyline: polyline || null,
    totals: totals || {},
  });

  const runOptimize = async () => {
    if (planStops.length < 1) {
      setError('Add at least one plannable stop');
      return;
    }
    setOptimizing(true);
    setError(null);
    setWarning(null);
    try {
      const body = {
        origin: origin || undefined,
        stops: planStops.map((s) => ({
          id: s.id,
          layer: s.layer,
          sourceId: s.sourceId,
          title: s.title,
          lat: s.lat,
          lng: s.lng,
          precision: s.precision,
          scheduledAt: s.scheduledAt,
          crmUrl: s.crmUrl,
          address: s.address,
          kind: s.kind,
        })),
        departureTime: new Date(Date.now() + 120_000).toISOString(),
      };
      const result = await optimizeRoute(body);
      setPlanStops(result.stops || []);
      setLegs(result.legs || []);
      setRouteCoords(result.routeCoords || []);
      setPolyline(result.polyline || null);
      setTotals(result.totals || null);
      setProvider(result.provider || null);
      setWarning(result.warning || null);
      if (result.origin) setOrigin(result.origin);
      const roadOk = result.provider === 'google_routes' || result.provider === 'google_directions';
      setMsg(
        roadOk
          ? `Optimized on roads · ${fmtKm(result.totals?.km)} · ${fmtMin(result.totals?.minutes)}`
          : result.warning || 'Optimized (fallback)',
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setOptimizing(false);
    }
  };

  const saveDraft = async () => {
    if (!owner || !date) return;
    setSaving(true);
    setError(null);
    try {
      await saveRoutePlan(owner, date, planPayload());
      setMsg('Draft saved');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const shareWithRm = async () => {
    if (!owner || !date) return;
    if (!planStops.length) {
      setError('Add at least one stop before sharing');
      return;
    }
    setSharing(true);
    setError(null);
    try {
      const res = await shareRoutePlan(owner, date, planPayload());
      const url = `${window.location.origin}${window.location.pathname}#/r/${res.shareToken}`;
      setShareUrl(url);
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          copied = true;
        }
      } catch { /* */ }
      if (navigator.share) {
        try {
          await navigator.share({
            title: `Circolife route · ${owner}`,
            text: `Your day route for ${date}`,
            url,
          });
          setMsg('Shared with RM');
          return;
        } catch {
          // user cancelled share sheet — still keep link
        }
      }
      setMsg(copied
        ? 'Link copied — send to RM (WhatsApp / SMS)'
        : 'Share link ready — copy and send to RM');
    } catch (e) {
      setError(e.message);
    } finally {
      setSharing(false);
    }
  };

  const clearPlan = async () => {
    setPlanStops([]);
    setLegs([]);
    setRouteCoords([]);
    setTotals(null);
    setPolyline(null);
    setShareUrl(null);
    setProvider(null);
    setWarning(null);
    setMsg(null);
    try {
      if (owner && date) await deleteRoutePlan(owner, date);
    } catch { /* */ }
  };

  const exploreNearSelected = async () => {
    const stop = planStops.find((s) => s.id === selectedId)
      || planStops[0]
      || null;
    if (!stop) {
      setError('Select a plan stop first (or load meetings)');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRouteNearby({
        lat: stop.lat,
        lng: stop.lng,
        radiusKm,
        territory: territory.length ? territory.join(',') : undefined,
        source: source.length ? source.join(',') : undefined,
        layers: 'leads,accounts',
      });
      setNearby(data.stops || []);
      setMsg(`${data.count || 0} nearby within ${radiusKm} km of ${stop.title}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const navAll = googleMapsNavUrl(planStops, origin);

  return (
    <div className="routes-plan">
      <div className="toolbar activity-toolbar">
        <div className="activity-field">
          <label htmlFor="route-date">Date (IST)</label>
          <input
            id="route-date"
            className="input"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="activity-field">
          <label htmlFor="route-radius">Nearby km</label>
          <input
            id="route-radius"
            className="input"
            type="number"
            min={0.5}
            max={25}
            step={0.5}
            value={radiusKm}
            onChange={(e) => setRadiusKm(Number(e.target.value) || 3)}
          />
        </div>
        <div className="routes-actions">
          <button type="button" className="btn" disabled={!owner || loading} onClick={load}>
            {loading ? 'Loading…' : 'Load'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!planStops.length || optimizing}
            onClick={runOptimize}
          >
            {optimizing ? 'Optimizing…' : 'Optimize'}
          </button>
          <button type="button" className="btn ghost" disabled={!owner || saving} onClick={saveDraft}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!owner || !planStops.length || sharing}
            onClick={shareWithRm}
          >
            {sharing ? 'Sharing…' : 'Share to RM'}
          </button>
          <button type="button" className="btn ghost" onClick={clearPlan}>
            Clear
          </button>
        </div>
      </div>
      <PeopleFilters
        options={options}
        userStatus={userStatus}
        onUserStatus={setUserStatus}
        role={role}
        onRole={setRole}
        owner={owner}
        onOwner={setOwner}
        ownerQ={ownerQ}
        onOwnerQ={setOwnerQ}
        ownerMode="single"
        territory={territory}
        onTerritory={setTerritory}
        source={source}
        onSource={setSource}
        showSource
      />

      {error && <p className="banner err">{error}</p>}
      {msg && !error && <p className="banner ok">{msg}</p>}
      {warning && <p className="banner warn">{warning}</p>}
      {shareUrl && (
        <div className="share-link-bar">
          <span className="muted">RM link</span>
          <input className="input share-link-input" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
          <button
            type="button"
            className="btn ghost sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl);
                setMsg('Link copied');
              } catch {
                setError('Could not copy — select the link and copy manually');
              }
            }}
          >
            Copy
          </button>
        </div>
      )}

      {!owner && (
        <p className="muted">Pick a field agent and date to build a day route plan.</p>
      )}

      {owner && candidates && (
        <>
          <div className="stat-grid activity-kpi">
            <div className="stat-card static">
              <span className="stat-label">Plan stops</span>
              <span className="stat-value">{planStops.length}</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Meetings mapped</span>
              <span className="stat-value">{(candidates.meetings || []).length}</span>
              <span className="stat-sub">{unmapped.length} unmapped</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Nearby</span>
              <span className="stat-value">{nearby.length}</span>
              <span className="stat-sub">within {radiusKm} km</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Drive</span>
              <span className="stat-value">{fmtKm(totals?.km)}</span>
              <span className="stat-sub">
                {fmtMin(totals?.minutes)}
                {provider
                  ? ` · ${provider === 'google_routes' || provider === 'google_directions' ? 'roads' : 'fallback'}`
                  : ''}
              </span>
            </div>
          </div>

          <div className="walk-layout routes-layout">
            <div className="walk-map-wrap soft-block">
              <RouteMap
                planStops={planStops}
                candidates={candidates.meetings || []}
                nearby={nearby}
                routeCoords={routeCoords}
                selectedId={selectedId}
                onSelectStop={setSelectedId}
              />
              <div className="walk-map-legend" aria-hidden="true">
                <span><i className="walk-dot start" /> Start / plan #</span>
                <span><i className="walk-dot stop" /> Road path</span>
                <span><i className="route-legend-dot candidate" /> Meeting</span>
                <span><i className="route-legend-dot nearby" /> Nearby drop-in</span>
              </div>
              <div className="routes-map-actions">
                <button type="button" className="btn ghost sm" onClick={exploreNearSelected}>
                  Explore nearest
                </button>
                {navAll && (
                  <a className="btn sm" href={navAll} target="_blank" rel="noreferrer">
                    Navigate all
                  </a>
                )}
              </div>
            </div>

            <div className="routes-sidebar">
              <div className="soft-block route-plan-panel">
                <div className="route-panel-head">
                  <h2>Day plan</h2>
                  {origin && (
                    <span className="muted route-origin-hint">
                      From: {origin.label || `${origin.lat?.toFixed?.(4)}, ${origin.lng?.toFixed?.(4)}`}
                    </span>
                  )}
                </div>
                {!planStops.length && (
                  <p className="muted">No stops in plan. Load meetings or add nearby drop-ins.</p>
                )}
                <ol className="walk-stop-list route-stop-list">
                  {planStops.map((s, idx) => {
                    const leg = legByTo.get(s.id);
                    const nav = googleMapsStopUrl(s);
                    return (
                      <li
                        key={s.id}
                        className={[
                          'walk-stop route-stop',
                          selectedId === s.id ? 'on' : '',
                          s.precision === 'approx' ? 'approx' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          type="button"
                          className="walk-stop-btn"
                          onClick={() => setSelectedId(s.id)}
                        >
                          <span className="walk-order">{s.order || idx + 1}</span>
                          <span className="walk-stop-body">
                            <span className="walk-title">{s.title}</span>
                            <span className="walk-meta">
                              <span className="badge outcome">{s.layer}</span>
                              {s.precision === 'approx' && (
                                <span className="badge late">~1 km</span>
                              )}
                              {s.scheduledAt && (
                                <span>Start {fmtTime(s.scheduledAt)}</span>
                              )}
                              {s.eta && <span>ETA {fmtTime(s.eta)}</span>}
                            </span>
                            {leg && (
                              <span className="walk-leg muted">
                                ← drive {fmtKm(leg.km)} · {fmtMin(leg.minutes)}
                              </span>
                            )}
                          </span>
                        </button>
                        <div className="route-stop-actions">
                          <button type="button" className="icon-btn" title="Move up" onClick={() => moveStop(s.id, -1)}>↑</button>
                          <button type="button" className="icon-btn" title="Move down" onClick={() => moveStop(s.id, 1)}>↓</button>
                          <button type="button" className="icon-btn" title="Remove" onClick={() => removeFromPlan(s.id)}>×</button>
                          {nav && (
                            <a className="walk-crm" href={nav} target="_blank" rel="noreferrer">Nav</a>
                          )}
                          {s.crmUrl && (
                            <a className="walk-crm" href={s.crmUrl} target="_blank" rel="noreferrer">CRM</a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="soft-block route-plan-panel">
                <div className="route-panel-head">
                  <h2>Nearby drop-ins</h2>
                  <button type="button" className="btn ghost sm" onClick={exploreNearSelected}>
                    Refresh
                  </button>
                </div>
                {!nearby.length && (
                  <p className="muted">No nearby leads/accounts — try Explore nearest or widen radius.</p>
                )}
                <ul className="route-nearby-list">
                  {nearby.filter((s) => !planIdSet.has(s.id)).slice(0, 20).map((s) => (
                    <li key={s.id} className="route-nearby-row">
                      <div>
                        <strong>{s.title}</strong>
                        <span className="muted">
                          {' '}{s.layer} · {fmtKm(s.distanceKm)}
                          {s.precision === 'approx' ? ' · ~1 km' : ''}
                        </span>
                      </div>
                      <button type="button" className="btn ghost sm" onClick={() => addToPlan(s)}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {unmapped.length > 0 && (
                <div className="soft-block route-plan-panel">
                  <h2>Unmapped meetings</h2>
                  <p className="muted">
                    Missing usable coordinates — fix in CRM / Gaps before routing.
                  </p>
                  <ul className="route-nearby-list">
                    {unmapped.map((s) => (
                      <li key={s.id} className="route-nearby-row">
                        <div>
                          <strong>{s.title}</strong>
                          <span className="muted"> {s.precision || 'none'}</span>
                        </div>
                        {s.crmUrl && (
                          <a className="walk-crm" href={s.crmUrl} target="_blank" rel="noreferrer">CRM</a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
