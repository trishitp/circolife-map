import RoutePlanView from './RoutePlanView';

export default function RoutesPanel({ options = {} }) {
  return (
    <div className="page-panel activity-panel routes-panel">
      <div className="page-head">
        <div>
          <h1>Routes</h1>
          <p>
            Plan the day for a field agent: load meetings, add nearby stops, optimize
            the drive, and share a private link for navigation.
          </p>
        </div>
      </div>

      <RoutePlanView options={options} />

      <p className="activity-footnote muted">
        Only stops with a usable location are included. Optimize uses Google Routes when
        it is available; otherwise it uses a nearest-neighbour order. Drafts are saved
        per agent and date (IST). Activity is for coaching past visits; Routes is for
        planning the day ahead.
      </p>
    </div>
  );
}
