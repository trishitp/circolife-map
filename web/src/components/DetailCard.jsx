import { useEffect } from 'react';
import { emitSelection } from '../lib/selection';
import { IconAc } from './icons';

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

export default function DetailCard({ p, onClose }) {
  useEffect(() => {
    if (!p) {
      emitSelection(null);
      return;
    }
    const lat = p.lat != null ? Number(p.lat) : null;
    const lng = p.lng != null ? Number(p.lng) : null;
    emitSelection({ id: p.id, lat, lng });
  }, [p]);

  if (!p) return null;

  const layer = p._layer;
  const isZone = layer === 'zone';
  const assetNo = p.assetNumber || (layer === 'assets' ? p.title : null);
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
    layer === 'assets' && p.assetName && p.assetName !== assetNo && ['Model', p.assetName],
    layer === 'assets' && p.mac && ['MAC', p.mac],
    layer === 'assets' && p.acType && ['AC type', p.acType],
    layer === 'assets' && p.tonnage && ['Tonnage', p.tonnage],
    layer === 'assets' && p.addressSource && [
      'Address source',
      ADDRESS_SOURCE_COPY[p.addressSource] || p.addressSource,
    ],
    p.owner && ['Agent', p.owner],
    p.territory && ['Territory', p.territory],
    p.status && ['Status', p.status],
    p.ts && ['Date', new Date(p.ts).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    })],
  ].filter(Boolean);

  return (
    <div className="detail-card" role="dialog" aria-label={p.title || 'Record detail'}>
      <button type="button" className="x" onClick={onClose} aria-label="Close">✕</button>
      {layer && (
        <div className="layer-tag" style={{ '--tag-color': LAYER_COLOR[layer] }}>
          {layer === 'assets'
            ? <span className="ac-glyph" aria-hidden><IconAc size={14} /></span>
            : <span className="dot" aria-hidden />}
          {layer === 'assets' ? 'AC' : (LAYER_LABEL[layer] || layer)}
        </div>
      )}
      <h3>{layer === 'assets' ? (assetNo || p.title || 'Asset') : (p.title || 'Untitled')}</h3>
      {rows.length > 0 && (
        <dl className="meta">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
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
      {p.crmUrl && (
        <div>
          <a className="cta" href={p.crmUrl} target="_blank" rel="noreferrer">
            Open in CRM →
          </a>
        </div>
      )}
    </div>
  );
}
