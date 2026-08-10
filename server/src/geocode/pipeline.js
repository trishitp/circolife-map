// Tiered geocoding. Order matters and is audit-driven:
//   T0 exact/approx -> lat/lng already on the record (Search Address widget, check-in)
//                     2dp Analytics coords try T1 refine before accepting as approx
//   T1 geocoded     -> provider call on full address
//                     (Street + Street 2 + City + State + Pin + Country).
//                     Pin-only skips to T2. Coarse (APPROXIMATE) hits rejected when
//                     a street was supplied.
//   T2 pincode      -> static centroid (authoritative for pin-only rows)
//   T3 territory    -> mean of plotted peers in same territory
//   T4 none         -> logged to unplottable_log, never plotted at (0,0)/city centre
import crypto from 'node:crypto';
import { q } from '../db.js';
import { providerGeocode, hasGeocoderKey } from './providers.js';
import {
  cleanText, normalizePincode, composeStreet, buildFullAddress, inIndia,
  parseCoords, isLowPrecisionCoord,
} from './address.js';

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** Great-circle distance in km — used to reject geocodes that contradict the PIN. */
function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Max distance from our pincode centroid before a provider hit is treated as wrong-city. */
const PIN_PROXIMITY_KM = 45;

async function pinCentroid(pincode) {
  const pin = normalizePincode(pincode);
  if (!pin) return null;
  const c = (await q('SELECT lat,lng FROM pincode_centroids WHERE pincode=$1', [pin])).rows[0];
  if (c && inIndia(c.lat, c.lng)) return { lat: c.lat, lng: c.lng, pincode: pin };
  return null;
}

function nearPin(hit, pinRef) {
  if (!hit || !pinRef) return true; // no pin reference → cannot contradict
  return haversineKm(hit, pinRef) <= PIN_PROXIMITY_KM;
}

/**
 * Provider geocode with cache.
 * @returns {{lat,lng,precision}|null|'miss'}
 *   hit object | null (skip/unavailable) | 'miss' (provider answered empty — cacheable)
 */
async function cachedProviderLookup(query, { pincode, requireStreetLevel }) {
  const key = hash(norm(query));
  const pinRef = await pinCentroid(pincode);
  const cached = (await q('SELECT * FROM geocode_cache WHERE addr_hash=$1', [key])).rows[0];
  if (cached) {
    if (cached.failed) return 'miss';
    if (cached.lat != null && cached.lng != null && inIndia(cached.lat, cached.lng)) {
      // Re-validate legacy cache rows that may predate proximity checks
      if (!nearPin({ lat: cached.lat, lng: cached.lng }, pinRef)) return 'miss';
      return { lat: cached.lat, lng: cached.lng, precision: 'geocoded' };
    }
    return 'miss';
  }

  if (!hasGeocoderKey()) return null;

  try {
    const g = await providerGeocode(query, { pincode, requireStreetLevel });
    if (g && inIndia(g.lat, g.lng) && nearPin(g, pinRef)) {
      await q(
        `INSERT INTO geocode_cache (addr_hash,query,provider,lat,lng,confidence)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (addr_hash) DO NOTHING`,
        [key, query, g.provider, g.lat, g.lng, g.confidence]);
      return { lat: g.lat, lng: g.lng, precision: 'geocoded' };
    }
    // True miss / rejected quality — cache so we don't re-hammer
    await q(`INSERT INTO geocode_cache (addr_hash,query,provider,failed)
             VALUES ($1,$2,$3,TRUE) ON CONFLICT (addr_hash) DO NOTHING`,
            [key, query, g?.provider || 'none']);
    return 'miss';
  } catch (e) {
    console.warn('[geocode] provider error, will retry next sync:', e.message);
    // Transient — do not write failed=true
    return null;
  }
}

async function lookupPincode(pincode) {
  const c = await pinCentroid(pincode);
  if (c) return { lat: c.lat, lng: c.lng, precision: 'pincode' };
  return null;
}

async function lookupTerritory(territory, cityHint) {
  const terr = cleanText(territory) || cleanText(cityHint);
  if (!terr) return null;
  const c = (await q(
    'SELECT lat,lng FROM territory_centroids WHERE lower(territory)=lower($1)', [terr]
  )).rows[0];
  if (c && inIndia(c.lat, c.lng)) return { lat: c.lat, lng: c.lng, precision: 'territory' };
  return null;
}

/**
 * Resolve a CRM row to coordinates.
 * Inputs are raw; normalization happens here.
 * Prefer passing street/street2/city/state/country/pincode — cityHint kept for compat.
 */
export async function resolvePoint({
  sLat, sLng, checkinLatLng,
  street, street2, city, state, country,
  pincode, cityHint, territory,
}) {
  const pin = normalizePincode(pincode);
  const streetLine = composeStreet(street, street2);
  const place = cleanText(city) || cleanText(cityHint) || cleanText(territory);

  // T0: coordinates already present
  const t0 = parseCoords(sLat, sLng, checkinLatLng);
  const t0Approx = t0
    ? isLowPrecisionCoord(sLat, sLng, checkinLatLng)
    : false;

  // High-precision CRM coords win — never overwrite with a geocoder guess
  if (t0 && !t0Approx) return { ...t0, precision: 'exact' };

  // T1: street-level provider geocode on the FULL address
  // (pin-only rows skip to T2 — no API burn). Also refines Analytics 2dp coords.
  if (streetLine) {
    const query = buildFullAddress({
      street, street2, city, state, pincode: pin, country, territory, cityHint,
    });
    if (query.length > 8) {
      const hit = await cachedProviderLookup(query, {
        pincode: pin,
        requireStreetLevel: true,
      });
      if (hit && hit !== 'miss') return hit;
    }
  }

  // Keep coarse check-in / Search Address after failed refine
  if (t0 && t0Approx) return { ...t0, precision: 'approx' };

  // T2: pincode centroid (authoritative path for pin-only / geocode-miss rows)
  const t2 = await lookupPincode(pin);
  if (t2) return t2;

  // T3: territory / city centroid from plotted peers
  const t3 = await lookupTerritory(territory, place);
  if (t3) return t3;

  return { lat: null, lng: null, precision: 'none' };
}

export async function refreshTerritoryCentroids() {
  await q(`
    INSERT INTO territory_centroids (territory, lat, lng, n_points, updated_at)
    SELECT territory, AVG(lat), AVG(lng), COUNT(*)::int, now()
    FROM map_points
    WHERE territory IS NOT NULL AND territory <> ''
      AND lat IS NOT NULL AND lng IS NOT NULL
      AND precision IN ('exact','geocoded','approx','pincode','inherited')
    GROUP BY territory
    HAVING COUNT(*) >= 3
    ON CONFLICT (territory) DO UPDATE SET
      lat = EXCLUDED.lat, lng = EXCLUDED.lng,
      n_points = EXCLUDED.n_points, updated_at = now()`);
}
