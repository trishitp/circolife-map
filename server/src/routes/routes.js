// Smart Route Planning APIs.
import { Router } from 'express';
import { loadCandidates, loadNearby } from '../routing/candidates.js';
import { optimizeRoute } from '../routing/optimize.js';
import {
  getPlan, upsertPlan, deletePlan, ensureShareToken, getPlanByShareToken,
} from '../routing/plans.js';

export const routes = Router();
/** Public share view — mount before requireAuth */
export const routesShare = Router();

const dateOk = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

routes.get('/candidates', async (req, res) => {
  try {
    const owner = (req.query.owner || '').trim();
    const date = (req.query.date || '').trim();
    if (!owner) return res.status(400).json({ error: 'owner is required' });
    if (!dateOk(date)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    const territory = (req.query.territory || '').trim() || null;
    const source = (req.query.source || '').trim() || null;
    const nearLat = req.query.nearLat != null ? Number(req.query.nearLat) : null;
    const nearLng = req.query.nearLng != null ? Number(req.query.nearLng) : null;
    const radiusKm = req.query.radiusKm != null ? Number(req.query.radiusKm) : 3;
    const data = await loadCandidates({
      owner, date, territory, source, nearLat, nearLng, radiusKm,
    });
    res.json(data);
  } catch (e) {
    console.error('[routes/candidates]', e);
    res.status(400).json({ error: e.message || 'candidates failed' });
  }
});

routes.get('/nearby', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }
    const radiusKm = req.query.radiusKm != null ? Number(req.query.radiusKm) : 3;
    const layers = (req.query.layers || 'leads,accounts').split(',').map((s) => s.trim());
    const owner = (req.query.owner || '').trim() || null;
    const territory = (req.query.territory || '').trim() || null;
    const source = (req.query.source || '').trim() || null;
    const data = await loadNearby({ lat, lng, radiusKm, layers, owner, territory, source });
    res.json(data);
  } catch (e) {
    console.error('[routes/nearby]', e);
    res.status(400).json({ error: e.message || 'nearby failed' });
  }
});

routes.post('/optimize', async (req, res) => {
  try {
    const body = req.body || {};
    const stops = Array.isArray(body.stops) ? body.stops : [];
    if (!stops.length) return res.status(400).json({ error: 'stops[] required' });
    const result = await optimizeRoute({
      origin: body.origin || null,
      stops,
      departureTime: body.departureTime || null,
    });
    res.json(result);
  } catch (e) {
    console.error('[routes/optimize]', e.message);
    res.status(e.status || 500).json({
      error: e.message || 'optimize failed',
      detail: e.detail || undefined,
    });
  }
});

routes.get('/plans/:owner/:date', async (req, res) => {
  try {
    const owner = decodeURIComponent(req.params.owner || '').trim();
    const date = (req.params.date || '').trim();
    if (!owner || !dateOk(date)) {
      return res.status(400).json({ error: 'owner and date (YYYY-MM-DD) required' });
    }
    const plan = await getPlan(owner, date);
    if (!plan) return res.status(404).json({ error: 'no saved plan' });
    res.json(plan);
  } catch (e) {
    console.error('[routes/plans GET]', e);
    res.status(500).json({ error: e.message || 'load plan failed' });
  }
});

routes.put('/plans/:owner/:date', async (req, res) => {
  try {
    const owner = decodeURIComponent(req.params.owner || '').trim();
    const date = (req.params.date || '').trim();
    if (!owner || !dateOk(date)) {
      return res.status(400).json({ error: 'owner and date (YYYY-MM-DD) required' });
    }
    const body = req.body || {};
    const plan = await upsertPlan({
      owner,
      planDate: date,
      originLat: body.originLat ?? body.origin?.lat,
      originLng: body.originLng ?? body.origin?.lng,
      originLabel: body.originLabel ?? body.origin?.label,
      stops: body.stops || [],
      polyline: body.polyline || null,
      totals: body.totals || {},
    });
    res.json(plan);
  } catch (e) {
    console.error('[routes/plans PUT]', e);
    res.status(500).json({ error: e.message || 'save plan failed' });
  }
});

routes.delete('/plans/:owner/:date', async (req, res) => {
  try {
    const owner = decodeURIComponent(req.params.owner || '').trim();
    const date = (req.params.date || '').trim();
    if (!owner || !dateOk(date)) {
      return res.status(400).json({ error: 'owner and date required' });
    }
    const n = await deletePlan(owner, date);
    res.json({ deleted: n });
  } catch (e) {
    console.error('[routes/plans DELETE]', e);
    res.status(500).json({ error: e.message || 'delete plan failed' });
  }
});

/**
 * Save latest plan body (optional) and mint share link for RM mobile view.
 * Body: same as PUT plan (stops, origin, polyline, totals).
 */
routes.post('/plans/:owner/:date/share', async (req, res) => {
  try {
    const owner = decodeURIComponent(req.params.owner || '').trim();
    const date = (req.params.date || '').trim();
    if (!owner || !dateOk(date)) {
      return res.status(400).json({ error: 'owner and date (YYYY-MM-DD) required' });
    }
    const body = req.body || {};
    if (Array.isArray(body.stops) && body.stops.length) {
      await upsertPlan({
        owner,
        planDate: date,
        originLat: body.originLat ?? body.origin?.lat,
        originLng: body.originLng ?? body.origin?.lng,
        originLabel: body.originLabel ?? body.origin?.label,
        stops: body.stops,
        polyline: body.polyline || null,
        totals: body.totals || {},
      });
    }
    let plan = await ensureShareToken(owner, date);
    if (!plan) {
      return res.status(404).json({ error: 'save the plan with at least one stop first' });
    }
    if (!plan.share_token) {
      plan = await ensureShareToken(owner, date);
    }
    if (!plan?.share_token) {
      return res.status(500).json({ error: 'could not create share link' });
    }
    res.json({
      owner_name: plan.owner_name,
      plan_date: plan.plan_date,
      shareToken: plan.share_token,
      path: `/#/r/${plan.share_token}`,
      stops: plan.stops?.length || 0,
      updated_at: plan.updated_at,
    });
  } catch (e) {
    console.error('[routes/plans SHARE]', e);
    res.status(500).json({ error: e.message || 'share failed' });
  }
});

function publicPlanPayload(plan) {
  const stops = Array.isArray(plan.stops) ? plan.stops : [];
  return {
    owner_name: plan.owner_name,
    plan_date: plan.plan_date,
    origin: plan.origin_lat != null ? {
      lat: plan.origin_lat,
      lng: plan.origin_lng,
      label: plan.origin_label || 'Start',
    } : null,
    stops: stops.map((s, i) => ({
      id: s.id || `stop-${i}`,
      order: s.order || i + 1,
      title: s.title || s.name || 'Stop',
      layer: s.layer || null,
      sourceId: s.sourceId || s.source_id || null,
      lat: s.lat,
      lng: s.lng,
      precision: s.precision || null,
      scheduledAt: s.scheduledAt || s.scheduled_at || null,
      eta: s.eta || null,
      address: s.address || s.address_raw || null,
      crmUrl: s.crmUrl || s.crm_url || null,
      kind: s.kind || null,
    })),
    polyline: plan.polyline || null,
    totals: plan.totals || {},
    updated_at: plan.updated_at,
  };
}

routesShare.get('/:token', async (req, res) => {
  try {
    const token = (req.params.token || '').trim();
    const plan = await getPlanByShareToken(token);
    if (!plan) return res.status(404).json({ error: 'route link expired or not found' });
    res.json(publicPlanPayload(plan));
  } catch (e) {
    console.error('[routes/share GET]', e);
    res.status(500).json({ error: e.message || 'load shared route failed' });
  }
});
