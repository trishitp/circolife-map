import { pool, q } from '../src/db.js';

const MAC_IN_PARENS = /\s*\(([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\)\s*$/i;
const MAC_CAPTURE = /\(([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\)/i;

const { rows } = await q(`
  SELECT source_id, title, extra FROM map_points WHERE layer='assets'`);

let n = 0;
for (const r of rows) {
  const extra = r.extra && typeof r.extra === 'object' ? { ...r.extra } : {};
  const title = r.title || '';
  const macFromTitle = (title.match(MAC_CAPTURE) || [])[1] || null;
  const stripped = title.replace(MAC_IN_PARENS, '').trim() || title;

  const assetNumber = extra.assetNumber || stripped || null;
  const assetName = extra.assetName || title || null;
  const mac = extra.mac || macFromTitle || null;
  const newTitle = assetNumber || stripped || title || 'Asset';

  extra.assetNumber = assetNumber;
  extra.assetName = assetName;
  if (mac) extra.mac = mac;

  await q(`
    UPDATE map_points SET title=$2, extra=$3, updated_at=now()
    WHERE layer='assets' AND source_id=$1`,
    [r.source_id, newTitle, extra]);
  n++;
}

const check = await q(`
  SELECT source_id, title, extra->>'assetNumber' AS asset_no, extra->>'mac' AS mac
  FROM map_points WHERE layer='assets' ORDER BY updated_at DESC LIMIT 6`);
console.log(JSON.stringify({ updated: n, samples: check.rows }, null, 2));
await pool.end();
