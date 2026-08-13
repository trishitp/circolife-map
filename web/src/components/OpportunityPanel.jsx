function kindLabel(kind) {
  if (kind === 'untouched') return 'Untouched';
  if (kind === 'thin') return 'Thin coverage';
  return 'Covered';
}

function fmtDate(v) {
  if (!v) return 'Never';
  try {
    return new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return '—';
  }
}

export default function OpportunityPanel({
  open, onClose, top = [], ghosts = [], days, onFly, onSelect,
}) {
  if (!open) return null;
  const empty = !top.length && !ghosts.length;

  return (
    <aside className="opp-panel" aria-label="Opportunities">
      <div className="opp-head">
        <h3>Opportunities</h3>
        <button type="button" className="filter-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="filter-hint">
        Highest-lead areas with little or no check-in in the last {days} days. Tap to go there.
      </p>
      {empty && <p className="filter-empty">Zoom into a city to see ranked areas.</p>}

      {top.length > 0 && (
        <>
          <h4>Priority areas</h4>
          <ul className="opp-list">
            {top.map((z) => (
              <li key={z.id}>
                <button
                  type="button"
                  className={`opp-item kind-${z.kind}`}
                  onClick={() => {
                    onFly?.(z);
                    onSelect?.({
                      _layer: 'zone',
                      id: z.id,
                      title: kindLabel(z.kind),
                      kind: z.kind,
                      leads: z.leads,
                      stale: z.stale,
                      visits: z.visits,
                      score: z.score,
                      lastVisit: z.lastVisit,
                      lng: z.lng,
                      lat: z.lat,
                    });
                  }}
                >
                  <span className={`opp-kind ${z.kind}`}>{kindLabel(z.kind)}</span>
                  <strong>{z.leads} leads</strong>
                  <span>{z.visits} visits · last {fmtDate(z.lastVisit)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {ghosts.length > 0 && (
        <>
          <h4>Unvisited territories</h4>
          <p className="filter-hint">Territories with leads on the map but no GPS check-ins in this period.</p>
          <ul className="opp-list">
            {ghosts.map((g) => (
              <li key={g.territory}>
                <div className="opp-item kind-untouched static">
                  <span className="opp-kind untouched">Unvisited</span>
                  <strong>{g.territory}</strong>
                  <span>{g.leads} plotted leads · no check-ins</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
