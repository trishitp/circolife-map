import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView';
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
import MapLegend from './components/MapLegend';
import MapChromeShell from './components/MapChromeShell';
import MapCoach from './components/MapCoach';
import { IconInsights, IconInfo, IconZones } from './components/icons';
import {
  decodeShareHash, encodeShareHash, isFieldMode, packMapView, setFieldMode,
} from './lib/mapViews';
import {
  fetchStats, fetchFiltersCached, fetchAuthStatus, fetchMe, login, logout, getAppToken,
  setAppToken, fetchBdmPincodes,
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

function formatSyncAge(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const hrs = (Date.now() - t) / 3600000;
  if (hrs < 1) return 'Synced just now';
  if (hrs < 24) return `Synced ${Math.round(hrs)}h ago`;
  const days = Math.round(hrs / 24);
  return `Synced ${days}d ago`;
}

function syncAgeClass(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const hrs = (Date.now() - t) / 3600000;
  if (hrs >= 72) return 'stale';
  if (hrs >= 24) return 'warn';
  return 'fresh';
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
  const [active, setActive] = useState(new Set(['assets']));
  const [filters, setFilters] = useState(() => loadLastFilters());
  const [options, setOptions] = useState({
    owners: [], ownerDetails: [], roles: [], sources: [],
    territoryGroups: [], territories: [], userStatuses: [], statuses: [], precisions: [],
  });
  const [optionsError, setOptionsError] = useState(null);
  const [counts, setCounts] = useState({});
  const [filteredCounts, setFilteredCounts] = useState(null);
  const [mapRecordTotal, setMapRecordTotal] = useState(null);
  const [mapTruncatedLayers, setMapTruncatedLayers] = useState([]);
  const [mapClusterMode, setMapClusterMode] = useState(false);
  const [mapPinStats, setMapPinStats] = useState({
    renderedPins: null,
    mapPinPositions: null,
    colocatedStacks: 0,
  });
  const [mapViewport, setMapViewport] = useState(null);
  const [fieldMode, setFieldModeState] = useState(() => isFieldMode());
  const [routesPlanSeed, setRoutesPlanSeed] = useState(null);
  const [activityWalkSeed, setActivityWalkSeed] = useState(null);
  const [discSeverityPreset, setDiscSeverityPreset] = useState('');
  const mapRef = useRef(null);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [discSearch, setDiscSearch] = useState('');
  const [gapsSearch, setGapsSearch] = useState('');
  const [bdmPincodes, setBdmPincodes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const [mapIssue, setMapIssue] = useState(null);
  const [insightMode, setInsightMode] = useState('off');
  const [insightDays, setInsightDays] = useState(90);
  const [insightData, setInsightData] = useState({ top: [], ghosts: [], summary: null });
  const [oppOpen, setOppOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [markerStyle, setMarkerStyle] = useState(DEFAULT_MARKER_STYLE);
  const [flyRequest, setFlyRequest] = useState(null);
  const [zoomNudge, setZoomNudge] = useState(null);
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
        if (!getAppToken()) {
          try {
            await login({});
          } catch {
            /* open dev — /me works without token */
          }
        }
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
    const shared = decodeShareHash(typeof window !== 'undefined' ? window.location.hash : '');
    if (shared?.v === 1) {
      if (Array.isArray(shared.layers) && shared.layers.length) {
        setActive(new Set(shared.layers));
      }
      if (shared.insight) setInsightMode(shared.insight);
      if (shared.days) setInsightDays(shared.days);
      if (shared.center?.length === 2 && shared.zoom != null) {
        setFlyRequest({
          lat: shared.center[1],
          lng: shared.center[0],
          zoom: shared.zoom,
          nonce: Date.now(),
        });
      }
    }
    setOptionsError(null);
    fetchFiltersCached()
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
        if (o.lastSuccessfulSyncAt) setLastSyncAt(o.lastSuccessfulSyncAt);
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

  const selectedRm = useMemo(() => {
    const o = filters.owner;
    const list = Array.isArray(o) ? o : (o ? [o] : []);
    return list.length === 1 ? list[0] : null;
  }, [filters.owner]);

  useEffect(() => {
    if (!selectedRm) {
      setBdmPincodes([]);
      return undefined;
    }
    let cancelled = false;
    fetchBdmPincodes(selectedRm)
      .then((r) => { if (!cancelled) setBdmPincodes(r.pincodes || []); })
      .catch(() => { if (!cancelled) setBdmPincodes([]); });
    return () => { cancelled = true; };
  }, [selectedRm]);

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
      setLegendOpen(false);
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

  const goPlanRoute = useCallback(({ owner, date } = {}) => {
    if (owner) setRoutesPlanSeed({ owner, date: date || undefined });
    setPanelOpen(false);
    setMoreOpen(false);
    setMapMenu(null);
    setTab('routes');
  }, []);

  const goActivityWalk = useCallback(({ owner, date } = {}) => {
    if (owner) setActivityWalkSeed({ owner, date: date || undefined });
    setPanelOpen(false);
    setMoreOpen(false);
    setMapMenu(null);
    setTab('activity');
  }, []);

  const pickInsight = (m) => {
    setInsightMode(m);
    if (m === 'off') setOppOpen(false);
    else if (typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches) {
      setOppOpen(true);
    }
  };

  const toggleFieldMode = (on) => {
    setFieldModeState(on);
    setFieldMode(on);
    if (on && !['map', 'routes'].includes(tab)) setTab('map');
  };

  const mapSnapshot = () => {
    const data = mapRef.current?.exportPng?.();
    if (!data) return;
    const a = document.createElement('a');
    a.href = data;
    a.download = `circolife-map-${Date.now()}.png`;
    a.click();
  };

  const copyMapShareLink = async () => {
    const vp = mapRef.current?.getViewport?.() || mapViewport;
    const hash = encodeShareHash(packMapView({
      active,
      insightMode,
      insightDays,
      center: vp?.center,
      zoom: vp?.zoom,
    }));
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch { /* */ }
  };

  const openDiscForRecord = (p) => {
    const q = p?.id || p?.title || '';
    setDiscSearch(String(q));
    setTab('disc');
    setSelected(null);
    setPanelOpen(false);
  };

  const openGapsForRecord = (p) => {
    const q = p?.id || p?.title || '';
    setGapsSearch(String(q));
    setTab('gaps');
    setSelected(null);
    setPanelOpen(false);
  };

  const focusFromGap = ({ layer, sourceId, territory } = {}) => {
    setTab('map');
    // Prefer territory filter when jumping from Gaps (many rows are unplottable).
    setFilters(territory ? { territory: [territory] } : {});
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
  const visibleTabs = TABS.filter((t) => {
    if (t.id === 'admin' && !me?.admin) return false;
    if (fieldMode && !['map', 'routes', 'help'].includes(t.id)) return false;
    return true;
  });
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
    <div className={`app-shell ${tab === 'map' ? 'is-map' : 'is-page'}${fieldMode ? ' is-field' : ''}`}>
      <div className="top-chrome">
        <BrandMark />
        <nav className="app-tabs" aria-label="Views">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              data-tab={t.id}
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
              <div className="account-menu-tools">
                <button type="button" className="btn ghost sm" onClick={copyMapShareLink}>
                  Copy map link
                </button>
                <button type="button" className="btn ghost sm" onClick={mapSnapshot}>
                  Map snapshot
                </button>
                <button
                  type="button"
                  className={`btn ghost sm${fieldMode ? ' on' : ''}`}
                  onClick={() => toggleFieldMode(!fieldMode)}
                >
                  {fieldMode ? 'Field mode on' : 'Field mode'}
                </button>
              </div>
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
        {tab === 'map' && formatSyncAge(lastSyncAt) && (
          <div
            className={`map-sync-chip ${syncAgeClass(lastSyncAt)}`}
            role="status"
            title={lastSyncAt || ''}
          >
            {formatSyncAge(lastSyncAt)}
          </div>
        )}

        {tab === 'map' && (
          <>
            <button
              type="button"
              className={`map-info-fab${legendOpen ? ' open' : ''}`}
              aria-expanded={legendOpen}
              aria-label="Map legend and precision"
              title="Map legend"
              onClick={() => { setLegendOpen((v) => !v); setMapMenu(null); }}
            >
              i
            </button>
            {legendOpen && (
              <div className="map-legend-popover" role="dialog" aria-label="Legend">
                <button
                  type="button"
                  className="map-legend-close"
                  aria-label="Close legend"
                  onClick={() => setLegendOpen(false)}
                >
                  ×
                </button>
                <MapLegend
                  insightMode={insightMode}
                  selectedRm={selectedRm}
                  showBdmVisits={Boolean(selectedRm && bdmPincodes.length > 0)}
                />
              </div>
            )}
          </>
        )}

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
              <MapLegend
                insightMode={insightMode}
                selectedRm={selectedRm}
                showBdmVisits={Boolean(selectedRm && bdmPincodes.length > 0)}
              />
            </div>
          )}
          {tab === 'map' && mapRecordTotal === 0 && !loading && (
            <div className="map-empty-state soft-block" role="status">
              <strong>No pins in this view</strong>
              <p>Zoom out, clear filters, or turn on another layer. Assets are on by default around Thane.</p>
              <button type="button" className="btn ghost sm" onClick={() => { setFilters({}); setPanelOpen(true); }}>
                Open filters
              </button>
            </div>
          )}
          <MapChromeShell
            active={active}
            toggle={toggle}
            counts={counts}
            filteredCounts={filteredCounts}
            insightMode={insightMode}
            insightDays={insightDays}
            pickInsight={pickInsight}
            setInsightDays={setInsightDays}
            insightSummary={insightData.summary}
            mapRecordTotal={mapRecordTotal}
            mapClusterMode={mapClusterMode}
            mapPinStats={mapPinStats}
            mapTruncatedLayers={mapTruncatedLayers}
            onZoomNudge={() => setZoomNudge({ delta: 1.5, nonce: Date.now() })}
            activeLayerCount={active.size}
          />
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
              <IconInfo />
              <span>Info</span>
            </button>
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

        <MapCoach />

        <MapView
          ref={mapRef}
          active={active}
          filters={filters}
          bdmPincodes={bdmPincodes}
          onViewportChange={setMapViewport}
          onFilteredCounts={(payload) => {
            setFilteredCounts(payload?.counts || null);
            setMapRecordTotal(payload?.total ?? null);
          }}
          onViewMeta={(meta) => {
            setMapTruncatedLayers(meta?.truncatedLayers || []);
            setMapClusterMode(Boolean(meta?.clusterMode));
            setMapPinStats({
              renderedPins: meta?.renderedPins ?? null,
              mapPinPositions: meta?.mapPinPositions ?? null,
              colocatedStacks: meta?.colocatedStacks ?? 0,
            });
          }}
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
          zoomNudge={zoomNudge}
          onZoomNudgeHandled={() => setZoomNudge(null)}
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

        <DetailCard
          p={selected}
          onClose={() => setSelected(null)}
          onViewSources={openDiscForRecord}
          onViewGaps={openGapsForRecord}
          isAdmin={Boolean(me?.admin)}
          onPinUpdated={(next) => setSelected(next)}
        />
      </div>

      {tab === 'activity' && (
        <ActivityPanel
          options={options}
          walkSeed={activityWalkSeed}
          onWalkSeedApplied={() => setActivityWalkSeed(null)}
          onPlanRoute={goPlanRoute}
        />
      )}
      {tab === 'routes' && (
        <RoutesPanel
          options={options}
          planSeed={routesPlanSeed}
          onPlanSeedApplied={() => setRoutesPlanSeed(null)}
          onReviewDay={goActivityWalk}
        />
      )}
      {tab === 'disc' && (
        <DiscrepanciesPanel
          onFocusMap={focusFromGap}
          initialSearch={discSearch}
          initialSeverity={discSeverityPreset}
        />
      )}
      {tab === 'gaps' && (
        <GapsPanel onFocusMap={focusFromGap} initialSearch={gapsSearch} />
      )}
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
        fieldMode={fieldMode}
      />
    </div>
  );
}
