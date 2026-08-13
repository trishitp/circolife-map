import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchActivityWalk } from '../lib/api';
import WalkMap from './WalkMap';
import PeopleFilters from './PeopleFilters';

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
  if (n < 1 && n > 0) return `${Math.round(n * 1000)} m`;
  if (n === 0) return '0 km';
  return `${n.toFixed(1)} km`;
}

function fmtCoord(lat, lng) {
  if (lat == null || lng == null || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return null;
  }
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function fmtLeg(leg) {
  if (!leg) return null;
  if (leg.samePlace) {
    return leg.minutes != null ? `same place · ${leg.minutes} min` : 'same place';
  }
  if (!leg.on_path) {
    return leg.minutes != null ? `not on check-in path · ${leg.minutes} min` : 'not on check-in path';
  }
  const dist = fmtKm(leg.km);
  return leg.minutes != null ? `${dist} · ${leg.minutes} min` : dist;
}

function shiftDate(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default function RmWalkView({ options = {}, initialOwner, initialDate }) {
  const today = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }, []);

  const [owner, setOwner] = useState(initialOwner || '');
  const [date, setDate] = useState(initialDate || today);
  const [ownerQ, setOwnerQ] = useState('');
  const [userStatus, setUserStatus] = useState([]);
  const [role, setRole] = useState([]);
  const [territory, setTerritory] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const stopRefs = useRef(new Map());
  const lastScrollPlace = useRef(null);

  useEffect(() => {
    if (initialOwner) setOwner(initialOwner);
  }, [initialOwner]);
  useEffect(() => {
    if (initialDate) setDate(initialDate);
  }, [initialDate]);

  useEffect(() => {
    if (!owner || !date) {
      setData(null);
      setError(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setSelectedId(null);
    lastScrollPlace.current = null;
    fetchActivityWalk({
      owner,
      date,
      territory: territory.length ? territory.join(',') : undefined,
    })
      .then((d) => {
        if (!cancelled) {
          setData(d);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [owner, date, territory]);

  useEffect(() => {
    if (!selectedId) return;
    const el = stopRefs.current.get(selectedId);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const meetings = data?.meetings || data?.stops || [];
  const places = data?.places || [];
  const path = data?.path || null;
  const summary = data?.summary;
  const legByFrom = useMemo(() => {
    const m = new Map();
    for (const leg of data?.legs || []) m.set(String(leg.fromId), leg);
    return m;
  }, [data]);

  const onSelectMeeting = (id) => {
    setSelectedId(String(id));
  };

  const onPlaceChange = (placeIndex) => {
    // Throttle list scroll: only when place changes
    if (lastScrollPlace.current === placeIndex) return;
    lastScrollPlace.current = placeIndex;
    const place = places.find((p) => p.placeIndex === placeIndex);
    if (!place?.meetingIds?.length) return;
    const id = place.meetingIds[place.meetingIds.length - 1];
    setSelectedId(String(id));
  };

  return (
    <div className="activity-walk">
      <div className="toolbar activity-toolbar">
        <div className="activity-field activity-date-field">
          <label htmlFor="walk-date">Date (IST)</label>
          <div className="activity-date-row">
            <button type="button" className="btn ghost sm" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Previous day">‹</button>
            <input
              id="walk-date"
              className="input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button type="button" className="btn ghost sm" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Next day">›</button>
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
      />

      {error && <p className="banner err">{error}</p>}
      {loading && <p className="muted">Loading the day’s walk…</p>}

      {!owner && !loading && (
        <p className="muted">Choose a field agent and date to see check-in places and meetings.</p>
      )}

      {owner && data && !loading && (
        <>
          <div className="stat-grid activity-kpi">
            <div className="stat-card static">
              <span className="stat-label">Meetings</span>
              <span className="stat-value">{summary?.meetings ?? 0}</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Check-in %</span>
              <span className="stat-value">{summary?.checkin_rate ?? 0}%</span>
              <span className="stat-sub">{summary?.checked_in ?? 0} of {summary?.meetings ?? 0}</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Late %</span>
              <span className="stat-value">{summary?.late_rate ?? 0}%</span>
              <span className="stat-sub">{summary?.late ?? 0} late (&gt;15m)</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Places</span>
              <span className="stat-value">{summary?.places ?? places.length}</span>
              <span className="stat-sub">check-in GPS cells</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Path</span>
              <span className="stat-value">{fmtKm(summary?.path_km ?? path?.km)}</span>
              <span className="stat-sub">straight-line · check-ins</span>
            </div>
            <div className="stat-card static">
              <span className="stat-label">Active</span>
              <span className="stat-value">
                {summary?.active_hours != null ? `${summary.active_hours}h` : '—'}
              </span>
              <span className="stat-sub">first → last stop</span>
            </div>
          </div>

          {(summary?.approx_places > 0) && (
            <p className="banner walk-trust-banner">
              {summary.approx_places} place(s) still use coarse coordinates.
              Run a meetings coord refresh / full sync so check-ins use full GPS from Analytics.
            </p>
          )}

          {summary?.meetings === 0 ? (
            <p className="muted">No meetings for this agent on {date}.</p>
          ) : (
            <div className="walk-layout">
              <div className="walk-map-wrap soft-block">
                {places.length === 0 ? (
                  <div className="walk-map-empty muted">
                    No check-in GPS points for this day — path needs field check-ins
                    (inherited account/lead pins are excluded).
                  </div>
                ) : (
                  <WalkMap
                    places={places}
                    path={path}
                    meetings={meetings}
                    selectedMeetingId={selectedId}
                    onSelectMeeting={onSelectMeeting}
                    onPlaceChange={onPlaceChange}
                  />
                )}
                <div className="walk-map-legend" aria-hidden="true">
                  <span><i className="walk-dot start" /> Start place</span>
                  <span><i className="walk-dot stop" /> Place #</span>
                  <span><i className="walk-dot end" /> End place</span>
                  <span><i className="walk-dot late" /> Late ring</span>
                  <span className="muted">
                    ×N = meetings at same GPS · path ignores inherited coords
                  </span>
                </div>
              </div>

              <div className="walk-timeline soft-block">
                <div className="walk-timeline-head">
                  <h2>Timeline</h2>
                  <span className="muted">{meetings.length} meetings · {places.length} places</span>
                </div>
                <ol className="walk-stop-list">
                  {meetings.map((s) => {
                    const leg = legByFrom.get(String(s.id));
                    const legLabel = fmtLeg(leg);
                    const onPath = s.coords_source === 'checkin' && s.placeIndex != null;
                    return (
                      <li
                        key={s.id}
                        ref={(el) => {
                          if (el) stopRefs.current.set(String(s.id), el);
                          else stopRefs.current.delete(String(s.id));
                        }}
                        className={[
                          'walk-stop',
                          String(selectedId) === String(s.id) ? 'on' : '',
                          s.late ? 'late' : '',
                          !s.checkedIn ? 'missed' : '',
                          !onPath ? 'unmapped' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <button
                          type="button"
                          className="walk-stop-btn"
                          onClick={() => setSelectedId(String(s.id))}
                        >
                          <span className="walk-order">{s.order}</span>
                          <span className="walk-stop-body">
                            <span className="walk-title">{s.title || 'Meeting'}</span>
                            <span className="walk-meta">
                              {onPath && (
                                <span className="badge place">@ place {s.placeIndex}</span>
                              )}
                              Start {fmtTime(s.start)}
                              {' · '}
                              Check-in {fmtTime(s.checkin)}
                              {s.late && <span className="badge late">Late</span>}
                              {!s.checkedIn && <span className="badge missed">No check-in</span>}
                              {s.coords_source === 'inherited' && (
                                <span className="badge missed">Inherited geo</span>
                              )}
                              {s.coords_source === 'none' && (
                                <span className="badge missed">Not on map</span>
                              )}
                              {s.precision === 'exact' && onPath && (
                                <span className="badge place">GPS exact</span>
                              )}
                              {s.outcome && <span className="badge outcome">{s.outcome}</span>}
                            </span>
                            {fmtCoord(s.lat, s.lng) && (
                              <span className="walk-coords muted" title="Check-in geo coordinates">
                                {fmtCoord(s.lat, s.lng)}
                                {s.precision ? ` · ${s.precision}` : ''}
                              </span>
                            )}
                            {legLabel && (
                              <span className="walk-leg muted">→ next: {legLabel}</span>
                            )}
                          </span>
                        </button>
                        {s.crmUrl && (
                          <a className="walk-crm" href={s.crmUrl} target="_blank" rel="noreferrer">
                            CRM
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
