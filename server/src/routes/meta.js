import { Router } from 'express';
import { q } from '../db.js';
import { cfg } from '../config.js';
import { TERRITORY_GROUP_KEYS } from '../filters/mapFilters.js';
import { syncUsers } from '../sync/sync.js';
import { recordUsage, isClientSku } from '../usage/meter.js';

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

// GET /api/meta/maps — Google Map Tiles session for the web basemap
meta.get('/maps', async (_req, res) => {
  try {
    if (!cfg.googleKey) {
      return res.json({ enabled: false, provider: null });
    }
    const session = await createGoogleTileSession();
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
    if (!cfg.googleKey) return res.status(503).json({ error: 'GOOGLE_MAPS_API_KEY not configured' });
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
meta.get('/stats', async (_req, res) => {
  try {
    const { rows } = await q(`
      SELECT layer, precision, COUNT(*)::int AS n
      FROM map_points GROUP BY layer, precision ORDER BY layer`);
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
