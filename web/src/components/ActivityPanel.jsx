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

  return (
    <div className="page-panel activity-panel">
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>
            Compare field teams, then open a single day’s walk to coach check-ins
            against the planned meetings.
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
        <RmCompareView options={options} onOpenWalk={openWalk} />
      )}
      {mode === 'walk' && (
        <RmWalkView
          options={options}
          initialOwner={walkSeed.owner}
          initialDate={walkSeed.date}
        />
      )}

      <p className="activity-footnote muted">
        A visit is late when the check-in is more than 15 minutes after the scheduled start.
        Distances are straight-line from check-in GPS, not road distance. Nearby check-ins
        (about 50 m) share a pin. Dates and times use India Standard Time.
      </p>
    </div>
  );
}
