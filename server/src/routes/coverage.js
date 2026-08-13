import { Router } from 'express';
import { q } from '../db.js';
import {
  parseList, TERRITORY_GROUPS, expandUserStatuses,
} from '../filters/mapFilters.js';

export const coverage = Router();

function cellSizeForZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n) || n < 7) return 0.22;
  if (n < 9) return 0.1;
  if (n < 11) return 0.045;
  if (n < 13) return 0.022;
  if (n < 15) return 0.01;
  return 0.005;
}

function addSharedFilters(query, params, { forMeetings } = {}) {
  const bits = [];
  const add = (sql, v) => {
    params.push(v);
    bits.push(sql.replace(/\?/g, `$${params.length}`));
  };
  const addAny = (sql, values) => {
    params.push(values);
    bits.push(sql.replace(/\?/g, `$${params.length}`));
  };

  const owners = parseList(query.owner);
  if (owners.length === 1) add(`owner_name = ?`, owners[0]);
  else if (owners.length > 1) addAny(`owner_name = ANY(?::text[])`, owners);

  const territories = parseList(query.territory)
    .map((t) => (TERRITORY_GROUPS[t] ? t : null))
    .filter(Boolean);
  if (territories.length) {
    const patterns = territories.map((k) => TERRITORY_GROUPS[k].pattern);
    params.push(patterns);
    bits.push(
      `territory IS NOT NULL AND territory <> '' AND EXISTS (
         SELECT 1 FROM unnest($${params.length}::text[]) AS pat(p)
         WHERE territory ~* ('(?:' || pat.p || ')')
       )`,
    );
  }

  const sources = parseList(query.source);
  if (!forMeetings && sources.length) {
    if (sources.length === 1) add(`extra->>'source' = ?`, sources[0]);
    else addAny(`extra->>'source' = ANY(?::text[])`, sources);
  }

  const roles = parseList(query.role);
  const userStatuses = expandUserStatuses(parseList(query.userStatus));
  if (roles.length || userStatuses.length) {
    const joinBits = [
      `lower(trim(u.full_name)) = lower(trim(map_points.owner_name))`,
      `map_points.owner_name IS NOT NULL`,
      `trim(map_points.owner_name) <> ''`,
    ];
    if (roles.length === 1) {
      params.push(roles[0]);
      joinBits.push(`u.role_name = $${params.length}`);
    } else if (roles.length > 1) {
      params.push(roles);
      joinBits.push(`u.role_name = ANY($${params.length}::text[])`);
    }
    if (userStatuses.length === 1) {
      params.push(userStatuses[0]);
      joinBits.push(`u.status = $${params.length}`);
    } else if (userStatuses.length > 1) {
      params.push(userStatuses);
      joinBits.push(`u.status = ANY($${params.length}::text[])`);
    }
    bits.push(`EXISTS (SELECT 1 FROM crm_users u WHERE ${joinBits.join(' AND ')})`);
  }

  return bits;
}

function cellKey(gx, gy) {
  return `${gx.toFixed(5)},${gy.toFixed(5)}`;
}

function cellPolygon(gx, gy, cell) {
  const x2 = gx + cell;
  const y2 = gy + cell;
  return {
    type: 'Polygon',
    coordinates: [[[gx, gy], [x2, gy], [x2, y2], [gx, y2], [gx, gy]]],
  };
}

function classify(leads, visits) {
  if (visits <= 0) return 'untouched';
  const ratio = visits / Math.max(leads, 1);
  if (ratio < 0.08) return 'thin';
  return 'covered';
}

function opportunityScore(leads, stale, visits) {
  const untouchedBoost = visits <= 0 ? 2.4 : visits / Math.max(leads, 1) < 0.08 ? 1.4 : 0.4;
  return Math.round((leads + stale * 0.6) * untouchedBoost);
}

// GET /api/coverage/grid?bbox=&zoom=&days=&mode=untouched|coverage|heat
coverage.get('/grid', async (req, res) => {
  try {
    const bbox = String(req.query.bbox || '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n))) {
      return res.status(400).json({ error: 'bbox=minLng,minLat,maxLng,maxLat required' });
    }
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const zoom = Number(req.query.zoom) || 10;
    const cell = Math.max(0.004, Math.min(0.3, Number(req.query.cell) || cellSizeForZoom(zoom)));
    const days = Math.min(Math.max(Number(req.query.days) || 90, 7), 730);
    const minLeads = Math.min(Math.max(Number(req.query.minLeads) || 3, 1), 50);
    const mode = String(req.query.mode || 'untouched');

    const leadParams = [minLng, minLat, maxLng, maxLat];
    const leadBits = addSharedFilters(req.query, leadParams, { forMeetings: false });
    leadParams.push(days);
    const daysLeadIdx = leadParams.length;

    const visitParams = [minLng, minLat, maxLng, maxLat];
    const visitBits = addSharedFilters(req.query, visitParams, { forMeetings: true });
    visitParams.push(days);
    const daysVisitIdx = visitParams.length;

    const leadWhere = [
      `layer = 'leads'`, `geom IS NOT NULL`,
      `geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`,
      ...leadBits,
    ].join(' AND ');

    const visitWhere = [
      `layer = 'meetings'`, `geom IS NOT NULL`,
      `precision IN ('exact','approx')`,
      `geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`,
      ...visitBits,
      `record_ts >= (now() AT TIME ZONE 'Asia/Kolkata') - ($${daysVisitIdx}::int * interval '1 day')`,
    ].join(' AND ');

    const ghostParams = [minLng, minLat, maxLng, maxLat];
    const ghostBits = addSharedFilters(req.query, ghostParams, { forMeetings: false });
    ghostParams.push(days);
    const daysGhostIdx = ghostParams.length;

    const [leadRows, visitRows, heatRows, ghostRows] = await Promise.all([
      q(`
        SELECT
          (floor(lng / ${cell}) * ${cell}) AS gx,
          (floor(lat / ${cell}) * ${cell}) AS gy,
          COUNT(*)::int AS leads,
          COUNT(*) FILTER (
            WHERE record_ts < (now() AT TIME ZONE 'Asia/Kolkata')
              - ($${daysLeadIdx}::int * interval '1 day')
          )::int AS stale
        FROM map_points
        WHERE ${leadWhere}
        GROUP BY 1, 2`, leadParams),
      q(`
        SELECT
          (floor(lng / ${cell}) * ${cell}) AS gx,
          (floor(lat / ${cell}) * ${cell}) AS gy,
          COUNT(*)::int AS visits,
          MAX(record_ts) AS last_visit
        FROM map_points
        WHERE ${visitWhere}
        GROUP BY 1, 2`, visitParams),
      mode === 'heat'
        ? q(`
            SELECT lng, lat
            FROM map_points
            WHERE ${visitWhere}
            ORDER BY record_ts DESC NULLS LAST
            LIMIT 8000`, visitParams)
        : Promise.resolve({ rows: [] }),
      q(`
        SELECT territory, COUNT(*)::int AS leads
        FROM map_points
        WHERE layer = 'leads' AND geom IS NOT NULL
          AND territory IS NOT NULL AND territory <> ''
          AND geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
          ${ghostBits.length ? `AND ${ghostBits.join(' AND ')}` : ''}
        GROUP BY territory
        HAVING COUNT(*) >= 12
          AND NOT EXISTS (
            SELECT 1 FROM map_points m
            WHERE m.layer = 'meetings'
              AND m.geom IS NOT NULL
              AND m.precision IN ('exact','approx')
              AND m.territory IS NOT NULL
              AND m.territory = map_points.territory
              AND m.record_ts >= (now() AT TIME ZONE 'Asia/Kolkata')
                - ($${daysGhostIdx}::int * interval '1 day')
          )
        ORDER BY COUNT(*) DESC
        LIMIT 8`, ghostParams).catch(() => ({ rows: [] })),
    ]);

    const merged = new Map();
    for (const r of leadRows.rows) {
      const gx = Number(r.gx);
      const gy = Number(r.gy);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      merged.set(cellKey(gx, gy), {
        gx, gy,
        leads: Number(r.leads) || 0,
        stale: Number(r.stale) || 0,
        visits: 0,
        lastVisit: null,
      });
    }
    for (const r of visitRows.rows) {
      const gx = Number(r.gx);
      const gy = Number(r.gy);
      if (!Number.isFinite(gx) || !Number.isFinite(gy)) continue;
      const k = cellKey(gx, gy);
      const cur = merged.get(k) || { gx, gy, leads: 0, stale: 0, visits: 0, lastVisit: null };
      cur.visits = Number(r.visits) || 0;
      cur.lastVisit = r.last_visit || null;
      merged.set(k, cur);
    }

    let cells = [...merged.values()]
      .filter((c) => c.leads >= minLeads || c.visits > 0)
      .map((c) => {
        const kind = classify(c.leads, c.visits);
        return {
          ...c,
          kind,
          score: opportunityScore(c.leads, c.stale, c.visits),
        };
      });

    if (mode === 'untouched') {
      cells = cells.filter((c) => c.kind === 'untouched' && c.leads >= minLeads);
    } else if (mode === 'thin') {
      cells = cells.filter((c) => c.kind === 'thin' || c.kind === 'untouched');
    }

    cells.sort((a, b) => b.score - a.score);
    const truncated = cells.length > 700;
    if (truncated) cells = cells.slice(0, 700);

    const features = cells.map((c) => ({
      type: 'Feature',
      geometry: cellPolygon(c.gx, c.gy, cell),
      properties: {
        id: `z:${c.gx.toFixed(4)},${c.gy.toFixed(4)}`,
        kind: c.kind,
        leads: c.leads,
        stale: c.stale,
        visits: c.visits,
        score: c.score,
        lastVisit: c.lastVisit,
        lng: c.gx + cell / 2,
        lat: c.gy + cell / 2,
      },
    }));

    const heat = {
      type: 'FeatureCollection',
      features: (heatRows.rows || []).map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
        properties: { w: 1 },
      })).filter((f) => Number.isFinite(f.geometry.coordinates[0])),
    };

    const top = cells.slice(0, 8).map((c) => ({
      id: `z:${c.gx.toFixed(4)},${c.gy.toFixed(4)}`,
      kind: c.kind,
      leads: c.leads,
      stale: c.stale,
      visits: c.visits,
      score: c.score,
      lastVisit: c.lastVisit,
      lng: c.gx + cell / 2,
      lat: c.gy + cell / 2,
    }));

    const summary = {
      cells: cells.length,
      untouched: cells.filter((c) => c.kind === 'untouched').length,
      thin: cells.filter((c) => c.kind === 'thin').length,
      covered: cells.filter((c) => c.kind === 'covered').length,
      leads: cells.reduce((s, c) => s + c.leads, 0),
      visits: cells.reduce((s, c) => s + c.visits, 0),
    };

    res.json({
      type: 'FeatureCollection',
      features,
      heat,
      top,
      ghosts: (ghostRows.rows || []).map((r) => ({
        territory: r.territory,
        leads: r.leads,
      })),
      meta: {
        mode, days, cell, zoom, minLeads, truncated, summary,
      },
    });
  } catch (e) {
    console.error('[coverage/grid]', e);
    res.status(500).json({ error: e.message || 'coverage failed' });
  }
});
