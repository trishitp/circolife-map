import { MAP_QUICK_PRESETS, presetMatches } from '../lib/mapPresets';

export default function MapQuickPresets({ active, insightMode, onApply }) {
  return (
    <div className="map-quick-presets" role="toolbar" aria-label="Quick map views">
      {MAP_QUICK_PRESETS.map((p) => {
        const on = presetMatches(p, { active, insightMode });
        return (
          <button
            key={p.id}
            type="button"
            className={`map-preset-pill${on ? ' on' : ''}`}
            aria-pressed={on}
            title={p.hint}
            onClick={() => onApply(p)}
          >
            <span className="map-preset-full">{p.label}</span>
            <span className="map-preset-short">{p.short}</span>
          </button>
        );
      })}
    </div>
  );
}