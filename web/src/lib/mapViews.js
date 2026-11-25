const SAVED_KEY = 'circo.mapViews.v1';
const FIELD_KEY = 'circo.fieldMode';

export function isFieldMode() {
  try {
    return localStorage.getItem(FIELD_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFieldMode(on) {
  try {
    localStorage.setItem(FIELD_KEY, on ? '1' : '0');
  } catch { /* */ }
}

export function packMapView({
  active, insightMode, insightDays, center, zoom,
}) {
  return {
    v: 1,
    layers: [...active],
    insight: insightMode || 'off',
    days: insightDays || 90,
    center: center?.length === 2 ? [Number(center[0]), Number(center[1])] : null,
    zoom: zoom != null ? Number(zoom) : null,
  };
}

export function encodeShareHash(view) {
  try {
    const json = JSON.stringify(view);
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `#m=${b64}`;
  } catch {
    return '';
  }
}

export function decodeShareHash(hash) {
  if (!hash) return null;
  const raw = String(hash).replace(/^#/, '');
  const m = raw.match(/^m=([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  try {
    const pad = m[1].length % 4 ? '='.repeat(4 - (m[1].length % 4)) : '';
    const b64 = (m[1] + pad).replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function loadSavedViews() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveNamedView(name, view) {
  const list = loadSavedViews().filter((v) => v.name !== name);
  list.unshift({
    name,
    savedAt: new Date().toISOString(),
    view,
  });
  const trimmed = list.slice(0, 12);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(trimmed));
  } catch { /* */ }
  return trimmed;
}