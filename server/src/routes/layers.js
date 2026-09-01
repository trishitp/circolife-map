// Viewport-scoped GeoJSON. The client never downloads the full dataset —
// this is what keeps mobile on 4G alive at 75K+ leads.
import { Router } from 'express';
import { q } from '../db.js';
import { buildMapFilterClauses } from '../filters/mapFilters.js';
import { layerVisibilityClauses } from '../filters/layerPolicy.js';
import { redactMacInText, scrubPublicProperties } from '../privacy/mac.js';

export const layers = Router();

const LAYERS = new Set(['leads', 'accounts', 'meetings', 'assets']);

const POINT_COLS = [
  'source_id', 'title', 'owner_name', 'territory', 'status', 'precision',
  'record_ts', 'crm_url', 'extra', 'lat', 'lng', 'address_raw', 'pincode',
];
const POINT_SELECT = POINT_COLS.join(', ');
const POINT_SELECT_P = POINT_COLS.map((c) => `p.${c}`).join(', ');

function featureFromRow(r) {
  const extra = r.extra && typeof r.extra === 'object' ? r.extra : {};
  const accountName = r.account_title || extra.accountName || extra.fsmCompanyName || null;
  const accountCrmUrl = r.account_crm_url || extra.accountCrmUrl || null;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: scrubPublicProperties({
      id: r.source_id,
      title: redactMacInText(r.title),
      owner: r.owner_name,
      territory: r.territory,
      status: r.status,
      precision: r.precision,
      ts: r.record_ts,
      crmUrl: r.crm_url,
      ...extra,
      address: r.address_raw || extra.address || null,
      pincode: r.pincode || extra.pincode || null,
      ...(accountName ? { accountName } : {}),
      ...(accountCrmUrl ? { accountCrmUrl } : {}),
    }),
  };
}

const ACCOUNT_JOIN = `
LEFT JOIN map_points acc
  ON acc.layer = 'accounts'
 AND NULLIF(p.extra->>'accountId', '') IS NOT NULL
 AND acc.source_id = p.extra->>'accountId'`;

function buildFilterWheres(req, layer, params) {
  const wheres = [
    `layer = $1`, `geom IS NOT NULL`,
    `geom && ST_MakeEnvelope($2,$3,$4,$5,4326)`,
  ];
  wheres.push(...buildMapFilterClauses(req.query, params, { layer }));
  return wheres;
}

// GET /api/layers/:layer/feature/:id — single plotted point (for focus-from-list)
layers.get('/:layer/feature/:id', async (req, res) => {
  try {
    const layer = req.params.layer;
    if (!LAYERS.has(layer)) return res.status(400).json({ error: 'unknown layer' });
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id required' });

    const vis = layerVisibilityClauses(layer, 'p');
    const visSql = vis.length ? `AND ${vis.join(' AND ')}` : '';

    const { rows } = await q(`
      SELECT ${POINT_SELECT_P},
             acc.title AS account_title,
             acc.crm_url AS account_crm_url
      FROM map_points p
      ${ACCOUNT_JOIN}
      WHERE p.layer = $1 AND p.source_id = $2 AND p.geom IS NOT NULL
        ${visSql}
      LIMIT 1`, [layer, id]);

    if (!rows.length) return res.status(404).json({ error: 'point not found or unplottable' });
    res.json(featureFromRow(rows[0]));
  } catch (e) {
    console.error('[layers/feature]', e);
    res.status(500).json({ error: e.message || 'feature lookup failed' });
  }
});

// GET /api/layers/:layer?bbox=...&owner=&territory=&role=&userStatus=&source=&status=&precision=&from=&to=&joint=&limit=
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
      SELECT ${POINT_SELECT_P},
             acc.title AS account_title,
             acc.crm_url AS account_crm_url
      FROM (
        SELECT ${POINT_SELECT}
        FROM map_points
        WHERE ${wheres.join(' AND ')}
        ORDER BY record_ts DESC NULLS LAST, source_id
        LIMIT ${limit + 1}
      ) p
      ${ACCOUNT_JOIN}`, params);

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
