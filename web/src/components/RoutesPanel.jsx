import RoutePlanView from './RoutePlanView';

export default function RoutesPanel({ options = {} }) {
  return (
    <div className="page-panel activity-panel routes-panel">
      <div className="page-head">
        <div>
          <h1>Routes</h1>
          <p>
            Pick an RM, add nearby drop-ins, get drive times, and share a private
            link the field agent can open without signing in.
          </p>
        </div>
      </div>

      <RoutePlanView options={options} />

      <p className="activity-footnote muted">
        Only stops with a usable location are included. Keep times follows the calendar;
        Shortest drive reorders for less travel. Drafts are saved per agent and date (IST).
        Activity is for coaching past visits; Routes is for planning the day ahead.
      </p>
    </div>
  );
}
