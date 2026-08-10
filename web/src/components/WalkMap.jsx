import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { loadGoogleMaps, GOOGLE_MAP_DEFAULTS } from '../lib/googleMaps';

const WALK_LINE = '#3D8FB0';
const LATE_RING = '#C45C5C';
const START_COLOR = '#2F6B4F';
const END_COLOR = '#2E1F40';
const STOP_COLOR = '#2F7A95';

/**
 * Place-route map on native Google Maps JS — pins use the same projection as
 * the basemap (avoids MapLibre + Google raster tile misalignment).
 */
export default function WalkMap({
  places = [],
  path = null,
  meetings = [],
  selectedMeetingId,
  onSelectMeeting,
  onPlaceChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const gmapsRef = useRef(null);
  const readyRef = useRef(false);
  const markersRef = useRef([]);
  const pathLineRef = useRef(null);
  const progressLineRef = useRef(null);
  const travelerRef = useRef(null);
  const animRef = useRef(null);
  const placesRef = useRef(places);
  const fittedKeyRef = useRef('');
  const followRef = useRef(true);
  const lockedZoomRef = useRef(null);
  placesRef.current = places;

  const [playState, setPlayState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [placeIdx, setPlaceIdx] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [mapError, setMapError] = useState(null);
  followRef.current = follow;

  const canPlay = places.length >= 2;
  const pathKm = path?.km ?? 0;
  const coords = useMemo(
    () => (places.length
      ? places.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
      : (path?.coordinates || []).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))),
    [places, path],
  );

  const meetingById = useMemo(() => {
    const m = new Map();
    for (const x of meetings) m.set(String(x.id), x);
    return m;
  }, [meetings]);

  const stopAnimation = useCallback((reset = false) => {
    if (animRef.current?.raf) cancelAnimationFrame(animRef.current.raf);
    animRef.current = null;
    if (!reset) return;
    setPlayState('idle');
    setProgress(0);
    setPlaceIdx(0);
    progressLineRef.current?.setPath([]);
    const tr = travelerRef.current;
    if (tr?.marker) tr.marker.setMap(null);
    setTravelerMoving(travelerRef, false);
  }, []);

  const setProgressLine = useCallback((throughIdx, partialCoord) => {
    const line = progressLineRef.current;
    if (!line || !coords.length) return;
    if (throughIdx < 0) {
      line.setPath([]);
      return;
    }
    const pathPts = coords.slice(0, throughIdx + 1).map((c) => ({ ...c }));
    if (partialCoord) pathPts.push({ lat: partialCoord.lat, lng: partialCoord.lng });
    line.setPath(pathPts.length >= 2 ? pathPts : []);
  }, [coords]);

  const paintPlaceMarkers = useCallback((selectedPlaceIndex) => {
    const gmaps = gmapsRef.current;
    for (const mk of markersRef.current) {
      const on = mk.placeIndex === selectedPlaceIndex;
      // Skip expensive setIcon when selection state is unchanged
      if (mk.selected === on) {
        mk.marker?.setZIndex(on ? 500 : 100 + (mk.idx || 0));
        continue;
      }
      mk.selected = on;
      if (gmaps && mk.marker && mk.role != null) {
        mk.marker.setIcon({
          url: 'data:image/svg+xml,' + encodeURIComponent(
            pinSvg(mk.role, mk.placeIndex, mk.hasLate, on),
          ),
          scaledSize: new gmaps.Size(on ? 32 : 28, on ? 41 : 36),
          anchor: new gmaps.Point(on ? 16 : 14, on ? 41 : 36),
        });
        mk.marker.setZIndex(on ? 500 : 100 + (mk.idx || 0));
      }
    }
  }, []);

  const selectPlaceMeetings = useCallback((place, preferLast = false) => {
    if (!place?.meetingIds?.length) return;
    const ids = place.meetingIds;
    const id = preferLast ? ids[ids.length - 1] : ids[0];
    onSelectMeeting?.(id);
    onPlaceChange?.(place.placeIndex);
  }, [onSelectMeeting, onPlaceChange]);

  const positionAlong = useCallback((t) => {
    if (!coords.length) return null;
    if (coords.length === 1 || t <= 0) {
      return { pos: coords[0], throughIdx: 0, partial: null, placeIdx: 0 };
    }
    if (t >= 1) {
      const last = coords.length - 1;
      return { pos: coords[last], throughIdx: last, partial: null, placeIdx: last };
    }
    const hops = coords.length - 1;
    const scaled = t * hops;
    const i = Math.min(hops - 1, Math.floor(scaled));
    const u = Math.min(1, Math.max(0, scaled - i));
    const a = coords[i];
    const b = coords[i + 1];
    const pos = {
      lat: a.lat + (b.lat - a.lat) * u,
      lng: a.lng + (b.lng - a.lng) * u,
    };
    const atNode = u < 0.001;
    return {
      pos: atNode ? a : pos,
      throughIdx: i,
      partial: u > 0.02 ? pos : null,
      placeIdx: u >= 0.98 ? i + 1 : i,
    };
  }, [coords]);

  const panTo = useCallback((latLng, animate = true) => {
    const map = mapRef.current;
    if (!map || latLng?.lat == null || latLng?.lng == null) return;
    // Keep locked zoom — only pan so marker projection stays stable
    if (animate) map.panTo(latLng);
    else map.setCenter(latLng);
  }, []);

  const runAnimation = useCallback(() => {
    if (coords.length < 2 || !mapRef.current || !gmapsRef.current) return;
    const hops = coords.length - 1;
    // Distance-aware hop timing so long legs feel smooth and start clearly moves
    const distM = (a, b) => {
      const R = 6371000;
      const toR = (d) => (d * Math.PI) / 180;
      const dLat = toR(b.lat - a.lat);
      const dLng = toR(b.lng - a.lng);
      const lat1 = toR(a.lat);
      const lat2 = toR(b.lat);
      const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };
    const segments = [];
    for (let i = 0; i < hops; i++) {
      const m = distM(coords[i], coords[i + 1]);
      // 900–2200 ms per hop at 1× (short cells still animate; long legs don't crawl forever)
      const hopMs = Math.max(900, Math.min(2200, 700 + m * 0.12)) / speed;
      segments.push({
        type: 'hop',
        from: i,
        to: i + 1,
        ms: hopMs,
        progressAt: i / hops,
        progressSpan: 1 / hops,
      });
      const dest = placesRef.current[i + 1];
      if ((dest?.meetingIds?.length || 1) > 1) {
        segments.push({
          type: 'dwell',
          at: i + 1,
          ms: 500 / speed,
          progressAt: (i + 1) / hops,
        });
      }
    }

    const startProgress = Math.min(1, Math.max(0, animRef.current?.resumeT ?? 0));
    let elapsedTarget = 0;
    for (const seg of segments) {
      if (seg.type === 'hop') {
        const endP = seg.progressAt + seg.progressSpan;
        if (startProgress <= endP + 1e-6) {
          const u = Math.max(0, Math.min(1, (startProgress - seg.progressAt) / seg.progressSpan));
          elapsedTarget += u * seg.ms;
          break;
        }
        elapsedTarget += seg.ms;
      } else if (startProgress > seg.progressAt + 1e-6) {
        elapsedTarget += seg.ms;
      } else {
        break;
      }
    }

    const startedAt = performance.now() - elapsedTarget;
    let lastAnnouncedPlace = -1;
    let lastReact = 0;
    let lastPaintedPlace = -1;

    // Show traveler at resume position immediately (not always at start)
    const initial = positionAlong(startProgress);
    ensureTraveler(mapRef.current, gmapsRef.current, travelerRef);
    const tr = travelerRef.current;
    if (tr?.marker && initial?.pos) {
      tr.marker.setPosition(initial.pos);
      tr.marker.setMap(mapRef.current);
      tr.marker.setAnimation(null);
    }
    setTravelerMoving(travelerRef, true);
    setProgressLine(initial.throughIdx, initial.partial);
    if (initial.placeIdx != null) {
      setPlaceIdx(initial.placeIdx);
      paintPlaceMarkers(placesRef.current[initial.placeIdx]?.placeIndex);
      lastPaintedPlace = initial.placeIdx;
      lastAnnouncedPlace = initial.placeIdx;
    }

    // Mark playing first so selection pan effect does not fight the walk
    setPlayState('playing');
    setProgress(startProgress);
    if (startProgress < 0.001 && placesRef.current[0]) {
      selectPlaceMeetings(placesRef.current[0]);
    } else if (placesRef.current[initial.placeIdx]) {
      selectPlaceMeetings(placesRef.current[initial.placeIdx], startProgress > 0.05);
    }
    if (followRef.current && initial?.pos) {
      panTo(initial.pos, startProgress < 0.001);
    }

    const tick = (now) => {
      // Cancel if anim cleared (pause/reset)
      if (!animRef.current) return;

      let elapsed = now - startedAt;
      let t = 0;
      let done = true;
      for (const seg of segments) {
        if (elapsed <= seg.ms) {
          done = false;
          if (seg.type === 'hop') {
            // Ease-in-out so motion is obvious at hop start
            const raw = seg.ms > 0 ? elapsed / seg.ms : 1;
            const u = raw * raw * (3 - 2 * raw);
            t = seg.progressAt + u * seg.progressSpan;
          } else {
            t = seg.progressAt;
          }
          break;
        }
        elapsed -= seg.ms;
        if (seg.type === 'hop') t = seg.progressAt + seg.progressSpan;
        else t = seg.progressAt;
      }
      if (done) t = 1;
      t = Math.min(1, Math.max(0, t));

      const { pos, throughIdx, partial, placeIdx: curPlace } = positionAlong(t);

      setProgressLine(throughIdx, partial);
      travelerRef.current?.marker?.setPosition(pos);

      if (curPlace !== lastPaintedPlace) {
        lastPaintedPlace = curPlace;
        paintPlaceMarkers(placesRef.current[curPlace]?.placeIndex);
      }

      if (now - lastReact > 48 || curPlace !== lastAnnouncedPlace || t >= 1) {
        lastReact = now;
        setProgress(t);
        setPlaceIdx(curPlace);
      }
      if (curPlace !== lastAnnouncedPlace && placesRef.current[curPlace]) {
        lastAnnouncedPlace = curPlace;
        selectPlaceMeetings(placesRef.current[curPlace], true);
      }

      if (followRef.current && pos) {
        const lastCam = animRef.current?.lastCam || 0;
        if (now - lastCam > 320) {
          if (animRef.current) animRef.current.lastCam = now;
          panTo(pos, true);
        }
      }

      if (t < 1) {
        const lastCam = animRef.current?.lastCam;
        animRef.current = { raf: requestAnimationFrame(tick), resumeT: t, lastCam };
      } else {
        animRef.current = null;
        setPlayState('idle');
        setProgress(1);
        setTravelerMoving(travelerRef, false);
        paintPlaceMarkers(placesRef.current[placesRef.current.length - 1]?.placeIndex);
        const last = placesRef.current[placesRef.current.length - 1];
        if (last) selectPlaceMeetings(last, true);
      }
    };

    animRef.current = {
      raf: requestAnimationFrame(tick),
      resumeT: startProgress,
      lastCam: 0,
    };
  }, [coords, speed, setProgressLine, selectPlaceMeetings, paintPlaceMarkers, panTo, positionAlong]);

  const handlePlay = () => {
    if (!canPlay || !mapRef.current) return;
    if (playState === 'playing') {
      if (animRef.current?.raf) cancelAnimationFrame(animRef.current.raf);
      animRef.current = { raf: null, resumeT: progress };
      setPlayState('paused');
      setTravelerMoving(travelerRef, false);
      return;
    }
    if (playState === 'idle' && progress >= 0.999) {
      setProgress(0);
      setPlaceIdx(0);
      setProgressLine(-1);
      animRef.current = { raf: null, resumeT: 0 };
    } else if (playState === 'paused' && animRef.current?.resumeT == null) {
      animRef.current = { raf: null, resumeT: progress };
    }
    runAnimation();
  };

  const handleReset = () => {
    stopAnimation(true);
    setProgressLine(-1);
  };

  const handleScrub = (e) => {
    if (!canPlay) return;
    const t = Number(e.target.value) / 100;
    if (playState === 'playing') {
      if (animRef.current?.raf) cancelAnimationFrame(animRef.current.raf);
      animRef.current = { raf: null, resumeT: t };
      setPlayState('paused');
      setTravelerMoving(travelerRef, false);
    } else {
      animRef.current = { ...(animRef.current || {}), raf: null, resumeT: t };
    }
    setProgress(t);
    const hops = coords.length - 1;
    const scaled = t * hops;
    const i = Math.min(hops, Math.floor(scaled));
    const u = scaled - i;
    let pos = coords[i];
    if (i < hops && u > 0) {
      const a = coords[i];
      const b = coords[i + 1];
      pos = { lat: a.lat + (b.lat - a.lat) * u, lng: a.lng + (b.lng - a.lng) * u };
    }
    const curPlace = Math.min(coords.length - 1, u >= 0.98 ? i + 1 : i);
    setPlaceIdx(curPlace);
    setProgressLine(i, u > 0.02 && i < hops ? pos : null);
    ensureTraveler(mapRef.current, gmapsRef.current, travelerRef);
    travelerRef.current?.marker?.setMap(mapRef.current);
    travelerRef.current?.marker?.setPosition(pos);
    setTravelerMoving(travelerRef, false);
    if (places[curPlace]) {
      selectPlaceMeetings(places[curPlace]);
      paintPlaceMarkers(places[curPlace].placeIndex);
    }
  };

  // Init Google Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    let cancelled = false;
    let ro;

    (async () => {
      try {
        const gmaps = await loadGoogleMaps();
        if (cancelled || !containerRef.current) return;
        gmapsRef.current = gmaps;

        const map = new gmaps.Map(containerRef.current, {
          ...GOOGLE_MAP_DEFAULTS,
          // Activity: pan allowed, zoom locked after fit
          gestureHandling: 'greedy',
          draggable: true,
          scrollwheel: false,
          disableDoubleClickZoom: true,
        });
        mapRef.current = map;

        pathLineRef.current = new gmaps.Polyline({
          map,
          path: [],
          geodesic: true,
          strokeColor: WALK_LINE,
          strokeOpacity: 0,
          strokeWeight: 4,
          icons: [{
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.7,
              strokeColor: WALK_LINE,
              scale: 3,
            },
            offset: '0',
            repeat: '14px',
          }],
          zIndex: 1,
        });
        progressLineRef.current = new gmaps.Polyline({
          map,
          path: [],
          geodesic: true,
          strokeColor: START_COLOR,
          strokeOpacity: 1,
          strokeWeight: 5,
          zIndex: 2,
        });

        readyRef.current = true;
        setMapError(null);
        applyPlaces(map, gmaps, placesRef.current, path, markersRef, travelerRef, pathLineRef, {
          onSelectMeeting: (id) => onSelectMeeting?.(id),
          fittedKeyRef,
          lockedZoomRef,
          refit: true,
        });

        ro = new ResizeObserver(() => {
          clearTimeout(map.__walkResizeT);
          map.__walkResizeT = setTimeout(() => {
            try {
              gmaps.event.trigger(map, 'resize');
              if (placesRef.current?.length && fittedKeyRef.current) {
                // keep center; zoom stays locked
              }
            } catch { /* */ }
          }, 80);
        });
        ro.observe(containerRef.current);
      } catch (e) {
        console.error('[WalkMap]', e);
        if (!cancelled) setMapError(e.message || 'Google Maps failed to load');
      }
    })();

    return () => {
      cancelled = true;
      if (animRef.current?.raf) cancelAnimationFrame(animRef.current.raf);
      clearMarkers(markersRef);
      pathLineRef.current?.setMap(null);
      progressLineRef.current?.setMap(null);
      travelerRef.current?.marker?.setMap(null);
      travelerRef.current = null;
      ro?.disconnect();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Places data changed
  useEffect(() => {
    const map = mapRef.current;
    const gmaps = gmapsRef.current;
    if (!map || !gmaps || !readyRef.current) return;
    stopAnimation(true);
    applyPlaces(map, gmaps, places, path, markersRef, travelerRef, pathLineRef, {
      onSelectMeeting,
      fittedKeyRef,
      lockedZoomRef,
      refit: true,
    });
  }, [places, path, stopAnimation]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection highlight
  useEffect(() => {
    if (!selectedMeetingId) return;
    const m = meetingById.get(String(selectedMeetingId));
    const pi = m?.placeIndex;
    if (pi != null) paintPlaceMarkers(pi);
  }, [selectedMeetingId, meetingById, paintPlaceMarkers]);

  // Pan when timeline selects — zoom stays locked
  useEffect(() => {
    if (!selectedMeetingId || !mapRef.current) return;
    const m = meetingById.get(String(selectedMeetingId));
    if (m?.placeIndex == null) return;
    const place = places.find((p) => p.placeIndex === m.placeIndex);
    if (!place || playState === 'playing') return;
    panTo({ lat: Number(place.lat), lng: Number(place.lng) }, true);
  }, [selectedMeetingId, meetingById, places, playState, panTo]);

  const curPlace = places[placeIdx];
  const statusLabel = (() => {
    if (!places.length) return 'No check-in places on path';
    if (!canPlay) return 'Need at least two places to play walk';
    if (playState === 'playing') {
      return `Place ${placeIdx + 1}/${places.length} · ${(curPlace?.meetingIds?.length || 1)} meeting(s) · ${fmtKm(pathKm)}`;
    }
    if (playState === 'paused') return `Paused · place ${placeIdx + 1}/${places.length}`;
    if (progress >= 1) return 'Walk complete';
    return `${places.length} places · ${fmtKm(pathKm)} geodesic · play to animate`;
  })();

  return (
    <div className="walk-map-root">
      <div className="walk-map" ref={containerRef} role="img" aria-label="RM place walk map" />
      {mapError && <p className="banner err walk-map-error">{mapError}</p>}
      <div className="walk-playbar">
        <button type="button" className="btn walk-play-btn" onClick={handlePlay} disabled={!canPlay}>
          {playState === 'playing' ? 'Pause' : playState === 'paused' ? 'Resume' : progress >= 1 ? 'Replay' : 'Play walk'}
        </button>
        <button type="button" className="btn ghost walk-reset-btn" onClick={handleReset} disabled={progress === 0 && playState === 'idle'}>
          Reset
        </button>
        <label className="walk-speed">
          <span className="sr-only">Speed</span>
          <select className="input walk-speed-select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={!canPlay}>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <label className="walk-follow">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
        <input
          type="range"
          className="walk-scrub"
          min={0}
          max={100}
          value={Math.round(progress * 100)}
          onChange={handleScrub}
          disabled={!canPlay}
          aria-label="Scrub place progress"
        />
        <span className="walk-play-label muted">{statusLabel}</span>
      </div>
    </div>
  );
}

function fmtKm(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n < 1) return `${Math.round(n * 1000)} m`;
  return `${n.toFixed(1)} km`;
}

function clearMarkers(markersRef) {
  for (const m of markersRef.current) {
    try { m.marker.setMap(null); } catch { /* */ }
  }
  markersRef.current = [];
}

function pinColor(role) {
  if (role === 'start') return START_COLOR;
  if (role === 'end') return END_COLOR;
  return STOP_COLOR;
}

function travelerIconSvg(moving) {
  // Slightly larger pulse ring while playing so motion is obvious from frame 1
  const ring = moving
    ? '<circle cx="16" cy="16" r="13" fill="none" stroke="#A14996" stroke-width="2" opacity="0.45"/>'
    : '';
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  ${ring}
  <circle cx="16" cy="16" r="8" fill="#A14996" stroke="#FFFCFA" stroke-width="3"/>
</svg>`.trim();
}

function setTravelerMoving(travelerRef, moving) {
  const tr = travelerRef.current;
  if (!tr?.marker || !tr.gmaps) return;
  tr.moving = moving;
  tr.marker.setIcon({
    url: 'data:image/svg+xml,' + encodeURIComponent(travelerIconSvg(moving)),
    scaledSize: new tr.gmaps.Size(32, 32),
    anchor: new tr.gmaps.Point(16, 16),
  });
}

function ensureTraveler(map, gmaps, travelerRef) {
  if (!map || !gmaps) return null;
  if (travelerRef.current?.marker) {
    travelerRef.current.gmaps = gmaps;
    return travelerRef.current;
  }
  const marker = new gmaps.Marker({
    map: null,
    position: { lat: 0, lng: 0 },
    icon: {
      url: 'data:image/svg+xml,' + encodeURIComponent(travelerIconSvg(false)),
      scaledSize: new gmaps.Size(32, 32),
      anchor: new gmaps.Point(16, 16),
    },
    zIndex: 1000,
    clickable: false,
    optimized: false,
  });
  travelerRef.current = { marker, gmaps, moving: false };
  return travelerRef.current;
}

function applyPlaces(map, gmaps, places, path, markersRef, travelerRef, pathLineRef, {
  onSelectMeeting,
  fittedKeyRef,
  lockedZoomRef,
  refit,
}) {
  const coords = places
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));

  pathLineRef.current?.setPath(coords.length >= 2 ? coords : []);

  const key = places.map((p) => `${p.placeIndex}:${p.lng},${p.lat}:${(p.meetingIds || []).join(',')}`).join('|');
  const needRebuild = fittedKeyRef._markerKey !== key;

  if (needRebuild) {
    clearMarkers(markersRef);
    places.forEach((p, idx) => {
      if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) return;
      const role = idx === 0 ? 'start' : (places.length > 1 && idx === places.length - 1 ? 'end' : 'stop');
      let stackClick = 0;
      const icon = {
        url: 'data:image/svg+xml,' + encodeURIComponent(pinSvg(role, p.placeIndex, !!p.hasLate, false)),
        scaledSize: new gmaps.Size(28, 36),
        anchor: new gmaps.Point(14, 36), // tip of teardrop = exact lat/lng
      };
      const marker = new gmaps.Marker({
        map,
        position: { lat: Number(p.lat), lng: Number(p.lng) },
        icon,
        title: `Place ${p.placeIndex}`,
        zIndex: 100 + idx,
        optimized: false,
      });
      marker.addListener('click', () => {
        const ids = p.meetingIds || [];
        if (!ids.length) return;
        const id = ids[stackClick % ids.length];
        stackClick += 1;
        onSelectMeeting?.(id);
      });
      markersRef.current.push({
        placeIndex: p.placeIndex,
        marker,
        el: null,
        role,
        hasLate: !!p.hasLate,
        idx,
        selected: false,
        lngLat: [Number(p.lng), Number(p.lat)],
      });
    });
    fittedKeyRef._markerKey = key;
  }

  if (travelerRef) {
    const tr = ensureTraveler(map, gmaps, travelerRef);
    if (tr?.marker && coords[0]) {
      tr.marker.setPosition(coords[0]);
      tr.marker.setMap(null);
    }
  }

  if (refit && coords.length) {
    const fitKey = places.map((p) => p.placeIndex).join('-');
    if (fittedKeyRef.current !== fitKey) {
      fittedKeyRef.current = fitKey;
      const bounds = new gmaps.LatLngBounds();
      for (const c of coords) bounds.extend(c);
      // Unlock, fit, then lock zoom so pan-only keep pins exact
      map.setOptions({ minZoom: GOOGLE_MAP_DEFAULTS.minZoom, maxZoom: 18 });
      lockedZoomRef.current = null;
      map.fitBounds(bounds, { top: 56, right: 56, bottom: 72, left: 56 });
      gmaps.event.addListenerOnce(map, 'idle', () => {
        let z = map.getZoom();
        if (coords.length === 1) z = Math.min(z ?? 15, 15);
        else z = Math.min(z ?? 14.5, 14.5);
        map.setZoom(z);
        lockedZoomRef.current = z;
        map.setOptions({ minZoom: z, maxZoom: z });
      });
    }
  }
}

function pinSvg(role, placeIndex, hasLate, selected = false) {
  const bg = pinColor(role);
  const stroke = selected ? '#A14996' : '#FFFCFA';
  const sw = selected ? 2.8 : 2;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <path fill="${bg}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"
    d="M14 1.5C7.65 1.5 2.5 6.65 2.5 13.1 2.5 21.6 14 34.5 14 34.5S25.5 21.6 25.5 13.1C25.5 6.65 20.35 1.5 14 1.5z"/>
  ${hasLate ? `<circle cx="14" cy="13" r="8.5" fill="none" stroke="${LATE_RING}" stroke-width="2"/>` : ''}
  <text x="14" y="16" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="11" font-weight="800">${placeIndex}</text>
</svg>`.trim();
}
