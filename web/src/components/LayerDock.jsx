const META = [
  { key: 'leads', label: 'Leads', color: 'var(--layer-leads)' },
  { key: 'accounts', label: 'Accounts', color: 'var(--layer-accounts)' },
  { key: 'meetings', label: 'Meetings', color: 'var(--layer-meetings)' },
  { key: 'assets', label: 'Assets', color: 'var(--layer-assets)' },
];

const abbr = (n) => {
  if (n == null) return '';
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export default function LayerDock({ active, toggle, counts }) {
  return (
    <nav className="layer-dock" aria-label="Map layers">
      {META.map((l) => (
        <button
          key={l.key}
          type="button"
          className={`layer-pill ${active.has(l.key) ? 'on' : ''}`}
          style={{ '--pill-color': l.color }}
          aria-pressed={active.has(l.key)}
          onClick={() => toggle(l.key)}
        >
          <span className="dot" style={{ background: l.color }} aria-hidden />
          {l.label}
          <span className="count">{abbr(counts[l.key])}</span>
        </button>
      ))}
    </nav>
  );
}
