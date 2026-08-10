// Build address_discrepancies from location_signals.
// Thresholds: watch ≥ 1 km, alert ≥ 3 km; pin mismatch alone → at least watch.
import { q } from '../db.js';

export const WATCH_KM = 1;
export const ALERT_KM = 3;

const SOURCES = ['mmi', 'billing', 'shipping', 'checkin'];
export const PAIR_LABELS = {
  mmi_billing: 'MMI vs billing',
  mmi_shipping: 'MMI vs shipping',
  billing_shipping: 'Billing vs shipping',
  mmi_checkin: 'MMI vs check-in',
  billing_checkin: 'Billing vs check-in',
  shipping_checkin: 'Shipping vs check-in',
};

/** Haversine distance in km. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasCoords(s) {
  return s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng));
}

function pickPrimarySignals(rows) {
  const by = { mmi: null, billing: null, shipping: null, checkin: null };
  const checkins = [];
  for (const r of rows) {
    if (r.source === 'checkin') {
      checkins.push(r);
      continue;
    }
    const prev = by[r.source];
    if (!prev || (hasCoords(r) && !hasCoords(prev))) by[r.source] = r;
  }
  if (checkins.length) {
    checkins.sort((a, b) => {
      const ta = a.record_ts ? new Date(a.record_ts).getTime() : 0;
      const tb = b.record_ts ? new Date(b.record_ts).getTime() : 0;
      return tb - ta;
    });
    by.checkin = checkins.find(hasCoords) || checkins[0];
  }
  return { by, checkinCount: checkins.length };
}

function severityFrom({ maxSpreadKm, pinMismatch }) {
  if (maxSpreadKm != null && maxSpreadKm >= ALERT_KM) return 'alert';
  if (maxSpreadKm != null && maxSpreadKm >= WATCH_KM) return 'watch';
  if (pinMismatch) return 'watch';
  return 'ok';
}

/**
 * Rebuild all address_discrepancies from location_signals + map_points metadata.
 */
export async function rebuildDiscrepancies() {
  const t = Date.now();
  const { rows: allSigs } = await q(`
    SELECT entity_layer, entity_id, source, address_text, pincode, lat, lng,
           precision, meeting_id, record_ts
    FROM location_signals`);

  const byEntity = new Map();
  for (const s of allSigs) {
    const key = `${s.entity_layer}\0${s.entity_id}`;
    if (!byEntity.has(key)) byEntity.set(key, []);
    byEntity.get(key).push(s);
  }

  const metaMap = new Map((await q(`
    SELECT layer, source_id, title, owner_name, territory, crm_url
    FROM map_points WHERE layer IN ('leads','accounts')`)).rows
    .map((r) => [`${r.layer}\0${r.source_id}`, r]));

  await q(`TRUNCATE address_discrepancies`);

  let written = 0;
  for (const [key, sigs] of byEntity) {
    const [entity_layer, entity_id] = key.split('\0');
    const meta = metaMap.get(key) || {};
    const { by, checkinCount } = pickPrimarySignals(sigs);
    const located = SOURCES.filter((s) => hasCoords(by[s]));
    if (located.length === 0 && !sigs.some((s) => s.pincode || s.address_text)) continue;

    const pairKm = {};
    const pairs = [
      ['mmi', 'billing', 'mmi_billing'],
      ['mmi', 'shipping', 'mmi_shipping'],
      ['billing', 'shipping', 'billing_shipping'],
      ['mmi', 'checkin', 'mmi_checkin'],
      ['billing', 'checkin', 'billing_checkin'],
      ['shipping', 'checkin', 'shipping_checkin'],
    ];
    let maxSpreadKm = null;
    let worstPair = null;
    for (const [a, b, name] of pairs) {
      if (!hasCoords(by[a]) || !hasCoords(by[b])) {
        pairKm[name] = null;
        continue;
      }
      const km = haversineKm(
        Number(by[a].lat), Number(by[a].lng),
        Number(by[b].lat), Number(by[b].lng),
      );
      pairKm[name] = km != null ? Math.round(km * 1000) / 1000 : null;
      if (pairKm[name] != null && (maxSpreadKm == null || pairKm[name] > maxSpreadKm)) {
        maxSpreadKm = pairKm[name];
        worstPair = name;
      }
    }

    const pins = SOURCES
      .map((s) => by[s]?.pincode)
      .filter((p) => p && /^[1-9]\d{5}$/.test(String(p)));
    const uniquePins = new Set(pins);
    const pinMismatch = uniquePins.size > 1;

    const present = SOURCES.filter((s) => {
      const x = by[s];
      return x && (hasCoords(x) || x.address_text || x.pincode);
    });
    const missing = SOURCES.filter((s) => !present.includes(s));
    const severity = severityFrom({ maxSpreadKm, pinMismatch });

    const flags = {
      present,
      missing,
      pinMismatch,
      uniquePins: [...uniquePins],
      checkinCount,
      sourceCountWithCoords: located.length,
      thresholds: { watchKm: WATCH_KM, alertKm: ALERT_KM },
    };

    const m = by.mmi, b = by.billing, sh = by.shipping, c = by.checkin;
    await q(`
      INSERT INTO address_discrepancies (
        entity_layer, entity_id, title, owner_name, territory, crm_url,
        mmi_lat, mmi_lng, mmi_address, mmi_pincode, mmi_precision,
        billing_lat, billing_lng, billing_address, billing_pincode, billing_precision,
        shipping_lat, shipping_lng, shipping_address, shipping_pincode, shipping_precision,
        checkin_lat, checkin_lng, checkin_meeting_id, checkin_precision, checkin_record_ts,
        mmi_billing_km, mmi_shipping_km, billing_shipping_km,
        mmi_checkin_km, billing_checkin_km, shipping_checkin_km,
        max_spread_km, worst_pair, severity, flags, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,
        $17,$18,$19,$20,$21,
        $22,$23,$24,$25,$26,
        $27,$28,$29,$30,$31,$32,
        $33,$34,$35,$36, now()
      )`, [
      entity_layer, entity_id,
      meta.title || null, meta.owner_name || null, meta.territory || null, meta.crm_url || null,
      m?.lat ?? null, m?.lng ?? null, m?.address_text ?? null, m?.pincode ?? null, m?.precision ?? null,
      b?.lat ?? null, b?.lng ?? null, b?.address_text ?? null, b?.pincode ?? null, b?.precision ?? null,
      sh?.lat ?? null, sh?.lng ?? null, sh?.address_text ?? null, sh?.pincode ?? null, sh?.precision ?? null,
      c?.lat ?? null, c?.lng ?? null, c?.meeting_id ?? null, c?.precision ?? null, c?.record_ts ?? null,
      pairKm.mmi_billing, pairKm.mmi_shipping, pairKm.billing_shipping,
      pairKm.mmi_checkin, pairKm.billing_checkin, pairKm.shipping_checkin,
      maxSpreadKm, worstPair ? PAIR_LABELS[worstPair] || worstPair : null, severity, flags,
    ]);
    written++;
  }

  const durationMs = Date.now() - t;
  console.log(`[discrepancies] rebuilt ${written} entities in ${durationMs}ms`);
  return { entities: written, durationMs };
}
