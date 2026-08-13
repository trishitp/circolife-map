import { useEffect, useMemo, useState } from 'react';

const PRECISION_LABELS = {
  exact: 'Exact',
  geocoded: 'Geocoded',
  approx: 'Approx (~1 km)',
  pincode: 'Pincode',
  territory: 'Territory',
  inherited: 'Inherited',
};

export const FILTER_LABELS = {
  userStatus: 'Users',
  role: 'Role',
  owner: 'RM',
  territory: 'Territory',
  source: 'Source',
  status: 'Status',
  precision: 'Precision',
  joint: 'Meeting',
  from: 'From',
  to: 'To',
};

const PRESET_KEY = 'circo.mapFilterPresets';
export const LAST_FILTERS_KEY = 'circo.mapFilters.last';
const MULTI_KEYS = new Set(['userStatus', 'role', 'owner', 'territory', 'source', 'status', 'precision']);

function asList(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '');
  return [v];
}

function normalizeDraft(f = {}) {
  const next = { ...f };
  for (const k of MULTI_KEYS) next[k] = asList(next[k]);
  return next;
}

export function cleanFilters(f = {}) {
  const clean = {};
  for (const [k, v] of Object.entries(f)) {
    if (MULTI_KEYS.has(k)) {
      const list = asList(v);
      if (list.length) clean[k] = list;
    } else if (v != null && v !== '') {
      clean[k] = v;
    }
  }
  return clean;
}

export function describeFilter(key, value) {
  if (key === 'joint') return value === 'true' ? 'Joint' : 'Normal';
  if (key === 'precision') {
    return asList(value).map((p) => PRECISION_LABELS[p] || p).join(', ');
  }
  if (key === 'userStatus') {
    return asList(value).map((s) => (s === 'inactive' ? 'Inactive' : 'Active')).join(', ');
  }
  const list = asList(value);
  if (list.length > 2) return `${list.slice(0, 2).join(', ')} +${list.length - 2}`;
  return list.join(', ') || String(value);
}

export function activeFilterEntries(filters = {}) {
  return Object.entries(filters)
    .filter(([k]) => !['focusId', 'limit'].includes(k))
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ''));
}

export function loadLastFilters() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_FILTERS_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLastFilters(filters) {
  try {
    localStorage.setItem(LAST_FILTERS_KEY, JSON.stringify(cleanFilters(filters)));
  } catch { /* quota / private mode */ }
}

function loadPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function savePresets(list) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  } catch { /* */ }
}

function todayIST() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function daysAgo(days) {
  const [y, m, d] = todayIST().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function yearStart() {
  return `${todayIST().slice(0, 4)}-01-01`;
}

function MultiChipRow({ items, values, onToggle, empty = 'No options yet', scroll }) {
  if (!items.length) return <p className="filter-empty">{empty}</p>;
  const selected = new Set(asList(values).map(String));
  return (
    <div className={`chip-row ${scroll ? 'chip-row-scroll' : ''}`}>
      {items.map(([label, v]) => (
        <button
          key={String(v)}
          type="button"
          className={`chip ${selected.has(String(v)) ? 'on' : ''}`}
          onClick={() => onToggle(v)}
          aria-pressed={selected.has(String(v))}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function withSelectedFirst(visible, selected) {
  const vis = visible.map(String);
  const visSet = new Set(vis.map((s) => s.toLowerCase()));
  const extra = asList(selected).filter((s) => !visSet.has(String(s).toLowerCase()));
  return [...extra, ...visible];
}

export default function FilterPanel({ options, filters, setFilters, open, setOpen, optionsError }) {
  const [draft, setDraft] = useState(() => normalizeDraft(filters));
  const [ownerQ, setOwnerQ] = useState('');
  const [roleQ, setRoleQ] = useState('');
  const [sourceQ, setSourceQ] = useState('');
  const [presets, setPresets] = useState(() => loadPresets());
  const [presetName, setPresetName] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState('');

  useEffect(() => {
    if (open) {
      setDraft(normalizeDraft(filters));
      setSavedFlash('');
    }
  }, [open, filters]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  const toggleMulti = (k, v) => {
    setDraft((f) => {
      const cur = asList(f[k]);
      const sv = String(v);
      const next = cur.some((x) => String(x) === sv)
        ? cur.filter((x) => String(x) !== sv)
        : [...cur, v];
      return { ...f, [k]: next };
    });
  };

  const setKey = (k, v) => setDraft((f) => ({ ...f, [k]: v || '' }));

  const clearKey = (k) => setDraft((f) => {
    const next = { ...f };
    if (MULTI_KEYS.has(k)) next[k] = [];
    else delete next[k];
    return next;
  });

  const clearAll = () => {
    setDraft({
      userStatus: [], role: [], owner: [], territory: [], source: [],
      status: [], precision: [], joint: '', from: '', to: '',
    });
    setOwnerQ('');
    setRoleQ('');
    setSourceQ('');
  };

  const apply = (extra = {}) => {
    const clean = cleanFilters({ ...draft, ...extra });
    setFilters(clean);
    saveLastFilters(clean);
    setOpen(false);
  };

  const savePreset = () => {
    const clean = cleanFilters(draft);
    const name = (presetName || '').trim()
      || `Filter ${new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
    const next = [{ id: String(Date.now()), name, filters: clean }, ...presets].slice(0, 12);
    setPresets(next);
    savePresets(next);
    setPresetName('');
    setSavedFlash(`Saved “${name}”`);
  };

  const loadPreset = (p) => {
    setDraft(normalizeDraft(p.filters || {}));
    setSavedFlash('');
  };

  const applyPreset = (p) => {
    const clean = cleanFilters(p.filters || {});
    setDraft(normalizeDraft(clean));
    setFilters(clean);
    saveLastFilters(clean);
    setOpen(false);
  };

  const deletePreset = (id) => {
    const next = presets.filter((p) => p.id !== id);
    setPresets(next);
    savePresets(next);
  };

  const roles = options.roles || [];
  const territories = options.territoryGroups?.length
    ? options.territoryGroups
    : (options.territories || []);
  const sources = options.sources || [];
  const precisions = options.precisions || [];
  const ownerDetails = options.ownerDetails || [];
  const owners = options.owners || [];

  const filteredRoles = useMemo(() => {
    const q = roleQ.trim().toLowerCase();
    const list = q ? roles.filter((r) => r.toLowerCase().includes(q)) : roles;
    return withSelectedFirst(list.slice(0, q ? 80 : 40), draft.role);
  }, [roles, roleQ, draft.role]);

  const filteredOwners = useMemo(() => {
    const q = ownerQ.trim().toLowerCase();
    const roleSel = asList(draft.role);
    const statusSel = asList(draft.userStatus);
    let list = owners;

    if (ownerDetails.length && (roleSel.length || statusSel.length)) {
      const allowed = new Set(
        ownerDetails
          .filter((o) => {
            if (roleSel.length && !roleSel.includes(o.role)) return false;
            if (statusSel.length && !statusSel.includes(o.status)) return false;
            return true;
          })
          .map((o) => o.name),
      );
      list = owners.filter((o) => allowed.has(o));
      if (!list.length) list = [...allowed];
    }

    if (q) list = list.filter((o) => o.toLowerCase().includes(q));
    const cap = q ? 80 : 40;
    return withSelectedFirst(list.slice(0, cap), draft.owner);
  }, [owners, ownerDetails, ownerQ, draft.role, draft.userStatus, draft.owner]);

  const filteredSources = useMemo(() => {
    const q = sourceQ.trim().toLowerCase();
    const list = q ? sources.filter((s) => s.toLowerCase().includes(q)) : sources;
    return withSelectedFirst(list.slice(0, q ? 80 : 40), draft.source);
  }, [sources, sourceQ, draft.source]);

  const draftActive = activeFilterEntries(draft);
  const appliedActive = activeFilterEntries(filters);
  const activeCount = appliedActive.length;
  const selCount = (k) => asList(draft[k]).length;

  const createdPreset = (() => {
    if (!draft.from) return '';
    if (draft.from === daysAgo(30) && !draft.to) return '30';
    if (draft.from === daysAgo(90) && !draft.to) return '90';
    if (draft.from === yearStart() && !draft.to) return 'year';
    return 'custom';
  })();

  const applyCreated = (preset) => {
    if (preset === '30') setDraft((f) => ({ ...f, from: daysAgo(30), to: '' }));
    else if (preset === '90') setDraft((f) => ({ ...f, from: daysAgo(90), to: '' }));
    else if (preset === 'year') setDraft((f) => ({ ...f, from: yearStart(), to: '' }));
    else setDraft((f) => ({ ...f, from: '', to: '' }));
  };

  if (!open) {
    return (
      <button type="button" className="filter-fab" onClick={() => setOpen(true)}>
        Filters
        {activeCount > 0 && <span className="badge">{activeCount}</span>}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className="filter-scrim"
        aria-label="Close filters"
        onClick={() => setOpen(false)}
      />
      <aside className="filter-panel" aria-label="Filters" role="dialog" aria-modal="true">
        <div className="filter-panel-chrome">
          <div className="grab" aria-hidden />
          <div className="filter-panel-head">
            <h3>Filters</h3>
            <div className="filter-head-right">
              {draftActive.length > 0 && (
                <span className="filter-active-count">{draftActive.length} selected</span>
              )}
              <button type="button" className="filter-close" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
          </div>
        </div>

        <div className="filter-panel-body">
          {optionsError && (
            <p className="filter-banner err">{optionsError}</p>
          )}

          {draftActive.length > 0 && (
            <div className="filter-active-row" aria-label="Selected filters">
              {draftActive.map(([k, v]) => (
                <button
                  key={k}
                  type="button"
                  className="chip on filter-active-chip"
                  onClick={() => clearKey(k)}
                >
                  {FILTER_LABELS[k] || k}: {describeFilter(k, v)}
                  <span aria-hidden> ×</span>
                </button>
              ))}
            </div>
          )}

          <h4>User status {selCount('userStatus') > 0 && <em>{selCount('userStatus')}</em>}</h4>
          <MultiChipRow
            items={[['Active', 'active'], ['Inactive', 'inactive']]}
            values={draft.userStatus}
            onToggle={(v) => toggleMulti('userStatus', v)}
          />

          <h4>Role (CRM) {selCount('role') > 0 && <em>{selCount('role')}</em>}</h4>
          {roles.length > 8 && (
            <input
              className="filter-search"
              type="search"
              placeholder="Search roles…"
              value={roleQ}
              onChange={(e) => setRoleQ(e.target.value)}
              aria-label="Search roles"
              enterKeyHint="search"
            />
          )}
          <MultiChipRow
            items={filteredRoles.map((r) => [r, r])}
            values={draft.role}
            onToggle={(v) => toggleMulti('role', v)}
            empty={roles.length ? 'No matching roles' : 'No CRM roles yet — run a sync'}
            scroll
          />

          <h4>RM name {selCount('owner') > 0 && <em>{selCount('owner')}</em>}</h4>
          <input
            className="filter-search"
            type="search"
            placeholder="Search RMs…"
            value={ownerQ}
            onChange={(e) => setOwnerQ(e.target.value)}
            aria-label="Search RM names"
            enterKeyHint="search"
          />
          <MultiChipRow
            items={filteredOwners.map((o) => [o, o])}
            values={draft.owner}
            onToggle={(v) => toggleMulti('owner', v)}
            empty={owners.length ? 'No matching RMs' : 'No RMs yet — run a sync'}
            scroll
          />
          {!ownerQ && owners.length > 40 && (
            <p className="filter-hint">Showing 40 of {owners.length} — search to find more</p>
          )}

          <h4>Territory {selCount('territory') > 0 && <em>{selCount('territory')}</em>}</h4>
          <p className="filter-hint">Delhi includes NCR. Mumbai includes Thane, Navi Mumbai and MMR.</p>
          <MultiChipRow
            items={territories.map((t) => [t, t])}
            values={draft.territory}
            onToggle={(v) => toggleMulti('territory', v)}
            empty="Territory groups unavailable"
          />

          <h4>Source {selCount('source') > 0 && <em>{selCount('source')}</em>}</h4>
          <p className="filter-hint">Lead source — meetings, accounts and assets stay visible.</p>
          {sources.length > 8 && (
            <input
              className="filter-search"
              type="search"
              placeholder="Search sources…"
              value={sourceQ}
              onChange={(e) => setSourceQ(e.target.value)}
              aria-label="Search lead sources"
              enterKeyHint="search"
            />
          )}
          <MultiChipRow
            items={filteredSources.map((s) => [s, s])}
            values={draft.source}
            onToggle={(v) => toggleMulti('source', v)}
            empty={sources.length ? 'No matching sources' : 'No lead sources yet'}
            scroll
          />

          <button
            type="button"
            className="filter-more-toggle"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
          >
            {moreOpen ? 'Hide more filters' : 'More filters'}
          </button>

          {moreOpen && (
            <>
              <h4>Precision</h4>
              <MultiChipRow
                items={precisions.map((p) => [PRECISION_LABELS[p] || p, p])}
                values={draft.precision}
                onToggle={(v) => toggleMulti('precision', v)}
                empty="No precision values yet"
              />

              <h4>Meeting type</h4>
              <p className="filter-hint">Meetings layer only.</p>
              <div className="chip-row">
                {[['Normal', 'false'], ['Joint', 'true']].map(([label, v]) => (
                  <button
                    key={v}
                    type="button"
                    className={`chip ${draft.joint === v ? 'on' : ''}`}
                    onClick={() => setKey('joint', draft.joint === v ? '' : v)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <h4>Recorded date</h4>
              <div className="chip-row">
                {[
                  ['30 days', '30'],
                  ['90 days', '90'],
                  ['This year', 'year'],
                ].map(([label, preset]) => (
                  <button
                    key={preset}
                    type="button"
                    className={`chip ${createdPreset === preset ? 'on' : ''}`}
                    onClick={() => applyCreated(createdPreset === preset ? '' : preset)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="filter-date-row">
                <label>
                  From
                  <input
                    type="date"
                    value={draft.from || ''}
                    onChange={(e) => setKey('from', e.target.value)}
                  />
                </label>
                <label>
                  To
                  <input
                    type="date"
                    value={draft.to || ''}
                    onChange={(e) => setKey('to', e.target.value)}
                  />
                </label>
              </div>
            </>
          )}

          <div className="filter-save-block">
            <h4>Saved filters</h4>
            <div className="filter-save-row">
              <input
                className="filter-search"
                type="text"
                placeholder="Name this filter…"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                aria-label="Saved filter name"
              />
              <button type="button" className="chip" onClick={savePreset}>Save</button>
            </div>
            {savedFlash && <p className="filter-hint filter-saved-msg">{savedFlash}</p>}
            {presets.length > 0 && (
              <ul className="filter-preset-list">
                {presets.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="filter-preset-load" onClick={() => loadPreset(p)}>
                      {p.name}
                    </button>
                    <button type="button" className="chip filter-preset-apply" onClick={() => applyPreset(p)}>
                      Apply
                    </button>
                    <button
                      type="button"
                      className="filter-preset-del"
                      onClick={() => deletePreset(p.id)}
                      aria-label={`Delete ${p.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="filter-actions">
          <button type="button" className="chip" onClick={clearAll}>Clear</button>
          <button type="button" className="chip on" onClick={() => apply()}>Apply</button>
        </div>
      </aside>
    </>
  );
}
