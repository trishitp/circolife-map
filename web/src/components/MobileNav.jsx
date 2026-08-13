import {
  IconActivity, IconAdmin, IconDisc, IconGaps, IconHelp, IconMap, IconMore, IconRoutes,
} from './icons';

const PRIMARY = [
  { id: 'map', label: 'Map', Icon: IconMap },
  { id: 'activity', label: 'Activity', Icon: IconActivity },
  { id: 'routes', label: 'Routes', Icon: IconRoutes },
];

const MORE_ICONS = {
  disc: IconDisc,
  gaps: IconGaps,
  admin: IconAdmin,
  help: IconHelp,
};

export default function MobileNav({
  tab, onTab, moreOpen, setMoreOpen, moreTabs, me, onLogout,
}) {
  const primary = PRIMARY.some((t) => t.id === tab);

  const go = (id) => {
    setMoreOpen(false);
    onTab(id);
  };

  return (
    <>
      <nav className="mobile-nav" aria-label="App">
        {PRIMARY.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`mobile-nav-btn ${tab === t.id ? 'on' : ''}`}
            onClick={() => go(t.id)}
          >
            <t.Icon />
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`mobile-nav-btn ${moreOpen || !primary ? 'on' : ''}`}
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <IconMore />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <button
            type="button"
            className="mobile-more-scrim"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
          />
          <div className="mobile-more-sheet" role="dialog" aria-label="More">
            <div className="mobile-more-handle" aria-hidden />
            <p className="mobile-more-kicker">More</p>
            {moreTabs.map((t) => {
              const Icon = MORE_ICONS[t.id];
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`mobile-more-item ${tab === t.id ? 'on' : ''}`}
                  onClick={() => go(t.id)}
                >
                  {Icon && <Icon />}
                  <span>{t.label}</span>
                </button>
              );
            })}
            {me?.email && (
              <div className="mobile-more-account">
                <strong>{me.name || me.email}</strong>
                <span>{me.email}</span>
                <span className="account-role">{me.admin ? 'Admin' : 'User'}</span>
                <button type="button" className="btn ghost sm" onClick={onLogout}>
                  Log out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
