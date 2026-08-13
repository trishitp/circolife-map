import RoutePlanView from './RoutePlanView';

export default function RoutesPanel({ options = {} }) {
  return (
    <div className="page-panel activity-panel routes-panel">
      <div className="page-head">
        <div>
          <h1>Routes</h1>
          <p>
            Smart day planning for field agents — load today’s meetings, add nearby
            drop-ins, optimize on roads, navigate in Google Maps.
          </p>
        </div>
      </div>

      <RoutePlanView options={options} />

      <p className="activity-footnote muted">
        Plans use locatable stops only (exact / geocoded / approx). Pincode and territory
        pins are excluded unless already on a meeting. Optimize calls Google Routes when
        available, otherwise a straight-line nearest-neighbour order. Drafts save per
        agent + IST date. Activity stays historical coaching; Routes is forward planning.
      </p>
    </div>
  );
}
