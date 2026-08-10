// Geocoder providers. Google preferred when key present; Ola as alternate.
import { cfg } from '../config.js';
import { inIndia, isCoarseConfidence, normalizePincode } from './address.js';

/**
 * @param {string} query
 * @param {{ pincode?: string|null, requireStreetLevel?: boolean }} [opts]
 * @returns {Promise<{lat,lng,confidence,provider,postalCode}|null>}
 *   null = no usable hit (caller may fall through to pincode/territory)
 * @throws on auth / quota / network so caller can retry next sync without caching failure
 */
export async function providerGeocode(query, opts = {}) {
  // 1) Strict: bias/filter by postal_code when known
  // 2) Soft retry: pin may be wrong in CRM — keep pin in address text only
  const attempts = opts.pincode
    ? [{ ...opts, strictPostal: true }, { ...opts, strictPostal: false }]
    : [{ ...opts, strictPostal: false }];

  let lastHardError = null;
  for (const attempt of attempts) {
    const hit = await geocodeOnce(query, attempt).catch((e) => {
      lastHardError = e;
      return null;
    });
    if (hit) return hit;
  }
  if (lastHardError) throw lastHardError;
  return null;
}

async function geocodeOnce(query, opts) {
  const order = cfg.geocoder === 'olamaps'
    ? ['olamaps', 'google']
    : ['google', 'olamaps'];

  let lastHardError = null;
  for (const name of order) {
    if (name === 'google' && !cfg.googleKey) continue;
    if (name === 'olamaps' && !cfg.olaKey) continue;
    try {
      const g = name === 'google'
        ? await google(query, opts)
        : await olamaps(query, opts);
      if (!g) continue;
      if (!inIndia(g.lat, g.lng)) continue;
      // When we asked for a street address, reject city-level snaps — pincode tier is better.
      if (opts.requireStreetLevel && isCoarseConfidence(g.confidence)) continue;
      // Strict attempt: reject postal mismatch. Soft attempt: allow (street may be right, pin wrong).
      if (opts.strictPostal) {
        const want = normalizePincode(opts.pincode);
        const got = normalizePincode(g.postalCode);
        if (want && got && want !== got) continue;
      }
      return g;
    } catch (e) {
      console.warn(`[geocode] ${name} error:`, e.message);
      lastHardError = e;
    }
  }
  if (lastHardError) throw lastHardError;
  return null;
}

/** True when at least one provider key is configured. */
export function hasGeocoderKey() {
  return Boolean(cfg.googleKey || cfg.olaKey);
}

async function olamaps(query, opts = {}) {
  const u = new URL('https://api.olamaps.io/places/v1/geocode');
  u.searchParams.set('address', query);
  u.searchParams.set('api_key', cfg.olaKey);
  // Bias to India
  u.searchParams.set('bounds', '6.0,68.0,38.0,98.0');
  const r = await fetch(u);
  if (r.status === 401 || r.status === 403 || r.status === 429) {
    throw new Error(`olamaps ${r.status}`);
  }
  if (!r.ok) throw new Error(`olamaps ${r.status}`);
  const j = await r.json();
  const g = j?.geocodingResults?.[0];
  if (!g?.geometry?.location) return null;
  const postal = g.address_components?.find((c) =>
    (c.types || []).includes('postal_code'))?.long_name
    || g.address_components?.find((c) =>
      (c.types || []).includes('postal_code'))?.short_name
    || null;
  return {
    lat: Number(g.geometry.location.lat),
    lng: Number(g.geometry.location.lng),
    confidence: g.geometry.location_type || g.types?.[0] || 'unknown',
    provider: 'olamaps',
    postalCode: postal,
  };
}

async function google(query, opts = {}) {
  const u = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  u.searchParams.set('address', query);
  u.searchParams.set('region', 'in');
  u.searchParams.set('language', 'en');
  // Always restrict to India. Strict mode also filters by postal_code.
  const pin = normalizePincode(opts.pincode);
  const components = (opts.strictPostal && pin)
    ? `country:IN|postal_code:${pin}`
    : 'country:IN';
  u.searchParams.set('components', components);
  // Viewport bias covering India
  u.searchParams.set('bounds', '6.0,68.0|38.0,98.0');
  u.searchParams.set('key', cfg.googleKey);

  const r = await fetch(u);
  if (!r.ok) throw new Error(`google http ${r.status}`);
  const j = await r.json();
  if (j.status === 'REQUEST_DENIED' || j.status === 'OVER_QUERY_LIMIT'
      || j.status === 'UNKNOWN_ERROR') {
    throw new Error(`google ${j.status}: ${j.error_message || ''}`);
  }
  if (j.status === 'ZERO_RESULTS' || !j.results?.length) return null;

  // Prefer street/building grade over city APPROXIMATE
  let pick = j.results[0];
  if (opts.requireStreetLevel) {
    pick = j.results.find((x) => !isCoarseConfidence(x.geometry?.location_type)) || null;
  }
  if (!pick?.geometry?.location) return null;

  const postal = pick.address_components?.find((c) =>
    (c.types || []).includes('postal_code'))?.long_name || null;

  return {
    lat: Number(pick.geometry.location.lat),
    lng: Number(pick.geometry.location.lng),
    confidence: pick.geometry.location_type || 'unknown',
    provider: 'google',
    postalCode: postal,
  };
}
