import { useEffect } from 'react';
import { emitSelection } from '../lib/selection';

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
};

const LAYER_COLOR = {
  leads: '#A14996',
  accounts: '#2E1F40',
  meetings: '#5FA9C6',
  assets: '#6BB35A',
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
  const assetNo = p.assetNumber || (layer === 'assets' ? p.title : null);
  const rows = [
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
          <span className="dot" aria-hidden />
          {LAYER_LABEL[layer] || layer}
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
      <span className={`precision ${p.precision || ''}`}>
        {PRECISION_COPY[p.precision] || p.precision || 'Location'}
      </span>
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
