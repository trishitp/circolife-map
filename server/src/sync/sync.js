// Batch sync: Zoho Analytics -> Postgres. Run via CLI (`npm run sync`) or Admin API.
// Geocode calls are concurrency-limited; cache makes re-runs near-free.
// Also writes location_signals (mmi / billing / shipping / checkin) and rebuilds
// address_discrepancies after leads/accounts/meetings.
import { parse } from 'csv-parse/sync';
import pLimit from 'p-limit';
import { q } from '../db.js';
import { exportSql } from '../zoho/analyticsClient.js';
import { cfg } from '../config.js';
import {
  LEADS_SQL, ACCOUNTS_SQL, MEETINGS_SQL, ASSETS_SQL, USERS_SQL,
  FSM_ADDRESSES_SQL, FSM_COMPANIES_SQL, ACCOUNT_ADDRESS_SQL,
} from './extractQueries.js';
import { resolvePoint, refreshTerritoryCentroids } from '../geocode/pipeline.js';
import {
  cleanText, cleanPlace, normalizePincode, usableStreet, composeStreet,
  buildFullAddress, parseCoords, isLowPrecisionCoord, inIndia,
} from '../geocode/address.js';
import { rebuildDiscrepancies } from '../discrepancy/engine.js';

const limit = pLimit(5);
const csv = (text) => parse(text, { columns: true, skip_empty_lines: true, bom: true });
const col = (r, ...keys) => keys.map((k) => r[k]).find((v) => v != null && String(v).trim() !== '');
/** First non-empty cleaned place from candidate keys/values. */
const firstPlace = (...vals) => {
  for (const v of vals) {
    const t = cleanPlace(v);
    if (t) return t;
  }
  return '';
};

async function upsert(p) {
  await q(`
    INSERT INTO map_points (layer, source_id, title, owner_name, territory, status,
      record_ts, address_raw, pincode, lat, lng, precision, geom, crm_url, extra, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
      CASE WHEN $10::float8 IS NULL THEN NULL
           ELSE ST_SetSRID(ST_MakePoint($11::float8,$10::float8),4326) END,
      $13,$14,now())
    ON CONFLICT (layer, source_id) DO UPDATE SET
      title=EXCLUDED.title, owner_name=EXCLUDED.owner_name, territory=EXCLUDED.territory,
      status=EXCLUDED.status, record_ts=EXCLUDED.record_ts, address_raw=EXCLUDED.address_raw,
      pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
      precision=EXCLUDED.precision, geom=EXCLUDED.geom, crm_url=EXCLUDED.crm_url,
      extra=EXCLUDED.extra, updated_at=now()`,
    [p.layer, p.sourceId, p.title, p.owner, p.territory, p.status, p.recordTs,
     p.address, p.pincode, p.lat, p.lng, p.precision, p.crmUrl, p.extra ?? {}]);

  if (p.precision === 'none') {
    await q(`INSERT INTO unplottable_log
               (layer, source_id, reason, title, owner_name, territory, crm_url, address_raw, pincode)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (layer, source_id) DO UPDATE SET
               reason=EXCLUDED.reason, title=EXCLUDED.title, owner_name=EXCLUDED.owner_name,
               territory=EXCLUDED.territory, crm_url=EXCLUDED.crm_url,
               address_raw=EXCLUDED.address_raw, pincode=EXCLUDED.pincode,
               logged_at=now()`,
            [p.layer, p.sourceId, p.reason || 'no usable address or pincode',
             p.title, p.owner, p.territory, p.crmUrl, p.address, p.pincode]);
  } else {
    await q(`DELETE FROM unplottable_log WHERE layer=$1 AND source_id=$2`, [p.layer, p.sourceId]);
  }
}

/** Upsert a non-checkin signal (mmi / billing / shipping). */
async function upsertSignal({
  entityLayer, entityId, source, addressText, pincode, lat, lng, precision, meetingId, recordTs,
}) {
  if (!entityLayer || !entityId || !source) return;
  // Skip empty shells with nothing useful
  if (lat == null && lng == null && !addressText && !pincode) return;
  await q(`
    INSERT INTO location_signals (
      entity_layer, entity_id, source, address_text, pincode, lat, lng, precision,
      meeting_id, record_ts, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
    ON CONFLICT (entity_layer, entity_id, source, meeting_id)
    DO UPDATE SET
      address_text=EXCLUDED.address_text, pincode=EXCLUDED.pincode,
      lat=EXCLUDED.lat, lng=EXCLUDED.lng, precision=EXCLUDED.precision,
      record_ts=EXCLUDED.record_ts, updated_at=now()`,
    [entityLayer, entityId, source, addressText || null, pincode || null,
     lat ?? null, lng ?? null, precision || 'none', meetingId || '', recordTs || null]);
}

/**
 * Resolve coordinates for a text address source without MMI coords.
 * Uses the full address (street + street2 + city + state + pin + country).
 */
async function resolveAddressSource({
  street, street2, city, state, country, pincode, cityHint, territory,
}) {
  const address = buildFullAddress({
    street, street2, city, state, pincode, country, territory, cityHint,
  }) || null;
  const streetLine = composeStreet(street, street2);
  if (!streetLine && !pincode) {
    return {
      lat: null, lng: null, precision: 'none',
      address, pincode: pincode || null,
    };
  }
  const geo = await resolvePoint({
    street: street || null,
    street2: street2 || null,
    city: city || cityHint || null,
    state: state || null,
    country: country || null,
    pincode: pincode || null,
    cityHint: cityHint || territory || null,
    territory: territory || null,
  });
  return {
    lat: geo.lat, lng: geo.lng, precision: geo.precision,
    address, pincode: pincode || null,
  };
}

function mmiFromRow(sLat, sLng) {
  const coords = parseCoords(sLat, sLng);
  if (!coords) return { lat: null, lng: null, precision: 'none' };
  const approx = isLowPrecisionCoord(sLat, sLng);
  return { ...coords, precision: approx ? 'approx' : 'exact' };
}

async function syncLeads() {
  const rows = csv(await exportSql(LEADS_SQL));
  console.log(`[leads] ${rows.length} rows`);
  // Clear non-checkin signals for leads (check-ins refresh in meetings)
  await q(`DELETE FROM location_signals WHERE entity_layer='leads' AND source <> 'checkin'`);

  let n = 0;
  await Promise.all(rows.map((r) => limit(async () => {
    const id = r.Id;
    if (!id) return;
    const territory = cleanText(r['Lead Territory']) || null;

    const billingStreet = usableStreet(r.Street);
    const billingCity = firstPlace(r['Billing City'], r.City) || null;
    const billingState = firstPlace(r['Billing State'], r.State) || null;
    const billingCountry = firstPlace(r['Billing Country'], r.Country) || null;
    const billingPin = normalizePincode(r['Pin Code'] || r['Zip Code']);

    const shippingStreet = usableStreet(r['Shipping Street']);
    const shippingStreet2 = usableStreet(r['Shipping Street 2']);
    const shippingCity = firstPlace(r['Shipping City']) || null;
    const shippingState = firstPlace(r['Shipping State']) || null;
    const shippingCountry = firstPlace(r['Shipping Country']) || null;
    const shippingPin = normalizePincode(r['Shipping Code']);

    const billingAddr = buildFullAddress({
      street: billingStreet, city: billingCity, state: billingState,
      pincode: billingPin, country: billingCountry, territory,
    });
    const shippingAddr = buildFullAddress({
      street: shippingStreet, street2: shippingStreet2,
      city: shippingCity, state: shippingState,
      pincode: shippingPin, country: shippingCountry, territory,
    });
    const plotStreet = composeStreet(billingStreet, null)
      || composeStreet(shippingStreet, shippingStreet2);
    const plotPin = billingPin || shippingPin;
    const plotAddr = billingAddr || shippingAddr || null;

    const [billing, shipping] = await Promise.all([
      resolveAddressSource({
        street: billingStreet,
        city: billingCity,
        state: billingState,
        country: billingCountry,
        pincode: billingPin,
        cityHint: billingCity || territory,
        territory,
      }),
      resolveAddressSource({
        street: shippingStreet,
        street2: shippingStreet2,
        city: shippingCity,
        state: shippingState,
        country: shippingCountry,
        pincode: shippingPin,
        cityHint: shippingCity || territory,
        territory,
      }),
    ]);
    const mmi = mmiFromRow(r.s_lat, r.s_lng);

    // Map pin: existing priority (MMI → street geocode → pin → territory)
    const geo = await resolvePoint({
      sLat: r.s_lat, sLng: r.s_lng,
      street: billingStreet || shippingStreet,
      street2: billingStreet ? null : shippingStreet2,
      city: billingStreet ? billingCity : shippingCity,
      state: billingStreet ? billingState : shippingState,
      country: billingStreet ? billingCountry : shippingCountry,
      pincode: plotPin,
      cityHint: (billingStreet ? billingCity : shippingCity) || territory,
      territory,
    });
    const reason = !plotStreet && !plotPin ? 'Lead missing street and pincode'
      : !plotPin ? 'Lead missing pincode; street geocode failed'
      : 'Lead address/pincode could not be resolved';

    await upsert({
      layer: 'leads', sourceId: id,
      title: r['Full Name'] || r.Company, owner: r['Lead Owner Name'],
      territory, status: r['Lead Status'],
      recordTs: r['Created Time'] ? new Date(r['Created Time']) : null,
      address: plotAddr,
      pincode: plotPin, ...geo,
      crmUrl: `https://crm.zoho.in/crm/tab/Leads/${id}`,
      extra: { source: r['Lead Source'], converted: r['Is Converted'] },
      reason,
    });

    const recTs = r['Created Time'] ? new Date(r['Created Time']) : null;
    await upsertSignal({
      entityLayer: 'leads', entityId: id, source: 'mmi',
      addressText: null, pincode: null, ...mmi, recordTs: recTs,
    });
    await upsertSignal({
      entityLayer: 'leads', entityId: id, source: 'billing',
      addressText: billing.address || billingAddr || null,
      pincode: billing.pincode || billingPin,
      lat: billing.lat, lng: billing.lng, precision: billing.precision, recordTs: recTs,
    });
    await upsertSignal({
      entityLayer: 'leads', entityId: id, source: 'shipping',
      addressText: shipping.address || shippingAddr || null,
      pincode: shipping.pincode || shippingPin,
      lat: shipping.lat, lng: shipping.lng, precision: shipping.precision, recordTs: recTs,
    });
    n++;
  })));
  return { layer: 'leads', rows: rows.length, processed: n };
}

async function syncAccounts() {
  const rows = csv(await exportSql(ACCOUNTS_SQL));
  console.log(`[accounts] ${rows.length} rows`);
  await q(`DELETE FROM location_signals WHERE entity_layer='accounts' AND source <> 'checkin'`);

  const seen = new Set();
  let n = 0;
  await Promise.all(rows.map((r) => limit(async () => {
    const id = col(r, 'Id', 'a.Id');
    if (!id || seen.has(id)) return;
    seen.add(id);
    const territory = cleanText(r.territory) || null;

    // Fall back lead street for billing geocode when account street empty
    const leadStreet = usableStreet(r.lead_street);
    const billingStreet = usableStreet(col(r, 'Billing Street', 'a.Billing Street')) || leadStreet;
    const billingStreet2 = usableStreet(col(r, 'Billing Street 2', 'a.Billing Street 2'));
    const billingCity = firstPlace(
      col(r, 'Billing City', 'a.Billing City'),
      r['Billing City Dot'],
      r.lead_billing_city,
    ) || null;
    const billingState = firstPlace(
      r['Billing State Region'], r['Billing State'], r.lead_billing_state,
    ) || null;
    const billingCountry = firstPlace(
      r['Billing Country Nation'], r['Billing Country'], r.lead_billing_country,
    ) || null;
    // Prefer account pins; Billing Code historically empty — inherit lead pins
    const billingPin = normalizePincode(
      col(r, 'Billing Code', 'a.Billing Code')
      || col(r, 'Account Pin Code')
      || r.lead_pincode
      || r.lead_zip,
    );

    const shippingStreet = usableStreet(col(r, 'Shipping Street', 'a.Shipping Street'))
      || usableStreet(r.lead_shipping_street);
    const shippingStreet2 = usableStreet(col(r, 'Shipping Street 2', 'a.Shipping Street 2'))
      || usableStreet(r.lead_shipping_street2);
    const shippingCity = firstPlace(
      col(r, 'Shipping City', 'a.Shipping City'), r.lead_shipping_city,
    ) || null;
    const shippingState = firstPlace(
      col(r, 'Shipping State', 'a.Shipping State'), r.lead_shipping_state,
    ) || null;
    const shippingCountry = firstPlace(
      col(r, 'Shipping Country', 'a.Shipping Country'), r.lead_shipping_country,
    ) || null;
    const shippingPin = normalizePincode(
      col(r, 'Shipping Code', 'a.Shipping Code') || r.lead_ship_code,
    );

    const billingAddr = buildFullAddress({
      street: billingStreet, street2: billingStreet2,
      city: billingCity, state: billingState,
      pincode: billingPin, country: billingCountry, territory,
    });
    const shippingAddr = buildFullAddress({
      street: shippingStreet, street2: shippingStreet2,
      city: shippingCity, state: shippingState,
      pincode: shippingPin, country: shippingCountry, territory,
    });

    const [billing, shipping] = await Promise.all([
      resolveAddressSource({
        street: billingStreet,
        street2: billingStreet2,
        city: billingCity,
        state: billingState,
        country: billingCountry,
        pincode: billingPin,
        cityHint: billingCity || territory,
        territory,
      }),
      resolveAddressSource({
        street: shippingStreet,
        street2: shippingStreet2,
        city: shippingCity,
        state: shippingState,
        country: shippingCountry,
        pincode: shippingPin,
        cityHint: shippingCity || territory,
        territory,
      }),
    ]);
    const mmi = mmiFromRow(r.s_lat, r.s_lng);

    const plotStreet = composeStreet(billingStreet, billingStreet2)
      || composeStreet(shippingStreet, shippingStreet2);
    const plotPin = billingPin || shippingPin;
    const plotAddr = billingAddr || shippingAddr || null;
    const useBilling = Boolean(composeStreet(billingStreet, billingStreet2));
    const geo = await resolvePoint({
      sLat: r.s_lat, sLng: r.s_lng,
      street: useBilling ? billingStreet : shippingStreet,
      street2: useBilling ? billingStreet2 : shippingStreet2,
      city: useBilling ? billingCity : shippingCity,
      state: useBilling ? billingState : shippingState,
      country: useBilling ? billingCountry : shippingCountry,
      pincode: plotPin,
      cityHint: (useBilling ? billingCity : shippingCity) || territory,
      territory,
    });
    const reason = !plotPin && !plotStreet
      ? 'Account has no billing street and no inherited lead pincode'
      : !plotPin ? 'Account missing pincode (Billing Code 0%); street geocode failed'
      : 'Account address could not be resolved';

    const recTs = col(r, 'Created Time', 'a.Created Time')
      ? new Date(col(r, 'Created Time', 'a.Created Time')) : null;
    await upsert({
      layer: 'accounts', sourceId: id, title: col(r, 'Account Name', 'a.Account Name'), owner: r.owner,
      territory, status: 'active',
      recordTs: recTs,
      address: plotAddr,
      pincode: plotPin, ...geo,
      crmUrl: `https://crm.zoho.in/crm/tab/Accounts/${id}`,
      reason,
    });

    await upsertSignal({
      entityLayer: 'accounts', entityId: id, source: 'mmi',
      addressText: null, pincode: null, ...mmi, recordTs: recTs,
    });
    await upsertSignal({
      entityLayer: 'accounts', entityId: id, source: 'billing',
      addressText: billing.address || billingAddr || null,
      pincode: billing.pincode || billingPin,
      lat: billing.lat, lng: billing.lng, precision: billing.precision, recordTs: recTs,
    });
    await upsertSignal({
      entityLayer: 'accounts', entityId: id, source: 'shipping',
      addressText: shipping.address || shippingAddr || null,
      pincode: shipping.pincode || shippingPin,
      lat: shipping.lat, lng: shipping.lng, precision: shipping.precision, recordTs: recTs,
    });
    n++;
  })));
  return { layer: 'accounts', rows: rows.length, processed: n };
}

async function syncMeetings() {
  const rows = csv(await exportSql(MEETINGS_SQL));
  console.log(`[meetings] ${rows.length} rows`);
  // Full related maps (incl. unlocated) so territory still inherits when check-in exists.
  const relatedMap = async (layer) => new Map((await q(
    `SELECT source_id, lat, lng, territory FROM map_points WHERE layer=$1`, [layer])).rows
    .map((a) => [a.source_id, a]));
  const [accs, leads] = [await relatedMap('accounts'), await relatedMap('leads')];

  // Replace check-in signals each full meetings sync
  await q(`DELETE FROM location_signals WHERE source = 'checkin'`);

  let n = 0;
  for (const r of rows) {
    const id = col(r, 'Id', 'm.Id');
    if (!id) continue;
    const related = (r.account_id && accs.get(r.account_id))
      || (r.lead_id && leads.get(r.lead_id))
      || null;
    let geo = { lat: null, lng: null, precision: 'none' };
    const checkin = parseCoords(r.lat, r.lng);
    if (checkin) {
      const approx = isLowPrecisionCoord(r.lat, r.lng);
      geo = { ...checkin, precision: approx ? 'approx' : 'exact' };
    } else if (related?.lat != null && related?.lng != null
        && inIndia(Number(related.lat), Number(related.lng))) {
      geo = { lat: related.lat, lng: related.lng, precision: 'inherited' };
    }
    const joint = String(r.is_joint).toLowerCase() === 'yes' || r.is_joint === '1' || r.is_joint === 'true';
    const startTs = r.start_ts ? new Date(r.start_ts) : null;
    const checkinTs = r.checkin_time ? new Date(r.checkin_time) : null;
    const recTs = startTs || checkinTs;
    await upsert({
      layer: 'meetings', sourceId: id, title: col(r, 'Title', 'm.Title'), owner: r.owner,
      territory: related?.territory ?? null,
      status: r.checkin_time ? 'checked-in' : 'no check-in',
      recordTs: recTs,
      address: null, pincode: null, ...geo,
      crmUrl: `https://crm.zoho.in/crm/tab/Events/${id}`,
      extra: {
        joint, outcome: r.outcome || null,
        lead_id: r.lead_id || null, account_id: r.account_id || null,
        start_ts: startTs ? startTs.toISOString() : null,
        checkin_time: checkinTs ? checkinTs.toISOString() : null,
        checkin_status: r.checkin_status || null,
        // Raw geo strings from Analytics CAST(CHAR) — full GPS before float store
        checkin_lat: r.lat != null && r.lat !== '' ? String(r.lat) : null,
        checkin_lng: r.lng != null && r.lng !== '' ? String(r.lng) : null,
      },
      reason: 'Meeting has no check-in and no located related lead/account',
    });

    // Link check-in signal onto related account or lead
    if (checkin) {
      const target = r.account_id
        ? { layer: 'accounts', id: r.account_id }
        : (r.lead_id ? { layer: 'leads', id: r.lead_id } : null);
      if (target) {
        await upsertSignal({
          entityLayer: target.layer,
          entityId: target.id,
          source: 'checkin',
          addressText: null,
          pincode: null,
          lat: geo.lat,
          lng: geo.lng,
          precision: geo.precision,
          meetingId: id,
          recordTs: recTs,
        });
      }
    }
    n++;
  }
  return { layer: 'meetings', rows: rows.length, processed: n };
}

/** Strip Analytics/Excel `.0` suffixes; reject multi-lookup comma blobs. */
function normalizeZohoId(v) {
  const s = cleanText(v);
  if (!s || s.includes(',')) return null;
  if (/^\d+\.0+$/.test(s)) return s.replace(/\.0+$/, '');
  return s;
}

/**
 * Company lookup may export as Zoho id OR account name depending on the view.
 * Digits (10+) → id; otherwise treat as display name for secondary match.
 */
function parseAccountRef(raw) {
  const s = cleanText(raw);
  if (!s || s.includes(',')) return { id: null, name: null };
  const stripped = s.replace(/\.0+$/, '');
  if (/^\d{10,}$/.test(stripped)) return { id: stripped, name: null };
  return { id: null, name: s };
}

/**
 * Stable Zoho Asset id; fall back to Asset Number then MAC when Analytics
 * exports multi-value lookup blobs (contain commas).
 */
function resolveAssetSourceId(r) {
  const rawId = normalizeZohoId(col(r, 'Id', 's.Id'));
  if (rawId) return rawId;
  const num = cleanText(col(r, 'Asset Number'));
  if (num) return num;
  const mac = cleanText(r.mac);
  if (mac) return mac;
  return null;
}

/** Apply a location_signals row that already has coordinates. */
function geoFromSignal(sig) {
  if (!sig || sig.lat == null || sig.lng == null) return null;
  const lat = Number(sig.lat), lng = Number(sig.lng);
  if (!inIndia(lat, lng) || sig.precision === 'none') return null;
  return {
    lat, lng,
    // From related account — not the asset's own GPS
    precision: ['geocoded', 'exact', 'approx'].includes(sig.precision)
      ? 'inherited'
      : (sig.precision || 'inherited'),
  };
}

/** Prefer proper Asset Number; strip trailing MAC-in-parens from names for map pins. */
function resolveAssetTitle(r) {
  const num = cleanText(col(r, 'Asset Number'));
  if (num) return num;
  const name = cleanText(col(r, 'Asset Name'));
  if (name) {
    const stripped = name.replace(/\s*\(([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\)\s*$/i, '').trim();
    return stripped || name;
  }
  return cleanText(r.mac) || 'Asset';
}

async function syncAssets() {
  const rows = csv(await exportSql(ASSETS_SQL));
  const addrRows = csv(await exportSql(FSM_ADDRESSES_SQL, cfg.zoho.fsmWorkspaceId));
  const addrs = new Map();
  for (const a of addrRows) {
    const id = normalizeZohoId(a.Id) || cleanText(a.Id);
    if (id) addrs.set(id, a);
  }

  // FSM Company → CRM Account (+ company-level service/billing addresses)
  const fsmCompanies = new Map();
  try {
    const coRows = csv(await exportSql(FSM_COMPANIES_SQL, cfg.zoho.fsmWorkspaceId));
    for (const r of coRows) {
      const companyId = normalizeZohoId(r.company_id);
      if (!companyId || fsmCompanies.has(companyId)) continue;
      fsmCompanies.set(companyId, {
        name: cleanText(r.company_name) || null,
        zcrmId: normalizeZohoId(r.zcrm_id),
        serviceAddressId: normalizeZohoId(r.service_address_id),
        billingAddressId: normalizeZohoId(r.billing_address_id),
      });
    }
    console.log(`[assets] ${rows.length} rows, ${addrs.size} FSM addresses, ${fsmCompanies.size} FSM companies`);
  } catch (e) {
    console.warn(`[assets] FSM_COMPANIES_SQL failed: ${e.message}`);
    console.log(`[assets] ${rows.length} rows, ${addrs.size} FSM addresses`);
  }

  // Fresh CRM shipping/billing per account (covers gap when location_signals not yet rebuilt)
  const accAddr = new Map();
  try {
    const accRows = csv(await exportSql(ACCOUNT_ADDRESS_SQL));
    for (const r of accRows) {
      const aid = normalizeZohoId(r.account_id);
      if (!aid || accAddr.has(aid)) continue;
      accAddr.set(aid, {
        shippingStreet: usableStreet(r.shipping_street) || usableStreet(r.lead_shipping_street),
        shippingStreet2: usableStreet(r.shipping_street2) || usableStreet(r.lead_shipping_street2),
        shippingCity: firstPlace(r.shipping_city, r.lead_shipping_city) || null,
        shippingState: firstPlace(r.shipping_state, r.lead_shipping_state) || null,
        shippingCountry: firstPlace(r.shipping_country, r.lead_shipping_country) || null,
        // Lead pin is a valid shipping fallback when Shipping Code is empty
        shippingPin: normalizePincode(
          r.shipping_code || r.lead_shipping_code || r.lead_pincode || r.lead_zip,
        ),
        billingStreet: usableStreet(r.billing_street) || usableStreet(r.lead_street),
        billingStreet2: usableStreet(r.billing_street2),
        billingCity: firstPlace(r.billing_city, r.billing_city_dot, r.lead_billing_city) || null,
        billingState: firstPlace(r.billing_state_region, r.billing_state, r.lead_billing_state) || null,
        billingCountry: firstPlace(
          r.billing_country_nation, r.billing_country, r.lead_billing_country,
        ) || null,
        billingPin: normalizePincode(
          r.billing_code || r.account_pin || r.lead_pincode || r.lead_zip,
        ),
        territory: cleanText(r.territory) || null,
      });
    }
    console.log(`[assets] account address map ${accAddr.size}`);
  } catch (e) {
    console.warn(`[assets] ACCOUNT_ADDRESS_SQL failed: ${e.message}`);
  }

  // Account plot points (coords + territory) for inheritance
  const acc = new Map();
  const accByName = new Map();
  for (const a of (await q(
    `SELECT source_id, title, lat, lng, territory, address_raw, pincode, precision
     FROM map_points WHERE layer='accounts'`)).rows) {
    const id = normalizeZohoId(a.source_id) || a.source_id;
    acc.set(id, a);
    const nameKey = cleanText(a.title)?.toLowerCase();
    if (nameKey && !accByName.has(nameKey)) accByName.set(nameKey, a);
  }

  // Prefer already-resolved shipping/billing signals (incl. coords)
  const signalByAcc = new Map();
  for (const row of (await q(`
    SELECT entity_id, source, address_text, pincode, lat, lng, precision
    FROM location_signals
    WHERE entity_layer='accounts' AND source IN ('shipping','billing')`)).rows) {
    const eid = normalizeZohoId(row.entity_id) || cleanText(row.entity_id);
    if (!eid) continue;
    if (!signalByAcc.has(eid)) signalByAcc.set(eid, {});
    signalByAcc.get(eid)[row.source] = {
      address: cleanText(row.address_text) || null,
      pincode: normalizePincode(row.pincode),
      lat: row.lat, lng: row.lng, precision: row.precision,
    };
  }

  let n = 0;
  let viaShipping = 0;
  let viaBilling = 0;
  let viaAccount = 0;
  let linkedAccounts = 0;
  const seenIds = [];
  await Promise.all(rows.map((r) => limit(async () => {
    const sourceId = resolveAssetSourceId(r);
    if (!sourceId) return;
    seenIds.push(sourceId);

    const assetNumber = cleanText(col(r, 'Asset Number')) || null;
    const assetName = cleanText(col(r, 'Asset Name')) || null;
    const mac = cleanText(r.mac) || null;
    const title = resolveAssetTitle(r);

    // Assets.Company is an FSM Company id (524…). Bridge to CRM via ZCRM Id.
    const fsmCompanyId = normalizeZohoId(r.account_id);
    const fsmCo = fsmCompanyId ? fsmCompanies.get(fsmCompanyId) : null;

    const addressId = normalizeZohoId(r.address_id);
    const tryFsmAddress = async (fa, sourceLabel) => {
      if (!fa) return null;
      const street = usableStreet(fa['Street 1']);
      const pin = normalizePincode(fa['Zip Code']);
      const city = firstPlace(fa.City) || '';
      const state = firstPlace(fa.State) || '';
      const country = firstPlace(fa.Country) || '';
      if (!street && !pin) return null;
      const g = await resolvePoint({
        street, city: city || null, state: state || null, country: country || null,
        pincode: pin, cityHint: city || state, territory: city || state || null,
      });
      if (g.precision === 'none') return null;
      return {
        geo: g,
        address: buildFullAddress({
          street, city, state, pincode: pin, country,
        }) || null,
        pincode: pin,
        addressSource: sourceLabel,
        territory: city || state || null,
      };
    };

    let geo = { lat: null, lng: null, precision: 'none' };
    let address = null;
    let pincode = null;
    let addressSource = null;
    let territory = null;

    // 1) FSM asset Address
    const fa = addressId ? addrs.get(addressId) : null;
    const fromAsset = await tryFsmAddress(fa, 'fsm');
    if (fromAsset) {
      ({ geo, address, pincode, addressSource, territory } = fromAsset);
    }

    // 1b) Company Service Address, then Company Billing Address
    if (geo.precision === 'none' && fsmCo?.serviceAddressId) {
      const fromSvc = await tryFsmAddress(addrs.get(fsmCo.serviceAddressId), 'fsm_service');
      if (fromSvc) ({ geo, address, pincode, addressSource, territory } = fromSvc);
    }
    if (geo.precision === 'none' && fsmCo?.billingAddressId) {
      const fromBill = await tryFsmAddress(addrs.get(fsmCo.billingAddressId), 'fsm_billing');
      if (fromBill) ({ geo, address, pincode, addressSource, territory } = fromBill);
    }

    // Resolve CRM account via ZCRM Id (shipping/billing live here)
    let accountId = fsmCo?.zcrmId || null;
    let a = accountId ? acc.get(accountId) : null;
    let crm = accountId ? accAddr.get(accountId) : null;
    let sig = accountId ? signalByAcc.get(accountId) : null;
    // Fallback: match by FSM company name → CRM account title
    if (!a && !crm && !sig && fsmCo?.name) {
      const byName = accByName.get(fsmCo.name.toLowerCase());
      if (byName) {
        accountId = normalizeZohoId(byName.source_id) || byName.source_id;
        a = byName;
        crm = accAddr.get(accountId) || null;
        sig = signalByAcc.get(accountId) || null;
      }
    }
    // Legacy: Company exported as CRM id or name directly
    if (!accountId && !fsmCo) {
      const ref = parseAccountRef(r.account_id);
      accountId = ref.id;
      a = accountId ? acc.get(accountId) : null;
      crm = accountId ? accAddr.get(accountId) : null;
      sig = accountId ? signalByAcc.get(accountId) : null;
      if (!a && !crm && !sig && ref.name) {
        const byName = accByName.get(ref.name.toLowerCase());
        if (byName) {
          accountId = normalizeZohoId(byName.source_id) || byName.source_id;
          a = byName;
          crm = accAddr.get(accountId) || null;
          sig = signalByAcc.get(accountId) || null;
        }
      }
    }
    if (accountId && (a || crm || sig)) linkedAccounts++;
    const terrHint = crm?.territory || a?.territory || territory || null;

    // 2) Shipping — when FSM is none: reuse resolved shipping signal, else geocode
    const shippingStreet = crm?.shippingStreet
      || usableStreet(sig?.shipping?.address)
      || '';
    const shippingStreet2 = crm?.shippingStreet2 || '';
    const shippingCity = crm?.shippingCity || null;
    const shippingState = crm?.shippingState || null;
    const shippingCountry = crm?.shippingCountry || null;
    const shippingPin = crm?.shippingPin || sig?.shipping?.pincode || null;
    const shippingFull = buildFullAddress({
      street: shippingStreet, street2: shippingStreet2,
      city: shippingCity, state: shippingState,
      pincode: shippingPin, country: shippingCountry, territory: terrHint,
    }) || sig?.shipping?.address || null;

    if (geo.precision === 'none') {
      const fromSig = geoFromSignal(sig?.shipping);
      if (fromSig) {
        geo = fromSig;
        address = shippingFull || sig.shipping.address || null;
        pincode = shippingPin || sig.shipping.pincode || null;
        addressSource = 'shipping';
        viaShipping++;
      } else if (shippingStreet || shippingStreet2 || shippingPin || shippingFull) {
        const shipGeo = await resolvePoint({
          // If we only have a composed signal line, feed it as street for T1
          street: shippingStreet || (shippingFull && !shippingPin ? shippingFull : null),
          street2: shippingStreet2 || null,
          city: shippingCity,
          state: shippingState,
          country: shippingCountry || 'India',
          pincode: shippingPin,
          cityHint: shippingCity || terrHint,
          territory: terrHint,
        });
        // Last resort: geocode the full composed shipping line as one query
        const shipGeo2 = shipGeo.precision === 'none' && shippingFull
          ? await resolvePoint({
            street: shippingFull,
            pincode: shippingPin,
            cityHint: shippingCity || terrHint,
            territory: terrHint,
            country: 'India',
          })
          : shipGeo;
        const use = shipGeo2.precision !== 'none' ? shipGeo2 : shipGeo;
        if (use.precision !== 'none') {
          geo = use;
          address = shippingFull;
          pincode = shippingPin;
          addressSource = 'shipping';
          viaShipping++;
        }
      }
    }

    // 3) Billing address fallback
    const billingStreet = crm?.billingStreet
      || usableStreet(sig?.billing?.address)
      || '';
    const billingStreet2 = crm?.billingStreet2 || '';
    const billingCity = crm?.billingCity || null;
    const billingState = crm?.billingState || null;
    const billingCountry = crm?.billingCountry || null;
    const billingPin = crm?.billingPin || sig?.billing?.pincode || null;
    const billingFull = buildFullAddress({
      street: billingStreet, street2: billingStreet2,
      city: billingCity, state: billingState,
      pincode: billingPin, country: billingCountry, territory: terrHint,
    }) || sig?.billing?.address || null;
    if (geo.precision === 'none') {
      const fromSig = geoFromSignal(sig?.billing);
      if (fromSig) {
        geo = fromSig;
        address = billingFull || sig.billing.address || null;
        pincode = billingPin || sig.billing.pincode || null;
        addressSource = 'billing';
        viaBilling++;
      } else if (billingStreet || billingStreet2 || billingPin || billingFull) {
        const billGeo = await resolvePoint({
          street: billingStreet || (billingFull && !billingPin ? billingFull : null),
          street2: billingStreet2 || null,
          city: billingCity,
          state: billingState,
          country: billingCountry || 'India',
          pincode: billingPin,
          cityHint: billingCity || terrHint,
          territory: terrHint,
        });
        if (billGeo.precision !== 'none') {
          geo = billGeo;
          address = billingFull;
          pincode = billingPin;
          addressSource = 'billing';
          viaBilling++;
        }
      }
    }

    // 4) Inherit plotted account point
    if (geo.precision === 'none' && a?.lat != null && a?.lng != null
        && inIndia(Number(a.lat), Number(a.lng))) {
      geo = { lat: a.lat, lng: a.lng, precision: 'inherited' };
      if (!address) address = a.address_raw || null;
      if (!pincode) pincode = normalizePincode(a.pincode);
      addressSource = addressSource || 'account';
      viaAccount++;
    }

    if (!territory) territory = terrHint || a?.territory || null;

    await upsert({
      layer: 'assets', sourceId,
      title, owner: null,
      territory,
      status: r['Asset Status'],
      recordTs: r['Installation Date']
        ? new Date(r['Installation Date'])
        : (r['Created Time'] ? new Date(r['Created Time']) : null),
      address, pincode, ...geo,
      crmUrl: null,
      extra: {
        assetNumber,
        assetName,
        mac,
        acType: r['AC Type'] || null,
        tonnage: r.Tonnage || null,
        addressSource,
        accountId,
        accountName: a?.title || fsmCo?.name || null,
        fsmCompanyId: fsmCompanyId || null,
        fsmCompanyName: fsmCo?.name || null,
        installationDate: r['Installation Date'] || null,
      },
      reason: 'Asset has no FSM/company/shipping/billing address and linked CRM account is not located',
    });
    n++;
  })));

  // Drop stale assets removed from Zoho / filtered out (e.g. Uninstalled)
  if (seenIds.length) {
    const del = await q(
      `DELETE FROM map_points WHERE layer='assets' AND NOT (source_id = ANY($1::text[]))`,
      [seenIds],
    );
    const delLog = await q(
      `DELETE FROM unplottable_log WHERE layer='assets' AND NOT (source_id = ANY($1::text[]))`,
      [seenIds],
    );
    if (del.rowCount) console.log(`[assets] removed ${del.rowCount} stale map rows`);
    if (delLog.rowCount) console.log(`[assets] removed ${delLog.rowCount} stale gap rows`);
  }

  console.log(
    `[assets] processed ${n}; linked accounts ${linkedAccounts}; `
    + `shipping ${viaShipping}; billing ${viaBilling}; account inherit ${viaAccount}`,
  );
  return {
    layer: 'assets', rows: rows.length, processed: n,
    linkedAccounts, viaShipping, viaBilling, viaAccount,
  };
}

/** Sync Zoho CRM Users for active/inactive + role filters. */
export async function syncUsers() {
  const rows = csv(await exportSql(USERS_SQL));
  console.log(`[users] ${rows.length} rows`);
  let n = 0;
  for (const r of rows) {
    const id = String(r.Id || '').trim();
    const fullName = cleanText(r['Full Name']);
    if (!id || !fullName) continue;
    const statusRaw = String(r.Status || 'active').trim().toLowerCase();
    const status = statusRaw === 'disabled' || statusRaw === 'inactive'
      ? 'disabled' : 'active';
    await q(`
      INSERT INTO crm_users (user_id, full_name, email, status, role_name, profile_name, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,now())
      ON CONFLICT (user_id) DO UPDATE SET
        full_name=EXCLUDED.full_name, email=EXCLUDED.email, status=EXCLUDED.status,
        role_name=EXCLUDED.role_name, profile_name=EXCLUDED.profile_name, updated_at=now()`,
      [
        id,
        fullName,
        cleanText(r.Email) || null,
        status,
        cleanText(r['Role Name']) || null,
        cleanText(r['Profile Name']) || null,
      ]);
    n++;
  }
  // Drop users removed from CRM
  if (n) {
    const ids = rows.map((r) => String(r.Id || '').trim()).filter(Boolean);
    await q(`DELETE FROM crm_users WHERE NOT (user_id = ANY($1::text[]))`, [ids]);
  }
  return { layer: 'users', rows: rows.length, processed: n };
}

/** Full Zoho → Postgres sync. Returns run stats. Does not close the pool. */
export async function runFullSync() {
  const t = Date.now();
  const layers = [];
  layers.push(await syncUsers());
  layers.push(await syncLeads());
  await refreshTerritoryCentroids();
  layers.push(await syncAccounts());
  layers.push(await syncMeetings());
  layers.push(await syncAssets());
  await refreshTerritoryCentroids();
  const disc = await rebuildDiscrepancies();
  const durationMs = Date.now() - t;
  console.log(`sync complete in ${(durationMs / 1000).toFixed(0)}s`);
  return { durationMs, layers, discrepancies: disc };
}

/** Assets-only re-sync (FSM + shipping/billing fallback + clean asset numbers). */
export async function runAssetsSync() {
  const t = Date.now();
  const layer = await syncAssets();
  await refreshTerritoryCentroids();
  return { durationMs: Date.now() - t, layers: [layer] };
}

/** Re-resolve points that are none/pincode and have usable street or pin. */
export async function runRegeocode({ clearFailed = true, limitRows = 50000 } = {}) {
  const t = Date.now();
  if (clearFailed) {
    const del = await q(`DELETE FROM geocode_cache WHERE failed = TRUE`);
    console.log(`[regeocode] cleared ${del.rowCount} failed cache rows`);
  }
  await refreshTerritoryCentroids();

  const { rows } = await q(`
    SELECT layer, source_id, title, owner_name, territory, status, record_ts,
           address_raw, pincode, crm_url, extra
    FROM map_points
    WHERE precision IN ('none', 'pincode', 'territory')
      AND (
        (address_raw IS NOT NULL AND length(trim(address_raw)) > 8)
        OR (pincode ~ '^[1-9][0-9]{5}$')
        OR (territory IS NOT NULL AND territory <> '')
      )
    ORDER BY CASE precision WHEN 'none' THEN 0 WHEN 'pincode' THEN 1 ELSE 2 END
    LIMIT $1`, [limitRows]);

  console.log(`[regeocode] ${rows.length} candidates`);
  let upgraded = 0;
  await Promise.all(rows.map((r) => limit(async () => {
    // Skip manual overrides
    if (r.extra?.manual) return;
    // address_raw is now the full composed address when synced with this pipeline
    const geo = await resolvePoint({
      street: r.address_raw,
      pincode: r.pincode,
      cityHint: r.territory,
      territory: r.territory,
      country: 'India',
    });
    const rank = { none: 0, territory: 1, pincode: 2, inherited: 3, approx: 4, geocoded: 5, exact: 6 };
    const cur = (await q(
      `SELECT precision FROM map_points WHERE layer=$1 AND source_id=$2`,
      [r.layer, r.source_id])).rows[0]?.precision || 'none';
    if ((rank[geo.precision] || 0) <= (rank[cur] || 0) && geo.precision !== 'geocoded') return;
    if (geo.precision === 'none') return;

    await q(`
      UPDATE map_points SET lat=$3, lng=$4, precision=$5,
        geom = ST_SetSRID(ST_MakePoint($4::float8,$3::float8),4326),
        updated_at=now()
      WHERE layer=$1 AND source_id=$2`,
      [r.layer, r.source_id, geo.lat, geo.lng, geo.precision]);
    await q(`DELETE FROM unplottable_log WHERE layer=$1 AND source_id=$2`, [r.layer, r.source_id]);
    upgraded++;
  })));

  const disc = await rebuildDiscrepancies();
  const durationMs = Date.now() - t;
  console.log(`[regeocode] upgraded ${upgraded} in ${(durationMs / 1000).toFixed(0)}s`);
  return { durationMs, candidates: rows.length, upgraded, discrepancies: disc };
}

// CLI entry
const isMain = process.argv[1] &&
  (process.argv[1].endsWith('sync.js') || process.argv[1].endsWith('sync\\sync.js'));
if (isMain) {
  const { pool } = await import('../db.js');
  try {
    await runFullSync();
  } finally {
    await pool.end();
  }
}
