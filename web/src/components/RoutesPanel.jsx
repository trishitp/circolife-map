import RoutePlanView from './RoutePlanView';

export default function RoutesPanel({
  options = {},
  planSeed,
  onPlanSeedApplied,
  onReviewDay,
}) {
  return (
    <div className="page-panel activity-panel routes-panel">
      <div className="page-head">
        <div>
          <h1>Routes</h1>
          <p>
            Build tomorrow’s run: meetings, nearby drop-ins, drive times, and a share link
            for the field agent (no sign-in needed).
          </p>
        </div>
        {onReviewDay && (
          <button
            type="button"
            className="btn ghost sm field-workflow-link"
            onClick={() => onReviewDay({})}
          >
            ← Review in Activity
          </button>
        )}
      </div>

      <RoutePlanView
        options={options}
        planSeed={planSeed}
        onPlanSeedApplied={onPlanSeedApplied}
        onReviewDay={onReviewDay}
      />

      <details className="activity-footnote-wrap">
        <summary className="activity-footnote-toggle">How Routes works</summary>
        <p className="activity-footnote muted">
          Only stops with a usable map location are included. Keep times follows the calendar;
          Shortest drive reorders for less travel. Drafts are saved per agent and date (IST).
        </p>
      </details>
    </div>
  );
}
