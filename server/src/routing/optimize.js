// Google road path + waypoint optimization.
// Prefers Routes API (v2); falls back to classic Directions API when Routes is disabled.
import { cfg } from '../config.js';
import { haversineKm } from '../activity/metrics.js';

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
 * Optimize stop order and return road geometry + leg metrics.
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

  if (stops.length === 1) {
    const only = { ...stops[0], order: 1 };
    const legKm = haversineKm(origin.lat, origin.lng, only.lat, only.lng);
    const coords = [[Number(origin.lng), Number(origin.lat)], [only.lng, only.lat]];
    return {
      origin,
      stops: [only],
      legs: [{
        fromId: 'origin',
        toId: only.id,
        km: Math.round(legKm * 1000) / 1000,
        minutes: Math.round((legKm / 25) * 60),
        polyline: null,
      }],
      polyline: null,
      routeCoords: coords,
      totals: {
        km: Math.round(legKm * 1000) / 1000,
        minutes: Math.round((legKm / 25) * 60),
        stops: 1,
      },
      provider: 'direct',
    };
  }

  const useOptimize = stops.length >= 2 && stops.length <= 25;
  const intermediates = stops.slice(0, -1);
  const destination = stops[stops.length - 1];
  const departureIso = futureDepartureIso(input.departureTime);

  const routesResult = await tryRoutesApi({
    origin, stops, intermediates, destination, useOptimize, departureIso,
  });
  if (routesResult) return routesResult;

  const dirsResult = await tryDirectionsApi({
    origin, stops, intermediates, destination, useOptimize, departureIso,
  });
  if (dirsResult) return dirsResult;

  return fallbackOptimize(origin, stops, 'Google Routes and Directions unavailable');
}

async function tryRoutesApi({ origin, intermediates, destination, useOptimize, departureIso }) {
  const body = {
    origin: latLngObj(origin.lat, origin.lng),
    destination: latLngObj(destination.lat, destination.lng),
    intermediates: intermediates.map((s) => latLngObj(s.lat, s.lng)),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    computeAlternativeRoutes: false,
    languageCode: 'en-IN',
    units: 'METRIC',
    optimizeWaypointOrder: useOptimize && intermediates.length >= 1,
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

  let orderedStops;
  if (useOptimize && intermediates.length && route.optimizedIntermediateWaypointIndex?.length) {
    const orderIdx = route.optimizedIntermediateWaypointIndex;
    orderedStops = [
      ...orderIdx.map((i) => intermediates[i]),
      destination,
    ];
  } else {
    orderedStops = [...intermediates, destination];
  }

  const legs = [];
  const routeLegs = route.legs || [];
  for (let i = 0; i < routeLegs.length; i++) {
    const L = routeLegs[i];
    const meters = Number(L.distanceMeters) || 0;
    const sec = parseDurationSec(L.duration) || 0;
    legs.push({
      fromId: i === 0 ? 'origin' : orderedStops[i - 1]?.id,
      toId: orderedStops[i]?.id,
      km: Math.round((meters / 1000) * 1000) / 1000,
      minutes: Math.round(sec / 60),
      polyline: L.polyline?.encodedPolyline || null,
    });
  }

  if (!legs.length && Number(route.distanceMeters)) {
    const meters = Number(route.distanceMeters);
    const sec = parseDurationSec(route.duration) || 0;
    legs.push({
      fromId: 'origin',
      toId: orderedStops[0]?.id,
      km: Math.round((meters / 1000) * 1000) / 1000,
      minutes: Math.round(sec / 60),
      polyline: null,
    });
  }

  return buildResult(
    origin,
    orderedStops,
    legs,
    route.polyline?.encodedPolyline || null,
    'google_routes',
    departureIso,
  );
}

async function tryDirectionsApi({ origin, intermediates, destination, useOptimize, departureIso }) {
  try {
    const params = new URLSearchParams({
      origin: `${Number(origin.lat)},${Number(origin.lng)}`,
      destination: `${Number(destination.lat)},${Number(destination.lng)}`,
      mode: 'driving',
      language: 'en-IN',
      units: 'metric',
      departure_time: String(Math.floor(new Date(departureIso).getTime() / 1000)),
      key: cfg.googleKey,
    });
    if (intermediates.length) {
      const pts = intermediates.map((s) => `${Number(s.lat)},${Number(s.lng)}`).join('|');
      params.set('waypoints', useOptimize ? `optimize:true|${pts}` : pts);
    }
    const r = await fetch(`${DIRECTIONS_URL}?${params}`);
    const j = await r.json().catch(() => ({}));
    if (j.status !== 'OK' || !j.routes?.[0]) {
      const msg = j.error_message || j.status || `Directions ${r.status}`;
      console.warn('[optimize] Google Directions error:', msg);
      return null;
    }

    const route = j.routes[0];
    let orderedStops;
    if (useOptimize && intermediates.length && Array.isArray(route.waypoint_order)) {
      orderedStops = [
        ...route.waypoint_order.map((i) => intermediates[i]),
        destination,
      ];
    } else {
      orderedStops = [...intermediates, destination];
    }

    const legs = (route.legs || []).map((L, i) => ({
      fromId: i === 0 ? 'origin' : orderedStops[i - 1]?.id,
      toId: orderedStops[i]?.id,
      km: Math.round(((L.distance?.value || 0) / 1000) * 1000) / 1000,
      minutes: Math.round((L.duration_in_traffic?.value || L.duration?.value || 0) / 60),
      polyline: L.overview_polyline?.points || null,
    }));

    return buildResult(
      origin,
      orderedStops,
      legs,
      route.overview_polyline?.points || null,
      'google_directions',
      departureIso,
    );
  } catch (e) {
    console.warn('[optimize] Google Directions fetch failed:', e.message);
    return null;
  }
}

function fallbackOptimize(origin, stops, reason) {
  const remaining = [...stops];
  const ordered = [];
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

  const legs = [];
  let prev = origin;
  let totalKm = 0;
  ordered.forEach((s, i) => {
    const km = haversineKm(prev.lat, prev.lng, s.lat, s.lng);
    totalKm += km;
    legs.push({
      fromId: i === 0 ? 'origin' : ordered[i - 1].id,
      toId: s.id,
      km: Math.round(km * 1000) / 1000,
      minutes: Math.round((km / 25) * 60),
      polyline: null,
    });
    prev = s;
  });

  const withOrder = ordered.map((s, i) => ({ ...s, order: i + 1 }));
  const routeCoords = [
    [Number(origin.lng), Number(origin.lat)],
    ...withOrder.map((s) => [s.lng, s.lat]),
  ];
  return {
    origin,
    stops: withOrder,
    legs,
    polyline: null,
    routeCoords,
    totals: {
      km: Math.round(totalKm * 1000) / 1000,
      minutes: legs.reduce((a, l) => a + (l.minutes || 0), 0),
      stops: withOrder.length,
    },
    provider: 'fallback_nn',
    warning: reason
      ? `Google Routes unavailable (${reason}) — used straight-line nearest-neighbour`
      : 'Google Routes unavailable — used straight-line nearest-neighbour order',
  };
}
