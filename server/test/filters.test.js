import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMapFilterClauses, parseList } from '../src/filters/mapFilters.js';

describe('parseList', () => {
  it('splits commas and trims', () => {
    assert.deepEqual(parseList('a, b,,c'), ['a', 'b', 'c']);
    assert.deepEqual(parseList(['x', 'y']), ['x', 'y']);
    assert.deepEqual(parseList(''), []);
  });
});

describe('buildMapFilterClauses', () => {
  it('scopes owner to meetings/assets only', () => {
    const meetingParams = ['meetings'];
    const meeting = buildMapFilterClauses({ owner: 'Ada' }, meetingParams, { layer: 'meetings' });
    assert.ok(meeting.some((c) => c.includes('owner_name')));
    assert.equal(meetingParams.length, 2);

    const leadParams = ['leads'];
    const leads = buildMapFilterClauses({ owner: 'Ada' }, leadParams, { layer: 'leads' });
    assert.ok(!leads.some((c) => c.includes('owner_name')));
    assert.equal(leadParams.length, 1);
  });

  it('filters precision and date bounds', () => {
    const params = ['assets'];
    const clauses = buildMapFilterClauses(
      { precision: 'pincode,approx', from: '2026-01-01', to: '2026-01-31' },
      params,
      { layer: 'assets' },
    );
    assert.ok(clauses.some((c) => c.includes('precision')));
    assert.ok(clauses.some((c) => c.includes('record_ts >=')));
    assert.ok(clauses.some((c) => c.includes('record_ts <=')));
  });

  it('applies lead source only on leads', () => {
    const leadParams = ['leads'];
    const leads = buildMapFilterClauses({ source: 'Web' }, leadParams, { layer: 'leads' });
    assert.ok(leads.some((c) => c.includes("extra->>'source'")));

    const accParams = ['accounts'];
    const accounts = buildMapFilterClauses({ source: 'Web' }, accParams, { layer: 'accounts' });
    assert.ok(!accounts.some((c) => c.includes("extra->>'source'")));
  });
});
