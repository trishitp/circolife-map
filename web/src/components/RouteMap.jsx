import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { resolveBasemapStyle } from '../lib/basemap';

maplibregl.setWorkerUrl('/maplibre-worker.js');

const PLAN_COLOR = '#2F7A95';
const CAND_COLOR = '#8A8494';
const NEAR_COLOR = '#C45C26';
const ROAD_COLOR = '#2F6B4F';
const START_COLOR = '#2F6B4F';
const END_COLOR = '#2E1F40';
const FALLBACK_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

/**
 * Routes map: planned numbered pins, muted candidates, solid road polyline.
 */
export default function RouteMap({
  planStops = [],
  candidates = [],
  nearby = [],
  routeCoords = [],
  selectedId,
  onSelectStop,
  className = '',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const markersRef = useRef([]);
  const propsRef = useRef({ planStops, candidates, nearby, routeCoords, selectedId, onSelectStop });
  propsRef.current = { planStops, candidates, nearby, routeCoords, selectedId, onSelectStop };
  const fitKeyRef = useRef('');

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    let cancelled = false;
    let map;
    let ro;
    let usedFallback = false;

    const ensureLayers = (m) => {
      if (!m.getSource('route-line')) {
        m.addSource('route-line', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
      }
      const add = (id, spec) => { if (!m.getLayer(id)) m.addLayer(spec); };
      add('route-line-case', {
        id: 'route-line-case',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#FFFCFA', 'line-width': 9, 'line-opacity': 0.95 },
      });
      add('route-line', {
        id: 'route-line',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROAD_COLOR, 'line-width': 5, 'line-opacity': 0.92 },
      });
    };

    const paint = () => {
      if (!map || !readyRef.current) return;
      applyRouteData(map, markersRef, propsRef, fitKeyRef);
    };

    (async () => {
      let style = FALLBACK_STYLE;
      try {
        const resolved = await resolveBasemapStyle();
        style = resolved.style;
      } catch { /* */ }
      if (cancelled || !containerRef.current) return;

      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [78.96, 22.59],
        zoom: 4.2,
        attributionControl: false,
        failIfMajorPerformanceCaveat: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current = map;

      const wire = () => {
        if (cancelled) return;
        readyRef.current = false;
        ensureLayers(map);
        readyRef.current = true;
        try { map.resize(); } catch { /* */ }
        paint();
      };
      map.on('load', wire);
      map.on('style.load', () => { readyRef.current = false; wire(); });
      map.on('error', (e) => {
        const msg = e?.error?.message || '';
        if (msg) console.warn('[RouteMap]', msg);
        if (!usedFallback && /style|fetch|failed|403|404|network/i.test(msg)) {
          usedFallback = true;
          map.setStyle(FALLBACK_STYLE);
        }
      });
      ro = new ResizeObserver(() => {
        try { map.resize(); paint(); } catch { /* */ }
      });
      ro.observe(containerRef.current);
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      clearMarkers(markersRef);
      ro?.disconnect();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyRouteData(map, markersRef, propsRef, fitKeyRef, true);
  }, [planStops, candidates, nearby, routeCoords]);

  useEffect(() => {
    for (const m of markersRef.current) {
      m.el.classList.toggle('is-selected', m.id === selectedId);
    }
  }, [selectedId]);

  return (
    <div
      className={['route-map', className].filter(Boolean).join(' ')}
      ref={containerRef}
      role="img"
      aria-label="Route plan map"
    />
  );
}

function clearMarkers(markersRef) {
  for (const m of markersRef.current) {
    try { m.marker.remove(); } catch { /* */ }
  }
  markersRef.current = [];
}

function emptyFC() {
  return { type: 'FeatureCollection', features: [] };
}

function applyRouteData(map, markersRef, propsRef, fitKeyRef, refit = true) {
  const {
    planStops, candidates, nearby, routeCoords, selectedId, onSelectStop,
  } = propsRef.current;
  const lineSrc = map.getSource('route-line');
  if (!lineSrc) return;

  const coords = (routeCoords || []).filter(
    (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
  );
  if (coords.length >= 2) {
    lineSrc.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      }],
    });
  } else if ((planStops || []).length >= 2) {
    // Dashed straight connectors when not yet optimized
    const line = planStops
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map((s) => [s.lng, s.lat]);
    lineSrc.setData({
      type: 'FeatureCollection',
      features: line.length >= 2
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: {} }]
        : [],
    });
  } else {
    lineSrc.setData(emptyFC());
  }

  clearMarkers(markersRef);
  const planIds = new Set((planStops || []).map((s) => s.id));

  // Candidates not in plan — muted dots
  for (const s of candidates || []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    if (planIds.has(s.id)) continue;
    addMarker(map, markersRef, {
      id: s.id,
      lngLat: [s.lng, s.lat],
      kind: 'candidate',
      label: '',
      title: s.title,
      selected: s.id === selectedId,
      onSelect: onSelectStop,
    });
  }

  // Nearby drop-ins not in plan
  for (const s of nearby || []) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    if (planIds.has(s.id)) continue;
    addMarker(map, markersRef, {
      id: s.id,
      lngLat: [s.lng, s.lat],
      kind: 'nearby',
      label: '',
      title: s.title,
      selected: s.id === selectedId,
      onSelect: onSelectStop,
    });
  }

  // Plan pins numbered
  (planStops || []).forEach((s, idx) => {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
    const role = idx === 0 ? 'start' : (idx === planStops.length - 1 && planStops.length > 1 ? 'end' : 'plan');
    addMarker(map, markersRef, {
      id: s.id,
      lngLat: [s.lng, s.lat],
      kind: role,
      label: String(s.order || idx + 1),
      title: s.title,
      selected: s.id === selectedId,
      onSelect: onSelectStop,
    });
  });

  if (!refit) return;
  const key = [
    ...(planStops || []).map((s) => s.id),
    coords.length,
  ].join('|');
  if (fitKeyRef.current === key) return;
  fitKeyRef.current = key;

  const bounds = new maplibregl.LngLatBounds();
  let n = 0;
  for (const c of coords) { bounds.extend(c); n++; }
  for (const s of planStops || []) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
      bounds.extend([s.lng, s.lat]);
      n++;
    }
  }
  for (const s of candidates || []) {
    if (Number.isFinite(s.lat) && Number.isFinite(s.lng) && !planIds.has(s.id)) {
      bounds.extend([s.lng, s.lat]);
      n++;
    }
  }
  if (n === 0 || bounds.isEmpty()) return;
  try {
    map.fitBounds(bounds, {
      padding: { top: 72, bottom: 88, left: 48, right: 48 },
      maxZoom: 13.5,
      duration: 400,
    });
  } catch { /* */ }
}

function addMarker(map, markersRef, {
  id, lngLat, kind, label, title, selected, onSelect,
}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = [
    'route-pin',
    `route-pin--${kind}`,
    selected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');
  el.setAttribute('aria-label', title || id);
  el.title = title || '';

  if (kind === 'candidate' || kind === 'nearby') {
    el.innerHTML = `<span class="route-pin-dot"></span>`;
  } else {
    el.innerHTML = `
      <span class="route-pin-body">
        <svg viewBox="0 0 36 46" width="32" height="40" aria-hidden="true">
          <path fill="currentColor" stroke="#FFFCFA" stroke-width="2.5"
            d="M18 2C10.3 2 4 8.3 4 16.1 4 26.4 18 44 18 44s14-17.6 14-27.9C32 8.3 25.7 2 18 2z"/>
        </svg>
        <span class="route-pin-num">${label}</span>
      </span>`;
  }

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    onSelect?.(id);
  });

  const marker = new maplibregl.Marker({
    element: el,
    anchor: kind === 'candidate' || kind === 'nearby' ? 'center' : 'bottom',
  }).setLngLat(lngLat).addTo(map);

  markersRef.current.push({ id, marker, el });
}
