import { Router } from 'express';
import { parse } from 'csv-parse/sync';
import { q } from '../db.js';
import { cfg } from '../config.js';
import { runFullSync, runRegeocode, runAssetsSync } from '../sync/sync.js';
import { refreshTerritoryCentroids } from '../geocode/pipeline.js';
import { rebuildDiscrepancies } from '../discrepancy/engine.js';
import { exchangeAuthCode, getAccessToken, zohoAuthStatus } from '../zoho/analyticsClient.js';
import { requireAdminWrite } from '../auth.js';
import { usageSummary, saveRates } from '../usage/meter.js';
import {
  listAccounts, createAccount, updateAccount,
} from '../accounts.js';

export const admin = Router();
// Auth is enforced app-wide by requireAuth; writes may also need ADMIN_TOKEN.
admin.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  return requireAdminWrite(req, res, next);
});

let job = null; // { id, kind, status, startedAt, result?, error? }

async function startJob(kind, fn) {
  if (job?.status === 'running') {
    const err = new Error('A job is already running');
    err.code = 'BUSY';
    throw err;
  }
  const run = await q(
    `INSERT INTO sync_runs (kind, status) VALUES ($1,'running') RETURNING id`, [kind]);
  const id = run.rows[0].id;
  job = { id, kind, status: 'running', startedAt: Date.now() };

  (async () => {
    try {
      const result = await fn();
      const durationMs = Date.now() - job.startedAt;
      await q(`UPDATE sync_runs SET status='ok', finished_at=now(), duration_ms=$2, stats=$3
               WHERE id=$1`, [id, durationMs, JSON.stringify(result || {})]);
      job = { ...job, status: 'ok', result, durationMs };
    } catch (e) {
      const durationMs = Date.now() - job.startedAt;
      await q(`UPDATE sync_runs SET status='error', finished_at=now(), duration_ms=$2, error=$3
               WHERE id=$1`, [id, durationMs, e.message]);
      job = { ...job, status: 'error', error: e.message, durationMs };
      console.error(`[admin] job ${kind} failed:`, e);
    }
  })();

  return { id, kind, status: 'running' };
}

admin.get('/dashboard', async (_req, res) => {
  const coverage = await q(`
    SELECT layer, precision, COUNT(*)::int AS n
    FROM map_points GROUP BY layer, precision ORDER BY layer, precision`);
  const cache = await q(`
    SELECT COUNT(*) FILTER (WHERE failed)::int AS failed,
           COUNT(*) FILTER (WHERE NOT failed)::int AS ok,
           COUNT(*)::int AS total
    FROM geocode_cache`);
  const unplot = await q(`
    SELECT layer, COUNT(*)::int AS n FROM map_points
    WHERE precision='none' OR geom IS NULL GROUP BY layer`);
  const lastRuns = await q(`
    SELECT id, kind, status, started_at, finished_at, duration_ms, stats, error
    FROM sync_runs ORDER BY started_at DESC LIMIT 10`);
  const pins = await q(`SELECT COUNT(*)::int AS n FROM pincode_centroids`);
  const terr = await q(`SELECT COUNT(*)::int AS n FROM territory_centroids`);

  res.json({
    coverage: coverage.rows,
    cache: cache.rows[0],
    unplottable: unplot.rows,
    lastRuns: lastRuns.rows,
    pincodeCentroids: pins.rows[0].n,
    territoryCentroids: terr.rows[0].n,
    geocoder: cfg.geocoder,
    hasGoogleKey: Boolean(cfg.googleKey),
    hasOlaKey: Boolean(cfg.olaKey),
    job,
  });
});

admin.get('/job', (_req, res) => res.json(job || { status: 'idle' }));

admin.get('/zoho/status', (_req, res) => {
  res.json(zohoAuthStatus());
});

/** Force access-token refresh from ZOHO_REFRESH_TOKEN. */
admin.post('/zoho/refresh', async (_req, res) => {
  try {
    await getAccessToken({ force: true });
    res.json(zohoAuthStatus());
  } catch (e) {
    res.status(e.coolingDown ? 429 : 502).json({
      error: e.message,
      zoho: e.zoho || null,
      ...zohoAuthStatus(),
    });
  }
});

/**
 * One-time re-auth: paste grant code from Zoho API console / OAuth consent.
 * Body: { code: "1000...." }
 * Saves new ZOHO_REFRESH_TOKEN to .env automatically.
 */
admin.post('/zoho/exchange-code', async (req, res) => {
  try {
    const code = (req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'body.code required' });
    const r = await exchangeAuthCode(code);
    res.json({ ...r, ...zohoAuthStatus() });
  } catch (e) {
    res.status(502).json({ error: e.message, zoho: e.zoho || null, ...zohoAuthStatus() });
  }
});

admin.post('/rebuild-discrepancies', async (_req, res) => {
  try {
    const j = await startJob('manual', () => rebuildDiscrepancies());
    res.status(202).json(j);
  } catch (e) {
    res.status(e.code === 'BUSY' ? 409 : 500).json({ error: e.message });
  }
});

admin.post('/sync', async (_req, res) => {
  try {
    const j = await startJob('full', () => runFullSync());
    res.status(202).json(j);
  } catch (e) {
    res.status(e.code === 'BUSY' ? 409 : 500).json({ error: e.message });
  }
});

/** Assets only — FSM address, then account shipping, billing, account inherit. */
admin.post('/sync/assets', async (_req, res) => {
  try {
    const j = await startJob('manual', () => runAssetsSync());
    res.status(202).json(j);
  } catch (e) {
    res.status(e.code === 'BUSY' ? 409 : 500).json({ error: e.message });
  }
});

admin.post('/regeocode', async (req, res) => {
  try {
    const clearFailed = req.body?.clearFailed !== false;
    const limitRows = Number(req.body?.limit) || 50000;
    const j = await startJob('regeocode', () => runRegeocode({ clearFailed, limitRows }));
    res.status(202).json(j);
  } catch (e) {
    res.status(e.code === 'BUSY' ? 409 : 500).json({ error: e.message });
  }
});

admin.post('/cache/clear-failed', async (_req, res) => {
  const r = await q(`DELETE FROM geocode_cache WHERE failed = TRUE`);
  res.json({ deleted: r.rowCount });
});

admin.post('/cache/clear-all', async (_req, res) => {
  const r = await q(`DELETE FROM geocode_cache`);
  res.json({ deleted: r.rowCount });
});

admin.get('/cache/sample', async (req, res) => {
  const failed = req.query.failed === '1';
  const { rows } = await q(`
    SELECT query, provider, lat, lng, confidence, failed, created_at
    FROM geocode_cache WHERE failed = $1
    ORDER BY created_at DESC LIMIT 50`, [failed]);
  res.json(rows);
});

admin.post('/territory-centroids/refresh', async (_req, res) => {
  await refreshTerritoryCentroids();
  const { rows } = await q(`SELECT COUNT(*)::int AS n FROM territory_centroids`);
  res.json({ territories: rows[0].n });
});

admin.patch('/points/:layer/:id', async (req, res) => {
  const { layer, id } = req.params;
  if (!['leads', 'accounts', 'meetings', 'assets'].includes(layer))
    return res.status(400).json({ error: 'unknown layer' });
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'lat and lng required' });
  if (lat < 6 || lat > 38 || lng < 68 || lng > 98)
    return res.status(400).json({ error: 'coordinates must be in India' });

  const notes = req.body?.notes || null;
  const r = await q(`
    UPDATE map_points SET
      lat=$3, lng=$4, precision='exact',
      geom = ST_SetSRID(ST_MakePoint($4::float8,$3::float8),4326),
      extra = COALESCE(extra,'{}'::jsonb) || jsonb_build_object('manual', true, 'manual_notes', $5::text),
      updated_at=now()
    WHERE layer=$1 AND source_id=$2
    RETURNING source_id, title, lat, lng, precision`, [layer, id, lat, lng, notes]);
  if (!r.rowCount) return res.status(404).json({ error: 'point not found' });
  await q(`DELETE FROM unplottable_log WHERE layer=$1 AND source_id=$2`, [layer, id]);
  res.json(r.rows[0]);
});

admin.post('/points/bulk', async (req, res) => {
  const text = req.body?.csv;
  if (!text || typeof text !== 'string')
    return res.status(400).json({ error: 'body.csv required (layer,source_id,lat,lng)' });
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  let ok = 0, fail = 0;
  const errors = [];
  for (const row of rows) {
    const layer = (row.layer || '').trim();
    const sourceId = String(row.source_id || row.id || '').trim();
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!['leads', 'accounts', 'meetings', 'assets'].includes(layer) || !sourceId
        || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      fail++; errors.push({ sourceId, error: 'bad row' }); continue;
    }
    try {
      const r = await q(`
        UPDATE map_points SET lat=$3, lng=$4, precision='exact',
          geom=ST_SetSRID(ST_MakePoint($4::float8,$3::float8),4326),
          extra = COALESCE(extra,'{}'::jsonb) || '{"manual":true}'::jsonb,
          updated_at=now()
        WHERE layer=$1 AND source_id=$2`, [layer, sourceId, lat, lng]);
      if (r.rowCount) {
        await q(`DELETE FROM unplottable_log WHERE layer=$1 AND source_id=$2`, [layer, sourceId]);
        ok++;
      } else { fail++; errors.push({ sourceId, error: 'not found' }); }
    } catch (e) {
      fail++; errors.push({ sourceId, error: e.message });
    }
  }
  res.json({ ok, fail, errors: errors.slice(0, 50) });
});

admin.post('/gaps/:layer/:id/review', async (req, res) => {
  const { layer, id } = req.params;
  const notes = req.body?.notes || null;
  const r = await q(`
    INSERT INTO unplottable_log (layer, source_id, reason, reviewed_at, admin_notes)
    VALUES ($1,$2,'reviewed',now(),$3)
    ON CONFLICT (layer, source_id) DO UPDATE SET
      reviewed_at=now(), admin_notes=COALESCE($3, unplottable_log.admin_notes)
    RETURNING *`, [layer, id, notes]);
  res.json(r.rows[0]);
});

admin.get('/points/search', async (req, res) => {
  const qtext = (req.query.q || '').trim();
  const layer = req.query.layer;
  if (!qtext) return res.json([]);
  const params = [`%${qtext}%`];
  let sql = `
    SELECT layer, source_id, title, owner_name, territory, precision, lat, lng, crm_url, address_raw, pincode
    FROM map_points
    WHERE (title ILIKE $1 OR source_id ILIKE $1 OR address_raw ILIKE $1)`;
  if (layer) { params.push(layer); sql += ` AND layer=$${params.length}`; }
  sql += ` ORDER BY updated_at DESC LIMIT 40`;
  const { rows } = await q(sql, params);
  res.json(rows);
});

admin.get('/usage', async (_req, res) => {
  try {
    const summary = await usageSummary();
    const failed = await q(`SELECT COUNT(*)::int AS n FROM geocode_cache WHERE failed = TRUE`);
    const geoRate = summary.rates.skus.geocoding || 0;
    const regeocodeUnits = (failed.rows[0]?.n || 0);
    res.json({
      ...summary,
      estimates: {
        failedCache: failed.rows[0]?.n || 0,
        regeocodeUsd: (regeocodeUnits * geoRate) / 1000,
        regeocodeInr: ((regeocodeUnits * geoRate) / 1000) * summary.rates.usdInr,
      },
    });
  } catch (e) {
    console.error('[admin/usage]', e);
    res.status(500).json({ error: e.message || 'usage failed' });
  }
});

admin.post('/usage/rates', async (req, res) => {
  try {
    const rates = await saveRates(req.body || {});
    res.json({ ok: true, rates });
  } catch (e) {
    console.error('[admin/usage/rates]', e);
    res.status(500).json({ error: e.message || 'save rates failed' });
  }
});

admin.get('/users', async (_req, res) => {
  try {
    res.json({ users: await listAccounts() });
  } catch (e) {
    console.error('[admin/users]', e);
    res.status(500).json({ error: e.message || 'users failed' });
  }
});

admin.post('/users', async (req, res) => {
  try {
    const user = await createAccount({
      email: req.body?.email,
      name: req.body?.name,
      password: req.body?.password,
      isAdmin: Boolean(req.body?.isAdmin),
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'create user failed' });
  }
});

admin.patch('/users/:id', async (req, res) => {
  try {
    if (req.user?.id && String(req.user.id) === String(req.params.id) && req.body?.active === false) {
      return res.status(400).json({ error: 'cannot disable your own account' });
    }
    const user = await updateAccount(req.params.id, {
      name: req.body?.name,
      isAdmin: req.body?.isAdmin,
      active: req.body?.active,
      password: req.body?.password,
    });
    res.json({ ok: true, user });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'update user failed' });
  }
});
