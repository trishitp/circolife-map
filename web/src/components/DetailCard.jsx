import { useEffect, useState } from 'react';
import { emitSelection } from '../lib/selection';
import { isAreaPrecision } from '../lib/precisionUi';
import { IconAc } from './icons';
import DetailPinFix from './DetailPinFix';

const MAC_SEP = /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g;
const MAC_BARE = /\b[0-9A-Fa-f]{12}\b/g;
const MAC_ONLY = /^(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$|^[0-9A-Fa-f]{12}$/;

function parseMacOctets(raw) {
  const t = String(raw || '').trim();
  const sep = t.match(/^([0-9A-Fa-f]{2})([:\-])(?:[0-9A-Fa-f]{2}\2){4}[0-9A-Fa-f]{2}$/);
  if (sep) return t.split(sep[2]).map((o) => o.toUpperCase());
  if (/^[0-9A-Fa-f]{12}$/.test(t)) {
    const u = t.toUpperCase();
    return [0, 2, 4, 6, 8, 10].map((i) => u.slice(i, i + 2));
  }
  return null;
}

function formatMaskedMac(raw) {
  const octets = parseMacOctets(raw);
  if (!octets) return raw;
  return `${octets[0]}:${octets[1]}:••:••:••:${octets[5]}`;
}

function redactMac(value) {
  if (value == null || value === '') return value;
  const t = String(value).trim();
  if (MAC_ONLY.test(t)) return formatMaskedMac(t);
  return t
    .replace(MAC_SEP, (m) => formatMaskedMac(m))
    .replace(MAC_BARE, (m) => formatMaskedMac(m))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const PRECISION_COPY = {
  exact: 'Exact location',
  approx: 'Check-in (±1 km)',
  geocoded: 'Geocoded from address',
  pincode: 'Pincode area — approximate',
  territory: 'Territory centroid — approximate',
  inherited: 'Via linked account / lead',
};

const ADDRESS_SOURCE_COPY = {
  fsm: 'FSM install address',
  fsm_service: 'FSM service address',
  fsm_billing: 'FSM billing address',
  shipping: 'Account shipping address',
  billing: 'Account billing address',
  account: 'Linked account location',
};

const LAYER_LABEL = {
  leads: 'Lead',
  accounts: 'Account',
  meetings: 'Meeting',
  assets: 'Asset',
  zone: 'Zone',
};

const LAYER_COLOR = {
  leads: '#A14996',
  accounts: '#2E1F40',
  meetings: '#5FA9C6',
  assets: '#6BB35A',
  zone: '#c45c4a',
};

const WEAK_PRECISION = new Set(['pincode', 'territory', 'approx', 'inherited']);

function mapsDirectionsUrl(lat, lng) {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}

const TRUST_NEXT = {
  pincode: 'Compare billing vs shipping PIN in CRM, or open Location sources.',
  territory: 'Territory centroid — use Discrepancies or improve the account address.',
  approx: 'Check-in is approximate — confirm on site or set an exact pin (admin).',
  inherited: 'Location inherited from a parent record — verify the account address.',
};

const ASSET_PRIMARY_KEYS = new Set(['Asset No', 'Model', 'Account', 'PIN', 'Status']);

export default function DetailCard({
  p, onClose, onViewSources, onViewGaps, isAdmin, onPinUpdated,
}) {
  const [pinFix, setPinFix] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  useEffect(() => {
    if (!p) {
      emitSelection(null);
      return;
    }
    const lat = p.lat != null ? Number(p.lat) : null;
    const lng = p.lng != null ? Number(p.lng) : null;
    emitSelection({ id: p.id, lat, lng });
  }, [p]);

  useEffect(() => {
    setPinFix(false);
    setMetaOpen(false);
  }, [p?.id, p?._layer]);

  if (!p) return null;

  const layer = p._layer;
  const isManual = Boolean(p.manual);
  const isZone = layer === 'zone';
  const assetNo = redactMac(p.assetNumber || (layer === 'assets' ? p.title : null));
  const model = redactMac(p.assetName);
  const mac = redactMac(p.mac);
  const lat = p.lat != null ? Number(p.lat) : null;
  const lng = p.lng != null ? Number(p.lng) : null;
  const directions = mapsDirectionsUrl(lat, lng);
  const canCopy = lat != null && lng != null;

  const rows = isZone ? [
    ['Kind', p.kind === 'untouched' ? 'Untouched' : p.kind === 'thin' ? 'Thin coverage' : 'Covered'],
    ['Leads', String(p.leads ?? 0)],
    p.stale != null && ['Stale leads', String(p.stale)],
    ['Check-ins', String(p.visits ?? 0)],
    ['Score', String(p.score ?? 0)],
    ['Last visit', p.lastVisit
      ? new Date(p.lastVisit).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
      : 'Never in window'],
  ].filter(Boolean) : [
    layer === 'assets' && assetNo && ['Asset No', assetNo],
    layer === 'assets' && model && model !== assetNo && ['Model', model],
    layer === 'assets' && mac && ['MAC', mac],
    layer === 'assets' && p.acType && ['AC type', p.acType],
    layer === 'assets' && p.tonnage && ['Tonnage', p.tonnage],
    p.address && ['Address', p.address],
    layer === 'assets' && p.addressSource && [
      'Address source',
      ADDRESS_SOURCE_COPY[p.addressSource] || p.addressSource,
    ],
    layer === 'assets' && (p.accountName || p.accountId) && [
      'Account',
      p.accountName || p.accountId,
    ],
    p.pincode && ['PIN', String(p.pincode)],
    p.owner && ['Agent', p.owner],
    p.territory && ['Territory', p.territory],
    p.status && ['Status', p.status],
    p.ts && ['Date', new Date(p.ts).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })],
  ].filter(Boolean);

  const isAsset = layer === 'assets';
  const primaryRows = isAsset
    ? rows.filter(([k]) => ASSET_PRIMARY_KEYS.has(k))
    : rows.slice(0, 6);
  const extraRows = isAsset
    ? rows.filter(([k]) => !ASSET_PRIMARY_KEYS.has(k))
    : rows.slice(6);
  const rowsToShow = metaOpen || !isAsset ? rows : primaryRows;

  return (
    <div className="detail-card detail-card--compact" role="dialog" aria-label={p.title || 'Record detail'}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">✕</button>
      {layer && (
        <div className="layer-tag" style={{ '--tag-color': LAYER_COLOR[layer] }}>
          {layer === 'assets'
            ? <span className="ac-glyph" aria-hidden><IconAc size={14} /></span>
            : <span className="dot" aria-hidden />}
          {layer === 'assets' ? 'AC' : (LAYER_LABEL[layer] || layer)}
        </div>
      )}
      <h3>{layer === 'assets' ? (assetNo || 'Asset') : (redactMac(p.title) || 'Untitled')}</h3>
      {isManual && (
        <p className="detail-manual-badge" role="status">Admin-verified pin</p>
      )}
      {!isZone && isAreaPrecision(p.precision) && (
        <p className="detail-trust-callout detail-trust-callout--tight" role="note">
          Area pin — approximate. Confirm on site or in CRM.
        </p>
      )}
      {!isZone && WEAK_PRECISION.has(p.precision) && !isAreaPrecision(p.precision) && TRUST_NEXT[p.precision] && (
        <p className="detail-trust-callout subtle" role="note">{TRUST_NEXT[p.precision]}</p>
      )}
      {rowsToShow.length > 0 && (
        <dl className="meta">
          {rowsToShow.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {isAsset && extraRows.length > 0 && (
        <button
          type="button"
          className="detail-meta-toggle"
          aria-expanded={metaOpen}
          onClick={() => setMetaOpen((v) => !v)}
        >
          {metaOpen ? 'Less detail' : `More detail (${extraRows.length})`}
        </button>
      )}
      {!isZone && (
        <span className={`precision ${p.precision || ''}`}>
          {PRECISION_COPY[p.precision] || p.precision || 'Location'}
        </span>
      )}
      {isZone && (
        <span className={`precision ${p.kind === 'untouched' ? 'pincode' : ''}`}>
          {p.kind === 'untouched'
            ? 'Leads here, no GPS check-ins in the window'
            : p.kind === 'thin'
              ? 'A few visits vs many leads'
              : 'Visited relative to lead density'}
        </span>
      )}
      <div className="detail-actions">
        {directions && (
          <a className="btn ghost sm" href={directions} target="_blank" rel="noreferrer">
            Directions
          </a>
        )}
        {canCopy && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              const text = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
          >
            Copy coords
          </button>
        )}
        {(p._layer === 'leads' || p._layer === 'accounts') && onViewSources && (
          <button type="button" className="btn ghost sm" onClick={() => onViewSources(p)}>
            Location sources
          </button>
        )}
        {WEAK_PRECISION.has(p.precision) && onViewGaps && (
          <button type="button" className="btn ghost sm" onClick={() => onViewGaps(p)}>
            Improve precision
          </button>
        )}
        {isAdmin && !isZone && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setPinFix((v) => !v)}
          >
            {pinFix ? 'Close pin editor' : 'Set exact pin'}
          </button>
        )}
        {(p.crmUrl || p.accountCrmUrl) && (
          <a className="cta" href={p.crmUrl || p.accountCrmUrl} target="_blank" rel="noreferrer">
            {p.crmUrl ? 'Open in CRM →' : 'Open account in CRM →'}
          </a>
        )}
      </div>
      {pinFix && isAdmin && (
        <DetailPinFix
          record={p}
          onCancel={() => setPinFix(false)}
          onDone={(next) => {
            setPinFix(false);
            onPinUpdated?.({ ...p, ...next, precision: 'exact', manual: true });
            if (next?.lat != null) emitSelection({ id: p.id, lat: next.lat, lng: next.lng });
          }}
        />
      )}
    </div>
  );
}
