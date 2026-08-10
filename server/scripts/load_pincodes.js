// Load India pincode centroids into pincode_centroids.
// Usage: node scripts/load_pincodes.js path/to/pincodes.csv
// Expected columns (flexible header match): pincode, latitude, longitude.
// Source options: data.gov.in "All India Pincode Directory" (with lat/long),
// or github.com/sanand0/pincode (CC-BY). ~19K rows, one-time load.
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { pool } from '../src/db.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/load_pincodes.js <csv>'); process.exit(1); }
const rows = parse(readFileSync(file), { columns: (h) => h.map((c) => c.toLowerCase().trim()), bom: true });
const pick = (r, ...keys) => keys.map((k) => r[k]).find((v) => v != null && v !== '');
let n = 0;
for (const r of rows) {
  const pin = String(pick(r, 'pincode', 'pin code', 'pin') || '').trim();
  const lat = Number(pick(r, 'latitude', 'lat'));
  const lng = Number(pick(r, 'longitude', 'lng', 'long'));
  if (!/^[1-9]\d{5}$/.test(pin) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
  await pool.query(
    `INSERT INTO pincode_centroids (pincode, lat, lng) VALUES ($1,$2,$3)
     ON CONFLICT (pincode) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng`,
    [pin, lat, lng]);
  n++;
}
console.log(`loaded ${n} pincode centroids`);
await pool.end();
