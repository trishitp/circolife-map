// Usage meter for third-party map APIs. Fire-and-forget inserts; never block callers.
import { q } from '../db.js';

/**
 * Google Maps Platform list prices (USD per 1,000), Essentials / Pro as used here.
 * Traffic-aware Compute Routes is Pro. Override via env or Admin rate card.
 * 2D map tiles (~$0.60/1k) are fetched in the browser — not counted here.
 */
export const SKU_CATALOG = {
  geocoding: {
    label: 'Geocoding (Google)',
    provider: 'google',
    usdPer1000: 5,
    note: 'Billed per request, including ZERO_RESULTS. Cache hits are free.',
  },
  geocoding_ola: {
    label: 'Geocoding (Ola Maps)',
    provider: 'olamaps',
    usdPer1000: 0,
    note: 'Set a rate if you have an Ola Maps contract.',
  },
  routes: {
    label: 'Routes — Compute Routes (traffic)',
    provider: 'google',
    usdPer1000: 10,
    note: 'Pro SKU because we request TRAFFIC_AWARE.',
  },
  directions: {
    label: 'Directions API (legacy fallback)',
    provider: 'google',
    usdPer1000: 5,
  },
  maps_js_load: {
    label: 'Dynamic Maps (Maps JS load)',
    provider: 'google',
    usdPer1000: 7,
    note: 'Activity / Routes walk map. One load per browser session.',
  },
  map_tiles_session: {
    label: 'Map Tiles session',
    provider: 'google',
    usdPer1000: 0,
    note: 'Session create is not billed. 2D tiles are billed in Google Cloud.',
  },
  map_tiles_viewport: {
    label: 'Map Tiles viewport',
    provider: 'google',
    usdPer1000: 0,
    note: 'Copyright ping; typically not billed.',
  },
};

const CLIENT_SKUS = new Set(['maps_js_load']);

function envRate(sku, fallback) {
  const key = `PRICE_${String(sku).toUpperCase()}_PER_1K`;
  const raw = process.env[key];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function defaultRates() {
  const skus = {};
  for (const [id, spec] of Object.entries(SKU_CATALOG)) {
    skus[id] = envRate(id, spec.usdPer1000);
  }
  const usdInr = Number(process.env.USD_INR || 87);
  return {
    usdInr: Number.isFinite(usdInr) && usdInr > 0 ? usdInr : 87,
    skus,
  };
}

export async function loadRates() {
  const base = defaultRates();
  try {
    const r = await q(`SELECT value FROM app_settings WHERE key = 'api_rates'`);
    const saved = r.rows[0]?.value;
    if (!saved || typeof saved !== 'object') return base;
    const usdInr = Number(saved.usdInr);
    const skus = { ...base.skus };
    if (saved.skus && typeof saved.skus === 'object') {
      for (const [id, v] of Object.entries(saved.skus)) {
        if (!(id in SKU_CATALOG)) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 500) skus[id] = n;
      }
    }
    return {
      usdInr: Number.isFinite(usdInr) && usdInr > 0 && usdInr <= 500 ? usdInr : base.usdInr,
      skus,
    };
  } catch (e) {
    console.warn('[usage] loadRates:', e.message);
    return base;
  }
}

export async function saveRates(body = {}) {
  const base = defaultRates();
  const usdInr = Number(body.usdInr);
  const skus = { ...base.skus };
  if (body.skus && typeof body.skus === 'object') {
    for (const [id, v] of Object.entries(body.skus)) {
      if (!(id in SKU_CATALOG)) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0 && n <= 500) skus[id] = n;
    }
  }
  const next = {
    usdInr: Number.isFinite(usdInr) && usdInr > 0 && usdInr <= 500 ? usdInr : base.usdInr,
    skus,
  };
  await q(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('api_rates', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

export function recordUsage({ sku, provider, units = 1, ok = true, meta = null } = {}) {
  if (!sku) return;
  const spec = SKU_CATALOG[sku];
  const n = Math.max(0, Math.round(Number(units) || 0));
  if (!n) return;
  q(
    `INSERT INTO api_usage (sku, provider, units, ok, meta)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      sku,
      provider || spec?.provider || 'google',
      n,
      ok !== false,
      meta ? JSON.stringify(meta) : null,
    ],
  ).catch((e) => console.warn('[usage] insert failed:', e.message));
}

export function isClientSku(sku) {
  return CLIENT_SKUS.has(sku);
}

function costUsd(units, per1k) {
  return (Number(units) || 0) * (Number(per1k) || 0) / 1000;
}

export async function usageSummary() {
  const rates = await loadRates();
  const rows = await q(`
    SELECT sku,
           COUNT(*) FILTER (WHERE occurred_at >= (date_trunc('day', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata'))::int AS calls_today,
           COALESCE(SUM(units) FILTER (WHERE occurred_at >= (date_trunc('day', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata')), 0)::int AS units_today,
           COUNT(*)::int AS calls_month,
           COALESCE(SUM(units), 0)::int AS units_month
    FROM api_usage
    WHERE occurred_at >= (date_trunc('month', timezone('Asia/Kolkata', now())) AT TIME ZONE 'Asia/Kolkata')
    GROUP BY sku
  `);
  const days = await q(`
    SELECT (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
           sku,
           COALESCE(SUM(units), 0)::int AS units
    FROM api_usage
    WHERE occurred_at >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 13
    GROUP BY 1, 2
    ORDER BY 1
  `);

  const bySku = Object.keys(SKU_CATALOG).map((id) => {
    const hit = rows.rows.find((r) => r.sku === id) || {};
    const unitsToday = hit.units_today || 0;
    const unitsMonth = hit.units_month || 0;
    const per1k = rates.skus[id] ?? 0;
    return {
      sku: id,
      label: SKU_CATALOG[id].label,
      note: SKU_CATALOG[id].note || '',
      usdPer1000: per1k,
      callsToday: hit.calls_today || 0,
      unitsToday,
      callsMonth: hit.calls_month || 0,
      unitsMonth,
      usdToday: costUsd(unitsToday, per1k),
      usdMonth: costUsd(unitsMonth, per1k),
    };
  });

  const usdToday = bySku.reduce((a, s) => a + s.usdToday, 0);
  const usdMonth = bySku.reduce((a, s) => a + s.usdMonth, 0);

  return {
    rates,
    catalog: Object.fromEntries(
      Object.entries(SKU_CATALOG).map(([id, spec]) => [id, {
        label: spec.label,
        note: spec.note || '',
        defaultUsdPer1000: spec.usdPer1000,
      }]),
    ),
    bySku,
    totals: {
      usdToday,
      usdMonth,
      inrToday: usdToday * rates.usdInr,
      inrMonth: usdMonth * rates.usdInr,
      unitsToday: bySku.reduce((a, s) => a + s.unitsToday, 0),
      unitsMonth: bySku.reduce((a, s) => a + s.unitsMonth, 0),
    },
    days: days.rows,
    notes: [
      'Estimates from this app’s own logs — not a Google Cloud invoice.',
      'Map Tiles 2D (~$0.60 / 1,000 tiles) are requested by the browser and are not counted here.',
      'Geocode cache hits never call the provider.',
    ],
  };
}
