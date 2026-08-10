// Persist / load draft day route plans + share tokens.
import crypto from 'node:crypto';
import { q } from '../db.js';

const PLAN_SELECT = `owner_name, plan_date::text AS plan_date,
            origin_lat, origin_lng, origin_label,
            stops, polyline, totals, share_token, updated_at`;

export async function getPlan(owner, planDate) {
  const { rows } = await q(
    `SELECT ${PLAN_SELECT}
     FROM route_plans
     WHERE owner_name = $1 AND plan_date = $2::date`,
    [owner, planDate],
  );
  return rows[0] || null;
}

export async function getPlanByShareToken(token) {
  const t = (token || '').trim();
  if (!t || t.length < 16) return null;
  const { rows } = await q(
    `SELECT ${PLAN_SELECT}
     FROM route_plans
     WHERE share_token = $1`,
    [t],
  );
  return rows[0] || null;
}

export async function upsertPlan({
  owner, planDate, originLat, originLng, originLabel, stops, polyline, totals,
}) {
  const { rows } = await q(
    `INSERT INTO route_plans
       (owner_name, plan_date, origin_lat, origin_lng, origin_label,
        stops, polyline, totals, updated_at)
     VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, $8::jsonb, now())
     ON CONFLICT (owner_name, plan_date) DO UPDATE SET
       origin_lat = EXCLUDED.origin_lat,
       origin_lng = EXCLUDED.origin_lng,
       origin_label = EXCLUDED.origin_label,
       stops = EXCLUDED.stops,
       polyline = EXCLUDED.polyline,
       totals = EXCLUDED.totals,
       updated_at = now()
     RETURNING ${PLAN_SELECT}`,
    [
      owner,
      planDate,
      originLat ?? null,
      originLng ?? null,
      originLabel || null,
      JSON.stringify(stops || []),
      polyline || null,
      JSON.stringify(totals || {}),
    ],
  );
  return rows[0];
}

/**
 * Ensure plan exists and has a share_token. Saves latest draft first when body provided via upsert separately.
 */
export async function ensureShareToken(owner, planDate) {
  const existing = await getPlan(owner, planDate);
  if (!existing) return null;
  if (existing.share_token) return existing;

  // Unique collision retry (extremely rare)
  for (let i = 0; i < 3; i++) {
    const token = crypto.randomBytes(18).toString('base64url');
    try {
      const { rows } = await q(
        `UPDATE route_plans
            SET share_token = $3, updated_at = now()
          WHERE owner_name = $1 AND plan_date = $2::date
            AND share_token IS NULL
          RETURNING ${PLAN_SELECT}`,
        [owner, planDate, token],
      );
      if (rows[0]) return rows[0];
      const again = await getPlan(owner, planDate);
      if (again?.share_token) return again;
    } catch (e) {
      if (e.code !== '23505') throw e;
    }
  }
  return getPlan(owner, planDate);
}

export async function rotateShareToken(owner, planDate) {
  const token = crypto.randomBytes(18).toString('base64url');
  const { rows } = await q(
    `UPDATE route_plans
        SET share_token = $3, updated_at = now()
      WHERE owner_name = $1 AND plan_date = $2::date
      RETURNING ${PLAN_SELECT}`,
    [owner, planDate, token],
  );
  return rows[0] || null;
}

export async function deletePlan(owner, planDate) {
  const r = await q(
    `DELETE FROM route_plans WHERE owner_name = $1 AND plan_date = $2::date`,
    [owner, planDate],
  );
  return r.rowCount || 0;
}
