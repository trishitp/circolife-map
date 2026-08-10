/**
 * In-app how-to guide for Circolife Maps.
 */
export default function HelpGuide({ onOpenTab }) {
  const go = (id) => () => onOpenTab?.(id);

  return (
    <div className="page-panel help-panel">
      <div className="page-head">
        <div>
          <h1>How to use</h1>
          <p>
            Circolife Maps puts CRM locations on a shared India map so you can trust
            coordinates, coach field routes, and share a day plan with RMs.
          </p>
        </div>
      </div>

      <div className="help-toc soft-block">
        <strong>Jump to</strong>
        <nav className="help-toc-links">
          <a href="#help-map">Map</a>
          <a href="#help-filters">Filters</a>
          <a href="#help-activity">Activity</a>
          <a href="#help-routes">Routes</a>
          <a href="#help-disc">Discrepancies</a>
          <a href="#help-gaps">Gaps</a>
          <a href="#help-admin">Admin</a>
          <a href="#help-share">Share to RM</a>
        </nav>
      </div>

      <section id="help-map" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Map</h2>
          <button type="button" className="btn ghost sm" onClick={go('map')}>Open Map</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Toggle layers</strong>
            <span>Leads, Accounts, Meetings, Assets — use the dark dock. Counts are totals in the database (not viewport).</span>
          </li>
          <li>
            <strong>Pan &amp; zoom</strong>
            <span>Data loads for the visible area only. If a cream banner says “Zoom in… dense…”, the viewport has too many points — zoom tighter to see more of that area.</span>
          </li>
          <li>
            <strong>Tap a pin</strong>
            <span>Opens the detail card with owner, territory, precision, and Open in CRM when available.</span>
          </li>
          <li>
            <strong>Precision colours</strong>
            <span>Exact/geocoded are strongest. Approx = check-in (~1 km). Pincode/territory are area-level. Inherited comes from a linked account or lead.</span>
          </li>
        </ol>
      </section>

      <section id="help-filters" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Filters</h2>
          <button type="button" className="btn ghost sm" onClick={go('map')}>Open Map</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Open Filters</strong>
            <span>Bottom-left on Map. Search agents, territories, or statuses when lists are long.</span>
          </li>
          <li>
            <strong>What each filter does</strong>
            <span>Agent, territory, status, and precision apply to every layer that is on. Meeting type (Normal/Joint) only affects Meetings. Recorded date uses the map record time (meeting start / check-in when present).</span>
          </li>
          <li>
            <strong>Active chips</strong>
            <span>Chips under the top bar show what is on. Tap × on a chip (or Clear all) to remove it instantly.</span>
          </li>
        </ol>
      </section>

      <section id="help-activity" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Activity</h2>
          <button type="button" className="btn ghost sm" onClick={go('activity')}>Open Activity</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Compare</strong>
            <span>Pick agents and a date range to compare check-in paths, scheduled vs actual, and joint meetings.</span>
          </li>
          <li>
            <strong>Day walk</strong>
            <span>One agent + one IST day. See ordered check-ins and the path they walked (GPS may share a cell for multiple visits).</span>
          </li>
        </ol>
      </section>

      <section id="help-routes" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Routes</h2>
          <button type="button" className="btn ghost sm" onClick={go('routes')}>Open Routes</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Pick RM + date</strong>
            <span>Load that day’s meetings (and nearby drop-ins).</span>
          </li>
          <li>
            <strong>Build the plan</strong>
            <span>Reorder stops, add nearby leads/accounts, remove unneeded ones.</span>
          </li>
          <li>
            <strong>Optimize</strong>
            <span>Road-based order and drive time when Google Directions/Routes is enabled.</span>
          </li>
          <li>
            <strong>Save &amp; Share to RM</strong>
            <span>Creates a private mobile link. The RM only sees the map, Navigate, and CRM — no planner tools.</span>
          </li>
        </ol>
      </section>

      <section id="help-disc" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Discrepancies</h2>
          <button type="button" className="btn ghost sm" onClick={go('disc')}>Open Discrepancies</button>
        </div>
        <p className="help-lead">
          Plotted records where location sources disagree (billing vs shipping vs check-in vs MapMyIndia, etc.).
        </p>
        <ul className="help-bullets">
          <li><strong>Watch</strong> — roughly ≥ 1 km between sources, or pin mismatch alone.</li>
          <li><strong>Alert</strong> — roughly ≥ 3 km between sources.</li>
          <li>Open CRM or jump to Map to inspect the pin.</li>
        </ul>
      </section>

      <section id="help-gaps" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Gaps</h2>
          <button type="button" className="btn ghost sm" onClick={go('gaps')}>Open Gaps</button>
        </div>
        <p className="help-lead">
          Records that cannot be plotted at all (no usable address, pin, territory, or coords). Fix address data in CRM, then resync / re-geocode from Admin.
        </p>
      </section>

      <section id="help-admin" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Admin</h2>
          <button type="button" className="btn ghost sm" onClick={go('admin')}>Open Admin</button>
        </div>
        <ol className="help-steps">
          <li><strong>Sync</strong> — pull latest Zoho Analytics data into the map store.</li>
          <li><strong>Re-geocode</strong> — refresh street geocodes after fixes or API key unlocks.</li>
          <li><strong>Rebuild discrepancies</strong> — recalculate multi-source distance checks.</li>
          <li><strong>Overrides</strong> — manually set lat/lng for known correct locations.</li>
        </ol>
      </section>

      <section id="help-share" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Share to RM (mobile)</h2>
          <button type="button" className="btn ghost sm" onClick={go('routes')}>Open Routes</button>
        </div>
        <ol className="help-steps">
          <li>After Optimize, tap <strong>Share to RM</strong> — link is copied (and share sheet on mobile).</li>
          <li>RM opens <code>#/r/…</code> — no app password required for that link.</li>
          <li>Actions: map + stop list, <strong>Start full route</strong> / <strong>Navigate here</strong>, and <strong>Open CRM</strong>.</li>
        </ol>
      </section>

      <section className="help-section soft-block help-tips">
        <h2>Quick tips</h2>
        <ul className="help-bullets">
          <li>India / IST dates everywhere we show “today” for field work.</li>
          <li>If pins look empty, try widening filters (status/date) or turning another layer on.</li>
          <li>Session expires after logout or password change — sign in again from Log out.</li>
          <li>Google Maps open in a new tab for turn-by-turn navigation.</li>
        </ul>
      </section>
    </div>
  );
}
