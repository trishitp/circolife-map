import { Router } from 'express';
import { q } from '../db.js';
import { cfg } from '../config.js';
import { TERRITORY_GROUP_KEYS, parseList } from '../filters/mapFilters.js';
import { sqlMapPointVisible } from '../filters/layerPolicy.js';
import { syncUsers } from '../sync/sync.js';
import { recordUsage, isClientSku } from '../usage/meter.js';
import { getMapMarkerStyle } from '../mapStyle.js';
import { getPincodesForBdm, normalizeBdmName } from '../bdmPincodes.js';
import { normalizePincode } from '../geocode/address.js';
import { buildFilterWheres } from './layers.js';
import { fetchRelatedAssetsGeoJson } from '../relatedAssets.js';

export const meta = Router();

/** Warm CircoLife tint for Google roadmap tiles (Map Tiles API style objects). */
const GOOGLE_MAP_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#FEF9F5' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#2E1F40' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FEF9F5' }] },
  {
    featureType: 'administrative',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#D9CFC4' }],
  },
  {
    featureType: 'poi',
    elementType: 'geometry',
    stylers: [{ color: '#F3EBE3' }],
  },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: '#D5E8C8' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#FFFFFF' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#D9CFC4' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#E8B896' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#D4A07A' }],
  },
  {
    featureType: 'transit',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#A8C9DE' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#5A7A90' }],
  },
];

let cachedTileSession = null;

function tileSessionFresh(entry) {
  if (!entry?.payload?.session) return false;
  const exp = Number(entry.payload.expiry) * 1000;
  if (!Number.isFinite(exp)) return true;
  return exp > Date.now() + 5 * 60 * 1000;
}

async function createGoogleTileSession() {
  if (!cfg.googleKey) {
    const err = new Error('GOOGLE_MAPS_API_KEY not configured');
    err.status = 503;
    throw err;
  }
  const url = `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(cfg.googleKey)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mapType: 'roadmap',
      language: 'en-IN',
      region: 'IN',
      styles: GOOGLE_MAP_STYLES,
    }),
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!r.ok) {
    recordUsage({
      sku: 'map_tiles_session',
      provider: 'google',
      units: 1,
      ok: false,
      meta: { status: r.status },
    });
    const err = new Error(data?.error?.message || data?.error || `Google tiles session failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  recordUsage({ sku: 'map_tiles_session', provider: 'google', units: 1, ok: true });
  return data;
}

async function getGoogleTileSessionCached() {
  if (tileSessionFresh(cachedTileSession)) return cachedTileSession.payload;
  const session = await createGoogleTileSession();
  cachedTileSession = { payload: session, at: Date.now() };
  return session;
}

// GET /api/meta/maps — Google Map Tiles session for the web basemap
meta.get('/maps', async (_req, res) => {
  try {
    if (cfg.basemap !== 'google' || !cfg.googleKey) {
      return res.json({
        enabled: false,
        provider: cfg.basemap === 'google' ? null : 'carto',
        basemap: cfg.basemap,
      });
    }
    const session = await getGoogleTileSessionCached();
    res.json({
      enabled: true,
      provider: 'google',
      session: session.session,
      expiry: Number(session.expiry) || null,
      tileWidth: session.tileWidth || 256,
      tileHeight: session.tileHeight || 256,
      imageFormat: session.imageFormat || 'png',
      // Key is required in tile/viewport URLs (restrict by HTTP referrer in GCP)
      key: cfg.googleKey,
      language: 'en-IN',
      region: 'IN',
    });
  } catch (e) {
    console.error('[meta/maps]', e);
    res.status(e.status || 500).json({
      enabled: false,
      error: e.message || 'maps session failed',
    });
  }
});

// GET /api/meta/maps/viewport — required Google copyright string for current view
meta.get('/maps/viewport', async (req, res) => {
  try {
    if (cfg.basemap !== 'google' || !cfg.googleKey) {
      return res.json({ copyright: '', enabled: false });
    }
    const session = String(req.query.session || '').trim();
    if (!session) return res.status(400).json({ error: 'session required' });
    const zoom = Number(req.query.zoom);
    const north = Number(req.query.north);
    const south = Number(req.query.south);
    const east = Number(req.query.east);
    const west = Number(req.query.west);
    if (![zoom, north, south, east, west].every(Number.isFinite)) {
      return res.status(400).json({ error: 'zoom,north,south,east,west required' });
    }
    const u = new URL('https://tile.googleapis.com/v1/2dtiles/viewport');
    u.searchParams.set('session', session);
    u.searchParams.set('key', cfg.googleKey);
    u.searchParams.set('zoom', String(Math.round(zoom)));
    u.searchParams.set('north', String(north));
    u.searchParams.set('south', String(south));
    u.searchParams.set('east', String(east));
    u.searchParams.set('west', String(west));
    const r = await fetch(u);
    const data = await r.json().catch(() => ({}));
    recordUsage({
      sku: 'map_tiles_viewport',
      provider: 'google',
      units: 1,
      ok: r.ok,
    });
    if (!r.ok) {
      return res.status(r.status).json({ error: data?.error?.message || data?.error || 'viewport failed' });
    }
    res.json(data);
  } catch (e) {
    console.error('[meta/maps/viewport]', e);
    res.status(500).json({ error: e.message || 'viewport failed' });
  }
});

// Counts per layer + geo coverage; drives the layer dock badges and DQ panel
const MAP_LAYERS = ['leads', 'accounts', 'meetings', 'assets'];

// GET /api/meta/layer-counts?bbox=&layers=leads,meetings&owner=...
meta.get('/layer-counts', async (req, res) => {
  try {
    const bbox = (req.query.bbox || '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'bbox=minLng,minLat,maxLng,maxLat required' });
    }
    const layers = parseList(req.query.layers).filter((l) => MAP_LAYERS.includes(l));
    const target = layers.length ? layers : MAP_LAYERS;
    const counts = {};
    let total = 0;
    for (const layer of target) {
      const params = [layer, ...bbox];
      const wheres = buildFilterWheres(req, layer, params);
      const { rows } = await q(
        `SELECT COUNT(*)::int AS n FROM map_points WHERE ${wheres.join(' AND ')}`,
        params,
      );
      counts[layer] = rows[0]?.n || 0;
      total += counts[layer];
    }
    res.json({ counts, total, layers: target });
  } catch (e) {
    console.error('[meta/layer-counts]', e);
    res.status(500).json({ error: e.message || 'layer counts failed' });
  }
});

// GET /api/meta/bdm-pincodes?owner=Full Name
meta.get('/bdm-pincodes', async (req, res) => {
  try {
    const owner = normalizeBdmName(req.query.owner);
    if (!owner) return res.status(400).json({ error: 'owner query required' });
    const pincodes = await getPincodesForBdm(owner);
    res.json({ owner, pincodes, count: pincodes.length });
  } catch (e) {
    console.error('[meta/bdm-pincodes]', e);
    res.status(500).json({ error: e.message || 'bdm pincodes failed' });
  }
});

meta.get('/quality-snapshot', async (_req, res) => {
  try {
    const [disc, gaps, weak, sync] = await Promise.all([
      q(`SELECT
           COUNT(*) FILTER (WHERE severity = 'alert')::int AS alerts,
           COUNT(*) FILTER (WHERE severity = 'watch')::int AS watch
         FROM address_discrepancies`),
      q(`SELECT COUNT(*)::int AS n FROM map_points
         WHERE precision = 'none' OR geom IS NULL`),
      q(`SELECT COUNT(*)::int AS n FROM map_points
         WHERE precision IN ('pincode','territory')
           AND lat IS NOT NULL AND lng IS NOT NULL`),
      q(`
        SELECT finished_at, status FROM sync_runs
        WHERE kind IN ('full','sync') ORDER BY started_at DESC LIMIT 1`),
    ]);
    res.json({
      discrepancies: {
        alert: disc.rows[0]?.alerts || 0,
        watch: disc.rows[0]?.watch || 0,
      },
      unplottable: gaps.rows[0]?.n || 0,
      areaPrecision: weak.rows[0]?.n || 0,
      lastSync: sync.rows[0]?.finished_at || null,
      lastSyncStatus: sync.rows[0]?.status || null,
    });
  } catch (e) {
    console.error('[meta/quality-snapshot]', e);
    res.status(500).json({ error: e.message || 'quality snapshot failed' });
  }
});

meta.get('/bdm-scorecard', async (req, res) => {
  try {
    const owner = normalizeBdmName(req.query.owner);
    if (!owner) return res.status(400).json({ error: 'owner query required' });
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const pins = await getPincodesForBdm(owner);
  if (!pins.length) {
      return res.json({
        owner,
        days: Math.min(365, Math.max(7, Number(req.query.days) || 90)),
        assignedPincodes: 0,
        visits: { total: 0, inTerritory: 0, outside: 0, noPin: 0, inTerritoryPct: null },
        leadsInTerritory: 0,
        precision: { leadsAccountsInPins: 0, weak: 0, weakPct: null },
      });
    }
    const bbox = (req.query.bbox || '').split(',').map(Number);
    const hasBbox = bbox.length === 4 && bbox.every((n) => Number.isFinite(n));
    const pinList = pins;

    let bboxMeet = '';
    let bboxLead = '';
    const meetParams = [owner, pinList, days];
    const leadParams = [pinList];
    if (hasBbox) {
      meetParams.push(bbox[0], bbox[1], bbox[2], bbox[3]);
      leadParams.push(bbox[0], bbox[1], bbox[2], bbox[3]);
      const bi = meetParams.length - 3;
      bboxMeet = ` AND lng BETWEEN $${bi} AND $${bi + 2} AND lat BETWEEN $${bi + 1} AND $${bi + 3}`;
      const lj = leadParams.length - 3;
      bboxLead = ` AND lng BETWEEN $${lj} AND $${lj + 2} AND lat BETWEEN $${lj + 1} AND $${lj + 3}`;
    }

    const [meetings, leads, weak] = await Promise.all([
      q(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE pincode = ANY($2::text[]))::int AS in_territory,
          COUNT(*) FILTER (
            WHERE pincode IS NOT NULL AND NOT (pincode = ANY($2::text[]))
          )::int AS outside,
          COUNT(*) FILTER (WHERE pincode IS NULL OR pincode = '')::int AS no_pin
        FROM map_points
        WHERE layer = 'meetings'
          AND lower(trim(owner_name)) = lower(trim($1))
          AND record_ts >= now() - ($3::int || ' days')::interval
          ${bboxMeet}`,
        meetParams,
      ),
      q(`
        SELECT COUNT(*)::int AS total
        FROM map_points
        WHERE layer = 'leads'
          AND pincode = ANY($1::text[])
          AND lat IS NOT NULL AND lng IS NOT NULL
          ${bboxLead}`,
        leadParams,
      ),
      q(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE precision IN ('pincode','territory','approx'))::int AS weak
        FROM map_points
        WHERE layer IN ('leads','accounts')
          AND pincode = ANY($1::text[])
          AND lat IS NOT NULL AND lng IS NOT NULL
          ${bboxLead}`,
        leadParams,
      ),
    ]);

    const m = meetings.rows[0] || {};
    const l = leads.rows[0] || {};
    const w = weak.rows[0] || {};
    const visitDenom = (m.total || 0) - (m.no_pin || 0);
    const inPct = visitDenom > 0 ? Math.round((1000 * (m.in_territory || 0)) / visitDenom) / 10 : null;
    const weakPct = w.total > 0 ? Math.round((1000 * (w.weak || 0)) / w.total) / 10 : null;

    res.json({
      owner,
      days,
      assignedPincodes: pins.length,
      visits: {
        total: m.total || 0,
        inTerritory: m.in_territory || 0,
        outside: m.outside || 0,
        noPin: m.no_pin || 0,
        inTerritoryPct: inPct,
      },
      leadsInTerritory: l.total || 0,
      precision: {
        leadsAccountsInPins: w.total || 0,
        weak: w.weak || 0,
        weakPct,
      },
    });
  } catch (e) {
    console.error('[meta/bdm-scorecard]', e);
    res.status(500).json({ error: e.message || 'bdm scorecard failed' });
  }
});

meta.get('/pincode', async (req, res) => {
  try {
    const pin = normalizePincode(req.query.pin);
    if (!pin) return res.status(400).json({ error: 'valid 6-digit pin required' });
    const { rows } = await q(
      'SELECT pincode, lat, lng FROM pincode_centroids WHERE pincode = $1',
      [pin],
    );
    if (!rows[0]) return res.status(404).json({ error: 'pincode not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('[meta/pincode]', e);
    res.status(500).json({ error: e.message || 'pincode lookup failed' });
  }
});

meta.get('/related-assets', async (req, res) => {
  try {
    const accountIds = parseList(req.query.accountIds || req.query.accountId);
    const qTerm = String(req.query.q || '').trim();
    if (!accountIds.length && qTerm.length < 2) {
      return res.status(400).json({ error: 'accountIds or q required' });
    }
    const payload = await fetchRelatedAssetsGeoJson({ accountIds, q: qTerm });
    res.json(payload);
  } catch (e) {
    console.error('[meta/related-assets]', e);
    res.status(500).json({ error: e.message || 'related assets failed' });
  }
});

meta.get('/search', async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (raw.length < 2) return res.status(400).json({ error: 'q min length 2' });
    const pin = normalizePincode(raw);
    const like = `%${raw.replace(/[%_]/g, '')}%`;
    const params = [];
    const clauses = [];
    if (pin) {
      params.push(pin);
      clauses.push(`pincode = $${params.length}`);
    }
    params.push(like);
    const i = params.length;
    clauses.push(`(source_id ILIKE $${i} OR title ILIKE $${i})`);
    const { rows } = await q(
      `SELECT layer, source_id AS id, title, pincode, lat, lng, precision,
         CASE WHEN layer = 'accounts' THEN (
           SELECT COUNT(*)::int FROM map_points ast
           WHERE ast.layer = 'assets'
             AND NULLIF(ast.extra->>'accountId', '') = map_points.source_id
             AND ast.geom IS NOT NULL
         ) END AS linked_assets
       FROM map_points
       WHERE ${sqlMapPointVisible()}
         AND lat IS NOT NULL AND lng IS NOT NULL AND precision <> 'none'
         AND (${clauses.join(' OR ')})
       ORDER BY
         CASE WHEN layer = 'accounts' THEN 0 ELSE 1 END,
         COALESCE((
           SELECT COUNT(*) FROM map_points ast
           WHERE ast.layer = 'assets'
             AND ast.extra->>'accountId' = map_points.source_id
             AND ast.geom IS NOT NULL
         ), 0) DESC,
         CASE WHEN source_id ILIKE $${i} THEN 0 WHEN title ILIKE $${i} THEN 1 ELSE 2 END,
         record_ts DESC NULLS LAST
       LIMIT 12`,
      params,
    );
    res.json({ q: raw, results: rows });
  } catch (e) {
    console.error('[meta/search]', e);
    res.status(500).json({ error: e.message || 'search failed' });
  }
});

meta.get('/stats', async (_req, res) => {
  try {
    const { rows } = await q(`
      SELECT layer, precision, COUNT(*)::int AS n
      FROM map_points
      WHERE ${sqlMapPointVisible()}
      GROUP BY layer, precision ORDER BY layer`);
    res.json(rows);
  } catch (e) {
    console.error('[meta/stats]', e);
    res.status(500).json({ error: e.message || 'stats failed' });
  }
});

meta.get('/filters', async (_req, res) => {
  try {
    // Ensure CRM users exist so role / active filters have options
    const count = await q(`SELECT COUNT(*)::int AS n FROM crm_users`);
    if (!count.rows[0]?.n) {
      try {
        await syncUsers();
      } catch (e) {
        console.warn('[meta/filters] users sync skipped:', e.message);
      }
    }

    const [owners, roles, sources, statuses, precisions, ownerDetails, rawTerritories] = await Promise.all([
      q(`SELECT DISTINCT owner_name FROM map_points
         WHERE owner_name IS NOT NULL AND owner_name <> '' ORDER BY 1`),
      q(`SELECT DISTINCT role_name FROM crm_users
         WHERE role_name IS NOT NULL AND role_name <> '' ORDER BY 1`),
      q(`SELECT DISTINCT extra->>'source' AS source FROM map_points
         WHERE layer = 'leads'
           AND extra->>'source' IS NOT NULL
           AND extra->>'source' <> ''
         ORDER BY 1`),
      q(`SELECT DISTINCT status FROM map_points
         WHERE status IS NOT NULL AND status <> '' ORDER BY 1`),
      q(`SELECT DISTINCT precision FROM map_points
         WHERE precision IS NOT NULL AND precision <> 'none' ORDER BY 1`),
      q(`
        SELECT u.full_name AS name, u.role_name AS role,
               CASE WHEN u.status = 'disabled' THEN 'inactive' ELSE 'active' END AS status
        FROM crm_users u
        WHERE u.full_name IS NOT NULL AND u.full_name <> ''
        ORDER BY u.full_name`),
      q(`SELECT DISTINCT territory FROM map_points
         WHERE territory IS NOT NULL AND territory <> '' ORDER BY 1`),
    ]);

    res.json({
      owners: owners.rows.map((r) => r.owner_name),
      ownerDetails: ownerDetails.rows,
      roles: roles.rows.map((r) => r.role_name),
      sources: sources.rows.map((r) => r.source),
      territoryGroups: TERRITORY_GROUP_KEYS,
      territories: rawTerritories.rows.map((r) => r.territory),
      userStatuses: ['active', 'inactive'],
      statuses: statuses.rows.map((r) => r.status),
      precisions: precisions.rows.map((r) => r.precision),
      markerStyle: await getMapMarkerStyle(),
      lastSuccessfulSyncAt: (await q(`
        SELECT finished_at FROM sync_runs
        WHERE status = 'ok' AND kind IN ('full', 'sync')
        ORDER BY finished_at DESC NULLS LAST
        LIMIT 1`)).rows[0]?.finished_at || null,
    });
  } catch (e) {
    console.error('[meta/filters]', e);
    res.status(500).json({ error: e.message || 'filters failed' });
  }
});

meta.post('/usage', (req, res) => {
  const sku = String(req.body?.sku || '').trim();
  if (!isClientSku(sku)) {
    return res.status(400).json({ error: 'sku not allowed' });
  }
  const units = Math.max(1, Math.min(20, Number(req.body?.units) || 1));
  recordUsage({ sku, provider: 'google', units, ok: true });
  res.json({ ok: true });
});

meta.get('/unplottable', async (_req, res) => {
  try {
    const { rows } = await q(`SELECT layer, COUNT(*)::int AS n
      FROM map_points WHERE precision='none' OR geom IS NULL GROUP BY layer`);
    res.json(rows);
  } catch (e) {
    console.error('[meta/unplottable]', e);
    res.status(500).json({ error: e.message || 'unplottable failed' });
  }
});
