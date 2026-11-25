// QA report for pincode_centroids / pincodes.csv — duplicate coords, NCR on Agra template, gaps.
// Usage: node scripts/audit_pincodes.js [path/to/pincodes.csv]
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { pinCentroidPlausible } from '../src/geocode/pipeline.js';

const file = process.argv[2] || 'data/pincodes.csv';
const rows = parse(readFileSync(file), {
  columns: (h) => h.map((c) => c.toLowerCase().trim()),
  bom: true,
  skip_empty_lines: true,
});

const pick = (r, ...keys) => keys.map((k) => r[k]).find((v) => v != null && v !== '');
const byCoord = new Map();
const missing = [];
const implausible = [];

for (const r of rows) {
  const pin = String(pick(r, 'pincode', 'pin code', 'pin') || '').trim();
  const lat = Number(pick(r, 'latitude', 'lat'));
  const lng = Number(pick(r, 'longitude', 'lng', 'long'));
  if (!/^[1-9]\d{5}$/.test(pin)) continue;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    missing.push(pin);
    continue;
  }
  if (!pinCentroidPlausible(pin, lat, lng)) implausible.push({ pin, lat, lng });
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (!byCoord.has(key)) byCoord.set(key, []);
  byCoord.get(key).push(pin);
}

const dupes = [...byCoord.entries()]
  .filter(([, pins]) => pins.length > 1)
  .sort((a, b) => b[1].length - a[1].length);

console.log(`file: ${file}`);
console.log(`rows parsed: ${rows.length}`);
console.log(`missing lat/lng: ${missing.length}`);
console.log(`implausible (plausibility rules): ${implausible.length}`);
console.log(`duplicate coord groups: ${dupes.length}`);
console.log('\nTop duplicate coordinate groups:');
for (const [coord, pins] of dupes.slice(0, 12)) {
  console.log(`  ${coord} → ${pins.length} pincodes (e.g. ${pins.slice(0, 6).join(', ')}${pins.length > 6 ? '…' : ''})`);
}
if (implausible.length) {
  console.log('\nImplausible NCR pincodes (sample):');
  for (const row of implausible.slice(0, 20)) {
    console.log(`  ${row.pin} @ ${row.lat}, ${row.lng}`);
  }
}