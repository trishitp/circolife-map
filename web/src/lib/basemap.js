// Google Maps basemap via Map Tiles API (roadmap), rendered in MapLibre.
// Falls back to Carto Voyager only if Google is unavailable.

import { fetchMapsSession, fetchMapsViewport } from './api';

const VOYAGER = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
const POSITRON = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

const GOOGLE_LOGO = 'https://maps.gstatic.com/mapfiles/api-3/images/google_gray.svg';

export function buildGoogleStyle(sessionPayload) {
  const { session, key, tileWidth = 256 } = sessionPayload;
  const tiles = [
    `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`,
  ];
  return {
    version: 8,
    name: 'Google Maps',
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      google: {
        type: 'raster',
        tiles,
        tileSize: tileWidth,
        attribution: '© Google',
        maxzoom: 22,
      },
    },
    layers: [
      {
        id: 'google-roadmap',
        type: 'raster',
        source: 'google',
        paint: { 'raster-fade-duration': 0 },
      },
    ],
  };
}

export async function resolveBasemapStyle() {
  try {
    const maps = await fetchMapsSession();
    if (!maps?.enabled || !maps.session || !maps.key) {
      throw new Error(maps?.error || 'Google Maps not enabled');
    }
    return {
      style: buildGoogleStyle(maps),
      id: 'google',
      provider: 'google',
      session: maps.session,
      expiry: maps.expiry,
      key: maps.key,
    };
  } catch (e) {
    console.warn('[basemap] Google unavailable, using Voyager', e.message);
    try {
      const r = await fetch(VOYAGER);
      if (!r.ok) throw new Error(`voyager ${r.status}`);
      return { style: await r.json(), id: 'voyager', provider: 'carto' };
    } catch (e2) {
      console.warn('[basemap] voyager unavailable, using Positron', e2.message);
      return { style: POSITRON, id: 'positron', provider: 'carto' };
    }
  }
}

/**
 * Attach Google logo (Map Tiles). Copyright text pill is omitted from the UI.
 * Returns a cleanup function.
 */
export function attachGoogleAttribution(map, sessionInfo) {
  if (!map || sessionInfo?.provider !== 'google' || !sessionInfo.session) {
    return () => {};
  }

  const container = map.getContainer();
  let logo = container.querySelector('.google-maps-logo');
  if (!logo) {
    logo = document.createElement('a');
    logo.className = 'google-maps-logo';
    logo.href = 'https://maps.google.com/';
    logo.target = '_blank';
    logo.rel = 'noopener noreferrer';
    logo.setAttribute('aria-label', 'Google Maps');
    const img = document.createElement('img');
    img.src = GOOGLE_LOGO;
    img.alt = 'Google';
    img.width = 62;
    img.height = 20;
    logo.appendChild(img);
    container.appendChild(logo);
  }

  // Hide any leftover MapLibre attrib control if a style injects one
  const hideAttrib = () => {
    container.querySelectorAll('.maplibregl-ctrl-attrib, .google-maps-attrib').forEach((el) => {
      el.style.display = 'none';
    });
  };
  hideAttrib();
  map.on('styledata', hideAttrib);

  // Keep tile session warm via light viewport ping (no UI)
  let busy = false;
  let lastKey = '';
  let refreshTimer;
  const pingViewport = async () => {
    if (busy) return;
    const b = map.getBounds?.();
    if (!b) return;
    const zoom = Math.round(map.getZoom?.() || 5);
    const key = [sessionInfo.session, zoom, b.getNorth().toFixed(2)].join('|');
    if (key === lastKey) return;
    busy = true;
    try {
      await fetchMapsViewport({
        session: sessionInfo.session,
        zoom,
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
      lastKey = key;
    } catch {
      /* non-fatal */
    } finally {
      busy = false;
    }
  };

  map.on('moveend', pingViewport);
  requestAnimationFrame(() => { pingViewport(); });

  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    const expiryMs = Number(sessionInfo.expiry) * 1000;
    if (!Number.isFinite(expiryMs)) return;
    const wait = Math.max(5 * 60e3, expiryMs - Date.now() - 60 * 60e3);
    refreshTimer = setTimeout(async () => {
      try {
        const next = await resolveBasemapStyle();
        if (next.provider !== 'google') return;
        sessionInfo.session = next.session;
        sessionInfo.expiry = next.expiry;
        sessionInfo.key = next.key;
        map.setStyle(next.style);
        lastKey = '';
        scheduleRefresh();
      } catch (e) {
        console.warn('[basemap] session refresh failed', e.message);
      }
    }, wait);
  };
  scheduleRefresh();

  return () => {
    clearTimeout(refreshTimer);
    map.off('moveend', pingViewport);
    map.off('styledata', hideAttrib);
    logo?.remove();
    container.querySelector('.google-maps-attrib')?.remove();
  };
}

export const LABEL_FONTS_BY_STYLE = {
  google: ['Open Sans Bold', 'Arial Unicode MS Bold'],
  voyager: ['Open Sans Bold', 'Arial Unicode MS Bold'],
  positron: ['Open Sans Bold', 'Arial Unicode MS Bold'],
};
