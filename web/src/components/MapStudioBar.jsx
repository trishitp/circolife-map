import { useState } from 'react';
import {
  encodeShareHash, loadSavedViews, packMapView, saveNamedView,
} from '../lib/mapViews';

export default function MapStudioBar({
  active,
  insightMode,
  insightDays,
  viewport,
  onApplyView,
  onSnapshot,
  fieldMode,
  onFieldMode,
}) {
  const [msg, setMsg] = useState('');
  const [name, setName] = useState('');

  const view = () => packMapView({
    active,
    insightMode,
    insightDays,
    center: viewport?.center,
    zoom: viewport?.zoom,
  });

  const share = async () => {
    const hash = encodeShareHash(view());
    const url = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setMsg('View link copied');
    } catch {
      setMsg(url);
    }
    setTimeout(() => setMsg(''), 2500);
  };

  const save = () => {
    const label = name.trim() || `View ${new Date().toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}`;
    saveNamedView(label, view());
    setName('');
    setMsg(`Saved “${label}”`);
    setTimeout(() => setMsg(''), 2500);
  };

  const saved = loadSavedViews();

  return (
    <div className="map-studio" role="toolbar" aria-label="Map studio">
      <div className="map-studio-row">
        <button type="button" className="map-studio-btn" onClick={share} title="Copy link with layers and map position">
          Share view
        </button>
        <button type="button" className="map-studio-btn" onClick={onSnapshot} title="Download map PNG">
          Snapshot
        </button>
        <button
          type="button"
          className={`map-studio-btn${fieldMode ? ' on' : ''}`}
          onClick={() => onFieldMode(!fieldMode)}
          title="Fewer tabs — map, routes, and essentials"
        >
          Field
        </button>
      </div>
      <div className="map-studio-row subtle">
        <input
          className="map-studio-input"
          placeholder="Name this view…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="map-studio-btn sm" onClick={save}>Save</button>
        {saved.length > 0 && (
          <select
            className="map-studio-select"
            defaultValue=""
            onChange={(e) => {
              const item = saved.find((s) => s.name === e.target.value);
              if (item?.view) onApplyView(item.view);
              e.target.value = '';
            }}
            aria-label="Saved views"
          >
            <option value="" disabled>Saved views</option>
            {saved.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
        )}
      </div>
      {msg && <p className="map-studio-msg" role="status">{msg}</p>}
    </div>
  );
}