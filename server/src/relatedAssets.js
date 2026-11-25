import { q } from './db.js';
import { sqlAssetNotParent, sqlAccountHasAsset, sqlMapPointVisible } from './filters/layerPolicy.js';
import { redactMacInText, scrubPublicProperties } from './privacy/mac.js';

const ACCOUNT_JOIN = `
LEFT JOIN map_points acc
  ON acc.layer = 'accounts'
 AND NULLIF(p.extra->>'accountId', '') IS NOT NULL
 AND acc.source_id = p.extra->>'accountId'`;

function featureFromRow(r) {
  const extra = r.extra && typeof r.extra === 'object' ? r.extra : {};
  const accountName = r.account_title || extra.accountName || extra.fsmCompanyName || null;
  const accountCrmUrl = r.account_crm_url || extra.account_crmUrl || null;
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

const CITY_SUFFIX = /\s*[-_]\s*(mumbai|mmr|thane|noida|delhi|ncr|gurgaon|gurugram|hyderabad|chennai|bangalore|banglore|bengaluru|pune|kolkata|kochi|ahmedabad|jaipur|indore|lucknow|chandigarh|goa|surat|vadodara|nagpur|patna|bhopal|coimbatore).*$/i;
const CORP_TAIL = /\s*(private\s+limited|pvt\.?\s*ltd\.?|pvt\s+ltd|llp|ltd\.?)\s*$/gi;

/** Loose brand key so sibling CRM accounts (per city) roll up together. */
export function accountBrandKey(title) {
  let t = String(title || '').toLowerCase();
  t = t.replace(CITY_SUFFIX, '');
  t = t.replace(CORP_TAIL, '');
  t = t.replace(/[._]+/g, ' ');
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  const words = t.split(' ').filter((w) => w.length >= 3);
  if (!words.length) return '';
  return words.slice(0, Math.min(4, words.length)).join(' ');
}

async function expandAccountIds(ids) {
  if (!ids?.length) return [];
  const { rows } = await q(
    `SELECT source_id, title FROM map_points WHERE layer = 'accounts' AND source_id = ANY($1::text[])`,
    [ids],
  );
  const keys = new Set(
    rows.map((r) => accountBrandKey(r.title)).filter((k) => k.length >= 4),
  );
  if (!keys.size) return [...new Set(ids)];

  const expanded = new Set(ids);
  const { rows: all } = await q(
    `SELECT source_id, title FROM map_points WHERE layer = 'accounts' AND title IS NOT NULL`,
  );
  for (const row of all) {
    const key = accountBrandKey(row.title);
    if (!key) continue;
    for (const want of keys) {
      if (key === want || key.includes(want) || want.includes(key)) {
        expanded.add(row.source_id);
        break;
      }
    }
  }
  return [...expanded];
}

function boundsFromFeatures(features) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const f of features) {
    const c = f?.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    const [lng, lat] = c;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

export async function resolveAccountIds({ accountIds, searchQuery }) {
  const ids = new Set(
    (accountIds || []).map((id) => String(id || '').trim()).filter(Boolean),
  );
  if (ids.size) return [...ids];

  const query = String(searchQuery || '').trim();
  if (query.length < 2) return [];

  const like = `%${query.replace(/[%_]/g, '')}%`;
  const vis = sqlAccountHasAsset('map_points');
  const { rows } = await q(
    `SELECT source_id FROM map_points
     WHERE layer = 'accounts'
       AND ${sqlMapPointVisible('map_points')}
       AND ${vis}
       AND (source_id ILIKE $1 OR title ILIKE $1)
     ORDER BY title
     LIMIT 40`,
    [like],
  );
  return rows.map((r) => r.source_id);
}

export async function fetchRelatedAssetsGeoJson({ accountIds, q: searchQuery }) {
  let ids = await resolveAccountIds({ accountIds, searchQuery });
  ids = await expandAccountIds(ids);
  if (!ids.length) {
    return {
      accountIds: [],
      accounts: [],
      features: [],
      bounds: null,
      assetCount: 0,
    };
  }

  const assetVis = sqlAssetNotParent('p');
  const { rows: titles } = await q(
    `SELECT title FROM map_points WHERE layer = 'accounts' AND source_id = ANY($1::text[])`,
    [ids],
  );
  const titleKeys = [...new Set(
    titles.map((r) => String(r.title || '').trim().toLowerCase()).filter((t) => t.length >= 3),
  )];

  const assetSql = `SELECT p.source_id, p.title, p.owner_name, p.territory, p.status, p.precision,
            p.record_ts, p.crm_url, p.extra, p.lat, p.lng, p.address_raw, p.pincode,
            acc.title AS account_title, acc.crm_url AS account_crm_url
     FROM map_points p
     ${ACCOUNT_JOIN}
     WHERE p.layer = 'assets'
       AND p.geom IS NOT NULL
       AND ${assetVis}
       AND (
         NULLIF(p.extra->>'accountId', '') = ANY($1::text[])
         OR EXISTS (
           SELECT 1 FROM map_points a
           WHERE a.layer = 'accounts' AND a.source_id = ANY($1::text[])
             AND lower(trim(coalesce(p.extra->>'accountName', p.extra->>'fsmCompanyName', '')))
               = lower(trim(a.title))
         )`;
  const assetSqlTail = `
       )
     ORDER BY p.record_ts DESC NULLS LAST, p.source_id
     LIMIT 8000`;

  let { rows: assetRows } = await q(`${assetSql}${assetSqlTail}`, [ids]);

  if (!assetRows.length && titleKeys.length) {
    const brand = titleKeys[0].replace(/_(noida|delhi|hyderabad|mumbai|pune).*$/i, '').trim();
    const key = brand.length >= 4 ? `%${brand.replace(/\s+/g, '%')}%` : null;
    if (key) {
      ({ rows: assetRows } = await q(
        `SELECT p.source_id, p.title, p.owner_name, p.territory, p.status, p.precision,
                p.record_ts, p.crm_url, p.extra, p.lat, p.lng, p.address_raw, p.pincode,
                acc.title AS account_title, acc.crm_url AS account_crm_url
         FROM map_points p
         ${ACCOUNT_JOIN}
         WHERE p.layer = 'assets'
           AND p.geom IS NOT NULL
           AND ${assetVis}
           AND (
             lower(trim(coalesce(p.extra->>'accountName', p.extra->>'fsmCompanyName', p.title, ''))) LIKE $1
             OR lower(trim(p.title)) LIKE $1
           )
         ORDER BY p.record_ts DESC NULLS LAST, p.source_id
         LIMIT 8000`,
        [key],
      ));
    }
  }

  const visAcc = sqlAccountHasAsset('map_points');
  const { rows: accountRows } = await q(
    `SELECT source_id, title, owner_name, territory, status, precision,
            record_ts, crm_url, extra, lat, lng, address_raw, pincode
     FROM map_points
     WHERE layer = 'accounts'
       AND source_id = ANY($1::text[])
       AND geom IS NOT NULL
       AND ${visAcc}`,
    [ids],
  );

  const assetFeatures = assetRows.map(featureFromRow);
  const accountFeatures = accountRows.map(featureFromRow);
  const all = [...accountFeatures, ...assetFeatures];

  const picked = new Set((accountIds || []).map((id) => String(id)));
  const rolledUp = ids.length > picked.size;

  return {
    accountIds: ids,
    rolledUp,
    accounts: accountRows.map((r) => ({ id: r.source_id, title: r.title })),
    accountFeatures,
    features: assetFeatures,
    bounds: boundsFromFeatures(all),
    assetCount: assetFeatures.length,
    accountCount: accountFeatures.length,
  };
}