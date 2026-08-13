import { useMemo, useState } from 'react';

const TERRITORY_FALLBACK = ['Mumbai', 'Delhi', 'Goa', 'Hyderabad', 'Chennai', 'Bangalore', 'Pune'];

function asList(v) {
  if (v == null || v === '') return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

export function filterOwnerList(owners, ownerDetails, { roles, userStatuses, q } = {}) {
  const roleSel = asList(roles);
  const statusSel = asList(userStatuses);
  let list = owners || [];
  if ((ownerDetails || []).length && (roleSel.length || statusSel.length)) {
    const allowed = new Set(
      ownerDetails
        .filter((o) => {
          if (roleSel.length && !roleSel.includes(o.role)) return false;
          if (statusSel.length && !statusSel.includes(o.status)) return false;
          return true;
        })
        .map((o) => o.name),
    );
    const narrowed = list.filter((o) => allowed.has(o));
    list = narrowed.length ? narrowed : [...allowed];
  }
  const needle = (q || '').trim().toLowerCase();
  if (needle) list = list.filter((o) => o.toLowerCase().includes(needle));
  return list;
}

function ChipMulti({ items, values, onToggle }) {
  const selected = new Set(asList(values).map(String));
  return (
    <div className="chip-row people-chip-row">
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

function toggleIn(list, v) {
  const cur = asList(list);
  const sv = String(v);
  return cur.some((x) => String(x) === sv)
    ? cur.filter((x) => String(x) !== sv)
    : [...cur, v];
}

/**
 * Compact CRM filters for Activity / Routes toolbars.
 * ownerMode: 'single' | 'multi'
 */
export default function PeopleFilters({
  options = {},
  userStatus,
  onUserStatus,
  role,
  onRole,
  owner,
  onOwner,
  ownerQ,
  onOwnerQ,
  ownerMode = 'single',
  territory,
  onTerritory,
  source,
  onSource,
  showSource = false,
  showOwner = true,
}) {
  const [roleQ, setRoleQ] = useState('');
  const [sourceQ, setSourceQ] = useState('');
  const [open, setOpen] = useState(false);
  const roles = options.roles || [];
  const sources = options.sources || [];
  const territories = options.territoryGroups?.length
    ? options.territoryGroups
    : TERRITORY_FALLBACK;
  const owners = options.owners || [];
  const ownerDetails = options.ownerDetails || [];

  const filteredRoles = useMemo(() => {
    const q = roleQ.trim().toLowerCase();
    const list = q ? roles.filter((r) => r.toLowerCase().includes(q)) : roles;
    return list.slice(0, 40);
  }, [roles, roleQ]);

  const filteredOwners = useMemo(
    () => filterOwnerList(owners, ownerDetails, {
      roles: role,
      userStatuses: userStatus,
      q: ownerQ,
    }).slice(0, ownerMode === 'multi' ? 80 : 120),
    [owners, ownerDetails, role, userStatus, ownerQ, ownerMode],
  );

  const filteredSources = useMemo(() => {
    const q = sourceQ.trim().toLowerCase();
    const list = q ? sources.filter((s) => s.toLowerCase().includes(q)) : sources;
    return list.slice(0, 40);
  }, [sources, sourceQ]);

  const activeCount = asList(userStatus).length
    + asList(role).length
    + asList(territory).length
    + asList(source).length
    + (ownerMode === 'multi' ? asList(owner).length : (owner ? 1 : 0));

  const clearAll = () => {
    onUserStatus?.([]);
    onRole?.([]);
    onOwner?.(ownerMode === 'multi' ? [] : '');
    onTerritory?.([]);
    onSource?.([]);
    onOwnerQ?.('');
  };

  return (
    <div className={`people-filters ${open ? 'is-open' : ''}`}>
      <div className="people-filters-bar">
        <button
          type="button"
          className="people-filters-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          CRM filters
          {activeCount > 0 && <span className="badge">{activeCount}</span>}
          <span className="people-filters-caret" aria-hidden>{open ? '▾' : '▸'}</span>
        </button>
        {activeCount > 0 && (
          <button type="button" className="btn ghost sm people-filters-clear" onClick={clearAll}>
            Clear
          </button>
        )}
      </div>
      <div className="people-filters-body">
      <div className="activity-field people-field-wide">
        <label>User status</label>
        <ChipMulti
          items={[['Active', 'active'], ['Inactive', 'inactive']]}
          values={userStatus}
          onToggle={(v) => onUserStatus(toggleIn(userStatus, v))}
        />
      </div>

      <div className="activity-field people-field-wide">
        <label>Role (CRM)</label>
        {roles.length > 8 && (
          <input
            className="input"
            type="search"
            placeholder="Search roles…"
            value={roleQ}
            onChange={(e) => setRoleQ(e.target.value)}
            aria-label="Search roles"
          />
        )}
        <ChipMulti
          items={filteredRoles.map((r) => [r, r])}
          values={role}
          onToggle={(v) => onRole(toggleIn(role, v))}
        />
      </div>

      {showOwner && ownerMode === 'single' && (
        <div className="activity-field">
          <label>RM name</label>
          <input
            className="input"
            type="search"
            placeholder="Search RMs…"
            value={ownerQ || ''}
            onChange={(e) => onOwnerQ?.(e.target.value)}
            aria-label="Search RM names"
          />
          <select
            className="input"
            value={owner || ''}
            onChange={(e) => onOwner(e.target.value)}
            aria-label="Select RM"
          >
            <option value="">Select RM…</option>
            {owner && !filteredOwners.includes(owner) && (
              <option value={owner}>{owner}</option>
            )}
            {filteredOwners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      )}

      {showOwner && ownerMode === 'multi' && (
        <div className="activity-field people-field-wide">
          <label>RM name</label>
          <input
            className="input"
            type="search"
            placeholder="Search RMs…"
            value={ownerQ || ''}
            onChange={(e) => onOwnerQ?.(e.target.value)}
            aria-label="Search RM names"
          />
          <ChipMulti
            items={filteredOwners.map((o) => [o, o])}
            values={owner}
            onToggle={(v) => onOwner(toggleIn(owner, v))}
          />
        </div>
      )}

      <div className="activity-field people-field-wide">
        <label>Territory</label>
        <ChipMulti
          items={territories.map((t) => [t, t])}
          values={territory}
          onToggle={(v) => onTerritory(toggleIn(territory, v))}
        />
      </div>

      {showSource && (
        <div className="activity-field people-field-wide">
          <label>Source</label>
          {sources.length > 8 && (
            <input
              className="input"
              type="search"
              placeholder="Search sources…"
              value={sourceQ}
              onChange={(e) => setSourceQ(e.target.value)}
              aria-label="Search sources"
            />
          )}
          <ChipMulti
            items={filteredSources.map((s) => [s, s])}
            values={source}
            onToggle={(v) => onSource(toggleIn(source, v))}
          />
        </div>
      )}
      </div>
    </div>
  );
}
