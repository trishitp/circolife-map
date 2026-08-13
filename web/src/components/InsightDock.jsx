export const INSIGHT_MODES = [
  { id: 'off', label: 'Off', short: 'Off' },
  { id: 'untouched', label: 'Untouched', short: 'Untouched' },
  { id: 'coverage', label: 'Coverage', short: 'Cover' },
  { id: 'heat', label: 'Visit heat', short: 'Heat' },
];
const MODES = INSIGHT_MODES;

const DAYS = [
  { id: 30, label: '30d' },
  { id: 90, label: '90d' },
  { id: 180, label: '180d' },
];

export default function InsightDock({ mode, days, onMode, onDays, summary }) {
  return (
    <div className="insight-dock" aria-label="Field insights">
      <div className="insight-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`insight-pill ${mode === m.id ? 'on' : ''}`}
            aria-pressed={mode === m.id}
            onClick={() => onMode(m.id)}
          >
            <span className="insight-label-full">{m.label}</span>
            <span className="insight-label-short">{m.short}</span>
          </button>
        ))}
      </div>
      {mode !== 'off' && (
        <div className="insight-days">
          {DAYS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`insight-pill sm ${days === d.id ? 'on' : ''}`}
              aria-pressed={days === d.id}
              onClick={() => onDays(d.id)}
            >
              {d.label}
            </button>
          ))}
          {summary?.untouched != null && mode !== 'heat' && (
            <span className="insight-stat">
              {summary.untouched} dark
            </span>
          )}
        </div>
      )}
    </div>
  );
}
