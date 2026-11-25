import { useState } from 'react';
import LayerDock from './LayerDock';
import InsightDock from './InsightDock';

const LS_KEY = 'circo.mapChromeOpen';

function loadChromeOpen() {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

function saveChromeOpen(v) {
  try {
    localStorage.setItem(LS_KEY, v ? '1' : '0');
  } catch { /* */ }
}

export default function MapChromeShell({
  active,
  toggle,
  counts,
  filteredCounts,
  insightMode,
  insightDays,
  pickInsight,
  setInsightDays,
  insightSummary,
  mapRecordTotal,
  mapClusterMode,
  mapPinStats,
  mapTruncatedLayers,
  onZoomNudge,
  activeLayerCount,
}) {
  const [open, setOpen] = useState(loadChromeOpen);

  const setOpenPersist = (v) => {
    setOpen(v);
    saveChromeOpen(v);
  };

  const layerN = activeLayerCount ?? active?.size ?? 0;
  const totalLabel = (() => {
    if (mapRecordTotal == null) return null;
    const n = mapRecordTotal.toLocaleString('en-IN');
    const stacks = mapPinStats?.colocatedStacks;
    const positions = mapPinStats?.mapPinPositions;
    if (stacks > 0 && positions != null && positions !== mapRecordTotal) {
      return `${n} ACs · ${positions.toLocaleString('en-IN')} map spots`;
    }
    const pins = mapPinStats?.renderedPins;
    if (pins != null && pins !== mapRecordTotal) {
      return `${n} records · ${pins.toLocaleString('en-IN')} pins`;
    }
    return `${n} in view`;
  })();

  return (
    <div className={`map-chrome-docks ${open ? 'is-open' : 'is-collapsed'}`}>
      <button
        type="button"
        className="map-chrome-bar"
        aria-expanded={open}
        aria-label={open ? 'Collapse map layers' : 'Expand map layers'}
        onClick={() => setOpenPersist(!open)}
      >
        <span className="map-chrome-bar-title">
          {open ? 'Layers' : `Layers (${layerN})`}
        </span>
        {totalLabel && (
          <span className="map-chrome-bar-count">{totalLabel}</span>
        )}
        <span className="map-chrome-bar-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open && (
        <div className="map-chrome-body">
          <LayerDock
            active={active}
            toggle={toggle}
            counts={counts}
            filteredCounts={filteredCounts}
          />
          <InsightDock
            mode={insightMode}
            days={insightDays}
            onMode={pickInsight}
            onDays={setInsightDays}
            summary={insightSummary}
          />
          {(mapClusterMode || mapTruncatedLayers.length > 0) && (
            <p className="map-chrome-status" role="status">
              {mapClusterMode && (
                <span className="map-chrome-cluster-hint">Grouped · zoom in for pins</span>
              )}
              {mapTruncatedLayers.length > 0 && (
                <>
                  {' '}
                  Cap ~8k (
                  {mapTruncatedLayers.join(', ')}
                  )
                  {' '}
                  <button
                    type="button"
                    className="map-chrome-zoom"
                    onClick={onZoomNudge}
                  >
                    Zoom in
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}