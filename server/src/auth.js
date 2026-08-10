// Single-password app gate. Token = HMAC-signed payload with expiry.
import crypto from 'node:crypto';
import { Router } from 'express';
import { cfg } from './config.js';

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

export function createSessionToken(ttlMs = SESSION_MS) {
  const payload = b64url(JSON.stringify({ exp: Date.now() + ttlMs }));
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = sign(payload);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(exp) && exp > Date.now();
  } catch {
    return false;
  }
}

export function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return (req.headers['x-app-token'] || '').trim() || null;
}

/** True when APP_PASSWORD is configured — APIs require a valid session. */
export function authRequired() {
  return Boolean(cfg.appPassword);
}

/**
 * Middleware: protect /api/* when APP_PASSWORD is set.
 * Public: /healthz, /api/auth/*, /api/routes/share/*
 */
export function requireAuth(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  if (!authRequired()) return next();
  const token = extractBearer(req);
  if (!verifySessionToken(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * Extra gate for destructive admin mutations.
 * - If ADMIN_TOKEN is set and differs from APP_PASSWORD (after legacy alias),
 *   require X-Admin-Token header to match ADMIN_TOKEN from env.
 * Actually: when ADMIN_TOKEN env was only used as alias, both are same.
 * Check process.env.ADMIN_TOKEN was intended as admin-only when APP_PASSWORD also set.
 *
 * Rule: if process.env.ADMIN_TOKEN is set AFTER resolving that APP_PASSWORD exists
 * and ADMIN_TOKEN is different OR user set both explicitly…
 * Simpler rule used in production:
 * If ADMIN_TOKEN is non-empty AND APP_PASSWORD is non-empty AND they differ,
 * require X-Admin-Token: ADMIN_TOKEN for admin write routes.
 * If only one secret, session is enough.
 */
export function requireAdminWrite(req, res, next) {
  const envAdmin = process.env.ADMIN_TOKEN || '';
  const envApp = process.env.APP_PASSWORD || '';
  if (envAdmin && envApp && envAdmin !== envApp) {
    const hdr = (req.headers['x-admin-token'] || '').trim();
    if (hdr !== envAdmin) {
      return res.status(403).json({ error: 'admin token required' });
    }
  }
  next();
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

export const auth = Router();

auth.get('/status', (_req, res) => {
  res.json({
    authRequired: authRequired(),
    adminWriteProtected: Boolean(
      process.env.ADMIN_TOKEN && process.env.APP_PASSWORD
      && process.env.ADMIN_TOKEN !== process.env.APP_PASSWORD,
    ),
  });
});

auth.post('/login', (req, res) => {
  try {
    rateLimitLogin(req);
  } catch (e) {
    return res.status(e.status || 429).json({ error: e.message });
  }
  if (!authRequired()) {
    return res.json({ token: createSessionToken(), authRequired: false });
  }
  const password = req.body?.password;
  if (typeof password !== 'string' || password !== cfg.appPassword) {
    return res.status(401).json({ error: 'invalid password' });
  }
  res.json({ token: createSessionToken(), authRequired: true });
});

auth.get('/me', (req, res) => {
  if (!authRequired()) return res.json({ ok: true, authRequired: false });
  const token = extractBearer(req);
  if (!verifySessionToken(token)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ ok: true, authRequired: true });
});
