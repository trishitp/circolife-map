// Per-user email/password sessions. Token = HMAC-signed payload with expiry.
import crypto from 'node:crypto';
import { Router } from 'express';
import { cfg } from './config.js';
import {
  authenticate,
  countAccounts,
  createAccount,
  getAccountById,
  hasAccounts,
  isValidEmail,
  publicAccount,
  updateAccount,
  upsertZohoAccount,
} from './accounts.js';
import {
  zohoLoginEnabled,
  zohoAuthorizeUrl,
  loginRedirectUri,
  readOauthState,
  exchangeLoginCode,
  fetchZohoProfile,
} from './zoho/login.js';

const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Simple in-memory login rate limit (per IP). */
const loginHits = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 20;

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', cfg.sessionSecret)
    .update(payloadB64)
    .digest('base64url');
}

export function createSessionToken(user, ttlMs = SESSION_MS) {
  const payload = b64url(JSON.stringify({
    exp: Date.now() + ttlMs,
    sub: user?.id || null,
    email: user?.email || '',
    admin: Boolean(user?.admin),
  }));
  return `${payload}.${sign(payload)}`;
}

export function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** @deprecated use readSessionToken */
export function verifySessionToken(token) {
  return Boolean(readSessionToken(token));
}

export function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return (req.headers['x-app-token'] || '').trim() || null;
}

function automationUser() {
  return {
    id: null,
    email: 'automation',
    name: 'automation',
    admin: true,
    active: true,
    automation: true,
  };
}

function openDevUser() {
  return {
    id: null,
    email: '',
    name: 'Dev',
    admin: true,
    active: true,
    authRequired: false,
  };
}

function envAdminTokenOk(req) {
  const envAdmin = (process.env.ADMIN_TOKEN || '').trim();
  if (!envAdmin) return false;
  const hdr = (req.headers['x-admin-token'] || '').trim();
  return Boolean(hdr) && hdr === envAdmin;
}

/** True when logins are required (production / APP_PASSWORD / Zoho / existing accounts). */
export async function authRequired() {
  if (cfg.appPassword) return true;
  if (zohoLoginEnabled()) return true;
  return hasAccounts();
}

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown'
  );
}

function rateLimitLogin(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = loginHits.get(ip);
  if (!bucket || now - bucket.start > LOGIN_WINDOW_MS) {
    bucket = { start: now, n: 0 };
    loginHits.set(ip, bucket);
  }
  bucket.n += 1;
  if (bucket.n > LOGIN_MAX) {
    const err = new Error('too many login attempts — try again later');
    err.status = 429;
    throw err;
  }
}

/**
 * Middleware: protect /api/* when auth is on.
 * Public: /healthz, /api/auth/*, /api/routes/share/*
 * X-Admin-Token (when ADMIN_TOKEN is set) can authenticate automation as admin.
 */
export async function requireAuth(req, res, next) {
  try {
    if (req.method === 'OPTIONS') return next();
    if (envAdminTokenOk(req)) {
      req.user = automationUser();
      return next();
    }
    if (!(await authRequired())) {
      req.user = openDevUser();
      return next();
    }
    const token = extractBearer(req);
    const session = readSessionToken(token);
    if (!session?.sub) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const row = await getAccountById(session.sub);
    const user = publicAccount(row);
    if (!user || !user.active) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Admin tab + every /api/admin route. */
export function requireAdmin(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (req.user?.admin) return next();
  return res.status(403).json({ error: 'admin only' });
}

/**
 * Extra gate for destructive admin mutations when ADMIN_TOKEN differs from APP_PASSWORD.
 * Browser admins already passed requireAdmin; this only applies if both secrets are set
 * and the caller is not an admin user (automation still uses the token via requireAuth).
 */
export function requireAdminWrite(req, res, next) {
  if (req.user?.admin) return next();
  const envAdmin = process.env.ADMIN_TOKEN || '';
  const envApp = process.env.APP_PASSWORD || '';
  if (envAdmin && envApp && envAdmin !== envApp) {
    const hdr = (req.headers['x-admin-token'] || '').trim();
    if (hdr !== envAdmin) {
      return res.status(403).json({ error: 'admin only' });
    }
  }
  if (!req.user?.admin) {
    return res.status(403).json({ error: 'admin only' });
  }
  next();
}

function mePayload(user, required) {
  return {
    ok: true,
    authRequired: required,
    id: user?.id || null,
    email: user?.email || '',
    name: user?.name || '',
    admin: Boolean(user?.admin),
  };
}

export const auth = Router();

function frontendOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

auth.get('/status', async (_req, res) => {
  const required = await authRequired();
  res.json({
    authRequired: required,
    zohoLogin: zohoLoginEnabled(),
    accounts: await countAccounts().catch(() => 0),
  });
});

auth.get('/zoho/start', (req, res) => {
  try {
    rateLimitLogin(req);
  } catch (e) {
    return res.status(e.status || 429).json({ error: e.message });
  }
  if (!zohoLoginEnabled()) {
    return res.status(503).json({
      error: 'Zoho login is not configured — set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET',
    });
  }
  try {
    const { url } = zohoAuthorizeUrl(req);
    res.redirect(302, url);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Zoho login failed' });
  }
});

auth.get('/zoho/callback', async (req, res) => {
  const origin = frontendOrigin(req) || '/';
  const fail = (msg) => {
    const u = new URL('/', origin.endsWith('/') ? origin : `${origin}/`);
    u.searchParams.set('auth_error', msg);
    res.redirect(302, u.toString());
  };
  try {
    if (req.query.error) {
      return fail(String(req.query.error_description || req.query.error));
    }
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    if (!code) return fail('missing Zoho authorization code');
    if (!readOauthState(state)) return fail('Zoho sign-in expired — try again');
    const redirectUri = loginRedirectUri(req);
    const access = await exchangeLoginCode(code, redirectUri);
    const profile = await fetchZohoProfile(access);
    const user = await upsertZohoAccount(profile);
    const token = createSessionToken(user);
    const u = new URL('/', origin.endsWith('/') ? origin : `${origin}/`);
    u.searchParams.set('auth_token', token);
    res.redirect(302, u.toString());
  } catch (e) {
    console.error('[auth/zoho/callback]', e);
    fail(e.message || 'Zoho sign-in failed');
  }
});

auth.post('/login', async (req, res) => {
  try {
    rateLimitLogin(req);
  } catch (e) {
    return res.status(e.status || 429).json({ error: e.message });
  }
  try {
    const required = await authRequired();
    if (!required) {
      const user = openDevUser();
      return res.json({
        token: createSessionToken(user),
        authRequired: false,
        user: mePayload(user, false),
      });
    }
    if (zohoLoginEnabled()) {
      return res.status(400).json({ error: 'sign in with Zoho' });
    }
    const email = req.body?.email;
    const password = req.body?.password;
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    let user = await authenticate(email, password);
    if (!user && cfg.appPassword && password === cfg.appPassword) {
      const n = await countAccounts();
      if (n === 0 && isValidEmail(email) && password.length >= 8) {
        user = await createAccount({
          email,
          password,
          isAdmin: true,
        });
        console.log(`[auth] first admin claimed: ${user.email}`);
      }
    }
    if (!user) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    res.json({
      token: createSessionToken(user),
      authRequired: true,
      user: mePayload(user, true),
    });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: e.message || 'login failed' });
  }
});

auth.get('/me', async (req, res) => {
  try {
    const required = await authRequired();
    if (!required) return res.json(mePayload(openDevUser(), false));
    if (envAdminTokenOk(req)) return res.json(mePayload(automationUser(), true));
    const token = extractBearer(req);
    const session = readSessionToken(token);
    if (!session?.sub) return res.status(401).json({ error: 'unauthorized' });
    const row = await getAccountById(session.sub);
    const user = publicAccount(row);
    if (!user || !user.active) return res.status(401).json({ error: 'unauthorized' });
    res.json(mePayload(user, true));
  } catch (e) {
    res.status(500).json({ error: e.message || 'me failed' });
  }
});

auth.post('/password', async (req, res) => {
  try {
    const required = await authRequired();
    if (!required) return res.status(400).json({ error: 'auth is open in this environment' });
    const token = extractBearer(req);
    const session = readSessionToken(token);
    if (!session?.sub) return res.status(401).json({ error: 'unauthorized' });
    const row = await getAccountById(session.sub);
    const user = publicAccount(row);
    if (!user || !user.active) return res.status(401).json({ error: 'unauthorized' });
    const current = req.body?.current;
    const next = req.body?.next;
    const { verifyPassword } = await import('./accounts.js');
    if (typeof current !== 'string' || !(await verifyPassword(current, row.password_hash))) {
      return res.status(401).json({ error: 'current password is wrong' });
    }
    await updateAccount(user.id, { password: next });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'password change failed' });
  }
});
