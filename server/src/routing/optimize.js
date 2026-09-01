// Google road path + waypoint optimization.
// Prefers Routes API (v2); falls back to classic Directions API when Routes is disabled.
import { cfg } from '../config.js';
import { haversineKm } from '../activity/metrics.js';
import { recordUsage } from '../usage/meter.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const FIELD_MASK = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.polyline.encodedPolyline',
  'routes.optimizedIntermediateWaypointIndex',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
  'routes.legs.polyline.encodedPolyline',
].join(',');

function parseDurationSec(d) {
  if (d == null) return null;
  if (typeof d === 'number') return d;
  const s = String(d);
  const m = s.match(/^(\d+(?:\.\d+)?)s$/);
  return m ? Number(m[1]) : null;
}

function latLngObj(lat, lng) {
  return { location: { latLng: { latitude: Number(lat), longitude: Number(lng) } } };
}

function samePoint(a, b, km = 0.08) {
  if (!a || !b) return false;
  if (!Number.isFinite(Number(a.lat)) || !Number.isFinite(Number(b.lat))) return false;
  return haversineKm(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)) < km;
}

function zeroLeg(toId) {
  return {
    fromId: 'origin',
    toId,
    km: 0,
    minutes: 0,
    polyline: null,
  };
}

/** Google requires departureTime in the future for TRAFFIC_AWARE routing. */
function futureDepartureIso(inputTime) {
  const min = Date.now() + 90_000;
  if (inputTime) {
    const t = new Date(inputTime).getTime();
    if (Number.isFinite(t) && t >= min) return new Date(t).toISOString();
  }
  return new Date(min).toISOString();
}

function buildResult(origin, orderedStops, legs, encoded, provider, departureIso, extra = {}) {
  const totalKm = legs.reduce((a, l) => a + (l.km || 0), 0);
  const totalMin = legs.reduce((a, l) => a + (l.minutes || 0), 0);
  const departMs = new Date(departureIso).getTime();
  let accMin = 0;
  const withEta = orderedStops.map((s, i) => {
    if (legs[i]) accMin += legs[i].minutes || 0;
    return {
      ...s,
      order: i + 1,
      eta: new Date(departMs + accMin * 60_000).toISOString(),
      arriveMinutesFromStart: accMin,
    };
  });
  const routeCoords = decodePolyline(encoded);
  const coords = routeCoords.length >= 2
    ? routeCoords
    : [
      [Number(origin.lng), Number(origin.lat)],
      ...withEta.map((s) => [s.lng, s.lat]),
    ];
  return {
    origin,
    stops: withEta,
    legs,
    polyline: encoded || null,
    routeCoords: coords,
    totals: {
      km: Math.round(totalKm * 1000) / 1000,
      minutes: totalMin,
      stops: withEta.length,
    },
    provider,
    ...extra,
  };
}

/** Decode Google encoded polyline → [[lng, lat], ...] */
export function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const coordinates = [];
  while (index < len) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
    lng += dlng;
    coordinates.push([lng / 1e5, lat / 1e5]);
  }
  return coordinates;
}

/**
 * Split origin vs stops so we never send the start point twice.
 * Shortest-drive uses a round-trip (dest = origin) so the last stop can move, then drops the return leg.
 */
function routingPlan(origin, stops, lockOrder) {
  const startedAtFirst = samePoint(origin, stops[0]);
  const routeOrigin = startedAtFirst
    ? { ...origin, lat: stops[0].lat, lng: stops[0].lng }
    : origin;
  const movable = startedAtFirst ? stops.slice(1) : stops;
  if (lockOrder) {
    if (!movable.length) {
      return {
        routeOrigin, startedAtFirst, movable, intermediates: [], destination: routeOrigin, roundTrip: false,
      };
    }
    return {
      routeOrigin,
      startedAtFirst,
      movable,
      intermediates: movable.slice(0, -1),
      destination: movable[movable.length - 1],
      roundTrip: false,
    };
  }
  return {
    routeOrigin,
    startedAtFirst,
    movable,
    intermediates: movable,
    destination: routeOrigin,
    roundTrip: movable.length >= 1,
  };
}

function mapGoogleLegs(routeLegs, orderedStops, parseLeg) {
  const legs = [];
  for (let i = 0; i < routeLegs.length; i++) {
    const parsed = parseLeg(routeLegs[i], i);
    legs.push({
      fromId: i === 0 ? 'origin' : orderedStops[i - 1]?.id,
      toId: orderedStops[i]?.id,
      ...parsed,
    });
  }
  return legs;
}

function finishOptimized({
  origin, stops, plan, useOptimize, orderIdx, rawLegs, encoded, provider, departureIso, parseLeg,
}) {
  let orderedMovable;
  if (useOptimize && plan.movable.length && orderIdx?.length) {
    orderedMovable = orderIdx.map((i) => plan.movable[i]).filter(Boolean);
    if (orderedMovable.length !== plan.movable.length) {
      orderedMovable = [...plan.movable];
    }
  } else {
    orderedMovable = [...plan.movable];
  }
  const orderedStops = plan.startedAtFirst
    ? [stops[0], ...orderedMovable]
    : orderedMovable;

  let routeLegs = rawLegs || [];
  if (plan.roundTrip && routeLegs.length > orderedMovable.length) {
    routeLegs = routeLegs.slice(0, orderedMovable.length);
  }

  let legs = mapGoogleLegs(routeLegs, plan.startedAtFirst ? orderedMovable : orderedStops, parseLeg);
  if (plan.startedAtFirst) {
    legs = [zeroLeg(orderedStops[0]?.id), ...legs];
  }

  if (!legs.length && orderedStops.length) {
    legs = [zeroLeg(orderedStops[0].id)];
  }

  return buildResult(origin, orderedStops, legs, encoded, provider, departureIso);
}

/**
 * Optimize stop order and return road geometry + leg metrics.
 * lockOrder: keep the given sequence (meeting times) and only fetch the road path.
 */
export async function optimizeRoute(input) {
  if (!cfg.googleKey) {
    const err = new Error('GOOGLE_MAPS_API_KEY not configured — enable Routes API on the key');
    err.status = 503;
    throw err;
  }

  const stops = (input.stops || []).filter(
    (s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)),
  );
  if (stops.length < 1) {
    const err = new Error('at least one stop with coordinates is required');
    err.status = 400;
    throw err;
  }

  const origin = input.origin && Number.isFinite(Number(input.origin.lat))
    ? input.origin
    : { lat: stops[0].lat, lng: stops[0].lng, label: 'Start' };
  const lockOrder = Boolean(input.lockOrder);
  const departureIso = futureDepartureIso(input.departureTime);
  const plan = routingPlan(origin, stops, lockOrder);

  if (stops.length === 1 && plan.startedAtFirst) {
    const only = { ...stops[0], order: 1 };
    return buildResult(origin, [only], [zeroLeg(only.id)], null, 'direct', departureIso);
  }

  const useOptimize = !lockOrder && plan.movable.length >= 2 && plan.movable.length <= 25;

  const routesResult = await tryRoutesApi({
    origin, stops, plan, useOptimize, departureIso,
  });
  if (routesResult) return routesResult;

  const dirsResult = await tryDirectionsApi({
    origin, stops, plan, useOptimize, departureIso,
  });
  if (dirsResult) return dirsResult;

  return fallbackOptimize(origin, stops, lockOrder, 'Google Routes and Directions unavailable');
}

async function tryRoutesApi({ origin, stops, plan, useOptimize, departureIso }) {
  const body = {
    origin: latLngObj(plan.routeOrigin.lat, plan.routeOrigin.lng),
    destination: latLngObj(plan.destination.lat, plan.destination.lng),
    intermediates: plan.intermediates.map((s) => latLngObj(s.lat, s.lng)),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-IN',
    units: 'METRIC',
    optimizeWaypointOrder: useOptimize && plan.intermediates.length >= 1,
    departureTime: departureIso,
  };

  let j;
  try {
    const r = await fetch(ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': cfg.googleKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    j = await r.json().catch(() => ({}));
    recordUsage({
      sku: 'routes',
      provider: 'google',
      units: 1,
      ok: r.ok,
      meta: { status: r.status, stops: stops.length, lockOrder: !useOptimize },
    });
    if (!r.ok) {
      const msg = j?.error?.message || j?.message || `Google Routes ${r.status}`;
      console.warn('[optimize] Google Routes error:', msg);
      return null;
    }
  } catch (e) {
    console.warn('[optimize] Google Routes fetch failed:', e.message);
    return null;
  }

  const route = j.routes?.[0];
  if (!route) {
    console.warn('[optimize] Google Routes empty response');
    return null;
  }

  return finishOptimized({
    origin,
    stops,
    plan,
    useOptimize,
    orderIdx: route.optimizedIntermediateWaypointIndex,
    rawLegs: route.legs || [],
    encoded: route.polyline?.encodedPolyline || null,
    provider: 'google_routes',
    departureIso,
    parseLeg: (L) => ({
      km: Math.round(((Number(L.distanceMeters) || 0) / 1000) * 1000) / 1000,
      minutes: Math.round((parseDurationSec(L.duration) || 0) / 60),
      polyline: L.polyline?.encodedPolyline || null,
    }),
  });
}

async function tryDirectionsApi({ origin, stops, plan, useOptimize, departureIso }) {
  try {
    const params = new URLSearchParams({
      origin: `${Number(plan.routeOrigin.lat)},${Number(plan.routeOrigin.lng)}`,
      destination: `${Number(plan.destination.lat)},${Number(plan.destination.lng)}`,
      mode: 'driving',
      language: 'en-IN',
      units: 'metric',
      departure_time: String(Math.floor(new Date(departureIso).getTime() / 1000)),
      key: cfg.googleKey,
    });
    if (plan.intermediates.length) {
      const pts = plan.intermediates.map((s) => `${Number(s.lat)},${Number(s.lng)}`).join('|');
      params.set('waypoints', useOptimize ? `optimize:true|${pts}` : pts);
    }
    const r = await fetch(`${DIRECTIONS_URL}?${params}`);
    const j = await r.json().catch(() => ({}));
    recordUsage({
      sku: 'directions',
      provider: 'google',
      units: 1,
      ok: j.status === 'OK',
      meta: { status: j.status },
    });
    if (j.status !== 'OK' || !j.routes?.[0]) {
      const msg = j.error_message || j.status || `Directions ${r.status}`;
      console.warn('[optimize] Google Directions error:', msg);
      return null;
    }

    const route = j.routes[0];
    return finishOptimized({
      origin,
      stops,
      plan,
      useOptimize,
      orderIdx: route.waypoint_order,
      rawLegs: route.legs || [],
      encoded: route.overview_polyline?.points || null,
      provider: 'google_directions',
      departureIso,
      parseLeg: (L) => ({
        km: Math.round(((L.distance?.value || 0) / 1000) * 1000) / 1000,
        minutes: Math.round((L.duration_in_traffic?.value || L.duration?.value || 0) / 60),
        polyline: L.overview_polyline?.points || null,
      }),
    });
  } catch (e) {
    console.warn('[optimize] Google Directions fetch failed:', e.message);
    return null;
  }
}

function fallbackOptimize(origin, stops, lockOrder, reason) {
  let ordered;
  if (lockOrder) {
    ordered = [...stops];
  } else {
    const remaining = [...stops];
    ordered = [];
    let cur = { lat: origin.lat, lng: origin.lng };
    while (remaining.length) {
      let bestI = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = haversineKm(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      const [next] = remaining.splice(bestI, 1);
      ordered.push(next);
      cur = next;
    }
  }

  const legs = [];
  let prev = origin;
  ordered.forEach((s, i) => {
    const km = haversineKm(prev.lat, prev.lng, s.lat, s.lng);
    legs.push({
      fromId: i === 0 ? 'origin' : ordered[i - 1].id,
      toId: s.id,
      km: Math.round(km * 1000) / 1000,
      minutes: Math.round((km / 25) * 60),
      polyline: null,
    });
    prev = s;
  });

  return buildResult(
    origin,
    ordered,
    legs,
    null,
    'fallback_nn',
    futureDepartureIso(null),
    {
      warning: reason
        ? `Google Routes unavailable (${reason}) — used straight-line ${lockOrder ? 'order' : 'nearest-neighbour'}`
        : 'Google Routes unavailable — used straight-line nearest-neighbour order',
    },
  );
}
