import { useCallback, useState } from 'react';
import RmWalkView from './RmWalkView';
import RmCompareView from './RmCompareView';

export default function ActivityPanel({ options = {} }) {
  const [mode, setMode] = useState('compare');
  const [walkSeed, setWalkSeed] = useState({ owner: '', date: '' });

  const openWalk = useCallback(({ owner, date }) => {
    setWalkSeed({ owner: owner || '', date: date || '' });
    setMode('walk');
  }, []);

  const owners = options.owners || [];
  const territories = options.territories || [];

  return (
    <div className="page-panel activity-panel">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>
            Coach field agents with check-in place routes and multi-agent comparison
            (scheduled vs check-in · geodesic path from check-in GPS · IST).
          </p>
        </div>
        <div className="activity-mode-tabs" role="tablist" aria-label="Activity mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'compare'}
            className={`btn ${mode === 'compare' ? '' : 'ghost'}`}
            onClick={() => setMode('compare')}
          >
            Compare
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'walk'}
            className={`btn ${mode === 'walk' ? '' : 'ghost'}`}
            onClick={() => setMode('walk')}
          >
            Day walk
          </button>
        </div>
      </div>

      {mode === 'compare' && (
        <RmCompareView territories={territories} onOpenWalk={openWalk} />
      )}
      {mode === 'walk' && (
        <RmWalkView
          owners={owners}
          initialOwner={walkSeed.owner}
          initialDate={walkSeed.date}
        />
      )}

      <p className="activity-footnote muted">
        Late = check-in more than 15 minutes after scheduled start.
        Path km / places use field check-in GPS only — full-precision coords from Zoho
        (CAST export; not the 2-dp Analytics display).
        Map pins are places; timeline shows every meeting with “@ place N” and lat/lng.
        Same-cell check-ins (~50 m) share one pin (×N). Straight-line distance, not roads.
        After coord changes: run <code>npm run sync:meeting-coords</code> in server/.
      </p>
    </div>
  );
}
