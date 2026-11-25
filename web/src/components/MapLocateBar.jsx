import { useEffect, useRef, useState } from 'react';
import { fetchMapSearch, fetchPincodeCentroid } from '../lib/api';
import { normalizePincode } from '../lib/pincode';

export default function MapLocateBar({ onPick, onPincodeFly, onPlotAccounts, compact }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!debounced || debounced.length < 2) {
      setHits([]);
      setErr(null);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchMapSearch(debounced)
      .then((r) => {
        if (cancelled) return;
        setHits(r.results || []);
        setOpen(true);
      })
      .catch((e) => {
        if (!cancelled) setErr(e.message || 'Search failed');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const tryPinJump = async () => {
    const pin = normalizePincode(q);
    if (!pin) return false;
    setErr(null);
    try {
      const r = await fetchPincodeCentroid(pin);
      if (r?.lat == null || r?.lng == null) {
        setErr('PIN not in directory');
        return true;
      }
      onPincodeFly?.({ lat: r.lat, lng: r.lng, pin, zoom: 12.5 });
      setOpen(false);
      return true;
    } catch (e) {
      setErr(e.message || 'PIN lookup failed');
      return true;
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    const raw = q.trim();
    if (!raw) return;
    if (/^\d{5,6}$/.test(raw.replace(/\D/g, ''))) {
      const handled = await tryPinJump();
      if (handled) return;
    }
    const accountHits = hits.filter((h) => h.layer === 'accounts');
    if (accountHits.length > 0 && accountHits.length === hits.length) {
      onPlotAccounts?.(accountHits, q);
      setOpen(false);
      return;
    }
    if (hits[0]) {
      onPick(hits[0]);
      setOpen(false);
    }
  };

  const pickHit = (h) => {
    if (h.layer === 'accounts') {
      onPlotAccounts?.([h], h.title || h.id);
    } else {
      onPick(h);
    }
    setOpen(false);
  };

  return (
    <form
      className={`map-locate${compact ? ' is-compact' : ''}`}
      ref={wrapRef}
      onSubmit={onSubmit}
      role="search"
      aria-label="Find on map"
    >
      <input
        type="search"
        className="map-locate-input"
        placeholder="Name, CRM id, or PIN…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => { if (hits.length) setOpen(true); }}
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" className="map-locate-go" disabled={loading || !q.trim()} aria-label="Go">
        {loading ? '…' : 'Go'}
      </button>
      {err && <span className="map-locate-err" role="status">{err}</span>}
      {open && hits.length > 0 && hits.every((h) => h.layer === 'accounts') && hits.length > 1 && (
        <button
          type="button"
          className="map-locate-plot-all"
          onClick={() => {
            onPlotAccounts?.(hits, q.trim());
            setOpen(false);
          }}
        >
          Plot all
          {' '}
          {hits.length}
          {' matching accounts + ACs'}
        </button>
      )}
      {open && hits.length > 0 && (
        <ul className="map-locate-hits" role="listbox">
          {hits.map((h) => (
            <li key={`${h.layer}-${h.id}`}>
              <button
                type="button"
                role="option"
                onClick={() => pickHit(h)}
              >
                <span className={`map-locate-layer ${h.layer}`}>{h.layer}</span>
                <span className="map-locate-title">{h.title || h.id}</span>
                {h.layer === 'accounts' && h.linked_assets != null && (
                  <span className="map-locate-assets">{h.linked_assets} AC</span>
                )}
                {h.pincode && <span className="map-locate-pin">{h.pincode}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}