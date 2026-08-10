/**
 * Re-pull Meetings Latitude/Longitude via CAST(... AS CHAR) for full GPS precision
 * and patch map_points + check-in signals without a full multi-layer sync.
 *
 *   node scripts/refresh_meeting_coords.js
 */
import 'dotenv/config';
import { parse } from 'csv-parse/sync';
import { q } from '../src/db.js';
import { exportSql } from '../src/zoho/analyticsClient.js';
import { MEETINGS_SQL } from '../src/sync/extractQueries.js';
import { parseCoords, isLowPrecisionCoord, inIndia } from '../src/geocode/address.js';

const csv = (text) => parse(text, { columns: true, skip_empty_lines: true, bom: true });
const col = (r, ...keys) => keys.map((k) => r[k]).find((v) => v != null && String(v).trim() !== '');

console.log('[meetings-coords] exporting meetings from Zoho Analytics…');
const rows = csv(await exportSql(MEETINGS_SQL));
console.log(`[meetings-coords] ${rows.length} rows`);

let updated = 0;
let exact = 0;
let approx = 0;
let skipped = 0;
let n = 0;

for (const r of rows) {
  const id = col(r, 'Id', 'm.Id');
  if (!id) {
    skipped++;
    continue;
  }
  const checkin = parseCoords(r.lat, r.lng);
  if (!checkin || !inIndia(checkin.lat, checkin.lng)) {
    skipped++;
    continue;
  }
  const precision = isLowPrecisionCoord(r.lat, r.lng) ? 'approx' : 'exact';
  if (precision === 'exact') exact++;
  else approx++;

  const latRaw = r.lat != null ? String(r.lat).trim() : null;
  const lngRaw = r.lng != null ? String(r.lng).trim() : null;

  const res = await q(
    `UPDATE map_points SET
       lat = $2::float8,
       lng = $3::float8,
       precision = $4,
       geom = ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326),
       extra = COALESCE(extra, '{}'::jsonb)
         || jsonb_build_object('checkin_lat', to_jsonb($5::text), 'checkin_lng', to_jsonb($6::text)),
       updated_at = now()
     WHERE layer = 'meetings' AND source_id = $1`,
    [id, checkin.lat, checkin.lng, precision, latRaw, lngRaw],
  );
  if (res.rowCount) updated += res.rowCount;

  // Keep discrepancy check-in signals aligned
  await q(
    `UPDATE location_signals SET
       lat = $2::float8,
       lng = $3::float8,
       precision = $4,
       updated_at = now()
     WHERE source = 'checkin' AND meeting_id = $1`,
    [id, checkin.lat, checkin.lng, precision],
  );

  n++;
  if (n % 2500 === 0) console.log(`[meetings-coords] processed ${n}/${rows.length}…`);
}

console.log(JSON.stringify({
  rows: rows.length,
  processed: n,
  updated_points: updated,
  exact,
  approx,
  skipped,
}, null, 2));
