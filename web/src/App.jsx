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
import MobileNav from './components/MobileNav';
import BrandMark from './components/BrandMark';
import AppLoader from './components/AppLoader';
import { IconInsights, IconLegend, IconZones } from './components/icons';
import {
  fetchStats, fetchFilters, fetchAuthStatus, fetchMe, login, logout, getAppToken,
  setAppToken,
} from './lib/api';
import { DEFAULT_MARKER_STYLE, normalizeMarkerStyle } from './lib/mapMarkerStyle';

const TABS = [
  { id: 'map', label: 'Map' },
  { id: 'activity', label: 'Activity' },
  { id: 'routes', label: 'Routes' },
  { id: 'disc', label: 'Discrepancies' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'admin', label: 'Admin' },
  { id: 'help', label: 'Help' },
];

function takeAuthFromUrl() {
  if (typeof window === 'undefined') return { token: null, error: null };
  const q = new URLSearchParams(window.location.search);
  const token = q.get('auth_token');
  const error = q.get('auth_error');
  if (token || error) {
    q.delete('auth_token');
    q.delete('auth_error');
    const search = q.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
  }
  return { token, error };
}

function accountInitials(name, email) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  const e = String(email || '').trim();
  return e ? e[0].toUpperCase() : '•';
}

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
  const [legendOpen, setLegendOpen] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 901px)').matches : true
  ));
  const [markerStyle, setMarkerStyle] = useState(DEFAULT_MARKER_STYLE);
  const [flyRequest, setFlyRequest] = useState(null);
  const [me, setMe] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mapMenu, setMapMenu] = useState(null);

  const bootstrap = async () => {
    try {
      const fromUrl = takeAuthFromUrl();
      if (fromUrl.error) setLoginError(fromUrl.error);
      if (fromUrl.token) setAppToken(fromUrl.token);
      const status = await fetchAuthStatus();
      if (!status.authRequired) {
        if (!getAppToken()) await login({});
        const user = await fetchMe();
        setMe(user);
        setAuthState('ok');
        return;
      }
      if (!getAppToken()) {
        setAuthState('need');
        return;
      }
      const user = await fetchMe();
      setMe(user);
      setAuthState('ok');
    } catch {
      setMe(null);
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
        if (o.markerStyle) setMarkerStyle(normalizeMarkerStyle(o.markerStyle));
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

  useEffect(() => {
    if (me && !me.admin && tab === 'admin') setTab('map');
  }, [me, tab]);

  const toggle = (k) => setActive((s) => {
    const n = new Set(s);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  const openFilters = (next) => {
    if (next) {
      setSelected(null);
      setOppOpen(false);
      setMapMenu(null);
      setMoreOpen(false);
    }
    setPanelOpen(next);
  };

  const setTabAndClose = (id) => {
    setPanelOpen(false);
    setMoreOpen(false);
    setMapMenu(null);
    setTab(id);
  };

  const pickInsight = (m) => {
    setInsightMode(m);
    if (m === 'off') setOppOpen(false);
    else if (typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches) {
      setOppOpen(true);
    }
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
    setMe(null);
    setAuthState('need');
  };

  const activeFilters = activeFilterEntries(filters);
  const visibleTabs = TABS.filter((t) => t.id !== 'admin' || me?.admin);
  const moreTabs = visibleTabs.filter((t) => !['map', 'activity', 'routes'].includes(t.id));

  if (shareToken || authState === 'share') {
    return (
      <div className="app-shell is-share">
        <SharedRouteView token={shareToken} />
      </div>
    );
  }

  if (authState === 'loading') {
    return <AppLoader />;
  }

  if (authState === 'need') {
    return (
      <LoginScreen
        error={loginError}
        onSuccess={(user) => {
          setMe(user);
          setAuthState('ok');
        }}
      />
    );
  }

  return (
    <div className={`app-shell ${tab === 'map' ? 'is-map' : 'is-page'}`}>
      <div className="top-chrome">
        <BrandMark />
        <nav className="app-tabs" aria-label="Views">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`app-tab ${tab === t.id ? 'on' : ''}`}
              aria-pressed={tab === t.id}
              onClick={() => setTabAndClose(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {me?.email ? (
          <details className="account-menu">
            <summary className="account-summary" title={me.email}>
              <span className="account-name-full">{me.name || me.email}</span>
              <span className="account-name-short" aria-hidden>
                {accountInitials(me.name, me.email)}
              </span>
            </summary>
            <div className="account-menu-body">
              <div className="account-email">{me.email}</div>
              <div className="account-role">{me.admin ? 'Admin' : 'User'}</div>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>Signed in with your Circolife Zoho account</p>
              <button type="button" className="btn ghost sm" onClick={doLogout}>
                Log out
              </button>
            </div>
          </details>
        ) : (
          <button type="button" className="btn ghost sm logout-btn" onClick={doLogout}>
            Log out
          </button>
        )}
      </div>

      <div
        className={[
          'map-shell',
          tab === 'map' ? '' : 'is-hidden',
          mapIssue ? 'has-issue' : '',
          activeFilters.length > 0 ? 'has-filter-chips' : '',
          panelOpen ? 'filters-open' : '',
          insightMode !== 'off' ? 'has-insights' : '',
          selected ? 'has-selected' : '',
          oppOpen && insightMode !== 'off' ? 'has-opp' : '',
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

        <BrandMark compact product="" className="map-brand-chip" />

        <div className="map-mobile-tray">
          {mapMenu === 'insights' && (
            <div className="map-tool-sheet" role="dialog" aria-label="Insights">
              <InsightDock
                mode={insightMode}
                days={insightDays}
                onMode={pickInsight}
                onDays={setInsightDays}
                summary={insightData.summary}
              />
            </div>
          )}
          {mapMenu === 'legend' && (
            <div className="map-tool-sheet map-tool-sheet-legend" role="dialog" aria-label="Legend">
              {insightMode === 'off' ? (
                <>
                  <strong>Reach</strong>
                  <div className="legend-row"><span className="legend-swatch heat-cool" /> Heat = density of real locations</div>
                  <div className="legend-row"><span className="legend-swatch exact" /> Pins stay on the actual spot</div>
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
                  <div className="legend-row"><span className="legend-swatch zone-untouched" /> Leads, no visits</div>
                  {insightMode === 'coverage' && (
                    <>
                      <div className="legend-row"><span className="legend-swatch zone-thin" /> Thin vs leads</div>
                      <div className="legend-row"><span className="legend-swatch zone-covered" /> Covered</div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <div className="map-chrome-docks">
            <LayerDock active={active} toggle={toggle} counts={counts} />
            <InsightDock
              mode={insightMode}
              days={insightDays}
              onMode={pickInsight}
              onDays={setInsightDays}
              summary={insightData.summary}
            />
          </div>
          <div className="map-bottom-tools">
            <FilterPanel
              options={options}
              filters={filters}
              setFilters={setFilters}
              open={panelOpen}
              setOpen={openFilters}
              optionsError={optionsError}
            />
            {insightMode !== 'off' && !oppOpen && (
              <button
                type="button"
                className="opp-fab"
                onClick={() => { setMapMenu(null); setOppOpen(true); }}
              >
                <IconZones />
                <span className="opp-fab-full">Opportunities</span>
                <span className="opp-fab-short">Zones</span>
                {insightData.top?.length > 0 && <span className="badge">{insightData.top.length}</span>}
              </button>
            )}
            <button
              type="button"
              className={`map-tool-btn ${insightMode !== 'off' ? 'on' : ''} ${mapMenu === 'insights' ? 'open' : ''}`}
              aria-expanded={mapMenu === 'insights'}
              onClick={() => setMapMenu((m) => (m === 'insights' ? null : 'insights'))}
            >
              <IconInsights />
              <span>Insights</span>
            </button>
            <button
              type="button"
              className={`map-tool-btn ${mapMenu === 'legend' ? 'open' : ''}`}
              aria-expanded={mapMenu === 'legend'}
              onClick={() => setMapMenu((m) => (m === 'legend' ? null : 'legend'))}
            >
              <IconLegend />
              <span>Legend</span>
            </button>
            <details
              className="map-legend"
              open={legendOpen}
              onToggle={(e) => setLegendOpen(e.currentTarget.open)}
            >
              <summary className="map-legend-toggle">Legend</summary>
              <div className="map-legend-body">
                {insightMode === 'off' ? (
                  <>
                    <strong>Reach</strong>
                    <div className="legend-row"><span className="legend-swatch heat-cool" /> Heat = density of real locations</div>
                    <div className="legend-row"><span className="legend-swatch exact" /> Pins stay on the actual spot</div>
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
                    <div className="legend-row"><span className="legend-swatch zone-untouched" /> Leads, no visits</div>
                    {insightMode === 'coverage' && (
                      <>
                        <div className="legend-row"><span className="legend-swatch zone-thin" /> Thin vs leads</div>
                        <div className="legend-row"><span className="legend-swatch zone-covered" /> Covered</div>
                      </>
                    )}
                  </>
                )}
              </div>
            </details>
          </div>
        </div>

        <div className={`map-status ${loading ? 'show' : ''}`} aria-live="polite">
          Refreshing map…
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
          onSelect={(p) => {
            setSelected(p);
            if (p) setOppOpen(false);
          }}
          onLoading={setLoading}
          focusRequest={focusRequest}
          onFocusHandled={() => setFocusRequest(null)}
          onMapIssue={setMapIssue}
          visible={tab === 'map'}
          insight={{ mode: insightMode, days: insightDays }}
          onInsight={setInsightData}
          flyRequest={flyRequest}
          onFlyHandled={() => setFlyRequest(null)}
          markerStyle={markerStyle}
        />

        <OpportunityPanel
          open={oppOpen && insightMode !== 'off'}
          onClose={() => setOppOpen(false)}
          top={insightData.top}
          ghosts={insightData.ghosts}
          days={insightDays}
          onFly={(z) => setFlyRequest({ ...z, nonce: Date.now() })}
          onSelect={(p) => {
            setSelected(p);
            if (p) setOppOpen(false);
          }}
        />

        <DetailCard p={selected} onClose={() => setSelected(null)} />
      </div>

      {tab === 'activity' && <ActivityPanel options={options} />}
      {tab === 'routes' && <RoutesPanel options={options} />}
      {tab === 'disc' && <DiscrepanciesPanel onFocusMap={focusFromGap} />}
      {tab === 'gaps' && <GapsPanel onFocusMap={focusFromGap} />}
      {tab === 'admin' && me?.admin && (
        <AdminPanel me={me} markerStyle={markerStyle} onMarkerStyle={setMarkerStyle} />
      )}
      {tab === 'help' && <HelpGuide onOpenTab={setTab} isAdmin={Boolean(me?.admin)} />}

      <MobileNav
        tab={tab}
        onTab={setTabAndClose}
        moreOpen={moreOpen}
        setMoreOpen={setMoreOpen}
        moreTabs={moreTabs}
        me={me}
        onLogout={doLogout}
      />
    </div>
  );
}
