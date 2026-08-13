import { IconAc } from './icons';

const META = [
  { key: 'leads', label: 'Leads', short: 'Leads', color: 'var(--layer-leads)' },
  { key: 'accounts', label: 'Accounts', short: 'Accts', color: 'var(--layer-accounts)' },
  { key: 'meetings', label: 'Meetings', short: 'Meet', color: 'var(--layer-meetings)' },
  { key: 'assets', label: 'Assets', short: 'ACs', color: 'var(--layer-assets)' },
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
          {l.key === 'assets'
            ? <span className="ac-glyph" aria-hidden><IconAc size={15} /></span>
            : <span className="dot" style={{ background: l.color }} aria-hidden />}
          <span className="layer-label-full">{l.label}</span>
          <span className="layer-label-short">{l.short}</span>
          <span className="count">{abbr(counts[l.key])}</span>
        </button>
      ))}
    </nav>
  );
}
