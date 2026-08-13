import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchSharedRoute, googleMapsNavUrl, googleMapsStopUrl } from '../lib/api';
import { decodePolyline } from '../lib/polyline';
import RouteMap from './RouteMap';
import BrandMark from './BrandMark';
import AppLoader from './AppLoader';

function fmtTime(iso) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function fmtDate(ymd) {
  if (!ymd) return '';
  try {
    const d = new Date(`${ymd}T12:00:00+05:30`);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }).format(d);
  } catch {
    return ymd;
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

/**
 * Field mobile route view — RouteIQ-style: map + progress + nav + CRM only.
 * @see https://www.zoho.com/routeiq/features.html
 */
export default function SharedRouteView({ token }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const listRef = useRef(null);
  const itemRefs = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSharedRoute(token);
        if (cancelled) return;
        setPlan(data);
        if (data?.stops?.[0]?.id) setSelectedId(data.stops[0].id);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load route');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const stops = plan?.stops || [];
  const origin = plan?.origin || null;

  const routeCoords = useMemo(() => {
    if (plan?.polyline) {
      const decoded = decodePolyline(plan.polyline);
      if (decoded.length >= 2) return decoded;
    }
    const pts = stops
      .filter((s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
      .map((s) => [Number(s.lng), Number(s.lat)]);
    if (origin && Number.isFinite(Number(origin.lat))) {
      return [[Number(origin.lng), Number(origin.lat)], ...pts];
    }
    return pts;
  }, [plan, stops, origin]);

  const selected = useMemo(
    () => stops.find((s) => s.id === selectedId) || stops[0] || null,
    [stops, selectedId],
  );
  const selectedIdx = selected
    ? Math.max(0, stops.findIndex((s) => s.id === selected.id))
    : 0;

  useEffect(() => {
    if (!selectedId) return;
    const el = itemRefs.current.get(selectedId);
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId]);

  const navAll = googleMapsNavUrl(stops, origin);
  const navSelected = selected ? googleMapsStopUrl(selected) : null;

  if (loading) {
    return <AppLoader message="Loading your route" />;
  }

  if (error || !plan) {
    return (
      <div className="riq-app riq-state">
        <BrandMark product="Maps" />
        <h1>This link is no longer valid</h1>
        <p>{error || 'The route was removed or the link has expired.'}</p>
        <p className="riq-hint">Ask your lead for a new share link.</p>
      </div>
    );
  }

  return (
    <div className="riq-app">
      {/* Full-bleed map plane */}
      <section className="riq-map-plane" aria-label="Route map">
        <RouteMap
          className="riq-map"
          planStops={stops}
          candidates={[]}
          nearby={[]}
          routeCoords={routeCoords}
          selectedId={selectedId}
          onSelectStop={setSelectedId}
        />
        <div className="riq-map-veil" aria-hidden />
        <header className="riq-top">
          <BrandMark compact product="Route" className="riq-brand" />
          <div className="riq-date-chip">{fmtDate(plan.plan_date)}</div>
        </header>
        <div className="riq-float-kpis" aria-label="Route summary">
          <div>
            <span className="riq-kpi-v">{stops.length}</span>
            <span className="riq-kpi-l">Stops</span>
          </div>
          <div>
            <span className="riq-kpi-v">{fmtKm(plan.totals?.km)}</span>
            <span className="riq-kpi-l">Drive</span>
          </div>
          <div>
            <span className="riq-kpi-v">{fmtMin(plan.totals?.minutes)}</span>
            <span className="riq-kpi-l">Time</span>
          </div>
        </div>
      </section>

      {/* Bottom sheet */}
      <section className="riq-sheet">
        <div className="riq-handle" aria-hidden />
        <div className="riq-sheet-head">
          <div>
            <p className="riq-eyebrow">Today&apos;s route</p>
            <h1 className="riq-title">{plan.owner_name}</h1>
          </div>
          <span className="riq-progress" aria-label={`Stop ${selectedIdx + 1} of ${stops.length}`}>
            {stops.length ? `${selectedIdx + 1}/${stops.length}` : '0'}
          </span>
        </div>

        {selected && (
          <article className="riq-focus">
            <div className="riq-focus-label">
              <span>Next focus</span>
              <span className="riq-layer">{layerLabel(selected.layer)}</span>
            </div>
            <h2>{selected.title}</h2>
            <p className="riq-focus-meta">
              {fmtTime(selected.scheduledAt) && <span>Start {fmtTime(selected.scheduledAt)}</span>}
              {fmtTime(selected.eta) && <span>ETA {fmtTime(selected.eta)}</span>}
              {selected.precision === 'approx' && <span>~1 km</span>}
            </p>
            {selected.address && <p className="riq-addr">{selected.address}</p>}
            <div className="riq-focus-actions">
              {navSelected && (
                <a className="riq-btn riq-btn-primary" href={navSelected} target="_blank" rel="noreferrer">
                  Navigate here
                </a>
              )}
              {selected.crmUrl && (
                <a className="riq-btn riq-btn-ghost" href={selected.crmUrl} target="_blank" rel="noreferrer">
                  Open CRM
                </a>
              )}
            </div>
          </article>
        )}

        <div className="riq-list-label">All stops</div>
        <ol className="riq-list" ref={listRef}>
          {stops.map((s, idx) => {
            const nav = googleMapsStopUrl(s);
            const on = s.id === selectedId;
            const isLast = idx === stops.length - 1;
            return (
              <li
                key={s.id || idx}
                ref={(el) => {
                  if (el) itemRefs.current.set(s.id, el);
                  else itemRefs.current.delete(s.id);
                }}
                className={[
                  'riq-stop',
                  on ? 'is-on' : '',
                  isLast ? 'is-last' : '',
                ].filter(Boolean).join(' ')}
              >
                <button
                  type="button"
                  className="riq-stop-hit"
                  onClick={() => setSelectedId(s.id)}
                >
                  <span className="riq-rail" aria-hidden>
                    <span className="riq-dot">{s.order || idx + 1}</span>
                    {!isLast && <span className="riq-line" />}
                  </span>
                  <span className="riq-stop-copy">
                    <strong>{s.title}</strong>
                    <span>
                      {layerLabel(s.layer)}
                      {fmtTime(s.scheduledAt) ? ` · ${fmtTime(s.scheduledAt)}` : ''}
                      {fmtTime(s.eta) ? ` · ETA ${fmtTime(s.eta)}` : ''}
                    </span>
                  </span>
                </button>
                <div className="riq-stop-acts">
                  {nav && (
                    <a
                      className="riq-icon-act"
                      href={nav}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Navigate to ${s.title}`}
                      title="Navigate"
                    >
                      <NavIcon />
                    </a>
                  )}
                  {s.crmUrl && (
                    <a
                      className="riq-icon-act ghost"
                      href={s.crmUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${s.title} in CRM`}
                      title="CRM"
                    >
                      <CrmIcon />
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Sticky dock — primary field actions */}
      <footer className="riq-dock">
        {navAll ? (
          <a className="riq-btn riq-btn-primary riq-btn-dock" href={navAll} target="_blank" rel="noreferrer">
            <NavIcon />
            Start full route
          </a>
        ) : (
          <span className="riq-btn riq-btn-primary riq-btn-dock is-disabled">No mapped stops</span>
        )}
        {selected?.crmUrl && (
          <a className="riq-btn riq-btn-ghost riq-btn-dock-side" href={selected.crmUrl} target="_blank" rel="noreferrer">
            CRM
          </a>
        )}
      </footer>
    </div>
  );
}

function NavIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5 20 19l-8-3.2L4 19 12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CrmIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
