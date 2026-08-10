const qs = (o) => new URLSearchParams(
  Object.entries(o).filter(([, v]) => v != null && v !== '')).toString();

const TOKEN_KEY = 'appToken';

export function getAppToken() {
  return typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem(TOKEN_KEY) : null;
}

export function setAppToken(token) {
  if (typeof sessionStorage === 'undefined') return;
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

const authHeaders = (extra = {}) => {
  const h = { 'Content-Type': 'application/json', ...extra };
  const token = getAppToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
};

async function jfetch(url, opts = {}) {
  const headers = { ...authHeaders(), ...(opts.headers || {}) };
  let r;
  try {
    r = await fetch(url, { ...opts, headers });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    const err = new Error(e.message || 'network error');
    err.cause = e;
    throw err;
  }
  if (r.status === 401) {
    setAppToken(null);
    try {
      window.dispatchEvent(new CustomEvent('circo:unauthorized'));
    } catch { /* */ }
    const err = new Error('unauthorized');
    err.status = 401;
    throw err;
  }
  if (!r.ok) {
    let msg = `${r.status}`;
    try { const b = await r.json(); msg = b.error || msg; } catch { /* */ }
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/csv')) return r.text();
  return r.json();
}

export async function fetchAuthStatus() {
  const r = await fetch('/api/auth/status');
  if (!r.ok) throw new Error('auth status failed');
  return r.json();
}

export async function login(password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password || '' }),
  });
  if (!r.ok) {
    let msg = 'invalid password';
    try { const b = await r.json(); msg = b.error || msg; } catch { /* */ }
    throw new Error(msg);
  }
  const data = await r.json();
  setAppToken(data.token);
  return data;
}

export function logout() {
  setAppToken(null);
}

export async function fetchMe() {
  return jfetch('/api/auth/me');
}

const LAYER_FILTER_KEYS = new Set([
  'owner', 'territory', 'status', 'precision', 'from', 'to', 'joint', 'limit',
]);

function layerQuery(filters = {}) {
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    if (!LAYER_FILTER_KEYS.has(k)) continue;
    if (v == null || v === '') continue;
    out[k] = v;
  }
  return out;
}

export async function fetchLayer(layer, bbox, filters, opts = {}) {
  return jfetch(
    `/api/layers/${layer}?${qs({ bbox: bbox.join(','), ...layerQuery(filters) })}`,
    opts,
  );
}

export async function fetchLayerFeature(layer, id, opts = {}) {
  return jfetch(`/api/layers/${layer}/feature/${encodeURIComponent(id)}`, opts);
}
export const fetchStats = () => jfetch('/api/meta/stats');
export const fetchFilters = () => jfetch('/api/meta/filters');

export const fetchMapsSession = () => jfetch('/api/meta/maps');
export const fetchMapsViewport = (params) =>
  jfetch(`/api/meta/maps/viewport?${qs(params)}`);

export const fetchGapsSummary = () => jfetch('/api/gaps/summary');
export const fetchGaps = (params) => jfetch(`/api/gaps?${qs(params)}`);

export const fetchDiscSummary = () => jfetch('/api/discrepancies/summary');
export const fetchDiscrepancies = (params) => jfetch(`/api/discrepancies?${qs(params)}`);
export const fetchDiscrepancyDetail = (layer, id) =>
  jfetch(`/api/discrepancies/${layer}/${encodeURIComponent(id)}`);
export const exportDiscrepanciesCsv = (params) =>
  jfetch(`/api/discrepancies/export.csv?${qs(params)}`);

export const fetchAdminDashboard = () => jfetch('/api/admin/dashboard');
export const fetchAdminJob = () => jfetch('/api/admin/job');
export const fetchZohoStatus = () => jfetch('/api/admin/zoho/status');
export const refreshZohoToken = () =>
  jfetch('/api/admin/zoho/refresh', { method: 'POST', body: '{}' });
export const exchangeZohoCode = (code) =>
  jfetch('/api/admin/zoho/exchange-code', {
    method: 'POST', body: JSON.stringify({ code }),
  });
export const triggerSync = () =>
  jfetch('/api/admin/sync', { method: 'POST', body: '{}' });
export const triggerAssetsSync = () =>
  jfetch('/api/admin/sync/assets', { method: 'POST', body: '{}' });
export const triggerRegeocode = (body = {}) =>
  jfetch('/api/admin/regeocode', {
    method: 'POST', body: JSON.stringify(body),
  });
export const triggerRebuildDiscrepancies = () =>
  jfetch('/api/admin/rebuild-discrepancies', { method: 'POST', body: '{}' });
export const clearFailedCache = () =>
  jfetch('/api/admin/cache/clear-failed', { method: 'POST', body: '{}' });
export const clearAllCache = () =>
  jfetch('/api/admin/cache/clear-all', { method: 'POST', body: '{}' });
export const refreshTerritories = () =>
  jfetch('/api/admin/territory-centroids/refresh', {
    method: 'POST', body: '{}',
  });
export const overridePoint = (layer, id, { lat, lng, notes }) =>
  jfetch(`/api/admin/points/${layer}/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ lat, lng, notes }),
  });
export const bulkOverride = (csv) =>
  jfetch('/api/admin/points/bulk', {
    method: 'POST', body: JSON.stringify({ csv }),
  });
export const markGapReviewed = (layer, id, notes) =>
  jfetch(`/api/admin/gaps/${layer}/${encodeURIComponent(id)}/review`, {
    method: 'POST', body: JSON.stringify({ notes }),
  });
export const searchPoints = (q, layer) =>
  jfetch(`/api/admin/points/search?${qs({ q, layer })}`);
export const fetchCacheSample = (failed) =>
  jfetch(`/api/admin/cache/sample?failed=${failed ? 1 : 0}`);

export const fetchActivityWalk = (params) =>
  jfetch(`/api/activity/walk?${qs(params)}`);
export const fetchActivityCompare = (params) =>
  jfetch(`/api/activity/compare?${qs(params)}`);

// Smart Route Planning
export const fetchRouteCandidates = (params) =>
  jfetch(`/api/routes/candidates?${qs(params)}`);
export const fetchRouteNearby = (params) =>
  jfetch(`/api/routes/nearby?${qs(params)}`);
export const optimizeRoute = (body) =>
  jfetch('/api/routes/optimize', {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const fetchRoutePlan = (owner, date) =>
  jfetch(`/api/routes/plans/${encodeURIComponent(owner)}/${encodeURIComponent(date)}`);
export const saveRoutePlan = (owner, date, body) =>
  jfetch(`/api/routes/plans/${encodeURIComponent(owner)}/${encodeURIComponent(date)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
export const deleteRoutePlan = (owner, date) =>
  jfetch(`/api/routes/plans/${encodeURIComponent(owner)}/${encodeURIComponent(date)}`, {
    method: 'DELETE',
  });

/** Save plan (optional body) and return share token / path for RM mobile view. */
export const shareRoutePlan = (owner, date, body) =>
  jfetch(`/api/routes/plans/${encodeURIComponent(owner)}/${encodeURIComponent(date)}/share`, {
    method: 'POST',
    body: JSON.stringify(body || {}),
  });

/** Public shared day route (token only; no login). */
export const fetchSharedRoute = (token) =>
  jfetch(`/api/routes/share/${encodeURIComponent(token)}`);

/** Multi-stop or single-destination Google Maps navigation URL. */
export function googleMapsNavUrl(stops, origin) {
  const pts = (stops || []).filter(
    (s) => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)),
  );
  if (!pts.length) return null;
  if (pts.length === 1) {
    return `https://www.google.com/maps/dir/?api=1&destination=${pts[0].lat},${pts[0].lng}&travelmode=driving`;
  }
  const originStr = origin && Number.isFinite(Number(origin.lat))
    ? `${origin.lat},${origin.lng}`
    : `${pts[0].lat},${pts[0].lng}`;
  const dest = pts[pts.length - 1];
  const waypoints = pts.slice(0, -1)
    .map((s) => `${s.lat},${s.lng}`)
    .join('|');
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', originStr);
  u.searchParams.set('destination', `${dest.lat},${dest.lng}`);
  if (waypoints) u.searchParams.set('waypoints', waypoints);
  u.searchParams.set('travelmode', 'driving');
  return u.toString();
}

export function googleMapsStopUrl(stop) {
  if (!stop || !Number.isFinite(Number(stop.lat)) || !Number.isFinite(Number(stop.lng))) {
    return null;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lng}&travelmode=driving`;
}
