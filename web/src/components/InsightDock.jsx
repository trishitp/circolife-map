const MODES = [
  { id: 'off', label: 'Off' },
  { id: 'untouched', label: 'Untouched' },
  { id: 'coverage', label: 'Coverage' },
  { id: 'heat', label: 'Visit heat' },
];

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
            {m.label}
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
