// Address / coordinate normalization for the geocode pipeline.

const JUNK = /^(n\/?a|null|none|nil|undefined|-|—|na|not available|tbd)$/i;

/** Collapse whitespace; drop CRM junk placeholders. */
export function cleanText(s) {
  if (s == null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (!t || JUNK.test(t)) return '';
  return t;
}

/**
 * Place / locality cleanup — strips CRM trailing punctuation
 * ("Mumbai -", "Mohalla Baniyan Street,").
 */
export function cleanPlace(s) {
  let t = cleanText(s);
  if (!t) return '';
  t = t.replace(/[\s,;.\-/\\|—–]+$/g, '').trim();
  if (!t || JUNK.test(t)) return '';
  return t;
}

/**
 * Extract a valid India PIN (6 digits, not starting with 0).
 * Handles "411001.0", "Pin: 411 001", "411001," etc.
 */
export function normalizePincode(p) {
  if (p == null || p === '') return null;
  let s = String(p).trim();
  if (!s || JUNK.test(s)) return null;
  s = s.replace(/\.0+$/, ''); // Excel / Analytics numeric export
  const compact = s.replace(/[\s-]/g, '');
  const m = compact.match(/[1-9]\d{5}/);
  return m ? m[0] : null;
}

/** Usable street line for provider geocode (not a stub). */
export function usableStreet(street) {
  const t = cleanPlace(street);
  if (t.length < 4) return '';
  // Reject pure punctuation / numbers-only stubs
  if (!/[a-zA-Z]/.test(t)) return '';
  return t;
}

const normKey = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Join Street + Street 2 without duplicating when one line already contains the other.
 */
export function composeStreet(street, street2) {
  const a = usableStreet(street);
  const b = usableStreet(street2);
  if (a && b) {
    const na = normKey(a);
    const nb = normKey(b);
    if (na.includes(nb) || nb.includes(na)) return a.length >= b.length ? a : b;
    return `${a}, ${b}`;
  }
  return a || b || '';
}

/**
 * Full geocode / display address from all CRM address parts.
 * street + street2 + city + state + pincode + country (defaults to India).
 * Skips parts already present in earlier segments (safe for re-geocode of address_raw).
 */
export function buildFullAddress({
  street, street2, city, state, pincode, country, territory, cityHint,
} = {}) {
  const streetLine = composeStreet(street, street2);
  const cityLine = cleanPlace(city) || cleanPlace(cityHint) || cleanPlace(territory);
  const stateLine = cleanPlace(state);
  const pin = normalizePincode(pincode);
  const countryLine = cleanPlace(country) || 'India';

  const parts = [];
  let joined = '';
  for (const p of [streetLine, cityLine, stateLine, pin, countryLine]) {
    if (!p) continue;
    const key = normKey(String(p));
    if (parts.some((x) => normKey(String(x)) === key)) continue;
    // Avoid "… Mumbai, Maharashtra, 400022, India, Mumbai, 400022, India"
    if (joined && joined.includes(key)) continue;
    parts.push(p);
    joined = normKey(parts.join(', '));
  }
  return parts.join(', ');
}

export const inIndia = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng)
  && lat > 6 && lat < 38 && lng > 68 && lng < 98;

/**
 * Parse lat/lng from separate fields or a combined "lat, lng" string.
 * Auto-swaps when values are clearly reversed (common CRM mistake).
 */
export function parseCoords(sLat, sLng, combined) {
  let lat = Number(sLat);
  let lng = Number(sLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (!inIndia(lat, lng) && inIndia(lng, lat)) [lat, lng] = [lng, lat];
    if (inIndia(lat, lng)) return { lat, lng };
  }
  if (combined) {
    const m = String(combined).match(/(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
    if (m) {
      let la = Number(m[1]), ln = Number(m[2]);
      if (!inIndia(la, ln) && inIndia(ln, la)) [la, ln] = [ln, la];
      if (inIndia(la, ln)) return { lat: la, lng: ln };
    }
  }
  return null;
}

/**
 * Analytics often *displays* lat/lng at ≤2 decimal places (~1.1 km), but the
 * stored numeric value is precise. Export with CAST(... AS CHAR) to keep
 * full GPS. Low-precision still detected when the string really has ≤2 dp.
 */
export function isLowPrecisionCoord(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue;
    const s = String(v).trim();
    if (!s) continue;
    // Combined "lat, lng" — check both parts
    if (/[,\s]/.test(s) && /-?\d+\.\d+/.test(s)) {
      const parts = s.split(/[,\s]+/).filter((p) => /^-?\d/.test(p));
      if (parts.some((p) => isLowPrecisionCoord(p))) return true;
      continue;
    }
    if (/^-?\d+$/.test(s)) return true;
    const m = s.match(/^-?\d+\.(\d+)$/);
    if (m && m[1].length <= 2) return true;
  }
  return false;
}

/**
 * Street/building grade geocoder confidence.
 * APPROXIMATE is city/locality level — not good enough when we have a street.
 */
export function isStreetLevelConfidence(confidence) {
  const c = String(confidence || '').toUpperCase();
  return c === 'ROOFTOP'
    || c === 'RANGE_INTERPOLATED'
    || c === 'GEOMETRIC_CENTER'
    || c === 'PREMISE'
    || c === 'STREET_ADDRESS';
}

export function isCoarseConfidence(confidence) {
  const c = String(confidence || '').toUpperCase();
  if (!c || c === 'UNKNOWN' || c === 'APPROXIMATE') return true;
  return !isStreetLevelConfidence(c);
}
