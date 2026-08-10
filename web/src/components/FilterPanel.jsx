import { useMemo, useState } from 'react';

const PRECISION_LABELS = {
  exact: 'Exact',
  geocoded: 'Geocoded',
  approx: 'Approx (~1 km)',
  pincode: 'Pincode',
  territory: 'Territory',
  inherited: 'Inherited',
};

export const FILTER_LABELS = {
  owner: 'Agent',
  territory: 'Territory',
  status: 'Status',
  precision: 'Precision',
  joint: 'Meeting',
  from: 'From',
  to: 'To',
};

export function describeFilter(key, value) {
  if (key === 'joint') return value === 'true' ? 'Joint' : 'Normal';
  if (key === 'precision') return PRECISION_LABELS[value] || value;
  return String(value);
}

export function activeFilterEntries(filters = {}) {
  return Object.entries(filters)
    .filter(([, v]) => v != null && v !== '')
    .filter(([k]) => !['focusId', 'limit'].includes(k));
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

function ChipRow({ items, value, onToggle, empty = 'No options yet' }) {
  if (!items.length) return <p className="filter-empty">{empty}</p>;
  return (
    <div className="chip-row">
      {items.map(([label, v]) => (
        <button
          key={String(v)}
          type="button"
          className={`chip ${value === v ? 'on' : ''}`}
          onClick={() => onToggle(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default function FilterPanel({ options, filters, setFilters, open, setOpen, optionsError }) {
  const [ownerQ, setOwnerQ] = useState('');
  const [terrQ, setTerrQ] = useState('');
  const [statusQ, setStatusQ] = useState('');

  const set = (k, v) => setFilters((f) => ({ ...f, [k]: f[k] === v ? '' : v }));
  const setKey = (k, v) => setFilters((f) => ({ ...f, [k]: v || '' }));
  const clearKey = (k) => setFilters((f) => {
    const next = { ...f };
    delete next[k];
    return next;
  });

  const owners = options.owners || [];
  const territories = options.territories || [];
  const statuses = options.statuses || [];
  const precisions = options.precisions || [];

  const filteredOwners = useMemo(() => {
    const q = ownerQ.trim().toLowerCase();
    const list = q ? owners.filter((o) => o.toLowerCase().includes(q)) : owners;
    return list.slice(0, 120);
  }, [owners, ownerQ]);

  const filteredTerritories = useMemo(() => {
    const q = terrQ.trim().toLowerCase();
    const list = q ? territories.filter((t) => t.toLowerCase().includes(q)) : territories;
    return list.slice(0, 80);
  }, [territories, terrQ]);

  const filteredStatuses = useMemo(() => {
    const q = statusQ.trim().toLowerCase();
    if (!q) return statuses;
    return statuses.filter((s) => s.toLowerCase().includes(q));
  }, [statuses, statusQ]);

  const active = activeFilterEntries(filters);
  const activeCount = active.length;

  const createdPreset = (() => {
    if (!filters.from) return '';
    if (filters.from === daysAgo(30) && !filters.to) return '30';
    if (filters.from === daysAgo(90) && !filters.to) return '90';
    if (filters.from === yearStart() && !filters.to) return 'year';
    return 'custom';
  })();

  const applyCreated = (preset) => {
    if (preset === '30') setFilters((f) => ({ ...f, from: daysAgo(30), to: '' }));
    else if (preset === '90') setFilters((f) => ({ ...f, from: daysAgo(90), to: '' }));
    else if (preset === 'year') setFilters((f) => ({ ...f, from: yearStart(), to: '' }));
    else setFilters((f) => ({ ...f, from: '', to: '' }));
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
      <aside className="filter-panel" aria-label="Filters">
        <div className="grab" onClick={() => setOpen(false)} aria-hidden />
        <div className="filter-panel-head">
          <h3>Filters</h3>
          <div className="filter-head-right">
            {activeCount > 0 && <span className="filter-active-count">{activeCount} active</span>}
            <button type="button" className="filter-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {optionsError && (
          <p className="filter-banner err">{optionsError}</p>
        )}

        {activeCount > 0 && (
          <div className="filter-active-row" aria-label="Active filters">
            {active.map(([k, v]) => (
              <button
                key={k}
                type="button"
                className="chip on filter-active-chip"
                onClick={() => clearKey(k)}
                title="Remove filter"
              >
                {FILTER_LABELS[k] || k}: {describeFilter(k, v)}
                <span aria-hidden> ×</span>
              </button>
            ))}
          </div>
        )}

        <h4>Field agent</h4>
        <input
          className="filter-search"
          type="search"
          placeholder="Search agents…"
          value={ownerQ}
          onChange={(e) => setOwnerQ(e.target.value)}
          aria-label="Search field agents"
        />
        <ChipRow
          items={filteredOwners.map((o) => [o, o])}
          value={filters.owner || ''}
          onToggle={(v) => set('owner', v)}
          empty={owners.length ? 'No matching agents' : 'No agents yet — run a sync'}
        />
        {filters.owner && !filteredOwners.includes(filters.owner) && (
          <div className="chip-row" style={{ marginTop: 6 }}>
            <button type="button" className="chip on" onClick={() => set('owner', filters.owner)}>
              {filters.owner}
            </button>
          </div>
        )}
        {owners.length > filteredOwners.length && !ownerQ && (
          <p className="filter-hint">Showing first {filteredOwners.length} of {owners.length} — search to find more</p>
        )}

        <h4>Territory</h4>
        {territories.length > 8 && (
          <input
            className="filter-search"
            type="search"
            placeholder="Search territories…"
            value={terrQ}
            onChange={(e) => setTerrQ(e.target.value)}
            aria-label="Search territories"
          />
        )}
        <ChipRow
          items={filteredTerritories.map((t) => [t, t])}
          value={filters.territory || ''}
          onToggle={(v) => set('territory', v)}
          empty={territories.length ? 'No matching territories' : 'No territories yet'}
        />

        <h4>Status</h4>
        <p className="filter-hint">Applies to every on layer — pick statuses that exist on those layers.</p>
        {statuses.length > 10 && (
          <input
            className="filter-search"
            type="search"
            placeholder="Search statuses…"
            value={statusQ}
            onChange={(e) => setStatusQ(e.target.value)}
            aria-label="Search statuses"
          />
        )}
        <ChipRow
          items={filteredStatuses.map((s) => [s, s])}
          value={filters.status || ''}
          onToggle={(v) => set('status', v)}
          empty="No statuses yet"
        />

        <h4>Precision</h4>
        <ChipRow
          items={precisions.map((p) => [PRECISION_LABELS[p] || p, p])}
          value={filters.precision || ''}
          onToggle={(v) => set('precision', v)}
          empty="No precision values yet"
        />

        <h4>Meeting type</h4>
        <p className="filter-hint">Meetings layer only — other layers stay unfiltered.</p>
        <ChipRow
          items={[['Normal', 'false'], ['Joint', 'true']]}
          value={filters.joint || ''}
          onToggle={(v) => set('joint', v)}
        />

        <h4>Recorded date</h4>
        <p className="filter-hint">Filters by map record time (meeting start / check-in when present).</p>
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
              value={filters.from || ''}
              onChange={(e) => setKey('from', e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={filters.to || ''}
              onChange={(e) => setKey('to', e.target.value)}
            />
          </label>
        </div>

        <div className="filter-actions">
          <button
            type="button"
            className="chip"
            onClick={() => {
              setFilters({});
              setOwnerQ('');
              setTerrQ('');
              setStatusQ('');
            }}
          >
            Clear all
          </button>
          <button type="button" className="chip on" onClick={() => setOpen(false)}>Done</button>
        </div>
      </aside>
    </>
  );
}
