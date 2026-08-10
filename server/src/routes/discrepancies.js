import { Router } from 'express';
import { q } from '../db.js';
import { WATCH_KM, ALERT_KM } from '../discrepancy/engine.js';

export const discrepancies = Router();

discrepancies.get('/summary', async (_req, res) => {
  const bySev = await q(`
    SELECT severity, COUNT(*)::int AS n
    FROM address_discrepancies GROUP BY severity`);
  const total = await q(`SELECT COUNT(*)::int AS n FROM address_discrepancies`);
  const multi = await q(`
    SELECT COUNT(*)::int AS n FROM address_discrepancies
    WHERE COALESCE((flags->>'sourceCountWithCoords')::int, 0) >= 2`);
  const topPairs = await q(`
    SELECT worst_pair AS pair, COUNT(*)::int AS n
    FROM address_discrepancies
    WHERE severity IN ('watch','alert') AND worst_pair IS NOT NULL
    GROUP BY worst_pair ORDER BY n DESC LIMIT 6`);
  const topTerr = await q(`
    SELECT COALESCE(territory, '(none)') AS territory, COUNT(*)::int AS n
    FROM address_discrepancies
    WHERE severity IN ('watch','alert')
    GROUP BY 1 ORDER BY n DESC LIMIT 8`);
  const missingRollup = await q(`
    SELECT src AS source, COUNT(*)::int AS n
    FROM address_discrepancies d,
         LATERAL jsonb_array_elements_text(d.flags->'missing') AS src
    WHERE d.severity IN ('watch','alert') OR COALESCE((flags->>'sourceCountWithCoords')::int,0) >= 1
    GROUP BY src ORDER BY n DESC`);

  const sev = Object.fromEntries(bySev.rows.map((r) => [r.severity, r.n]));
  const nTotal = total.rows[0]?.n || 0;
  const nMulti = multi.rows[0]?.n || 0;

  res.json({
    total: nTotal,
    bySeverity: {
      alert: sev.alert || 0,
      watch: sev.watch || 0,
      ok: sev.ok || 0,
    },
    multiSource: nMulti,
    pctMultiSource: nTotal ? Math.round((1000 * nMulti) / nTotal) / 10 : 0,
    topConflictPairs: topPairs.rows,
    topTerritories: topTerr.rows,
    missingSources: missingRollup.rows,
    thresholds: { watchKm: WATCH_KM, alertKm: ALERT_KM },
  });
});

discrepancies.get('/', async (req, res) => {
  const severity = req.query.severity; // ok|watch|alert
  const territory = (req.query.territory || '').trim();
  const owner = (req.query.owner || '').trim();
  const sourceMissing = (req.query.source_missing || '').trim();
  const qtext = (req.query.q || '').trim();
  const minKm = req.query.min_km != null && req.query.min_km !== ''
    ? Number(req.query.min_km) : null;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const params = [];
  const wheres = ['TRUE'];
  const add = (sql, v) => {
    params.push(v);
    wheres.push(sql.replace('?', `$${params.length}`));
  };

  if (severity && ['ok', 'watch', 'alert'].includes(severity))
    add(`severity = ?`, severity);
  if (territory) add(`territory = ?`, territory);
  if (owner) add(`owner_name = ?`, owner);
  if (sourceMissing && ['mmi', 'billing', 'shipping', 'checkin'].includes(sourceMissing)) {
    params.push(sourceMissing);
    wheres.push(`flags->'missing' ? $${params.length}`);
  }
  if (qtext) {
    params.push(`%${qtext}%`);
    wheres.push(
      `(title ILIKE $${params.length} OR owner_name ILIKE $${params.length}`
      + ` OR territory ILIKE $${params.length} OR entity_id ILIKE $${params.length})`,
    );
  }
  if (Number.isFinite(minKm)) add(`max_spread_km >= ?`, minKm);

  const whereSql = wheres.join(' AND ');
  const countR = await q(
    `SELECT COUNT(*)::int AS n FROM address_discrepancies WHERE ${whereSql}`, params);
  params.push(limit, offset);
  const { rows } = await q(`
    SELECT entity_layer, entity_id, title, owner_name, territory, crm_url,
           max_spread_km, worst_pair, severity, flags,
           mmi_lat, mmi_lng, billing_lat, billing_lng, shipping_lat, shipping_lng,
           checkin_lat, checkin_lng,
           mmi_billing_km, mmi_shipping_km, billing_shipping_km,
           mmi_checkin_km, billing_checkin_km, shipping_checkin_km
    FROM address_discrepancies
    WHERE ${whereSql}
    ORDER BY
      CASE severity WHEN 'alert' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
      max_spread_km DESC NULLS LAST,
      updated_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  res.json({
    total: countR.rows[0].n,
    limit,
    offset,
    rows: rows.map((r) => ({
      ...r,
      present: r.flags?.present || [],
      missing: r.flags?.missing || [],
    })),
  });
});

discrepancies.get('/export.csv', async (req, res) => {
  const severity = req.query.severity;
  const params = [];
  const wheres = ['TRUE'];
  if (severity && ['ok', 'watch', 'alert'].includes(severity)) {
    params.push(severity);
    wheres.push(`severity = $1`);
  }
  const { rows } = await q(`
    SELECT entity_layer, entity_id, title, owner_name, territory, severity,
           max_spread_km, worst_pair, crm_url,
           mmi_address, mmi_pincode, mmi_lat, mmi_lng,
           billing_address, billing_pincode, billing_lat, billing_lng,
           shipping_address, shipping_pincode, shipping_lat, shipping_lng,
           checkin_lat, checkin_lng, checkin_meeting_id,
           mmi_billing_km, mmi_shipping_km, billing_shipping_km,
           mmi_checkin_km, billing_checkin_km, shipping_checkin_km
    FROM address_discrepancies
    WHERE ${wheres.join(' AND ')}
    ORDER BY CASE severity WHEN 'alert' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END,
             max_spread_km DESC NULLS LAST
    LIMIT 5000`, params);

  const cols = Object.keys(rows[0] || {
    entity_layer: 1, entity_id: 1, title: 1, owner_name: 1, territory: 1,
    severity: 1, max_spread_km: 1, worst_pair: 1, crm_url: 1,
  });
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="circolife-discrepancies.csv"');
  res.send(lines.join('\n'));
});

discrepancies.get('/:layer/:id', async (req, res) => {
  const { layer, id } = req.params;
  if (!['leads', 'accounts'].includes(layer)) {
    return res.status(400).json({ error: 'layer must be leads or accounts' });
  }
  const disc = (await q(`
    SELECT * FROM address_discrepancies
    WHERE entity_layer=$1 AND entity_id=$2`, [layer, id])).rows[0];
  const signals = (await q(`
    SELECT source, address_text, pincode, lat, lng, precision, meeting_id, record_ts, updated_at
    FROM location_signals
    WHERE entity_layer=$1 AND entity_id=$2
    ORDER BY source, record_ts DESC NULLS LAST`, [layer, id])).rows;
  const point = (await q(`
    SELECT lat, lng, precision, address_raw, pincode, title, territory, owner_name, crm_url
    FROM map_points WHERE layer=$1 AND source_id=$2`, [layer, id])).rows[0] || null;

  if (!disc && !signals.length) {
    return res.status(404).json({ error: 'not found' });
  }

  res.json({
    discrepancy: disc || null,
    signals,
    mapPoint: point,
    thresholds: { watchKm: WATCH_KM, alertKm: ALERT_KM },
  });
});
