import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pinCentroidPlausible } from '../src/geocode/pipeline.js';
import { addressFingerprint, buildFullAddress, normalizePincode } from '../src/geocode/address.js';
import { withModifiedSince } from '../src/sync/extractQueries.js';
import { layerLimitForZoom } from '../src/routes/layers.js';

describe('pinCentroidPlausible', () => {
  it('rejects Agra template for any pin', () => {
    assert.equal(pinCentroidPlausible('400001', 27.2384, 78.7478), false);
    assert.equal(pinCentroidPlausible('201009', 27.2384, 78.7478), false);
  });

  it('accepts Noida 201303 in the NCR box', () => {
    assert.equal(pinCentroidPlausible('201303', 28.5640, 77.3500), true);
  });

  it('rejects Noida pin far outside NCR', () => {
    assert.equal(pinCentroidPlausible('201303', 19.07, 72.87), false);
  });

  it('accepts Delhi 110001 near Connaught Place', () => {
    assert.equal(pinCentroidPlausible('110001', 28.6333, 77.2167), true);
  });
});

describe('addressFingerprint', () => {
  it('is stable for equivalent address inputs', () => {
    const a = addressFingerprint({
      street: ' 12 MG Road ', city: 'Mumbai', pincode: '400001', territory: 'Mumbai',
    });
    const b = addressFingerprint({
      street: '12 MG Road', city: 'Mumbai', pincode: '400001', territory: 'Mumbai',
    });
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{40}$/);
  });

  it('changes when street changes', () => {
    const a = addressFingerprint({ street: 'A', pincode: '400001' });
    const b = addressFingerprint({ street: 'B', pincode: '400001' });
    assert.notEqual(a, b);
  });
});

describe('buildFullAddress / normalizePincode', () => {
  it('composes a readable address', () => {
    const s = buildFullAddress({
      street: 'Lane 1', city: 'Pune', state: 'MH', pincode: '411001', country: 'India',
    });
    assert.match(s, /Lane 1/);
    assert.match(s, /411001/);
  });

  it('normalizes pin strings', () => {
    assert.equal(normalizePincode('411 001'), '411001');
    assert.equal(normalizePincode('411001.0'), '411001');
  });
});

describe('withModifiedSince', () => {
  it('appends AND when WHERE exists', () => {
    const sql = withModifiedSince(
      'SELECT 1 FROM "Leads"\nWHERE "Lead Status" NOT IN (\'Junk\')',
      '2026-11-01T00:00:00.000Z',
    );
    assert.match(sql, /AND "Modified Time" >/);
  });

  it('adds WHERE when missing', () => {
    const sql = withModifiedSince('SELECT 1 FROM "Accounts"', '2026-11-01T00:00:00.000Z', 'a."Modified Time"');
    assert.match(sql, /WHERE a\."Modified Time" >/);
  });

  it('is a no-op without since', () => {
    assert.equal(withModifiedSince('SELECT 1', null), 'SELECT 1');
  });
});

describe('layerLimitForZoom', () => {
  it('caps low zoom', () => {
    assert.equal(layerLimitForZoom(8, 8000), 2500);
    assert.equal(layerLimitForZoom(10, 8000), 5000);
  });

  it('raises high zoom', () => {
    assert.equal(layerLimitForZoom(14, 8000), 12000);
  });
});
