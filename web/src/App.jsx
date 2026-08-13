import { useEffect, useState } from 'react';
import MapView from './components/MapView';
import LayerDock from './components/LayerDock';
import FilterPanel, {
  activeFilterEntries, describeFilter, FILTER_LABELS,
  loadLastFilters, saveLastFilters,
} from './components/FilterPanel';
import DetailCard from './components/DetailCard';
import GapsPanel from './components/GapsPanel';
import AdminPanel from './components/AdminPanel';
import DiscrepanciesPanel from './components/DiscrepanciesPanel';
import ActivityPanel from './components/ActivityPanel';
import RoutesPanel from './components/RoutesPanel';
import SharedRouteView from './components/SharedRouteView';
import HelpGuide from './components/HelpGuide';
import LoginScreen from './components/LoginScreen';
import InsightDock from './components/InsightDock';
import OpportunityPanel from './components/OpportunityPanel';
import {
  fetchStats, fetchFilters, fetchAuthStatus, fetchMe, login, logout, getAppToken,
} from './lib/api';

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'activity', label: 'Activity' },
  { id: 'routes', label: 'Routes' },
  { id: 'disc', label: 'Discrepancies' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'admin', label: 'Admin' },
  { id: 'help', label: 'How to use' },
];

/** Shared RM link: #/r/<token> or #r/<token> */
function parseShareToken() {
  if (typeof window === 'undefined') return null;
  const hash = (window.location.hash || '').replace(/^#/, '');
  const m = hash.match(/^\/?r\/([A-Za-z0-9_-]{16,})$/);
  if (m) return m[1];
  const q = new URLSearchParams(window.location.search).get('r');
  if (q && /^[A-Za-z0-9_-]{16,}$/.test(q)) return q;
  return null;
}

export default function App() {
  const [shareToken] = useState(() => parseShareToken());
  const [authState, setAuthState] = useState(() => (shareToken ? 'share' : 'loading'));
  const [tab, setTab] = useState('map');
  const [active, setActive] = useState(new Set(['leads', 'meetings']));
  const [filters, setFilters] = useState(() => loadLastFilters());
  const [options, setOptions] = useState({
    owners: [], ownerDetails: [], roles: [], sources: [],
    territoryGroups: [], territories: [], userStatuses: [], statuses: [], precisions: [],
  });
  const [optionsError, setOptionsError] = useState(null);
  const [counts, setCounts] = useState({});
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const [mapIssue, setMapIssue] = useState(null);
  const [insightMode, setInsightMode] = useState('off');
  const [insightDays, setInsightDays] = useState(90);
  const [insightData, setInsightData] = useState({ top: [], ghosts: [], summary: null });
  const [oppOpen, setOppOpen] = useState(false);
  const [flyRequest, setFlyRequest] = useState(null);

  const bootstrap = async () => {
    try {
      const status = await fetchAuthStatus();
      if (!status.authRequired) {
        if (!getAppToken()) await login('');
        setAuthState('ok');
        return;
      }
      if (!getAppToken()) {
        setAuthState('need');
        return;
      }
      await fetchMe();
      setAuthState('ok');
    } catch {
      setAuthState('need');
    }
  };

  useEffect(() => {
    if (shareToken) return undefined;
    bootstrap();
    return undefined;
  }, [shareToken]);

  useEffect(() => {
    if (shareToken) return undefined;
    const onUnauth = () => setAuthState('need');
    window.addEventListener('circo:unauthorized', onUnauth);
    return () => window.removeEventListener('circo:unauthorized', onUnauth);
  }, [shareToken]);

  useEffect(() => {
    if (authState !== 'ok') return undefined;
    setOptionsError(null);
    fetchFilters()
      .then((o) => {
        setOptions({
          owners: o.owners || [],
          ownerDetails: o.ownerDetails || [],
          roles: o.roles || [],
          sources: o.sources || [],
          territoryGroups: o.territoryGroups || o.territories || [],
          territories: o.territories || [],
          userStatuses: o.userStatuses || ['active', 'inactive'],
          statuses: o.statuses || [],
          precisions: o.precisions || [],
        });
      })
      .catch((e) => {
        setOptionsError(e.message || 'Could not load filter options');
      });
    fetchStats().then((rows) => {
      const c = {};
      for (const r of rows) c[r.layer] = (c[r.layer] || 0) + Number(r.n);
      setCounts(c);
    }).catch((e) => {
      if (e.status === 401) setAuthState('need');
    });
    return undefined;
  }, [authState]);

  useEffect(() => {
    saveLastFilters(filters);
  }, [filters]);

  const toggle = (k) => setActive((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  const openFilters = (next) => {
    if (next) {
      setSelected(null);
      setOppOpen(false);
    }
    setPanelOpen(next);
  };

  const focusFromGap = ({ layer, sourceId }) => {
    setTab('map');
    // Clear filters so the focused point is not hidden
    setFilters({});
    if (layer) setActive(new Set([layer]));
    if (sourceId && layer) {
      setFocusRequest({ layer, id: String(sourceId), nonce: Date.now() });
    }
  };

  const doLogout = () => {
    logout();
    setAuthState('need');
  };

  const activeFilters = activeFilterEntries(filters);

  if (shareToken || authState === 'share') {
    return (
      <div className="app-shell is-share">
        <SharedRouteView token={shareToken} />
      </div>
    );
  }

  if (authState === 'loading') {
    return (
      <div className="login-screen">
        <div className="login-card muted">Loading Circolife Maps…</div>
      </div>
    );
  }

  if (authState === 'need') {
    return <LoginScreen onSuccess={() => setAuthState('ok')} />;
  }

  return (
    <div className={`app-shell ${tab === 'map' ? 'is-map' : 'is-page'}`}>
      <div className="top-chrome">
        <div className="brand">
          circo<span>life</span>
          <small>maps</small>
        </div>
        <nav className="app-tabs" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`app-tab ${tab === t.id ? 'on' : ''}`}
              aria-pressed={tab === t.id}
              onClick={() => {
                setPanelOpen(false);
                setTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <button type="button" className="btn ghost sm logout-btn" onClick={doLogout}>
          Log out
        </button>
      </div>

      <div
        className={[
          'map-shell',
          tab === 'map' ? '' : 'is-hidden',
          mapIssue ? 'has-issue' : '',
          activeFilters.length > 0 ? 'has-filter-chips' : '',
          panelOpen ? 'filters-open' : '',
          insightMode !== 'off' ? 'has-insights' : '',
        ].filter(Boolean).join(' ')}
        aria-hidden={tab !== 'map'}
      >
        {mapIssue && (
          <div
            className={`map-issue map-issue-top ${mapIssue.type === 'error' ? 'err' : 'warn'}`}
            role="status"
          >
            <span className="map-issue-icon" aria-hidden>
              {mapIssue.type === 'error' ? '!' : 'i'}
            </span>
            <span className="map-issue-text">{mapIssue.message}</span>
            <button type="button" className="map-issue-x" onClick={() => setMapIssue(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}

        <LayerDock active={active} toggle={toggle} counts={counts} />
        <InsightDock
          mode={insightMode}
          days={insightDays}
          onMode={(m) => {
            setInsightMode(m);
            if (m !== 'off') setOppOpen(true);
            else setOppOpen(false);
          }}
          onDays={setInsightDays}
          summary={insightData.summary}
        />

        <div className={`map-status ${loading ? 'show' : ''}`} aria-live="polite">
          Updating map…
        </div>

        {tab === 'map' && activeFilters.length > 0 && (
          <div className="map-filter-chips" aria-label="Active filters">
            {activeFilters.map(([k, v]) => (
              <button
                key={k}
                type="button"
                className="map-filter-chip"
                onClick={() => setFilters((f) => {
                  const n = { ...f };
                  delete n[k];
                  return n;
                })}
                title="Remove filter"
              >
                <em>{FILTER_LABELS[k] || k}</em>
                {describeFilter(k, v)}
                <span aria-hidden>×</span>
              </button>
            ))}
            <button
              type="button"
              className="map-filter-chip clear"
              onClick={() => setFilters({})}
            >
              Clear all
            </button>
          </div>
        )}

        <MapView
          active={active}
          filters={filters}
          onSelect={setSelected}
          onLoading={setLoading}
          focusRequest={focusRequest}
          onFocusHandled={() => setFocusRequest(null)}
          onMapIssue={setMapIssue}
          visible={tab === 'map'}
          insight={{ mode: insightMode, days: insightDays }}
          onInsight={setInsightData}
          flyRequest={flyRequest}
          onFlyHandled={() => setFlyRequest(null)}
        />

        <div className="map-legend" aria-hidden>
          {insightMode === 'off' ? (
            <>
              <strong>Precision</strong>
              <div className="legend-row"><span className="legend-swatch exact" /> Exact / geocoded</div>
              <div className="legend-row"><span className="legend-swatch approx" /> Check-in (~1 km)</div>
              <div className="legend-row"><span className="legend-swatch pincode" /> Pincode / territory</div>
              <div className="legend-row"><span className="legend-swatch inherited" /> Inherited</div>
            </>
          ) : insightMode === 'heat' ? (
            <>
              <strong>Visit heat</strong>
              <div className="legend-row"><span className="legend-swatch heat-cool" /> Quiet</div>
              <div className="legend-row"><span className="legend-swatch heat-hot" /> Heavy check-ins</div>
            </>
          ) : (
            <>
              <strong>{insightMode === 'untouched' ? 'Untouched' : 'Coverage'}</strong>
              <div className="legend-row"><span className="legend-swatch zone-untouched" /> No visits · has leads</div>
              {insightMode === 'coverage' && (
                <>
                  <div className="legend-row"><span className="legend-swatch zone-thin" /> Thin vs leads</div>
                  <div className="legend-row"><span className="legend-swatch zone-covered" /> Covered</div>
                </>
              )}
            </>
          )}
        </div>

        {insightMode !== 'off' && !oppOpen && (
          <button
            type="button"
            className="opp-fab"
            onClick={() => setOppOpen(true)}
          >
            Opportunities
            {insightData.top?.length > 0 && <span className="badge">{insightData.top.length}</span>}
          </button>
        )}

        <OpportunityPanel
          open={oppOpen && insightMode !== 'off'}
          onClose={() => setOppOpen(false)}
          top={insightData.top}
          ghosts={insightData.ghosts}
          days={insightDays}
          onFly={(z) => setFlyRequest({ ...z, nonce: Date.now() })}
          onSelect={setSelected}
        />

        <FilterPanel
          options={options}
          filters={filters}
          setFilters={setFilters}
          open={panelOpen}
          setOpen={openFilters}
          optionsError={optionsError}
        />

        <DetailCard p={selected} onClose={() => setSelected(null)} />
      </div>

      {tab === 'activity' && <ActivityPanel options={options} />}
      {tab === 'routes' && <RoutesPanel options={options} />}
      {tab === 'disc' && <DiscrepanciesPanel onFocusMap={focusFromGap} />}
      {tab === 'gaps' && <GapsPanel onFocusMap={focusFromGap} />}
      {tab === 'admin' && <AdminPanel />}
      {tab === 'help' && <HelpGuide onOpenTab={setTab} />}
    </div>
  );
}
