import { useState } from 'react';
import { overridePoint } from '../lib/api';

export default function DetailPinFix({ record, onDone, onCancel }) {
  const [lat, setLat] = useState(record?.lat != null ? String(record.lat) : '');
  const [lng, setLng] = useState(record?.lng != null ? String(record.lng) : '');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (!record?._layer || !record?.id) return null;

  const submit = async () => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setErr('Enter valid lat / lng');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await overridePoint(record._layer, record.id, { lat: la, lng: ln, notes: notes || undefined });
      onDone?.({ lat: la, lng: ln, precision: 'exact' });
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pin-fix-sheet" role="dialog" aria-label="Set exact pin">
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        Manual override — sync will not move this pin until you clear it in Admin.
      </p>
      <div className="pin-fix-grid">
        <label>
          Lat
          <input className="input" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label>
          Lng
          <input className="input" value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
      </div>
      <input
        className="input"
        placeholder="Note (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      {err && <p className="banner err" style={{ marginTop: 8 }}>{err}</p>}
      <div className="detail-actions" style={{ marginTop: 10 }}>
        <button type="button" className="btn ghost sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn sm" onClick={submit} disabled={busy}>
          {busy ? 'Saving…' : 'Save exact pin'}
        </button>
      </div>
    </div>
  );
}