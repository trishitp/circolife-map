// Browser Zoho Accounts OAuth for Maps sign-in (separate from Analytics refresh token).
import crypto from 'node:crypto';
import { cfg } from '../config.js';

const LOGIN_SCOPE = process.env.ZOHO_LOGIN_SCOPE || 'AaaServer.profile.Read';

function loginClient() {
  return {
    id: cfg.zoho.loginClientId || cfg.zoho.clientId,
    secret: cfg.zoho.loginClientSecret || cfg.zoho.clientSecret,
  };
}

/** Opt-in: requires ZOHO_LOGIN_REDIRECT_URI so Analytics Self Client creds cannot break login. */
export function zohoLoginEnabled() {
  const { id, secret } = loginClient();
  return Boolean(id && secret && String(cfg.zoho.loginRedirectUri || '').trim());
}

export function loginRedirectUri(req) {
  const explicit = String(cfg.zoho.loginRedirectUri || '').trim();
  if (explicit) return explicit;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
    .split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim();
  if (!host) return '';
  return `${proto}://${host}/api/auth/zoho/callback`;
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function makeOauthState() {
  return signState({ n: crypto.randomBytes(8).toString('hex'), exp: Date.now() + 15 * 60_000 });
}

export function readOauthState(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function zohoAuthorizeUrl(req) {
  const redirect = loginRedirectUri(req);
  const state = makeOauthState();
  const u = new URL('/oauth/v2/auth', cfg.zoho.accountsBase);
  u.searchParams.set('scope', LOGIN_SCOPE);
  u.searchParams.set('client_id', loginClient().id);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  return { url: u.toString(), redirect };
}

export async function exchangeLoginCode(code, redirectUri) {
  const u = new URL('/oauth/v2/token', cfg.zoho.accountsBase);
  const body = new URLSearchParams({
    code,
    client_id: loginClient().id,
    client_secret: loginClient().secret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const msg = j.error_description || j.error || `Zoho token failed (${r.status})`;
    const err = new Error(msg);
    err.status = 401;
    throw err;
  }
  return j.access_token;
}

export async function fetchZohoProfile(accessToken) {
  const urls = [
    new URL('/oauth/user/info', cfg.zoho.accountsBase).toString(),
    new URL('/oauth/v2/userinfo', cfg.zoho.accountsBase).toString(),
  ];
  let last = 'Zoho profile failed';
  for (const url of urls) {
    const r = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      last = j.error_description || j.error || j.message || `Zoho profile ${r.status}`;
      continue;
    }
    const email = j.Email || j.email || j.primary_email || j.Primary_Email;
    if (!email) {
      last = 'Zoho profile had no email';
      continue;
    }
    const name = [j.Display_Name, j.display_name, [j.First_Name, j.Last_Name].filter(Boolean).join(' ')]
      .map((s) => String(s || '').trim())
      .find(Boolean) || String(email).split('@')[0];
    return {
      email: String(email),
      name,
      zuid: String(j.ZUID || j.zuid || ''),
    };
  }
  const err = new Error(last);
  err.status = 401;
  throw err;
}
