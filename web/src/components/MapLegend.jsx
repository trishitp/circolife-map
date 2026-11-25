/** Shared map legend — mobile sheet + desktop details. */
export default function MapLegend({
  insightMode = 'off',
  selectedRm = '',
  showBdmVisits = false,
}) {
  if (insightMode === 'heat') {
    return (
      <>
        <strong>Visit heat</strong>
        <div className="legend-row"><span className="legend-swatch heat-cool" /> Quiet</div>
        <div className="legend-row"><span className="legend-swatch heat-hot" /> Heavy check-ins</div>
      </>
    );
  }
  if (insightMode === 'untouched' || insightMode === 'coverage') {
    return (
      <>
        <strong>{insightMode === 'untouched' ? 'Untouched' : 'Coverage'}</strong>
        <div className="legend-row"><span className="legend-swatch zone-untouched" /> Leads, no visits</div>
        {insightMode === 'coverage' && (
          <>
            <div className="legend-row"><span className="legend-swatch zone-thin" /> Thin vs leads</div>
            <div className="legend-row"><span className="legend-swatch zone-covered" /> Covered</div>
          </>
        )}
      </>
    );
  }
  return (
    <>
      <strong>Reach</strong>
      <div className="legend-row"><span className="legend-swatch heat-cool" /> Heat = density of real locations</div>
      <div className="legend-row"><span className="legend-swatch exact" /> Pins stay on the actual spot</div>
      <strong>Precision</strong>
      <div className="legend-row"><span className="legend-swatch exact" /> Exact / geocoded</div>
      <div className="legend-row"><span className="legend-swatch approx" /> Check-in (~1 km)</div>
      <div className="legend-row"><span className="legend-swatch pincode" /> Pincode / territory (area, not street)</div>
      <div className="legend-row"><span className="legend-swatch inherited" /> Inherited</div>
      {showBdmVisits && (
        <>
          <strong>Visits{selectedRm ? ` (${selectedRm})` : ''}</strong>
          <div className="legend-row"><span className="legend-swatch visit-in" /> Assigned pincode</div>
          <div className="legend-row"><span className="legend-swatch visit-out" /> Outside assigned pincode</div>
        </>
      )}
    </>
  );
}