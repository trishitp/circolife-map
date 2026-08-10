/** Late if check-in is more than 15 minutes after scheduled start. */
export const LATE_THRESHOLD_MS = 15 * 60 * 1000;
export const TZ = 'Asia/Kolkata';
/** Same place threshold (~50 m with full GPS). */
export const SAME_PLACE_KM = 0.05;

const R_KM = 6371;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function toMs(v) {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export function dayBoundsIST(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const start = new Date(`${dateStr}T00:00:00+05:30`);
  const end = new Date(`${dateStr}T23:59:59.999+05:30`);
  return { start: start.toISOString(), end: end.toISOString(), startMs: start.getTime(), endMs: end.getTime() };
}

export function rangeBoundsIST(from, to) {
  const a = dayBoundsIST(from);
  const b = dayBoundsIST(to);
  if (a.startMs > b.startMs) throw new Error('from must be on or before to');
  return { start: a.start, end: b.end };
}

export function dateKeyIST(ts) {
  const ms = toMs(ts);
  if (ms == null) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function isLate(startTs, checkinTs, thresholdMs = LATE_THRESHOLD_MS) {
  const s = toMs(startTs);
  const c = toMs(checkinTs);
  if (s == null || c == null) return false;
  return c > s + thresholdMs;
}

/**
 * Check-in GPS only — never inherited lead/account pins for path.
 * exact/approx = CRM check-in coords; inherited/none/pincode/etc. = not path material.
 */
export function coordsSourceOf(row, checkedIn) {
  const prec = row.precision || 'none';
  const lat = row.lat != null ? Number(row.lat) : null;
  const lng = row.lng != null ? Number(row.lng) : null;
  const hasCoords = lat != null && lng != null
    && Number.isFinite(lat) && Number.isFinite(lng);
  if (!hasCoords) return 'none';
  if (checkedIn && (prec === 'exact' || prec === 'approx')) return 'checkin';
  if (prec === 'inherited' || prec === 'pincode' || prec === 'territory' || prec === 'geocoded') {
    return 'inherited';
  }
  // Has coords + check-in but unexpected precision — still treat as checkin if status says so
  if (checkedIn) return 'checkin';
  return 'inherited';
}

function parseExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function normalizeStop(row, order) {
  const extra = parseExtra(row.extra);
  const start = extra.start_ts || (row.record_ts ? new Date(row.record_ts).toISOString() : null);
  const checkin = extra.checkin_time || null;
  const checkedIn = row.status === 'checked-in' || !!checkin;
  const late = checkedIn && isLate(start, checkin);
  // Prefer full-precision check-in strings when sync stored them (float8 can round)
  const latRaw = extra.checkin_lat != null && extra.checkin_lat !== ''
    ? extra.checkin_lat
    : row.lat;
  const lngRaw = extra.checkin_lng != null && extra.checkin_lng !== ''
    ? extra.checkin_lng
    : row.lng;
  const lat = latRaw != null ? Number(latRaw) : null;
  const lng = lngRaw != null ? Number(lngRaw) : null;
  const coords_source = coordsSourceOf(
    { precision: row.precision, lat, lng },
    checkedIn,
  );

  return {
    order,
    id: String(row.source_id),
    title: row.title,
    owner: row.owner_name,
    territory: row.territory,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    precision: row.precision,
    status: row.status,
    start,
    checkin,
    checkin_status: extra.checkin_status || null,
    outcome: extra.outcome || null,
    joint: !!extra.joint,
    lead_id: extra.lead_id || null,
    account_id: extra.account_id || null,
    crmUrl: row.crm_url,
    checkedIn,
    late,
    coords_source,
    placeIndex: null,
    sortTs: toMs(checkin) ?? toMs(start) ?? toMs(row.record_ts),
  };
}

export function samePlaceCoords(a, b, km = SAME_PLACE_KM) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return false;
  return haversineKm(a.lat, a.lng, b.lat, b.lng) < km;
}

/**
 * Build places 1..P from check-in-only meetings (execution order).
 * Consecutive same-cell visits collapse into one place with multiple meetingIds.
 */
export function buildPlaces(meetings) {
  const pathMeetings = meetings.filter((m) => m.coords_source === 'checkin');
  const places = [];

  for (const m of pathMeetings) {
    const last = places[places.length - 1];
    if (last && samePlaceCoords(last, m)) {
      last.meetingIds.push(m.id);
      last.lastOrder = m.order;
      last.departure = m.checkin || m.start || last.departure;
      if (m.precision === 'approx') last.precision = 'approx';
      if (m.late) last.hasLate = true;
      m.placeIndex = last.placeIndex;
    } else {
      const placeIndex = places.length + 1;
      places.push({
        placeIndex,
        lat: m.lat,
        lng: m.lng,
        precision: m.precision || 'approx',
        meetingIds: [m.id],
        firstOrder: m.order,
        lastOrder: m.order,
        arrival: m.checkin || m.start || null,
        departure: m.checkin || m.start || null,
        hasLate: !!m.late,
      });
      m.placeIndex = placeIndex;
    }
  }

  for (const p of places) {
    const a = toMs(p.arrival);
    const d = toMs(p.departure);
    p.dwellMin = (a != null && d != null && d >= a)
      ? Math.round((d - a) / 60000)
      : (p.meetingIds.length > 1 ? null : 0);
  }

  return places;
}

/** Place path km + coordinate array. */
export function pathFromPlaces(places) {
  const coordinates = places.map((p) => [p.lng, p.lat]);
  let km = 0;
  for (let i = 1; i < places.length; i++) {
    km += haversineKm(places[i - 1].lat, places[i - 1].lng, places[i].lat, places[i].lng);
  }
  return {
    type: 'LineString',
    coordinates,
    km: Math.round(km * 1000) / 1000,
  };
}

/**
 * Legs between consecutive meetings (timeline; may include non-path hops).
 * path_km is not from here — use place path only.
 */
export function buildLegs(meetings) {
  const legs = [];
  for (let i = 0; i < meetings.length - 1; i++) {
    const a = meetings[i];
    const b = meetings[i + 1];
    const bothCheckin = a.coords_source === 'checkin' && b.coords_source === 'checkin';
    const hasCoords = bothCheckin
      && a.lat != null && a.lng != null && b.lat != null && b.lng != null;
    const km = hasCoords ? haversineKm(a.lat, a.lng, b.lat, b.lng) : null;
    const aTime = toMs(a.checkin) ?? toMs(a.start);
    const bTime = toMs(b.checkin) ?? toMs(b.start);
    const minutes = (aTime != null && bTime != null && bTime >= aTime)
      ? (bTime - aTime) / 60000
      : null;
    const samePlace = bothCheckin && samePlaceCoords(a, b);
    legs.push({
      fromId: a.id,
      toId: b.id,
      fromOrder: a.order,
      toOrder: b.order,
      km: km != null ? Math.round(km * 1000) / 1000 : null,
      minutes: minutes != null ? Math.round(minutes) : null,
      samePlace: !!samePlace,
      on_path: bothCheckin,
    });
  }
  return legs;
}

export function summarizeWalk(meetings, places, path) {
  const n = meetings.length;
  const checkedIn = meetings.filter((s) => s.checkedIn).length;
  const late = meetings.filter((s) => s.late).length;
  const onTime = meetings.filter((s) => s.checkedIn && !s.late && s.start && s.checkin).length;
  const approxPlaces = places.filter((p) => p.precision === 'approx').length;

  const times = meetings
    .map((s) => toMs(s.checkin) ?? toMs(s.start))
    .filter((t) => t != null)
    .sort((a, b) => a - b);
  let activeMs = null;
  if (times.length >= 2) activeMs = times[times.length - 1] - times[0];
  else if (times.length === 1) activeMs = 0;

  const legs = buildLegs(meetings);
  const gapMins = legs.map((l) => l.minutes).filter((m) => m != null);
  const avgGapMin = gapMins.length
    ? Math.round(gapMins.reduce((a, b) => a + b, 0) / gapMins.length)
    : null;

  return {
    meetings: n,
    checked_in: checkedIn,
    missed_checkin: n - checkedIn,
    checkin_rate: n ? Math.round((checkedIn / n) * 1000) / 10 : 0,
    late,
    late_rate: checkedIn ? Math.round((late / checkedIn) * 1000) / 10 : 0,
    on_time: onTime,
    places: places.length,
    path_km: path.km,
    path_basis: 'checkin_gps',
    approx_places: approxPlaces,
    active_hours: activeMs != null ? Math.round((activeMs / 3600000) * 100) / 100 : null,
    avg_gap_min: avgGapMin,
    first_ts: times[0] != null ? new Date(times[0]).toISOString() : null,
    last_ts: times.length ? new Date(times[times.length - 1]).toISOString() : null,
  };
}

/** Full walk payload for one owner-day. */
export function buildWalkPayload(meetings) {
  const places = buildPlaces(meetings);
  const path = pathFromPlaces(places);
  const legs = buildLegs(meetings);
  const summary = summarizeWalk(meetings, places, path);
  const geojson = placesToGeoJSON(places, path);
  return {
    meetings,
    stops: meetings, // alias
    places,
    path,
    legs,
    summary,
    geojson,
  };
}

/**
 * Path km for a day's meetings using check-in places only.
 */
export function dayPathKm(meetings) {
  const places = buildPlaces(meetings);
  return pathFromPlaces(places).km;
}

/**
 * Aggregate compare row. open_day depends on sort metric.
 */
export function aggregateOwner(owner, stops, sort = 'path_km') {
  const meetings = stops.length;
  const checkedIn = stops.filter((s) => s.checkedIn).length;
  const late = stops.filter((s) => s.late).length;
  const byDay = new Map();
  for (const s of stops) {
    const key = dateKeyIST(s.sortTs ?? s.start ?? s.checkin);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(s);
  }

  let pathKm = 0;
  let busiestDay = null;
  let busiestCount = -1;
  let longestPathDay = null;
  let longestPathKm = -1;
  let latestDay = null;
  let latestLate = -1;

  for (const [day, dayStops] of byDay) {
    dayStops.sort((a, b) => (a.sortTs ?? 0) - (b.sortTs ?? 0)
      || String(a.id).localeCompare(String(b.id)));
    // Re-number local order for place build
    dayStops.forEach((s, i) => { s.order = i + 1; });
    const dayKm = dayPathKm(dayStops);
    pathKm += dayKm;

    if (dayStops.length > busiestCount) {
      busiestCount = dayStops.length;
      busiestDay = day;
    }
    if (dayKm > longestPathKm) {
      longestPathKm = dayKm;
      longestPathDay = day;
    }
    const dayLate = dayStops.filter((s) => s.late).length;
    if (dayLate > latestLate) {
      latestLate = dayLate;
      latestDay = day;
    }
  }

  let open_day = busiestDay;
  let open_day_reason = 'busiest_meetings';
  if (sort === 'path_km') {
    open_day = longestPathDay || busiestDay;
    open_day_reason = 'longest_path';
  } else if (sort === 'late_rate') {
    open_day = latestDay || busiestDay;
    open_day_reason = 'most_late';
  } else if (sort === 'meetings' || sort === 'checkin_rate') {
    open_day = busiestDay;
    open_day_reason = 'busiest_meetings';
  }

  const daysActive = byDay.size;
  return {
    owner,
    meetings,
    checked_in: checkedIn,
    missed_checkin: meetings - checkedIn,
    checkin_rate: meetings ? Math.round((checkedIn / meetings) * 1000) / 10 : 0,
    late,
    late_rate: checkedIn ? Math.round((late / checkedIn) * 1000) / 10 : 0,
    days_active: daysActive,
    path_km: Math.round(pathKm * 1000) / 1000,
    avg_meetings_per_active_day: daysActive
      ? Math.round((meetings / daysActive) * 10) / 10
      : 0,
    busiest_day: busiestDay,
    longest_path_day: longestPathDay,
    open_day,
    open_day_reason,
  };
}

export function placesToGeoJSON(places, path) {
  const features = places.map((p, idx) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: {
      placeIndex: p.placeIndex,
      meetingIds: p.meetingIds,
      meetingCount: p.meetingIds.length,
      firstOrder: p.firstOrder,
      lastOrder: p.lastOrder,
      precision: p.precision,
      hasLate: !!p.hasLate,
      isStart: idx === 0,
      isEnd: places.length > 1 && idx === places.length - 1,
    },
  }));

  if (path.coordinates.length >= 2) {
    features.unshift({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: path.coordinates },
      properties: { kind: 'walk', km: path.km },
    });
  }

  return { type: 'FeatureCollection', features };
}

/** @deprecated use placesToGeoJSON via buildWalkPayload */
export function stopsToGeoJSON(stops) {
  const places = buildPlaces(stops);
  const path = pathFromPlaces(places);
  return placesToGeoJSON(places, path);
}
