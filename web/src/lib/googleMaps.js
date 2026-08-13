import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { fetchMapsSession, reportClientUsage } from './api';
import { INDIA_BOUNDS, INDIA_CENTER, INDIA_DEFAULT_ZOOM, INDIA_MIN_ZOOM } from './mapBounds';

let loaderPromise = null;

/** Load Google Maps JS (Maps JavaScript API) using the server key. */
export async function loadGoogleMaps() {
  if (typeof window !== 'undefined' && window.google?.maps?.Map) {
    return window.google.maps;
  }
  if (!loaderPromise) {
    loaderPromise = (async () => {
      const maps = await fetchMapsSession();
      if (!maps?.enabled || !maps.key) {
        throw new Error(maps?.error || 'GOOGLE_MAPS_API_KEY not configured');
      }
      setOptions({
        key: maps.key,
        v: 'weekly',
      });
      // Ensures Maps JS is bootstrapped; Map lives on window.google.maps after this.
      await importLibrary('maps');
      reportClientUsage('maps_js_load').catch(() => {});
      return window.google.maps;
    })().catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

export function indiaMapRestriction() {
  return {
    latLngBounds: {
      south: INDIA_BOUNDS[0][1],
      west: INDIA_BOUNDS[0][0],
      north: INDIA_BOUNDS[1][1],
      east: INDIA_BOUNDS[1][0],
    },
    strictBounds: true,
  };
}

export const GOOGLE_MAP_DEFAULTS = {
  center: { lat: INDIA_CENTER[1], lng: INDIA_CENTER[0] },
  zoom: INDIA_DEFAULT_ZOOM,
  minZoom: INDIA_MIN_ZOOM,
  mapTypeId: 'roadmap',
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  rotateControl: false,
  scaleControl: true,
  clickableIcons: false,
  gestureHandling: 'cooperative',
  restriction: indiaMapRestriction(),
  styles: [
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  ],
};
