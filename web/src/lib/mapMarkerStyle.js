export const MARKER_STYLES = [
  {
    id: 'pins-heat',
    label: 'Pins + heat',
    hint: 'Drop pins on real spots, with a density glow. Best default for reach.',
  },
  {
    id: 'pins',
    label: 'Pins only',
    hint: 'Every record as a pin. No heatmap.',
  },
  {
    id: 'heat',
    label: 'Heat only',
    hint: 'Density glow when zoomed out. Pins appear as you zoom in so you can tap one.',
  },
  {
    id: 'clusters',
    label: 'Cluster circles',
    hint: 'Old style — circle size grows with count. Easy to misread as market size.',
  },
];

export const DEFAULT_MARKER_STYLE = 'pins-heat';

export function normalizeMarkerStyle(id) {
  return MARKER_STYLES.some((s) => s.id === id) ? id : DEFAULT_MARKER_STYLE;
}
