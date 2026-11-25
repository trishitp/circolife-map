export default function QualityPulse({ snapshot, onAlerts, onGaps }) {
  if (!snapshot) return null;
  const alerts = snapshot.discrepancies?.alert || 0;
  const watch = snapshot.discrepancies?.watch || 0;
  const gaps = snapshot.unplottable || 0;
  if (!alerts && !watch && !gaps) return null;

  return (
    <div className="quality-pulse" role="status">
      <span className="quality-pulse-title">Data quality</span>
      {alerts > 0 && (
        <button type="button" className="quality-pill alert" onClick={onAlerts}>
          {alerts.toLocaleString('en-IN')} alerts
        </button>
      )}
      {watch > 0 && (
        <button type="button" className="quality-pill watch" onClick={onAlerts}>
          {watch.toLocaleString('en-IN')} watch
        </button>
      )}
      {gaps > 0 && (
        <button type="button" className="quality-pill gaps" onClick={onGaps}>
          {gaps.toLocaleString('en-IN')} unplottable
        </button>
      )}
    </div>
  );
}