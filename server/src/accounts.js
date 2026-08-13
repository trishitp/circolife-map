import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';
import { cfg } from './config.js';

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function isValidEmail(raw) {
  const e = normalizeEmail(raw);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 190;
}

export function parseEmailList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => normalizeEmail(s))
    .filter(isValidEmail);
}

export function envAdminEmails() {
  return new Set(parseEmailList(cfg.adminEmails));
}

export function isEnvAdmin(email) {
  return envAdminEmails().has(normalizeEmail(email));
}

export async function hashPassword(plain) {
  const salt = randomBytes(16);
  const buf = await scryptAsync(String(plain), salt, KEYLEN, SCRYPT);
  return `scrypt:${SCRYPT.N}:${SCRYPT.r}:${SCRYPT.p}:${salt.toString('base64')}:${buf.toString('base64')}`;
}

export async function verifyPassword(plain, stored) {
  const parts = String(stored || '').split(':');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (!salt.length || !expected.length) return false;
  const buf = await scryptAsync(String(plain), salt, expected.length, { N, r, p });
  if (buf.length !== expected.length) return false;
  return timingSafeEqual(buf, expected);
}

function newId() {
  return randomBytes(12).toString('hex');
}

export function publicAccount(row) {
  if (!row) return null;
  const email = normalizeEmail(row.email);
  const admin = Boolean(row.is_admin) || isEnvAdmin(email);
  return {
    id: row.id,
    email,
    name: row.name || email.split('@')[0],
    admin,
    active: row.active !== false,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
    loginProvider: row.login_provider || 'password',
  };
}

let cachedHasAccounts = null;

export function invalidateAccountCache() {
  cachedHasAccounts = null;
}

export async function countAccounts() {
  const r = await q(`SELECT COUNT(*)::int AS n FROM app_accounts`);
  const n = r.rows[0]?.n || 0;
  cachedHasAccounts = n > 0;
  return n;
}

export async function hasAccounts() {
  if (cachedHasAccounts === true) return true;
  return (await countAccounts()) > 0;
}

export async function getAccountById(id) {
  if (!id) return null;
  const r = await q(`SELECT * FROM app_accounts WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

export async function getAccountByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const r = await q(`SELECT * FROM app_accounts WHERE lower(email) = $1`, [e]);
  return r.rows[0] || null;
}

export async function listAccounts() {
  const r = await q(`
    SELECT id, email, name, is_admin, active, last_login_at, created_at, updated_at,
           login_provider, zoho_zuid
    FROM app_accounts
    ORDER BY is_admin DESC, lower(email)
  `);
  return r.rows.map(publicAccount);
}

export async function createAccount({ email, name, password, isAdmin = false }) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) {
    const err = new Error('valid email is required');
    err.status = 400;
    throw err;
  }
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('password must be at least 8 characters');
    err.status = 400;
    throw err;
  }
  const existing = await getAccountByEmail(e);
  if (existing) {
    const err = new Error('an account with that email already exists');
    err.status = 409;
    throw err;
  }
  const display = String(name || '').trim() || e.split('@')[0];
  const admin = Boolean(isAdmin) || isEnvAdmin(e);
  const id = newId();
  const hash = await hashPassword(password);
  const r = await q(
    `INSERT INTO app_accounts (id, email, name, password_hash, is_admin, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)
     RETURNING *`,
    [id, e, display, hash, admin],
  );
  invalidateAccountCache();
  return publicAccount(r.rows[0]);
}

export async function updateAccount(id, patch = {}) {
  const row = await getAccountById(id);
  if (!row) {
    const err = new Error('account not found');
    err.status = 404;
    throw err;
  }
  const email = normalizeEmail(row.email);
  let name = row.name;
  let isAdmin = row.is_admin;
  let active = row.active;
  let passwordHash = row.password_hash;

  if (patch.name != null) {
    const n = String(patch.name).trim();
    if (n) name = n;
  }
  if (patch.isAdmin != null) {
    if (isEnvAdmin(email) && !patch.isAdmin) {
      const err = new Error('this email is listed in ADMIN_EMAILS and must stay admin');
      err.status = 400;
      throw err;
    }
    isAdmin = Boolean(patch.isAdmin);
  }
  if (patch.active != null) active = Boolean(patch.active);
  if (patch.password != null && patch.password !== '') {
    if (String(patch.password).length < 8) {
      const err = new Error('password must be at least 8 characters');
      err.status = 400;
      throw err;
    }
    passwordHash = await hashPassword(patch.password);
  }

  if (!active && row.is_admin) {
    const others = await q(
      `SELECT COUNT(*)::int AS n FROM app_accounts
       WHERE is_admin = TRUE AND active = TRUE AND id <> $1`,
      [id],
    );
    if (!(others.rows[0]?.n) && !isEnvAdmin(email)) {
      const err = new Error('cannot disable the last admin');
      err.status = 400;
      throw err;
    }
  }
  if (row.is_admin && isAdmin === false) {
    const others = await q(
      `SELECT COUNT(*)::int AS n FROM app_accounts
       WHERE is_admin = TRUE AND active = TRUE AND id <> $1`,
      [id],
    );
    if (!(others.rows[0]?.n) && !isEnvAdmin(email)) {
      const err = new Error('cannot remove the last admin');
      err.status = 400;
      throw err;
    }
  }

  const r = await q(
    `UPDATE app_accounts
     SET name = $2, is_admin = $3, active = $4, password_hash = $5, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, name, isAdmin, active, passwordHash],
  );
  return publicAccount(r.rows[0]);
}

export async function touchLogin(id) {
  await q(`UPDATE app_accounts SET last_login_at = now() WHERE id = $1`, [id]);
}

export async function authenticate(email, password) {
  const row = await getAccountByEmail(email);
  if (!row || row.active === false || !row.password_hash) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  await touchLogin(row.id);
  return publicAccount(row);
}

const CRM_ADMIN_ROLE = /admin|ceo|founder|director|super\s*admin/i;

export async function upsertZohoAccount({ email, name, zuid } = {}) {
  const e = normalizeEmail(email);
  if (!isValidEmail(e)) {
    const err = new Error('Zoho account has no usable email');
    err.status = 400;
    throw err;
  }
  const crm = await q(
    `SELECT full_name, role_name, status FROM crm_users WHERE lower(email) = $1 LIMIT 1`,
    [e],
  ).catch(() => ({ rows: [] }));
  const crmRow = crm.rows[0];
  if (process.env.ZOHO_LOGIN_REQUIRE_CRM === '1' && !crmRow) {
    const err = new Error('this Zoho user is not in Circolife CRM Users');
    err.status = 403;
    throw err;
  }
  if (crmRow && String(crmRow.status || '').toLowerCase() === 'disabled') {
    const err = new Error('this CRM user is disabled');
    err.status = 403;
    throw err;
  }

  const display = String(name || crmRow?.full_name || '').trim() || e.split('@')[0];
  const crmAdmin = CRM_ADMIN_ROLE.test(crmRow?.role_name || '');
  const existing = await getAccountByEmail(e);
  if (existing) {
    if (existing.active === false) {
      const err = new Error('this Maps account is disabled');
      err.status = 403;
      throw err;
    }
    const promote = isEnvAdmin(e) || crmAdmin;
    const r = await q(
      `UPDATE app_accounts
       SET name = $2,
           zoho_zuid = COALESCE(NULLIF($3, ''), zoho_zuid),
           login_provider = 'zoho',
           is_admin = CASE WHEN $4 THEN TRUE ELSE is_admin END,
           last_login_at = now(),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [existing.id, display, zuid || '', promote],
    );
    return publicAccount(r.rows[0]);
  }

  const admins = await q(
    `SELECT COUNT(*)::int AS n FROM app_accounts WHERE is_admin = TRUE AND active = TRUE`,
  );
  const isAdmin = isEnvAdmin(e) || crmAdmin || !(admins.rows[0]?.n);
  const id = newId();
  const r = await q(
    `INSERT INTO app_accounts
       (id, email, name, password_hash, is_admin, active, login_provider, zoho_zuid, last_login_at)
     VALUES ($1, $2, $3, NULL, $4, TRUE, 'zoho', $5, now())
     RETURNING *`,
    [id, e, display, isAdmin, zuid || null],
  );
  invalidateAccountCache();
  return publicAccount(r.rows[0]);
}

/**
 * Password bootstrap is skipped when Zoho login is configured — the first
 * Zoho sign-in becomes admin if no admin exists yet.
 */
export async function ensureBootstrapAdmin() {
  try {
    const n = await countAccounts();
    if (n > 0) return { created: false, count: n };
    if (cfg.zoho.loginRedirectUri && (cfg.zoho.loginClientId || cfg.zoho.clientId)) {
      console.log('[auth] Zoho login on — first Zoho sign-in becomes admin');
      return { created: false, count: 0, zoho: true };
    }
    const email = normalizeEmail(cfg.bootstrapAdminEmail)
      || parseEmailList(cfg.adminEmails)[0]
      || '';
    const password = cfg.bootstrapAdminPassword || cfg.appPassword || '';
    if (!email || !password) {
      console.warn(
        '[auth] no app_accounts yet — sign in with Zoho, or set BOOTSTRAP_ADMIN_EMAIL',
      );
      return { created: false, count: 0 };
    }
    if (!isValidEmail(email) || password.length < 8) {
      console.warn('[auth] bootstrap admin skipped: need a valid email and password ≥ 8 characters');
      return { created: false, count: 0 };
    }
    const user = await createAccount({
      email,
      name: email.split('@')[0],
      password,
      isAdmin: true,
    });
    console.log(`[auth] created bootstrap admin ${user.email}`);
    return { created: true, count: 1, email: user.email };
  } catch (e) {
    console.warn('[auth] bootstrap admin failed:', e.message);
    return { created: false, error: e.message };
  }
}
