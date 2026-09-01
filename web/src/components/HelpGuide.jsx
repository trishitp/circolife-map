/**
 * In-app guide for Circolife Maps.
 */
export default function HelpGuide({ onOpenTab, isAdmin = false }) {
  const go = (id) => () => onOpenTab?.(id);

  return (
    <div className="page-panel help-panel">
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p>
            Circolife Maps places CRM leads, accounts, meetings, and assets on a shared
            India map so field teams can trust locations, plan routes, and coach visits.
          </p>
        </div>
      </div>

      <div className="help-toc soft-block">
        <strong>On this page</strong>
        <nav className="help-toc-links">
          <a href="#help-map">Map</a>
          <a href="#help-insights">Insights</a>
          <a href="#help-filters">Filters</a>
          <a href="#help-activity">Activity</a>
          <a href="#help-routes">Routes</a>
          <a href="#help-disc">Discrepancies</a>
          <a href="#help-gaps">Gaps</a>
          {isAdmin && <a href="#help-admin">Admin</a>}
          <a href="#help-share">Share with field</a>
        </nav>
      </div>

      <section id="help-map" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Map</h2>
          <button type="button" className="btn ghost sm" onClick={go('map')}>Open Map</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Layers</strong>
            <span>Turn Leads, Accounts, Meetings, and Assets on or off. Assets shows installed AC units only — not parent containers. Accounts shows only where at least one asset is on the map. Layer counts match those rules.</span>
          </li>
          <li>
            <strong>Pan and zoom</strong>
            <span>Pins stay on real locations at every zoom. Heat under them shows density — a large glow means many nearby records, not a bigger market blob. Admins can switch Pins + heat, Pins only, Heat only, or Cluster circles under Admin → Map display. Data loads for the visible area. If a banner asks you to zoom in, the area is too dense to plot every point.</span>
          </li>
          <li>
            <strong>Select a pin</strong>
            <span>Opens owner, territory, location precision, and Open in CRM when a link is available.</span>
          </li>
          <li>
            <strong>Precision</strong>
            <span>Exact and geocoded are street-level. Approximate is a check-in within about 1 km. Pincode and territory are area-level. Inherited comes from a linked account or lead.</span>
          </li>
        </ol>
      </section>

      <section id="help-insights" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Insights</h2>
          <button type="button" className="btn ghost sm" onClick={go('map')}>Open Map</button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Untouched</strong>
            <span>Areas with plotted leads but no GPS check-in in the last 30, 90, or 180 days.</span>
          </li>
          <li>
            <strong>Coverage</strong>
            <span>Every cell with leads, coloured by visit ratio — unused, thin, or covered.</span>
          </li>
          <li>
            <strong>Visit heat</strong>
            <span>Where teams actually checked in. Combine with filters to see one person’s footprint.</span>
          </li>
          <li>
            <strong>Unvisited territories</strong>
            <span>CRM territories that have leads in view but no check-ins in the selected period.</span>
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
            <span>From the map tools. Multi-select user status, CRM role, RM, territory, and lead source.</span>
          </li>
          <li>
            <strong>Territory groups</strong>
            <span>Delhi includes NCR (Noida, Gurugram, and nearby). Mumbai includes Thane, Navi Mumbai, and the wider MMR.</span>
          </li>
          <li>
            <strong>Apply and save</strong>
            <span>Selections apply only after you tap Apply. Save a named preset on this browser to reuse it.</span>
          </li>
          <li>
            <strong>Active chips</strong>
            <span>Chips on the map show what is on. Tap a chip, or Clear all, to remove it.</span>
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
            <span>Filter by status, role, RM, and metro, then compare check-in paths for a range of up to 31 days.</span>
          </li>
          <li>
            <strong>Day walk</strong>
            <span>Pick an RM and a date to see that day’s check-in places and meetings.</span>
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
            <strong>Choose RM and date</strong>
            <span>Meetings load automatically. Start from last check-in when we have it, or from the first meeting.</span>
          </li>
          <li>
            <strong>Build the plan</strong>
            <span>Tap orange pins to add nearby leads or accounts. Reorder with the arrows, or remove a stop.</span>
          </li>
          <li>
            <strong>Get drive times</strong>
            <span>Keep times follows the calendar. Shortest drive reorders for less travel.</span>
          </li>
          <li>
            <strong>Share with field</strong>
            <span>Creates a private mobile link. The recipient sees the map, navigation, and CRM — not planner tools.</span>
          </li>
        </ol>
      </section>

      <section id="help-disc" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Discrepancies</h2>
          <button type="button" className="btn ghost sm" onClick={go('disc')}>Open Discrepancies</button>
        </div>
        <p className="help-lead">
          Plotted records where location sources disagree, such as billing versus shipping versus check-in versus MapMyIndia.
        </p>
        <ul className="help-bullets">
          <li><strong>Watch</strong> — about 1 km or more between sources, or a pin mismatch.</li>
          <li><strong>Alert</strong> — about 3 km or more between sources.</li>
          <li>Open CRM or jump to the map to inspect the pin.</li>
        </ul>
      </section>

      <section id="help-gaps" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Gaps</h2>
          <button type="button" className="btn ghost sm" onClick={go('gaps')}>Open Gaps</button>
        </div>
        <p className="help-lead">
          Records that cannot be plotted because address, pin, territory, or coordinates are missing. Fix the data in CRM, then sync or re-geocode from Admin.
        </p>
      </section>

      {isAdmin && (
      <section id="help-admin" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Admin</h2>
          <button type="button" className="btn ghost sm" onClick={go('admin')}>Open Admin</button>
        </div>
        <ol className="help-steps">
          <li><strong>Sync</strong> — pull the latest Zoho Analytics data into Maps.</li>
          <li><strong>Re-geocode</strong> — refresh street locations after address fixes.</li>
          <li><strong>Rebuild discrepancies</strong> — recalculate distance checks across sources.</li>
          <li><strong>API cost</strong> — estimated Google Maps spend this month, with an editable rate card.</li>
          <li><strong>Users</strong> — grant admin after people sign in with Zoho; disable accounts.</li>
          <li><strong>Overrides</strong> — set latitude and longitude for a known-correct location.</li>
        </ol>
      </section>
      )}

      <section id="help-share" className="help-section soft-block">
        <div className="help-section-head">
          <h2>Share with field</h2>
          <button type="button" className="btn ghost sm" onClick={go('routes')}>Open Routes</button>
        </div>
        <ol className="help-steps">
          <li>After drive times, tap <strong>Share with field</strong> — the link is copied (and the share sheet opens on mobile).</li>
          <li>The recipient opens the link with no Maps login required.</li>
          <li>They can follow the full route, navigate to one stop, or open the record in CRM.</li>
        </ol>
      </section>

      <section className="help-section soft-block help-tips">
        <h2>Quick tips</h2>
        <ul className="help-bullets">
          <li>Field dates and times use India Standard Time.</li>
          <li>If the map looks empty, widen filters or turn another layer on.</li>
          <li>Sign in with Zoho. Only admins see Admin.</li>
          <li>Google Maps opens in a new tab for turn-by-turn navigation.</li>
        </ul>
      </section>
    </div>
  );
}
