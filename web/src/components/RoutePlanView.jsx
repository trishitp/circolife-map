import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  googleMapsNavTruncated,
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

function shiftDate(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
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

function timeHHmmIST(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return null;
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

function layerLabel(layer) {
  const k = String(layer || '').toLowerCase();
  if (k === 'leads') return 'Lead';
  if (k === 'accounts') return 'Account';
  if (k === 'meetings') return 'Meeting';
  if (k === 'assets') return 'Asset';
  return layer || 'Stop';
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bestInsertIndex(stops, stop, origin) {
  let bestI = stops.length;
  let bestCost = Infinity;
  for (let i = 0; i <= stops.length; i++) {
    const prev = i === 0 ? origin : stops[i - 1];
    const next = i < stops.length ? stops[i] : null;
    let cost = 0;
    if (prev && Number.isFinite(Number(prev.lat))) {
      cost += haversineKm(prev.lat, prev.lng, stop.lat, stop.lng);
    }
    if (next && Number.isFinite(Number(next.lat))) {
      cost += haversineKm(stop.lat, stop.lng, next.lat, next.lng);
    }
    if (prev && next && Number.isFinite(Number(prev.lat)) && Number.isFinite(Number(next.lat))) {
      cost -= haversineKm(prev.lat, prev.lng, next.lat, next.lng);
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestI = i;
    }
  }
  return bestI;
}

function departIso(date, hhmm) {
  const t = hhmm && /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : '09:00';
  return new Date(`${date}T${t}:00+05:30`).toISOString();
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
  const [departTime, setDepartTime] = useState('09:00');
  const [lockOrder, setLockOrder] = useState(true);
  const [nearbyQ, setNearbyQ] = useState('');
  const [nearbyLayer, setNearbyLayer] = useState('all');

  const [loading, setLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [usingDraft, setUsingDraft] = useState(false);

  const [candidates, setCandidates] = useState(null);
  const [originOptions, setOriginOptions] = useState([]);
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
  const stopRefs = useRef(new Map());

  const legByTo = useMemo(() => {
    const m = new Map();
    for (const L of legs) if (L.toId) m.set(L.toId, L);
    return m;
  }, [legs]);

  const planIdSet = useMemo(() => new Set(planStops.map((s) => s.id)), [planStops]);

  const selectedStop = useMemo(() => {
    if (!selectedId) return null;
    return planStops.find((s) => s.id === selectedId)
      || nearby.find((s) => s.id === selectedId)
      || (candidates?.meetings || []).find((s) => s.id === selectedId)
      || null;
  }, [selectedId, planStops, nearby, candidates]);

  const selectedInPlan = selectedStop ? planIdSet.has(selectedStop.id) : false;

  const filteredNearby = useMemo(() => {
    const q = nearbyQ.trim().toLowerCase();
    return nearby.filter((s) => {
      if (planIdSet.has(s.id)) return false;
      if (nearbyLayer !== 'all' && s.layer !== nearbyLayer) return false;
      if (q && !String(s.title || '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [nearby, planIdSet, nearbyQ, nearbyLayer]);

  const markStale = () => {
    setRouteCoords([]);
    setLegs([]);
    setTotals(null);
    setPolyline(null);
    setProvider(null);
  };

  const applyMeetings = (data) => {
    const meetings = (data.meetings || []).map((s, i) => ({ ...s, order: i + 1 }));
    setPlanStops(meetings);
    markStale();
    setShareUrl(null);
    setWarning(null);
    setUsingDraft(false);
    const firstT = timeHHmmIST(meetings.find((m) => m.scheduledAt)?.scheduledAt);
    if (firstT) setDepartTime(firstT);
  };

  const load = useCallback(async ({ preferDraft = true } = {}) => {
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
      setOriginOptions(data.originOptions || (data.origin ? [data.origin] : []));
      setNearby(data.nearby || []);

      let usedSaved = false;
      if (preferDraft) {
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
                source: 'saved',
              });
            } else {
              setOrigin(data.origin || null);
            }
            if (saved.share_token) {
              setShareUrl(`${window.location.origin}${window.location.pathname}#/r/${saved.share_token}`);
            } else {
              setShareUrl(null);
            }
            setUsingDraft(true);
            setMsg('Loaded saved draft — reset to reload today’s meetings.');
            usedSaved = true;
          }
        } catch {
          // 404 — no draft
        }
      }

      if (!usedSaved) {
        setOrigin(data.origin || null);
        applyMeetings(data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [owner, date, territory, source, radiusKm]);

  useEffect(() => {
    if (owner && date) load({ preferDraft: true });
  }, [owner, date, territory, source]); // eslint-disable-line react-hooks/exhaustive-deps -- radius via Find nearby

  useEffect(() => {
    if (!selectedId) return;
    const el = stopRefs.current.get(selectedId);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);

  const addToPlan = (stop) => {
    if (planIdSet.has(stop.id)) return;
    setPlanStops((prev) => {
      const insertAt = lockOrder ? bestInsertIndex(prev, stop, origin) : prev.length;
      const next = [...prev];
      next.splice(insertAt, 0, { ...stop, kind: stop.kind || 'nearby' });
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
    markStale();
    setSelectedId(stop.id);
    setMsg(`Added ${stop.title}`);
  };

  const removeFromPlan = (id) => {
    setPlanStops((prev) => prev
      .filter((s) => s.id !== id)
      .map((s, i) => ({ ...s, order: i + 1 })));
    markStale();
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
    markStale();
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
      setError('Add at least one stop with a usable location');
      return null;
    }
    setOptimizing(true);
    setError(null);
    setWarning(null);
    try {
      const result = await optimizeRoute({
        origin: origin || undefined,
        lockOrder,
        departureTime: departIso(date, departTime),
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
      });
      setPlanStops(result.stops || []);
      setLegs(result.legs || []);
      setRouteCoords(result.routeCoords || []);
      setPolyline(result.polyline || null);
      setTotals(result.totals || null);
      setProvider(result.provider || null);
      setWarning(result.warning || null);
      if (result.origin) {
        setOrigin((prev) => ({ ...prev, ...result.origin }));
      }
      const roadOk = result.provider === 'google_routes' || result.provider === 'google_directions';
      setMsg(
        roadOk
          ? `${lockOrder ? 'Drive times' : 'Shortest drive'} · ${fmtKm(result.totals?.km)} · ${fmtMin(result.totals?.minutes)}`
          : result.warning || 'Optimized (fallback)',
      );
      return result;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setOptimizing(false);
    }
  };

  const saveDraft = async (payload) => {
    if (!owner || !date) return;
    setSaving(true);
    setError(null);
    try {
      await saveRoutePlan(owner, date, payload || planPayload());
      setUsingDraft(true);
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
      let payload = planPayload();
      if (!polyline && planStops.length >= 1) {
        const result = await runOptimize();
        if (result) {
          payload = {
            origin: result.origin || origin,
            originLat: result.origin?.lat ?? origin?.lat,
            originLng: result.origin?.lng ?? origin?.lng,
            originLabel: result.origin?.label ?? origin?.label,
            stops: result.stops || planStops,
            polyline: result.polyline || null,
            totals: result.totals || {},
          };
        }
      }
      const res = await shareRoutePlan(owner, date, payload);
      const url = `${window.location.origin}${window.location.pathname}#/r/${res.shareToken}`;
      setShareUrl(url);
      setUsingDraft(true);
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
            title: 'Circolife Maps route',
            text: `Your route for ${date}`,
            url,
          });
          setMsg('Shared');
          return;
        } catch {
          // cancelled
        }
      }
      setMsg(copied
        ? 'Link copied. Send it to the field agent.'
        : 'Share link ready. Copy and send it to the field agent.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSharing(false);
    }
  };

  const clearPlan = async () => {
    if (planStops.length && !window.confirm('Clear this day’s plan?')) return;
    setPlanStops([]);
    markStale();
    setShareUrl(null);
    setWarning(null);
    setMsg(null);
    setUsingDraft(false);
    try {
      if (owner && date) await deleteRoutePlan(owner, date);
    } catch { /* */ }
  };

  const resetToMeetings = () => {
    if (!candidates) return;
    applyMeetings(candidates);
    setOrigin(candidates.origin || originOptions[0] || null);
    setMsg('Reset to today’s meetings');
  };

  const exploreNearSelected = async (centerStop) => {
    const stop = centerStop
      || planStops.find((s) => s.id === selectedId)
      || planStops[0]
      || origin;
    if (!stop || !Number.isFinite(Number(stop.lat))) {
      setError('Select a stop on the map, or load meetings first');
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
        layers: nearbyLayer === 'all' ? 'leads,accounts' : nearbyLayer,
      });
      setNearby(data.stops || []);
      setMsg(`${data.count || 0} nearby within ${radiusKm} km of ${stop.title || stop.label || 'this point'}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const onSelectOrigin = (sourceKey) => {
    const next = originOptions.find((o) => o.source === sourceKey);
    if (!next) return;
    setOrigin(next);
    markStale();
  };

  const navAll = googleMapsNavUrl(planStops, origin);
  const navTruncated = googleMapsNavTruncated(planStops);
  const roadOk = provider === 'google_routes' || provider === 'google_directions';
  const staleDrive = planStops.length > 0 && !polyline;

  return (
    <div className="routes-plan">
      <div className="toolbar activity-toolbar routes-toolbar">
        <div className="activity-field activity-date-field">
          <label htmlFor="route-date">Date (IST)</label>
          <div className="activity-date-row">
            <button type="button" className="btn ghost sm" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day">‹</button>
            <input
              id="route-date"
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button type="button" className="btn ghost sm" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Next day">›</button>
          </div>
        </div>
        <div className="activity-field">
          <label htmlFor="route-depart">Start time</label>
          <input
            id="route-depart"
            className="input"
            type="time"
            value={departTime}
            onChange={(e) => { setDepartTime(e.target.value); markStale(); }}
          />
        </div>
        <div className="activity-field">
          <label htmlFor="route-origin">Start from</label>
          <select
            id="route-origin"
            className="input"
            value={origin?.source || ''}
            onChange={(e) => onSelectOrigin(e.target.value)}
            disabled={!originOptions.length}
          >
            {!originOptions.length && <option value="">No start point yet</option>}
            {originOptions.map((o) => (
              <option key={o.source} value={o.source}>{o.label}</option>
            ))}
            {origin?.source === 'saved' && (
              <option value="saved">{origin.label || 'Saved origin'}</option>
            )}
          </select>
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
        <div className="activity-field">
          <label>Order</label>
          <div className="route-mode-toggle" role="group" aria-label="Route order">
            <button
              type="button"
              className={`btn sm ${lockOrder ? '' : 'ghost'}`}
              onClick={() => { setLockOrder(true); markStale(); }}
            >
              Keep times
            </button>
            <button
              type="button"
              className={`btn sm ${lockOrder ? 'ghost' : ''}`}
              onClick={() => { setLockOrder(false); markStale(); }}
            >
              Shortest drive
            </button>
          </div>
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

      {owner && (
        <div className="routes-cta-bar">
          <button
            type="button"
            className="btn"
            disabled={!planStops.length || optimizing}
            onClick={runOptimize}
          >
            {optimizing ? 'Getting drive…' : (lockOrder ? 'Get drive times' : 'Optimize drive')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!owner || !planStops.length || sharing || optimizing}
            onClick={shareWithRm}
          >
            {sharing ? 'Sharing…' : 'Share with field'}
          </button>
          <button type="button" className="btn ghost" disabled={!owner || saving} onClick={() => saveDraft()}>
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          {usingDraft && (
            <button type="button" className="btn ghost" disabled={!candidates} onClick={resetToMeetings}>
              Reset to meetings
            </button>
          )}
          <button type="button" className="btn ghost" onClick={clearPlan}>
            Clear
          </button>
        </div>
      )}

      {error && <p className="banner err">{error}</p>}
      {msg && !error && <p className="banner ok">{msg}</p>}
      {warning && <p className="banner warn">{warning}</p>}
      {staleDrive && !error && planStops.length > 1 && (
        <p className="banner warn">
          Drive times are out of date. Get drive times, or Share will refresh them.
        </p>
      )}
      {shareUrl && (
        <div className="share-link-bar">
          <span className="muted">Share link</span>
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
        <div className="route-empty soft-block">
          <h2>Plan a field day</h2>
          <ol className="help-steps">
            <li>
              <strong>Pick an RM and date</strong>
              <span>Meetings load automatically. Start from last check-in when we have it.</span>
            </li>
            <li>
              <strong>Tap orange pins to add drop-ins</strong>
              <span>Nearby leads and accounts slot into the drive. Reorder with the arrows.</span>
            </li>
            <li>
              <strong>Get drive times, then share</strong>
              <span>Keep times leaves the calendar order. Shortest drive reorders for less travel.</span>
            </li>
          </ol>
        </div>
      )}

      {owner && loading && !candidates && (
        <p className="muted">Loading meetings…</p>
      )}

      {owner && candidates && (
        <>
          <div className="stat-grid activity-kpi">
            <div className="stat-card static">
              <span className="stat-label">Plan stops</span>
              <span className="stat-value">{planStops.length}</span>
              <span className="stat-sub">{usingDraft ? 'saved draft' : 'from meetings'}</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Meetings mapped</span>
              <span className="stat-value">{(candidates.meetings || []).length}</span>
              <span className="stat-sub">{unmapped.length} unmapped</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Nearby</span>
              <span className="stat-value">{filteredNearby.length}</span>
              <span className="stat-sub">within {radiusKm} km</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Drive</span>
              <span className="stat-value">{fmtKm(totals?.km)}</span>
              <span className="stat-sub">
                {fmtMin(totals?.minutes)}
                {provider ? ` · ${roadOk ? 'roads' : 'straight-line'}` : staleDrive ? ' · not computed' : ''}
              </span>
            </div>
          </div>

          <div className="walk-layout routes-layout">
            <div className="walk-map-wrap soft-block">
              <RouteMap
                planStops={planStops}
                candidates={candidates.meetings || []}
                nearby={nearby}
                origin={origin}
                routeCoords={routeCoords}
                roadPath={Boolean(polyline)}
                selectedId={selectedId}
                onSelectStop={(id) => {
                  setSelectedId(id);
                  if (id === 'origin' || planIdSet.has(id)) return;
                  const extra = nearby.find((s) => s.id === id)
                    || (candidates.meetings || []).find((s) => s.id === id);
                  if (extra) addToPlan(extra);
                }}
              />
              {selectedStop && (
                <div className="route-focus-card">
                  <div>
                    <span className="badge outcome">{layerLabel(selectedStop.layer)}</span>
                    <strong>{selectedStop.title}</strong>
                    {selectedStop.address && (
                      <p className="muted route-focus-addr">{selectedStop.address}</p>
                    )}
                    <p className="muted">
                      {selectedStop.scheduledAt && `Start ${fmtTime(selectedStop.scheduledAt)}`}
                      {selectedStop.eta && selectedInPlan && ` · ETA ${fmtTime(selectedStop.eta)}`}
                      {selectedStop.distanceKm != null && !selectedInPlan && ` · ${fmtKm(selectedStop.distanceKm)}`}
                    </p>
                  </div>
                  <div className="route-focus-acts">
                    {selectedInPlan ? (
                      <button type="button" className="btn ghost sm" onClick={() => removeFromPlan(selectedStop.id)}>
                        Remove
                      </button>
                    ) : (
                      <button type="button" className="btn sm" onClick={() => addToPlan(selectedStop)}>
                        Add to plan
                      </button>
                    )}
                    <button type="button" className="btn ghost sm" onClick={() => exploreNearSelected(selectedStop)}>
                      Nearby
                    </button>
                    {googleMapsStopUrl(selectedStop) && (
                      <a className="btn ghost sm" href={googleMapsStopUrl(selectedStop)} target="_blank" rel="noreferrer">
                        Nav
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div className="walk-map-legend" aria-hidden="true">
                <span><i className="walk-dot start" /> Start / plan #</span>
                <span><i className="walk-dot stop" /> {polyline ? 'Road path' : 'Straight path'}</span>
                <span><i className="route-legend-dot candidate" /> Meeting</span>
                <span><i className="route-legend-dot nearby" /> Nearby — tap to add</span>
              </div>
              <div className="routes-map-actions">
                <button type="button" className="btn ghost sm" disabled={loading} onClick={() => exploreNearSelected()}>
                  Find nearby here
                </button>
                {navAll && (
                  <a className="btn sm" href={navAll} target="_blank" rel="noreferrer">
                    Navigate all
                  </a>
                )}
                {navTruncated && (
                  <span className="muted">Google Maps opens the first 10 stops — share the link for the full list.</span>
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
                  <p className="muted">No stops yet. Load an RM, or tap an orange pin to add a nearby lead or account.</p>
                )}
                <ol className="walk-stop-list route-stop-list">
                  {planStops.map((s, idx) => {
                    const leg = legByTo.get(s.id);
                    const nav = googleMapsStopUrl(s);
                    return (
                      <li
                        key={s.id}
                        ref={(el) => {
                          if (el) stopRefs.current.set(s.id, el);
                          else stopRefs.current.delete(s.id);
                        }}
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
                              <span className="badge outcome">{layerLabel(s.layer)}</span>
                              {s.precision === 'approx' && (
                                <span className="badge late">~1 km</span>
                              )}
                              {s.scheduledAt && (
                                <span>Start {fmtTime(s.scheduledAt)}</span>
                              )}
                              {s.eta && <span>ETA {fmtTime(s.eta)}</span>}
                            </span>
                            {leg && Number(leg.km) > 0 && (
                              <span className="walk-leg muted">
                                ← drive {fmtKm(leg.km)} · {fmtMin(leg.minutes)}
                              </span>
                            )}
                          </span>
                        </button>
                        <div className="route-stop-actions">
                          <button type="button" className="icon-btn" title="Move up" aria-label="Move up" onClick={() => moveStop(s.id, -1)}>↑</button>
                          <button type="button" className="icon-btn" title="Move down" aria-label="Move down" onClick={() => moveStop(s.id, 1)}>↓</button>
                          <button type="button" className="icon-btn" title="Remove" aria-label="Remove" onClick={() => removeFromPlan(s.id)}>×</button>
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
                  <button type="button" className="btn ghost sm" disabled={loading} onClick={() => exploreNearSelected()}>
                    {loading ? 'Finding…' : 'Refresh'}
                  </button>
                </div>
                <div className="route-nearby-tools">
                  <input
                    className="input"
                    type="search"
                    placeholder="Search nearby…"
                    value={nearbyQ}
                    onChange={(e) => setNearbyQ(e.target.value)}
                    aria-label="Search nearby stops"
                  />
                  <div className="route-mode-toggle" role="group" aria-label="Nearby layer">
                    {[['all', 'All'], ['leads', 'Leads'], ['accounts', 'Accounts']].map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        className={`btn sm ${nearbyLayer === id ? '' : 'ghost'}`}
                        onClick={() => setNearbyLayer(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {!filteredNearby.length && (
                  <p className="muted">No nearby leads or accounts. Select a stop, then Find nearby, or widen the radius.</p>
                )}
                <ul className="route-nearby-list">
                  {filteredNearby.slice(0, 40).map((s) => (
                    <li key={s.id} className={`route-nearby-row ${selectedId === s.id ? 'on' : ''}`}>
                      <button type="button" className="route-nearby-hit" onClick={() => setSelectedId(s.id)}>
                        <strong>{s.title}</strong>
                        <span className="muted">
                          {layerLabel(s.layer)} · {fmtKm(s.distanceKm)}
                          {s.precision === 'approx' ? ' · ~1 km' : ''}
                        </span>
                      </button>
                      <button type="button" className="btn sm" onClick={() => addToPlan(s)}>
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
