/** Spread points that share identical coords (pincode / territory centroids) so they are tappable. */
const COORD_DECIMALS = 5;

function coordKey(lng, lat) {
  return `${Number(lng).toFixed(COORD_DECIMALS)},${Number(lat).toFixed(COORD_DECIMALS)}`;
}

function metersToDelta(meters, lat) {
  const mPerDegLat = 111320;
  const mPerDegLng = Math.max(mPerDegLat * Math.cos((lat * Math.PI) / 180), 40000);
  return [meters / mPerDegLng, meters / mPerDegLat];
}

/**
 * @param {import('geojson').Feature[]} features
 * @param {number} zoom
 */
function stackRadiusMeters(n, zoom) {
  const base = zoom >= 16 ? 22 : zoom >= 14 ? 45 : zoom >= 12 ? 90 : zoom >= 10.5 ? 140 : zoom >= 9 ? 180 : 260;
  const scale = n > 80 ? 2.4 : n > 40 ? 1.75 : n > 15 ? 1.35 : 1;
  return base * scale;
}

export function spreadColocatedFeatures(features, zoom) {
  if (!Array.isArray(features) || features.length < 2) {
    return { features: features || [], stacks: 0, maxStack: 1 };
  }
  const z = Number.isFinite(zoom) ? zoom : 10;

  const buckets = new Map();
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const k = coordKey(c[0], c[1]);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(f);
  }

  let stacks = 0;
  let maxStack = 1;
  const out = [];

  for (const group of buckets.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    stacks += 1;
    maxStack = Math.max(maxStack, group.length);

    const [lng, lat] = group[0].geometry.coordinates;
    const n = group.length;
    const ring = stackRadiusMeters(n, z);

    group.forEach((f, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const [dLng, dLat] = metersToDelta(ring, lat);
      out.push({
        ...f,
        properties: {
          ...f.properties,
          colocated: true,
          stackSize: n,
          stackIndex: i,
        },
        geometry: {
          type: 'Point',
          coordinates: [
            lng + dLng * Math.cos(angle),
            lat + dLat * Math.sin(angle),
          ],
        },
      });
    });
  }

  return { features: out, stacks, maxStack };
}

export function countUniqueCoords(features) {
  const s = new Set();
  for (const f of features || []) {
    const c = f?.geometry?.coordinates;
    if (!c) continue;
    s.add(coordKey(c[0], c[1]));
  }
  return s.size;
}