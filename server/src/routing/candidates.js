// Candidate stops for route planning from map_points.
import { q } from '../db.js';
import { dayBoundsIST, haversineKm } from '../activity/metrics.js';
import { parseList, sqlTerritoryGroups } from '../filters/mapFilters.js';
import { sqlLayersVisibility } from '../filters/layerPolicy.js';
import { redactMacInText } from '../privacy/mac.js';

/** Precisions allowed for auto plan / optimize (not weak centroids). */
export const PLAN_OK = new Set(['exact', 'geocoded', 'approx']);
const WEAK = new Set(['pincode', 'territory', 'none', 'inherited']);

const MEETING_COLS = `
  source_id, title, owner_name, territory, status, record_ts,
  lat, lng, precision, address_raw, pincode, crm_url, extra
`;

function parseExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function rowToStop(row, layer, opts = {}) {
  const extra = parseExtra(row.extra);
  const lat = row.lat != null ? Number(row.lat) : null;
  const lng = row.lng != null ? Number(row.lng) : null;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
  const precision = row.precision || 'none';
  const plannable = hasCoords && PLAN_OK.has(precision);
  return {
    id: `${layer}:${row.source_id}`,
    layer,
    sourceId: row.source_id,
    title: redactMacInText(row.title) || 'Stop',
    owner: row.owner_name || null,
    territory: row.territory || null,
    status: row.status || null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    precision,
    address: row.address_raw || null,
    pincode: row.pincode || null,
    crmUrl: row.crm_url || null,
    scheduledAt: extra.start_ts || (row.record_ts ? new Date(row.record_ts).toISOString() : null),
    plannable,
    weak: !hasCoords || WEAK.has(precision),
    distanceKm: opts.distanceKm ?? null,
    kind: opts.kind || 'meeting',
  };
}

/**
 * Meetings for owner on IST date + unmapped list.
 * Origin hint: first scheduled locatable meeting, or last check-in from previous day.
 */
export async function loadDayMeetings({ owner, date, territory }) {
  const bounds = dayBoundsIST(date);
  const params = [owner, bounds.start, bounds.end];
  const extra = [];
  const terrSql = sqlTerritoryGroups(params, territory);
  if (terrSql) extra.push(terrSql);
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';

  const { rows } = await q(
    `SELECT ${MEETING_COLS}
     FROM map_points
     WHERE layer = 'meetings'
       AND owner_name = $1
       AND record_ts >= $2::timestamptz
       AND record_ts <= $3::timestamptz
       ${extraSql}
     ORDER BY record_ts ASC NULLS LAST, source_id ASC`,
    params,
  );

  const meetings = rows.map((r) => rowToStop(r, 'meetings', { kind: 'meeting' }));
  const mapped = meetings.filter((m) => m.plannable);
  const unmapped = meetings.filter((m) => !m.plannable);

  // Previous-day last locatable check-in for origin hint
  const prev = await q(
    `SELECT lat, lng, title, address_raw, record_ts
     FROM map_points
     WHERE layer = 'meetings'
       AND owner_name = $1
       AND record_ts < $2::timestamptz
       AND lat IS NOT NULL AND lng IS NOT NULL
       AND precision IN ('exact','approx','geocoded')
     ORDER BY record_ts DESC NULLS LAST
     LIMIT 1`,
    [owner, bounds.start],
  );
  const prevRow = prev.rows[0];

  const originOptions = [];
  if (prevRow) {
    originOptions.push({
      lat: Number(prevRow.lat),
      lng: Number(prevRow.lng),
      label: `Last check-in: ${prevRow.title || 'previous stop'}`,
      source: 'previous_day',
    });
  }
  if (mapped[0]) {
    originOptions.push({
      lat: mapped[0].lat,
      lng: mapped[0].lng,
      label: `First meeting: ${mapped[0].title}`,
      source: 'first_meeting',
    });
  }
  // Prefer last known location so drive time to the first meeting is included.
  const origin = originOptions[0] || null;

  return { meetings: mapped, unmapped, origin, originOptions, date, owner, timezone: 'Asia/Kolkata' };
}

/**
 * Nearby leads/accounts around a point (Explore nearest / drop-ins).
 */
export async function loadNearby({
  lat, lng, radiusKm = 3, layers = ['leads', 'accounts'], owner, territory, source, limit = 40,
}) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    throw new Error('lat and lng are required');
  }
  const rKm = Math.min(25, Math.max(0.2, Number(radiusKm) || 3));
  const allowed = (Array.isArray(layers) ? layers : String(layers).split(','))
    .map((s) => s.trim())
    .filter((l) => l === 'leads' || l === 'accounts' || l === 'assets');
  if (!allowed.length) allowed.push('leads', 'accounts');

  // Rough bbox degree pad (~111 km per deg lat)
  const dLat = rKm / 111;
  const dLng = rKm / (111 * Math.max(0.2, Math.cos((la * Math.PI) / 180)));
  const params = [allowed, la - dLat, la + dLat, ln - dLng, ln + dLng];
  let ownerClause = '';
  if (owner) {
    params.push(owner);
    // Match owner OR (no owner filter for territory-wide drop-ins when only territory set)
    ownerClause = ` AND (owner_name = $${params.length} OR owner_name IS NULL OR owner_name = '')`;
  }
  const extra = [];
  const terrSql = sqlTerritoryGroups(params, territory);
  if (terrSql) extra.push(terrSql);
  const sources = parseList(source);
  if (sources.length) {
    params.push(sources);
    extra.push(`(layer <> 'leads' OR extra->>'source' = ANY($${params.length}::text[]))`);
  }
  const extraSql = extra.length ? ` AND ${extra.join(' AND ')}` : '';

  const { rows } = await q(
    `SELECT layer, source_id, title, owner_name, territory, status, record_ts,
            lat, lng, precision, address_raw, pincode, crm_url, extra
     FROM map_points
     WHERE layer = ANY($1::text[])
       AND lat IS NOT NULL AND lng IS NOT NULL
       AND precision IN ('exact','geocoded','approx')
       AND lat BETWEEN $2 AND $3
       AND lng BETWEEN $4 AND $5
       AND ${sqlLayersVisibility()}
       ${ownerClause}
       ${extraSql}
     LIMIT 400`,
    params,
  );

  const out = [];
  for (const r of rows) {
    const stop = rowToStop(r, r.layer, { kind: 'nearby' });
    if (!stop.plannable) continue;
    const d = haversineKm(la, ln, stop.lat, stop.lng);
    if (d > rKm) continue;
    stop.distanceKm = Math.round(d * 1000) / 1000;
    out.push(stop);
  }
  out.sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  return {
    lat: la,
    lng: ln,
    radiusKm: rKm,
    count: Math.min(out.length, limit),
    stops: out.slice(0, limit),
  };
}

/**
 * Combined candidates payload for Routes UI load.
 */
export async function loadCandidates({
  owner, date, territory, source, nearLat, nearLng, radiusKm = 3,
}) {
  const day = await loadDayMeetings({ owner, date, territory });
  let nearby = { stops: [], count: 0 };
  const lat = nearLat != null ? Number(nearLat) : (day.meetings[0]?.lat ?? day.origin?.lat);
  const lng = nearLng != null ? Number(nearLng) : (day.meetings[0]?.lng ?? day.origin?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    nearby = await loadNearby({
      lat, lng, radiusKm,
      territory: territory || null,
      source: source || null,
      owner: null,
      layers: ['leads', 'accounts'],
    });
    const meetIds = new Set(day.meetings.map((m) => m.sourceId));
    nearby.stops = nearby.stops.filter((s) => !(s.layer === 'meetings' && meetIds.has(s.sourceId)));
    nearby.count = nearby.stops.length;
  }
  return {
    owner,
    date,
    timezone: 'Asia/Kolkata',
    origin: day.origin,
    originOptions: day.originOptions || [],
    meetings: day.meetings,
    unmapped: day.unmapped,
    nearby: nearby.stops,
    nearbyMeta: { lat, lng, radiusKm: Number(radiusKm) || 3, count: nearby.count },
  };
}
