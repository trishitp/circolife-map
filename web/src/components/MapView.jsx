import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import 'maplibre-gl/dist/maplibre-gl.css';
import { fetchLayer, fetchLayerFeature } from '../lib/api';
import { onSelection } from '../lib/selection';
import { resolveBasemapStyle, LABEL_FONTS_BY_STYLE, attachGoogleAttribution } from '../lib/basemap';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM, INDIA_MIN_ZOOM } from '../lib/mapBounds';

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

function ensureOverlay(m, layer, color, wired, onSelect, selectedId, indexes) {
  const srcId = layer;
  if (!m.getSource(srcId)) {
    m.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }

  const add = (id, spec) => { if (!m.getLayer(id)) m.addLayer(spec); };

  add(`${layer}-halo`, {
    id: `${layer}-halo`,
    type: 'circle',
    source: srcId,
    filter: ['has', 'point_count'],
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
    paint: {
      'circle-color': color,
      'circle-opacity': 0.95,
      'circle-radius': ['step', ['get', 'point_count'], 16, 25, 20, 100, 26, 500, 32, 2000, 40],
      'circle-stroke-width': 3,
      'circle-stroke-color': STROKE,
    },
  });

  // Note: symbol/count labels are intentionally omitted — glyph/symbol layers
  // corrupt GeoJSON source updates with the Vite MapLibre worker setup.

  add(`${layer}-pt-halo`, {
    id: `${layer}-pt-halo`,
    type: 'circle',
    source: srcId,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': color,
      'circle-opacity': 0.2,
      'circle-radius': 14,
      'circle-blur': 0.4,
    },
  });

  add(`${layer}-pts`, {
    id: `${layer}-pts`,
    type: 'circle',
    source: srcId,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': color,
      'circle-opacity': [
        'match', ['get', 'precision'],
        'pincode', 0.32, 'inherited', 0.62, 'approx', 0.85, 'geocoded', 0.92, 0.97,
      ],
      'circle-stroke-width': ['match', ['get', 'precision'], 'pincode', 2.4, 1.75],
      'circle-stroke-color': ['match', ['get', 'precision'], 'pincode', color, STROKE],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 11, 7, 15, 9],
    },
  });

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
      m.easeTo({
        center: f.geometry.coordinates,
        zoom,
        duration: 500,
      });
    });
    const on = () => { m.getCanvas().style.cursor = 'pointer'; };
    const off = () => { m.getCanvas().style.cursor = ''; };
    m.on('mouseenter', `${layer}-pts`, on);
    m.on('mouseleave', `${layer}-pts`, off);
    m.on('mouseenter', `${layer}-clusters`, on);
    m.on('mouseleave', `${layer}-clusters`, off);
  }
}

export default function MapView({
  active, filters, onSelect, onLoading, focusRequest, onFocusHandled, visible,
  onMapIssue,
}) {
  const el = useRef(null);
  const map = useRef(null);
  const debounce = useRef(null);
  const abortRef = useRef(null);
  const selectedId = useRef(null);
  const ready = useRef(false);
  const indexes = useRef({});
  const fonts = useRef(LABEL_FONTS_BY_STYLE.voyager);
  const zoomRaf = useRef(null);
  const activeRef = useRef(active);
  const filtersRef = useRef(filters);
  const onSelectRef = useRef(onSelect);
  const onLoadingRef = useRef(onLoading);
  const onFocusHandledRef = useRef(onFocusHandled);
  const onMapIssueRef = useRef(onMapIssue);
  activeRef.current = active;
  filtersRef.current = filters;
  onSelectRef.current = onSelect;
  onLoadingRef.current = onLoading;
  onFocusHandledRef.current = onFocusHandled;
  onMapIssueRef.current = onMapIssue;

  const pushClusters = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const z = Math.max(0, Math.floor(m.getZoom()));
    const b = m.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    for (const layer of Object.keys(LAYER_COLORS)) {
      if (!activeRef.current.has(layer) || !indexes.current[layer]) {
        m.getSource(layer)?.setData({ type: 'FeatureCollection', features: [] });
        continue;
      }
      const features = indexes.current[layer].getClusters(bbox, z).map((f) => {
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
            const index = new Supercluster({ radius: 58, maxZoom: 15, minPoints: 2 });
            index.load(feats);
            indexes.current[layer] = index;
          } catch (e) {
            if (e?.name === 'AbortError' || ac.signal.aborted) return;
            console.warn(e);
            indexes.current[layer] = null;
            m.getSource(layer)?.setData({ type: 'FeatureCollection', features: [] });
            loadIssues.push(`${layer}: ${e.message || 'load failed'}`);
          }
        }));
        if (!ac.signal.aborted) {
          pushClusters();
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

      const wire = () => {
        if (cancelled) return;
        for (const [layer, color] of Object.entries(LAYER_COLORS)) {
          ensureOverlay(m, layer, color, wired, (p) => onSelectRef.current?.(p), selectedId, indexes);
        }
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
            const ids = Object.keys(LAYER_COLORS).flatMap((l) => [`${l}-pts`, `${l}-clusters`]).filter((lid) => m.getLayer(lid));
            const hits = ids.length ? m.queryRenderedFeatures(e.point, { layers: ids }) : [];
            if (!hits.length) {
              selectedId.current = null;
              onSelectRef.current?.(null);
              m.getSource('selection')?.setData({ type: 'FeatureCollection', features: [] });
            }
          });
          m.on('moveend', refresh);
          m.on('zoom', () => {
            if (zoomRaf.current) return;
            zoomRaf.current = requestAnimationFrame(() => {
              zoomRaf.current = null;
              pushClusters();
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

  useEffect(() => { refresh(); }, [active, filters]); // eslint-disable-line

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

  return <div id="map" ref={el} role="application" aria-label="CircoLife territory map" />;
}
