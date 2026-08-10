// Viewport-scoped GeoJSON. The client never downloads the full dataset —
// this is what keeps mobile on 4G alive at 75K+ leads.
import { Router } from 'express';
import { q } from '../db.js';

export const layers = Router();

const LAYERS = new Set(['leads', 'accounts', 'meetings', 'assets']);

function istDayBound(dateStr, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return end
    ? `${dateStr}T23:59:59.999+05:30`
    : `${dateStr}T00:00:00+05:30`;
}

function featureFromRow(r) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      id: r.source_id,
      title: r.title,
      owner: r.owner_name,
      territory: r.territory,
      status: r.status,
      precision: r.precision,
      ts: r.record_ts,
      crmUrl: r.crm_url,
      ...(r.extra && typeof r.extra === 'object' ? r.extra : {}),
    },
  };
}

function buildFilterWheres(req, layer, params) {
  const wheres = [
    `layer = $1`, `geom IS NOT NULL`,
    `geom && ST_MakeEnvelope($2,$3,$4,$5,4326)`,
  ];
  const add = (sql, v) => {
    params.push(v);
    wheres.push(sql.replace(/\?/g, `$${params.length}`));
  };
  if (req.query.owner) add(`owner_name = ?`, req.query.owner);
  if (req.query.territory) add(`territory = ?`, req.query.territory);
  if (req.query.status) add(`status = ?`, req.query.status);
  if (req.query.precision) add(`precision = ?`, req.query.precision);
  if (req.query.from) {
    add(`record_ts >= ?::timestamptz`, istDayBound(String(req.query.from), false));
  }
  if (req.query.to) {
    add(`record_ts <= ?::timestamptz`, istDayBound(String(req.query.to), true));
  }
  // Joint only on meetings. Missing flag = normal (matches Activity metrics).
  if (req.query.joint != null && req.query.joint !== '' && layer === 'meetings') {
    const j = String(req.query.joint).toLowerCase();
    if (j === 'true' || j === '1' || j === 'yes') {
      wheres.push(`COALESCE((extra->>'joint')::boolean, false) = true`);
    } else if (j === 'false' || j === '0' || j === 'no') {
      wheres.push(`COALESCE((extra->>'joint')::boolean, false) = false`);
    }
  }
  return wheres;
}

// GET /api/layers/:layer/feature/:id — single plotted point (for focus-from-list)
layers.get('/:layer/feature/:id', async (req, res) => {
  try {
    const layer = req.params.layer;
    if (!LAYERS.has(layer)) return res.status(400).json({ error: 'unknown layer' });
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const { rows } = await q(`
      SELECT source_id, title, owner_name, territory, status, precision,
             record_ts, crm_url, extra, lat, lng
      FROM map_points
      WHERE layer = $1 AND source_id = $2 AND geom IS NOT NULL
      LIMIT 1`, [layer, id]);

    if (!rows.length) return res.status(404).json({ error: 'point not found or unplottable' });
    res.json(featureFromRow(rows[0]));
  } catch (e) {
    console.error('[layers/feature]', e);
    res.status(500).json({ error: e.message || 'feature lookup failed' });
  }
});

// GET /api/layers/:layer?bbox=minLng,minLat,maxLng,maxLat&owner=&territory=&status=&precision=&from=&to=&joint=&limit=
layers.get('/:layer', async (req, res) => {
  try {
    const layer = req.params.layer;
    if (!LAYERS.has(layer))
      return res.status(400).json({ error: 'unknown layer' });

    const bbox = (req.query.bbox || '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)))
      return res.status(400).json({ error: 'bbox=minLng,minLat,maxLng,maxLat required' });

    const params = [layer, ...bbox];
    const wheres = buildFilterWheres(req, layer, params);
    const limit = Math.min(Math.max(Number(req.query.limit) || 8000, 1), 25000);

    // Fetch limit+1 so we can report truncation without a full COUNT.
    const { rows } = await q(`
      SELECT source_id, title, owner_name, territory, status, precision,
             record_ts, crm_url, extra, lat, lng
      FROM map_points
      WHERE ${wheres.join(' AND ')}
      ORDER BY record_ts DESC NULLS LAST, source_id
      LIMIT ${limit + 1}`, params);

    const truncated = rows.length > limit;
    const slice = truncated ? rows.slice(0, limit) : rows;

    res.json({
      type: 'FeatureCollection',
      features: slice.map(featureFromRow),
      meta: {
        layer,
        returned: slice.length,
        limit,
        truncated,
      },
    });
  } catch (e) {
    console.error('[layers]', e);
    res.status(500).json({ error: e.message || 'layer query failed' });
  }
});
