import { q } from './db.js';

export const MAP_MARKER_STYLES = ['pins-heat', 'pins', 'heat', 'clusters'];
export const DEFAULT_MAP_MARKER_STYLE = 'pins-heat';

export function normalizeMapMarkerStyle(v) {
  const id = typeof v === 'string' ? v : v?.style;
  return MAP_MARKER_STYLES.includes(id) ? id : DEFAULT_MAP_MARKER_STYLE;
}

export async function getMapMarkerStyle() {
  try {
    const r = await q(`SELECT value FROM app_settings WHERE key = 'map_marker_style'`);
    return normalizeMapMarkerStyle(r.rows[0]?.value);
  } catch {
    return DEFAULT_MAP_MARKER_STYLE;
  }
}

export async function setMapMarkerStyle(style) {
  const next = normalizeMapMarkerStyle(style);
  await q(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('map_marker_style', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ style: next })],
  );
  return next;
}
