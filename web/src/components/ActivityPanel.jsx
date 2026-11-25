import { useCallback, useEffect, useState } from 'react';
import RmWalkView from './RmWalkView';
import RmCompareView from './RmCompareView';

const MODE_KEY = 'circo.activityMode';

function loadMode() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'walk' ? 'walk' : 'compare';
  } catch {
    return 'compare';
  }
}

export default function ActivityPanel({
  options = {},
  walkSeed: externalWalkSeed,
  onWalkSeedApplied,
  onPlanRoute,
}) {
  const [mode, setMode] = useState(loadMode);
  const [walkSeed, setWalkSeed] = useState({ owner: '', date: '' });

  useEffect(() => {
    if (!externalWalkSeed?.owner) return;
    setWalkSeed({
      owner: externalWalkSeed.owner,
      date: externalWalkSeed.date || '',
    });
    setMode('walk');
    onWalkSeedApplied?.();
  }, [externalWalkSeed, onWalkSeedApplied]);

  const setModePersist = (next) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch { /* */ }
  };

  const openWalk = useCallback(({ owner, date }) => {
    setWalkSeed({ owner: owner || '', date: date || '' });
    setModePersist('walk');
  }, []);

  return (
    <div className="page-panel activity-panel">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>
            Review check-ins against meetings — compare teams or replay one day on the map.
          </p>
        </div>
        <div className="activity-head-actions">
          <div className="activity-mode-tabs" role="tablist" aria-label="Activity mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'compare'}
            className={`btn ${mode === 'compare' ? '' : 'ghost'}`}
            onClick={() => setModePersist('compare')}
          >
            Compare
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'walk'}
            className={`btn ${mode === 'walk' ? '' : 'ghost'}`}
            onClick={() => setModePersist('walk')}
          >
            Day walk
          </button>
          </div>
          {onPlanRoute && (
            <button
              type="button"
              className="btn ghost sm field-workflow-link"
              onClick={() => onPlanRoute({})}
            >
              Plan ahead → Routes
            </button>
          )}
        </div>
      </div>

      {mode === 'compare' && (
        <RmCompareView
          options={options}
          onOpenWalk={openWalk}
          onPlanRoute={onPlanRoute}
        />
      )}
      {mode === 'walk' && (
        <RmWalkView
          options={options}
          initialOwner={walkSeed.owner}
          initialDate={walkSeed.date}
          onPlanRoute={onPlanRoute}
        />
      )}

      <details className="activity-footnote-wrap">
        <summary className="activity-footnote-toggle">How Activity works</summary>
        <p className="activity-footnote muted">
          Late = check-in more than 15 minutes after the scheduled start.
          Distances are straight-line from check-in GPS, not road distance.
          Check-ins within ~50 m share one map pin. All dates and times are IST.
        </p>
      </details>
    </div>
  );
}
