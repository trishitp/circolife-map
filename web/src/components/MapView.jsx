import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import { fetchLayer, fetchLayerFeature, fetchCoverageGrid } from '../lib/api';
import { onSelection } from '../lib/selection';
import { resolveBasemapStyle, LABEL_FONTS_BY_STYLE, attachGoogleAttribution } from '../lib/basemap';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM, INDIA_MIN_ZOOM } from '../lib/mapBounds';
import { loadMapIcons } from '../lib/acIcon';
import { normalizeMarkerStyle } from '../lib/mapMarkerStyle';

maplibregl.setWorkerUrl('/maplibre-worker.js');

const LAYER_COLORS = {
  leads: '#A14996',
  accounts: '#2E1F40',
  meetings: '#5FA9C6',
  assets: '#6BB35A',
};
const STROKE = '#FFFCFA';
const FALLBACK_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

const abbr = (n) => {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

function hexRgb(hex) {
  const n = hex.replace('#', '');
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ].join(',');
}

function heatPaint(color) {
  const rgb = hexRgb(color);
  return {
    'heatmap-weight': [
      'match', ['get', 'precision'],
      'territory', 0,
      'pincode', 0.16,
      'inherited', 0.4,
      'approx', 0.7,
      1,
    ],
    'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 0.85, 13, 1.15],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 8, 24, 12, 30],
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 10, 0.42, 13, 0.1, 15, 0],
    'heatmap-color': [
      'interpolate', ['linear'], ['heatmap-density'],
      0, 'rgba(0,0,0,0)',
      0.12, `rgba(${rgb},0.2)`,
      0.35, `rgba(${rgb},0.45)`,
      0.65, `rgba(${rgb},0.75)`,
      1, `rgba(${rgb},0.95)`,
    ],
  };
}

const PIN_OPACITY = [
  'match', ['get', 'precision'],
  'pincode', 0.55, 'territory', 0.4, 'inherited', 0.75, 1,
];

function applyMarkerStyle(m, style) {
  const s = normalizeMarkerStyle(style);
  const showHeat = s === 'pins-heat' || s === 'heat';
  const showClusters = s === 'clusters';
  const vis = (on) => (on ? 'visible' : 'none');
  for (const layer of Object.keys(LAYER_COLORS)) {
    if (m.getLayer(`${layer}-heat`)) {
      m.setLayoutProperty(`${layer}-heat`, 'visibility', vis(showHeat));
    }
    if (m.getLayer(`${layer}-pts`)) {
      m.setLayoutProperty(`${layer}-pts`, 'visibility', 'visible');
      try { m.setLayerZoomRange(`${layer}-pts`, s === 'heat' ? 11 : 0, 24); } catch { /* */ }
    }
    for (const id of [`${layer}-halo`, `${layer}-clusters`, `${layer}-cluster-icon`]) {
      if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis(showClusters));
    }
  }
}

function ensureOverlay(m, layer, color, wired, onSelect, selectedId, indexes) {
  const srcId = layer;
  if (!m.getSource(srcId)) {
    m.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }

  const add = (id, spec) => { if (!m.getLayer(id)) m.addLayer(spec); };

  add(`${layer}-heat`, {
    id: `${layer}-heat`,
    type: 'heatmap',
    source: srcId,
    filter: ['!', ['has', 'point_count']],
    paint: heatPaint(color),
  });

  add(`${layer}-halo`, {
    id: `${layer}-halo`,
    type: 'circle',
    source: srcId,
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': color,
      'circle-opacity': 0.18,
      'circle-radius': ['step', ['get', 'point_count'], 26, 50, 32, 250, 40, 1000, 48],
      'circle-blur': 0.65,
    },
  });

  add(`${layer}-clusters`, {
    id: `${layer}-clusters`,
    type: 'circle',
    source: srcId,
    filter: ['has', 'point_count'],
    layout: { visibility: 'none' },
    paint: {
      'circle-color': color,
      'circle-opacity': 0.95,
      'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 26, 500, 32, 2000, 40],
      'circle-stroke-width': 3,
      'circle-stroke-color': STROKE,
    },
  });

  if (layer === 'assets') {
    add(`${layer}-pts`, {
      id: `${layer}-pts`,
      type: 'symbol',
      source: srcId,
      layout: {
        'icon-image': 'ac-pin',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.28, 8, 0.38, 12, 0.52, 16, 0.7],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
      },
      filter: ['!', ['has', 'point_count']],
      paint: { 'icon-opacity': PIN_OPACITY },
    });
    add(`${layer}-cluster-icon`, {
      id: `${layer}-cluster-icon`,
      type: 'symbol',
      source: srcId,
      filter: ['has', 'point_count'],
      layout: {
        visibility: 'none',
        'icon-image': 'ac-glyph',
        'icon-size': ['step', ['get', 'point_count'], 0.32, 25, 0.38, 100, 0.44],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  } else {
    add(`${layer}-pts`, {
      id: `${layer}-pts`,
      type: 'symbol',
      source: srcId,
      layout: {
        'icon-image': `drop-pin-${layer}`,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.32, 8, 0.42, 12, 0.58, 16, 0.78],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'bottom',
      },
      filter: ['!', ['has', 'point_count']],
      paint: { 'icon-opacity': PIN_OPACITY },
    });
  }

  if (!wired.has(layer)) {
    wired.add(layer);
    m.on('click', `${layer}-pts`, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      e.originalEvent.stopPropagation();
      const [lng, lat] = f.geometry.coordinates;
      selectedId.current = f.properties.id;
      onSelect({ ...f.properties, _layer: layer, lng, lat });
      m.easeTo({ center: f.geometry.coordinates, offset: [0, -40], duration: 450 });
    });
    const on = () => { m.getCanvas().style.cursor = 'pointer'; };
    const off = () => { m.getCanvas().style.cursor = ''; };
    m.on('mouseenter', `${layer}-pts`, on);
    m.on('mouseleave', `${layer}-pts`, off);
    m.on('click', `${layer}-clusters`, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const cid = f.properties.cluster_id;
      const index = indexes.current[layer];
      let zoom = Math.min((m.getZoom() || 5) + 2.2, 16);
      if (index && cid != null) {
        try {
          zoom = Math.min(index.getClusterExpansionZoom(Number(cid)), 16);
        } catch { /* keep stepped zoom */ }
      }
      m.easeTo({ center: f.geometry.coordinates, zoom, duration: 500 });
    });
    m.on('mouseenter', `${layer}-clusters`, on);
    m.on('mouseleave', `${layer}-clusters`, off);
  }
}

function ensureCoverage(m, wired, onSelect) {
  if (!m.getSource('coverage')) {
    m.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!m.getSource('visit-heat')) {
    m.addSource('visit-heat', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  const add = (id, spec) => { if (!m.getLayer(id)) m.addLayer(spec); };
  add('coverage-fill', {
    id: 'coverage-fill',
    type: 'fill',
    source: 'coverage',
    paint: {
      'fill-color': [
        'match', ['get', 'kind'],
        'untouched', '#c45c4a',
        'thin', '#d4a017',
        'covered', '#6BB35A',
        '#c45c4a',
      ],
      'fill-opacity': [
        'match', ['get', 'kind'],
        'untouched', 0.38,
        'thin', 0.28,
        'covered', 0.16,
        0.3,
      ],
    },
  });
  add('coverage-line', {
    id: 'coverage-line',
    type: 'line',
    source: 'coverage',
    paint: {
      'line-color': [
        'match', ['get', 'kind'],
        'untouched', '#a33d2e',
        'thin', '#8a6a18',
        '#3d7a32',
      ],
      'line-width': 1.1,
      'line-opacity': 0.7,
    },
  });
  add('visit-heat', {
    id: 'visit-heat',
    type: 'heatmap',
    source: 'visit-heat',
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.35, 14, 1.35],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 14, 14, 32],
      'heatmap-opacity': 0.78,
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(254,249,245,0)',
        0.15, 'rgba(189,224,237,0.55)',
        0.4, 'rgba(161,73,150,0.55)',
        0.7, 'rgba(196,92,74,0.75)',
        1, 'rgba(122,36,36,0.9)',
      ],
    },
  });

  if (!wired.has('coverage')) {
    wired.add('coverage');
    m.on('click', 'coverage-fill', (e) => {
      const pointLayers = Object.keys(LAYER_COLORS)
        .flatMap((l) => [`${l}-pts`, `${l}-clusters`])
        .filter((id) => m.getLayer(id));
      if (pointLayers.length && m.queryRenderedFeatures(e.point, { layers: pointLayers }).length) {
        return;
      }
      const f = e.features?.[0];
      if (!f) return;
      e.originalEvent?.stopPropagation?.();
      const p = f.properties || {};
      const lng = Number(p.lng);
      const lat = Number(p.lat);
      onSelect({
        _layer: 'zone',
        id: p.id,
        title: p.kind === 'untouched' ? 'Untouched zone'
          : p.kind === 'thin' ? 'Thin coverage' : 'Covered zone',
        kind: p.kind,
        leads: Number(p.leads) || 0,
        stale: Number(p.stale) || 0,
        visits: Number(p.visits) || 0,
        score: Number(p.score) || 0,
        lastVisit: p.lastVisit || null,
        lng,
        lat,
      });
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        m.easeTo({ center: [lng, lat], offset: [0, -30], duration: 400 });
      }
    });
    m.on('mouseenter', 'coverage-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
    m.on('mouseleave', 'coverage-fill', () => { m.getCanvas().style.cursor = ''; });
  }
}

export default function MapView({
  active, filters, onSelect, onLoading, focusRequest, onFocusHandled, visible,
  onMapIssue, insight, onInsight, flyRequest, onFlyHandled, markerStyle,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const debounce = useRef(null);
  const abortRef = useRef(null);
  const selectedId = useRef(null);
  const ready = useRef(false);
  const featsRef = useRef({});
  const indexes = useRef({});
  const zoomRaf = useRef(null);
  const fonts = useRef(LABEL_FONTS_BY_STYLE.voyager);
  const activeRef = useRef(active);
  const filtersRef = useRef(filters);
  const onSelectRef = useRef(onSelect);
  const onLoadingRef = useRef(onLoading);
  const onFocusHandledRef = useRef(onFocusHandled);
  const onMapIssueRef = useRef(onMapIssue);
  const insightRef = useRef(insight);
  const onInsightRef = useRef(onInsight);
  const onFlyHandledRef = useRef(onFlyHandled);
  const styleRef = useRef(normalizeMarkerStyle(markerStyle));
  activeRef.current = active;
  filtersRef.current = filters;
  onSelectRef.current = onSelect;
  onLoadingRef.current = onLoading;
  onFocusHandledRef.current = onFocusHandled;
  onMapIssueRef.current = onMapIssue;
  insightRef.current = insight;
  onInsightRef.current = onInsight;
  onFlyHandledRef.current = onFlyHandled;
  styleRef.current = normalizeMarkerStyle(markerStyle);

  const pushDisplay = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const clustered = styleRef.current === 'clusters';
    const z = Math.max(0, Math.floor(m.getZoom()));
    let bbox = null;
    if (clustered) {
      const b = m.getBounds();
      bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    }
    for (const layer of Object.keys(LAYER_COLORS)) {
      const raw = activeRef.current.has(layer) ? (featsRef.current[layer] || []) : [];
      if (!clustered || !raw.length) {
        indexes.current[layer] = null;
        m.getSource(layer)?.setData({ type: 'FeatureCollection', features: raw });
        continue;
      }
      let index = indexes.current[layer];
      if (!index) {
        index = new Supercluster({ radius: 58, maxZoom: 15, minPoints: 2 });
        index.load(raw);
        indexes.current[layer] = index;
      }
      const features = index.getClusters(bbox, z).map((f) => {
        if (!f.properties?.cluster) return f;
        return {
          type: 'Feature',
          geometry: f.geometry,
          properties: {
            cluster: true,
            cluster_id: f.properties.cluster_id,
            point_count: f.properties.point_count,
            point_count_abbreviated: abbr(f.properties.point_count),
          },
        };
      });
      m.getSource(layer)?.setData({ type: 'FeatureCollection', features });
    }
  };

  const refresh = () => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const m = map.current;
      if (!m || !ready.current) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const b = m.getBounds();
      const padX = (b.getEast() - b.getWest()) * 0.12;
      const padY = (b.getNorth() - b.getSouth()) * 0.12;
      const wide = [b.getWest() - padX, b.getSouth() - padY, b.getEast() + padX, b.getNorth() + padY];
      onLoadingRef.current?.(true);
      const loadIssues = [];
      const truncLayers = [];
      try {
        const layers = Object.keys(LAYER_COLORS);
        await Promise.all(layers.map(async (layer) => {
          if (!activeRef.current.has(layer)) {
            featsRef.current[layer] = [];
            indexes.current[layer] = null;
            m.getSource(layer)?.setData({ type: 'FeatureCollection', features: [] });
            return;
          }
          try {
            const gj = await fetchLayer(layer, wide, filtersRef.current, { signal: ac.signal });
            if (ac.signal.aborted) return;
            if (gj?.meta?.truncated) truncLayers.push(layer);
            const feats = (gj.features || []).filter((f) =>
              f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates));
            featsRef.current[layer] = feats;
            indexes.current[layer] = null;
          } catch (e) {
            if (e?.name === 'AbortError' || ac.signal.aborted) return;
            console.warn(e);
            featsRef.current[layer] = [];
            indexes.current[layer] = null;
            m.getSource(layer)?.setData({ type: 'FeatureCollection', features: [] });
            loadIssues.push(`${layer}: ${e.message || 'load failed'}`);
          }
        }));

        const ins = insightRef.current || { mode: 'off', days: 90 };
        if (ins.mode && ins.mode !== 'off') {
          try {
            const cov = await fetchCoverageGrid({
              bbox: wide.join(','),
              zoom: Math.floor(m.getZoom() || 10),
              days: ins.days || 90,
              mode: ins.mode,
              ...Object.fromEntries(
                Object.entries(filtersRef.current || {}).map(([k, v]) => [
                  k, Array.isArray(v) ? v.join(',') : v,
                ]),
              ),
            }, { signal: ac.signal });
            if (!ac.signal.aborted) {
              const grid = ins.mode === 'heat'
                ? { type: 'FeatureCollection', features: [] }
                : cov;
              m.getSource('coverage')?.setData({
                type: 'FeatureCollection',
                features: grid.features || [],
              });
              m.getSource('visit-heat')?.setData(
                ins.mode === 'heat'
                  ? (cov.heat || { type: 'FeatureCollection', features: [] })
                  : { type: 'FeatureCollection', features: [] },
              );
              onInsightRef.current?.({
                top: cov.top || [],
                ghosts: cov.ghosts || [],
                summary: cov.meta?.summary || null,
              });
            }
          } catch (e) {
            if (e?.name !== 'AbortError' && !ac.signal.aborted) {
              console.warn('[coverage]', e);
              m.getSource('coverage')?.setData({ type: 'FeatureCollection', features: [] });
              m.getSource('visit-heat')?.setData({ type: 'FeatureCollection', features: [] });
              onInsightRef.current?.({ top: [], ghosts: [], summary: null });
            }
          }
        } else {
          m.getSource('coverage')?.setData({ type: 'FeatureCollection', features: [] });
          m.getSource('visit-heat')?.setData({ type: 'FeatureCollection', features: [] });
          onInsightRef.current?.({ top: [], ghosts: [], summary: null });
        }
        if (!ac.signal.aborted) {
          pushDisplay();
          if (loadIssues.length) {
            onMapIssueRef.current?.({
              type: 'error',
              message: `Could not load ${loadIssues.join('; ')}`,
            });
          } else if (truncLayers.length) {
            onMapIssueRef.current?.({
              type: 'warn',
              message: `Zoom in — ${truncLayers.join(', ')} dense in this view (showing latest only)`,
            });
          } else {
            onMapIssueRef.current?.(null);
          }
        }
      } finally {
        if (!ac.signal.aborted) onLoadingRef.current?.(false);
      }
    }, 200);
  };

  useEffect(() => {
    let cancelled = false;
    let ro;
    let usedFallback = false;
    let detachGoogle = () => {};
    const wired = new Set();

    (async () => {
      const resolved = await resolveBasemapStyle();
      if (cancelled || !el.current) return;
      fonts.current = LABEL_FONTS_BY_STYLE[resolved.id] || LABEL_FONTS_BY_STYLE.voyager;

      const m = new maplibregl.Map({
        container: el.current,
        style: resolved.style,
        center: INDIA_CENTER,
        zoom: INDIA_DEFAULT_ZOOM,
        minZoom: INDIA_MIN_ZOOM,
        maxZoom: 18,
        maxBounds: INDIA_BOUNDS,
        renderWorldCopies: false,
        attributionControl: false,
        fadeDuration: 260,
        antialias: true,
        failIfMajorPerformanceCaveat: false,
      });

      m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'bottom-right');
      m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
      m.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
      }), 'bottom-right');

      map.current = m;
      el.current.__circoMap = m;
      detachGoogle = attachGoogleAttribution(m, resolved);

      const wire = async () => {
        if (cancelled) return;
        try {
          await loadMapIcons(m);
        } catch (e) {
          console.warn('[map] pin icons', e);
        }
        ensureCoverage(m, wired, (p) => onSelectRef.current?.(p));
        for (const [layer, color] of Object.entries(LAYER_COLORS)) {
          ensureOverlay(m, layer, color, wired, (p) => onSelectRef.current?.(p), selectedId, indexes);
        }
        applyMarkerStyle(m, styleRef.current);
        if (!m.getSource('selection')) {
          m.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          m.addLayer({
            id: 'selection-ring', type: 'circle', source: 'selection',
            paint: { 'circle-radius': 17, 'circle-color': 'transparent', 'circle-stroke-width': 3, 'circle-stroke-color': '#A14996' },
          });
          m.addLayer({
            id: 'selection-pulse', type: 'circle', source: 'selection',
            paint: { 'circle-radius': 24, 'circle-color': '#A14996', 'circle-opacity': 0.16, 'circle-blur': 0.65 },
          });
        }
        if (!ready.current) {
          m.on('click', (e) => {
            const ids = ['coverage-fill', ...Object.keys(LAYER_COLORS).flatMap((l) => [`${l}-pts`, `${l}-clusters`])]
              .filter((lid) => m.getLayer(lid));
            const hits = ids.length ? m.queryRenderedFeatures(e.point, { layers: ids }) : [];
            if (!hits.length) {
              selectedId.current = null;
              onSelectRef.current?.(null);
              m.getSource('selection')?.setData({ type: 'FeatureCollection', features: [] });
            }
          });
          m.on('moveend', refresh);
          m.on('zoom', () => {
            if (styleRef.current !== 'clusters') return;
            if (zoomRaf.current) return;
            zoomRaf.current = requestAnimationFrame(() => {
              zoomRaf.current = null;
              pushDisplay();
            });
          });
        }
        ready.current = true;
        requestAnimationFrame(() => { m.resize(); refresh(); });
      };

      m.on('load', wire);
      m.on('style.load', () => {
        if (cancelled) return;
        ready.current = false;
        wired.clear();
        wire();
      });
      m.on('error', (e) => {
        const msg = e?.error?.message || '';
        if (msg) console.warn('[map]', msg);
        if (!usedFallback && resolved.provider === 'google' && /style|fetch|failed|403|404|network|tile/i.test(msg)) {
          usedFallback = true;
          ready.current = false;
          fonts.current = LABEL_FONTS_BY_STYLE.voyager;
          detachGoogle();
          detachGoogle = () => {};
          m.setStyle(FALLBACK_STYLE);
        }
      });

      ro = new ResizeObserver(() => { try { m.resize(); } catch { /* */ } });
      ro.observe(el.current);
    })();

    return () => {
      cancelled = true;
      clearTimeout(debounce.current);
      abortRef.current?.abort();
      if (zoomRaf.current) cancelAnimationFrame(zoomRaf.current);
      detachGoogle();
      ro?.disconnect();
      map.current?.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refresh(); }, [active, filters, insight?.mode, insight?.days]); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    applyMarkerStyle(m, markerStyle);
    indexes.current = {};
    pushDisplay();
  }, [markerStyle]); // eslint-disable-line

  // Resize when returning to the Map tab (shell was display:none / visibility hidden)
  useEffect(() => {
    if (!visible) return;
    const m = map.current;
    if (!m) return;
    requestAnimationFrame(() => {
      try { m.resize(); } catch { /* */ }
    });
  }, [visible]);

  // Focus a single entity from Gaps / Discrepancies
  useEffect(() => {
    if (!focusRequest?.layer || !focusRequest?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const feat = await fetchLayerFeature(focusRequest.layer, focusRequest.id);
        if (cancelled || !feat?.geometry?.coordinates) return;
        const [lng, lat] = feat.geometry.coordinates;
        const props = {
          ...feat.properties,
          _layer: focusRequest.layer,
          lng,
          lat,
        };
        selectedId.current = props.id;
        onSelectRef.current?.(props);

        const waitReady = () => new Promise((resolve) => {
          if (ready.current && map.current) {
            resolve();
            return;
          }
          let n = 0;
          const t = setInterval(() => {
            n += 1;
            if ((ready.current && map.current) || n > 40) {
              clearInterval(t);
              resolve();
            }
          }, 50);
        });
        await waitReady();
        const m = map.current;
        if (!m || cancelled) return;
        m.easeTo({
          center: [lng, lat],
          zoom: Math.max(m.getZoom(), 14),
          duration: 650,
          offset: [0, -40],
        });
        // Ensure selection ring paints even if DetailCard effect raced
        m.getSource('selection')?.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {},
          }],
        });
      } catch (e) {
        console.warn('[map focus]', e);
      } finally {
        if (!cancelled) onFocusHandledRef.current?.();
      }
    })();
    return () => { cancelled = true; };
  }, [focusRequest]);

  useEffect(() => {
    if (!flyRequest || flyRequest.lng == null || flyRequest.lat == null) return;
    const m = map.current;
    if (!m || !ready.current) return;
    m.easeTo({
      center: [Number(flyRequest.lng), Number(flyRequest.lat)],
      zoom: Math.max(m.getZoom(), flyRequest.zoom || 13),
      duration: 650,
      offset: [0, -40],
    });
    onFlyHandledRef.current?.();
  }, [flyRequest]);

  useEffect(() => onSelection((p) => {
    const m = map.current;
    if (!m?.getSource('selection')) return;
    if (!p?.id || p.lng == null || p.lat == null) {
      m.getSource('selection').setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    m.getSource('selection').setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [Number(p.lng), Number(p.lat)] },
        properties: {},
      }],
    });
  }), []);

  return <div id="map" ref={el} role="application" aria-label="Circolife Maps" />;
}
