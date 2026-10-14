import { parse } from 'csv-parse/sync';
import { q } from './db.js';

/** Normalize Indian pincode from CRM / Excel exports. */
export function normalizePincode(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim().replace(/\.0+$/, '');
  s = s.replace(/\D/g, '');
  if (s.length === 5) s = `0${s}`;
  if (!/^\d{6}$/.test(s)) return null;
  return s;
}

export function normalizeBdmName(raw) {
  const s = String(raw || '').trim();
  return s || null;
}

const BDM_HEADERS = new Set([
  'bdm', 'bdm_name', 'bdm name', 'rm', 'rm_name', 'rm name', 'name', 'owner', 'agent',
]);
const PIN_HEADERS = new Set([
  'pincode', 'pin code', 'pin', 'zip', 'zip code', 'postal', 'postal code',
]);

function headerKey(h) {
  return String(h || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
}

function pickColumns(record) {
  const keys = Object.keys(record);
  let bdmKey = null;
  let pinKey = null;
  for (const k of keys) {
    const hk = headerKey(k);
    if (!bdmKey && BDM_HEADERS.has(hk)) bdmKey = k;
    if (!pinKey && PIN_HEADERS.has(hk)) pinKey = k;
  }
  if (!bdmKey && keys.length >= 2) {
    bdmKey = keys[0];
    pinKey = keys[1];
  }
  return { bdmKey, pinKey };
}

/** Parse CSV text or rows from Excel into { bdmName, pincode }[]. */
export function parseAssignmentRows(textOrRows) {
  let rows;
  if (typeof textOrRows === 'string') {
    rows = parse(textOrRows, { columns: true, skip_empty_lines: true, trim: true, bom: true });
  } else {
    rows = textOrRows;
  }
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const { bdmKey, pinKey } = pickColumns(row);
    if (!bdmKey || !pinKey) continue;
    const bdmName = normalizeBdmName(row[bdmKey]);
    const pincode = normalizePincode(row[pinKey]);
    if (!bdmName || !pincode) continue;
    const key = `${bdmName.toLowerCase()}|${pincode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bdmName, pincode });
  }
  return out;
}

export async function getPincodesForBdm(bdmName) {
  const name = normalizeBdmName(bdmName);
  if (!name) return [];
  const { rows } = await q(
    `SELECT pincode FROM bdm_pincode_assignments
     WHERE lower(trim(bdm_name)) = lower(trim($1))
     ORDER BY pincode`,
    [name],
  );
  return rows.map((r) => r.pincode);
}

export async function replaceAllAssignments(parsedRows) {
  if (!parsedRows.length) {
    const err = new Error('No valid BDM / pincode rows found');
    err.status = 400;
    throw err;
  }
  await q('BEGIN');
  try {
    await q('DELETE FROM bdm_pincode_assignments');
    for (const { bdmName, pincode } of parsedRows) {
      await q(
        `INSERT INTO bdm_pincode_assignments (bdm_name, pincode, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (bdm_name, pincode) DO UPDATE SET updated_at = now()`,
        [bdmName, pincode],
      );
    }
    await q('COMMIT');
  } catch (e) {
    await q('ROLLBACK');
    throw e;
  }
  const stats = await q(`
    SELECT COUNT(DISTINCT bdm_name)::int AS bdms,
           COUNT(*)::int AS rows
    FROM bdm_pincode_assignments`);
  return stats.rows[0];
}

export async function assignmentSummary() {
  const { rows } = await q(`
    SELECT COUNT(DISTINCT bdm_name)::int AS bdms,
           COUNT(*)::int AS rows,
           MAX(updated_at) AS updated_at
    FROM bdm_pincode_assignments`);
  return rows[0] || { bdms: 0, rows: 0, updated_at: null };
}

/** Parse CSV text or Excel buffer (.xlsx) into assignment rows. */
export async function parseAssignmentUpload({ csv, buffer, filename }) {
  if (csv && typeof csv === 'string') {
    return parseAssignmentRows(csv);
  }
  if (buffer && buffer.length) {
    const name = String(filename || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      return parseAssignmentRows(buffer.toString('utf8'));
    }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return parseAssignmentRows(rows);
  }
  const err = new Error('Provide body.csv or body.base64 (Excel/CSV file)');
  err.status = 400;
  throw err;
}
