/** Canonical territory filter groups (UI shows these 7 only). */
export const TERRITORY_GROUPS = {
  Mumbai: {
    label: 'Mumbai',
    // MMR: city + Thane / Navi Mumbai / Kalyan etc.
    pattern:
      'mumbai|thane|kalyan|dombiv|navi[[:space:]]*mumba|raigad|raigarh|palghar|panvel|vasai|virar|mira[[:space:]]*bhay|ulhasnagar|badlapur|taloja|ghatkopar|malad',
  },
  Delhi: {
    label: 'Delhi',
    // NCR
    pattern:
      'delhi|\\yncr\\y|noida|gurugram|gurgaon|faridabad|ghaziabad|gautam',
  },
  Goa: {
    label: 'Goa',
    pattern: '\\ygoa\\y|panaji|panjim',
  },
  Hyderabad: {
    label: 'Hyderabad',
    pattern: 'hyderabad|rangareddy|ranga[[:space:]]*reddy',
  },
  Chennai: {
    label: 'Chennai',
    pattern: 'chennai|tiruvallur|thiruvallur',
  },
  Bangalore: {
    label: 'Bangalore',
    pattern: 'bangalore|bengaluru',
  },
  Pune: {
    label: 'Pune',
    pattern: '\\ypune\\y|pimpri|chinchwad',
  },
};

export const TERRITORY_GROUP_KEYS = Object.keys(TERRITORY_GROUPS);

/** Split comma-separated or repeated Express query values into a clean list. */
export function parseList(value) {
  if (value == null || value === '') return [];
  const raw = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const part of raw) {
    for (const piece of String(part).split(',')) {
      const v = piece.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

/** Map UI active/inactive → CRM Users.Status values. */
export function expandUserStatuses(list) {
  const out = new Set();
  for (const s of list) {
    const k = String(s).toLowerCase();
    if (k === 'active') out.add('active');
    else if (k === 'inactive' || k === 'disabled') out.add('disabled');
  }
  return [...out];
}

/**
 * Append map-point filter clauses for multi-select query params.
 * Mutates `params` and returns WHERE fragments (without leading AND).
 */
export function buildMapFilterClauses(query, params, { layer } = {}) {
  const wheres = [];
  const add = (sql, v) => {
    params.push(v);
    wheres.push(sql.replace(/\?/g, `$${params.length}`));
  };
  const addAny = (sql, values) => {
    params.push(values);
    wheres.push(sql.replace(/\?/g, `$${params.length}`));
  };

  const owners = parseList(query.owner);
  if (owners.length === 1) add(`owner_name = ?`, owners[0]);
  else if (owners.length > 1) addAny(`owner_name = ANY(?::text[])`, owners);

  const territories = parseList(query.territory)
    .map((t) => TERRITORY_GROUPS[t] ? t : null)
    .filter(Boolean);
  if (territories.length) {
    const patterns = territories.map((k) => TERRITORY_GROUPS[k].pattern);
    params.push(patterns);
    wheres.push(
      `territory IS NOT NULL AND territory <> '' AND EXISTS (
         SELECT 1 FROM unnest($${params.length}::text[]) AS pat(p)
         WHERE territory ~* ('(?:' || pat.p || ')')
       )`,
    );
  }

  const statuses = parseList(query.status);
  if (statuses.length === 1) add(`status = ?`, statuses[0]);
  else if (statuses.length > 1) addAny(`status = ANY(?::text[])`, statuses);

  const precisions = parseList(query.precision);
  if (precisions.length === 1) add(`precision = ?`, precisions[0]);
  else if (precisions.length > 1) addAny(`precision = ANY(?::text[])`, precisions);

  // Lead Source lives on leads.extra.source — other layers stay unfiltered.
  const sources = parseList(query.source);
  if (sources.length && layer === 'leads') {
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
    wheres.push(
      `EXISTS (
         SELECT 1 FROM crm_users u
         WHERE ${joinBits.join(' AND ')}
       )`,
    );
  }

  if (query.from) {
    const from = String(query.from);
    const bound = /^\d{4}-\d{2}-\d{2}$/.test(from)
      ? `${from}T00:00:00+05:30` : from;
    add(`record_ts >= ?::timestamptz`, bound);
  }
  if (query.to) {
    const to = String(query.to);
    const bound = /^\d{4}-\d{2}-\d{2}$/.test(to)
      ? `${to}T23:59:59.999+05:30` : to;
    add(`record_ts <= ?::timestamptz`, bound);
  }

  if (query.joint != null && query.joint !== '' && layer === 'meetings') {
    const j = String(query.joint).toLowerCase();
    if (j === 'true' || j === '1' || j === 'yes') {
      wheres.push(`COALESCE((extra->>'joint')::boolean, false) = true`);
    } else if (j === 'false' || j === '0' || j === 'no') {
      wheres.push(`COALESCE((extra->>'joint')::boolean, false) = false`);
    }
  }

  return wheres;
}
