import { Router } from 'express';
import { q } from '../db.js';

export const gaps = Router();

function classifyReason(row) {
  if (row.reason) return row.reason;
  const layer = row.layer;
  const hasStreet = row.address_raw && String(row.address_raw).trim().length > 8;
  const hasPin = row.pincode && /^[1-9]\d{5}$/.test(String(row.pincode).trim());
  if (layer === 'leads') {
    if (!hasStreet && !hasPin) return 'Lead missing street and pincode';
    if (!hasPin) return 'Lead missing pincode; street geocode failed';
    return 'Lead address/pincode could not be resolved';
  }
  if (layer === 'accounts') {
    if (!hasStreet && !hasPin) return 'Account has no billing street and no inherited lead pincode';
    if (!hasPin) return 'Account missing pincode (Billing Code 0%); street geocode failed';
    return 'Account address could not be resolved';
  }
  if (layer === 'meetings') return 'Meeting has no check-in and no located related lead/account';
  if (layer === 'assets') {
    return 'Asset has no FSM/shipping/billing address and linked account is not located';
  }
  return 'Unplottable';
}

// Soft-gap precision mix for BA (not hard unplottable)
gaps.get('/summary', async (_req, res) => {
  const hard = await q(`
    SELECT layer, COUNT(*)::int AS n
    FROM map_points WHERE precision = 'none' OR geom IS NULL
    GROUP BY layer`);
  const soft = await q(`
    SELECT layer, precision, COUNT(*)::int AS n
    FROM map_points
    WHERE precision IN ('pincode','approx','territory','inherited')
    GROUP BY layer, precision`);
  const totals = await q(`
    SELECT layer, COUNT(*)::int AS n FROM map_points GROUP BY layer`);
  const byReason = await q(`
    SELECT COALESCE(u.layer, p.layer) AS layer,
           COALESCE(u.reason, 'Unplottable — no usable location') AS reason,
           COUNT(*)::int AS n
    FROM map_points p
    LEFT JOIN unplottable_log u ON u.layer = p.layer AND u.source_id = p.source_id
    WHERE p.precision = 'none' OR p.geom IS NULL
    GROUP BY 1, 2
    ORDER BY n DESC`);
  const reviewed = await q(`
    SELECT COUNT(*)::int AS n FROM unplottable_log WHERE reviewed_at IS NOT NULL`);

  const totalMap = Object.fromEntries(totals.rows.map((r) => [r.layer, r.n]));
  const hardMap = Object.fromEntries(hard.rows.map((r) => [r.layer, r.n]));

  res.json({
    layers: ['leads', 'accounts', 'meetings', 'assets'].map((layer) => ({
      layer,
      total: totalMap[layer] || 0,
      unplottable: hardMap[layer] || 0,
      pctUnplottable: totalMap[layer]
        ? Math.round((1000 * (hardMap[layer] || 0)) / totalMap[layer]) / 10
        : 0,
    })),
    softGaps: soft.rows,
    byReason: byReason.rows,
    reviewed: reviewed.rows[0]?.n || 0,
  });
});

// Paginated hard gaps (precision none)
gaps.get('/', async (req, res) => {
  const layer = req.query.layer;
  const qtext = (req.query.q || '').trim();
  const reviewed = req.query.reviewed; // 'yes' | 'no' | omit
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const params = [];
  const wheres = [`(p.precision = 'none' OR p.geom IS NULL)`];
  const add = (sql, v) => { params.push(v); wheres.push(sql.replace('?', `$${params.length}`)); };

  if (layer && ['leads', 'accounts', 'meetings', 'assets'].includes(layer))
    add(`p.layer = ?`, layer);
  if (qtext) {
    params.push(`%${qtext}%`);
    wheres.push(`(p.title ILIKE $${params.length} OR p.owner_name ILIKE $${params.length} OR p.territory ILIKE $${params.length} OR p.source_id ILIKE $${params.length})`);
  }
  if (reviewed === 'yes') wheres.push(`u.reviewed_at IS NOT NULL`);
  if (reviewed === 'no') wheres.push(`(u.reviewed_at IS NULL)`);

  const whereSql = wheres.join(' AND ');
  const countR = await q(`
    SELECT COUNT(*)::int AS n
    FROM map_points p
    LEFT JOIN unplottable_log u ON u.layer = p.layer AND u.source_id = p.source_id
    WHERE ${whereSql}`, params);
  params.push(limit, offset);
  const { rows } = await q(`
    SELECT p.layer, p.source_id, p.title, p.owner_name, p.territory, p.status,
           p.address_raw, p.pincode, p.crm_url, p.precision,
           u.reason, u.reviewed_at, u.admin_notes, u.logged_at
    FROM map_points p
    LEFT JOIN unplottable_log u ON u.layer = p.layer AND u.source_id = p.source_id
    WHERE ${whereSql}
    ORDER BY u.logged_at DESC NULLS LAST, p.updated_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({
    total: countR.rows[0].n,
    limit, offset,
    rows: rows.map((r) => ({
      ...r,
      reason: classifyReason(r),
    })),
  });
});
