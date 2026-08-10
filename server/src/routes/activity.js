import { Router } from 'express';
import { q } from '../db.js';
import {
  dayBoundsIST,
  rangeBoundsIST,
  normalizeStop,
  buildWalkPayload,
  aggregateOwner,
} from '../activity/metrics.js';

export const activity = Router();

const MEETING_COLS = `
  source_id, title, owner_name, territory, status, record_ts,
  lat, lng, precision, crm_url, extra
`;

activity.get('/walk', async (req, res) => {
  try {
    const owner = (req.query.owner || '').trim();
    const date = (req.query.date || '').trim();
    if (!owner) return res.status(400).json({ error: 'owner is required' });
    if (!date) return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });

    let bounds;
    try {
      bounds = dayBoundsIST(date);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { rows } = await q(
      `SELECT ${MEETING_COLS}
       FROM map_points
       WHERE layer = 'meetings'
         AND owner_name = $1
         AND record_ts >= $2::timestamptz
         AND record_ts <= $3::timestamptz
       ORDER BY
         COALESCE(
           NULLIF(extra->>'checkin_time', '')::timestamptz,
           record_ts
         ) ASC NULLS LAST,
         source_id ASC`,
      [owner, bounds.start, bounds.end],
    );

    const meetings = rows.map((r, i) => normalizeStop(r, i + 1));
    meetings.sort((a, b) => (a.sortTs ?? Infinity) - (b.sortTs ?? Infinity)
      || String(a.id).localeCompare(String(b.id)));
    meetings.forEach((s, i) => { s.order = i + 1; });

    const payload = buildWalkPayload(meetings);

    res.json({
      owner,
      date,
      timezone: 'Asia/Kolkata',
      ...payload,
    });
  } catch (e) {
    console.error('[activity/walk]', e);
    res.status(500).json({ error: e.message || 'walk failed' });
  }
});

activity.get('/compare', async (req, res) => {
  try {
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required (YYYY-MM-DD)' });
    }

    let bounds;
    try {
      bounds = rangeBoundsIST(from, to);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Cap range so compare stays responsive (full meeting rows + in-memory agg)
    const fromMs = new Date(bounds.start).getTime();
    const toMs = new Date(bounds.end).getTime();
    const daySpan = Math.floor((toMs - fromMs) / 864e5) + 1;
    if (daySpan > 31) {
      return res.status(400).json({ error: 'compare range must be 31 days or less' });
    }

    const territory = (req.query.territory || '').trim();
    const sort = (req.query.sort || 'path_km').trim();
    const allowedSort = new Set(['path_km', 'checkin_rate', 'late_rate', 'meetings']);
    if (!allowedSort.has(sort)) {
      return res.status(400).json({ error: `sort must be one of ${[...allowedSort].join(', ')}` });
    }

    const params = [bounds.start, bounds.end];
    let terrClause = '';
    if (territory) {
      params.push(territory);
      terrClause = ` AND territory = $${params.length}`;
    }

    const { rows } = await q(
      `SELECT ${MEETING_COLS}
       FROM map_points
       WHERE layer = 'meetings'
         AND owner_name IS NOT NULL AND owner_name <> ''
         AND record_ts >= $1::timestamptz
         AND record_ts <= $2::timestamptz
         ${terrClause}`,
      params,
    );

    const byOwner = new Map();
    for (const r of rows) {
      const stop = normalizeStop(r, 0);
      if (!stop.owner) continue;
      if (!byOwner.has(stop.owner)) byOwner.set(stop.owner, []);
      byOwner.get(stop.owner).push(stop);
    }

    const owners = [...byOwner.entries()]
      .map(([owner, stops]) => aggregateOwner(owner, stops, sort))
      .sort((a, b) => {
        const av = Number(a[sort]) || 0;
        const bv = Number(b[sort]) || 0;
        if (bv !== av) return bv - av;
        return String(a.owner).localeCompare(String(b.owner));
      });

    res.json({
      from,
      to,
      territory: territory || null,
      sort,
      timezone: 'Asia/Kolkata',
      total_owners: owners.length,
      owners,
    });
  } catch (e) {
    console.error('[activity/compare]', e);
    res.status(500).json({ error: e.message || 'compare failed' });
  }
});
