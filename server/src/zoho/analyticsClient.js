// Zoho Analytics bulk-export client (India DC).
// Access tokens auto-refresh from ZOHO_REFRESH_TOKEN; rotated refresh tokens
// are written back to .env. Status checks never force-refresh (avoids rate limits).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg } from '../config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_PATH = path.join(ROOT, '.env');
const TOKEN_CACHE_PATH = path.join(ROOT, '.zoho-token-cache.json');

let accessToken = null;
let accessExp = 0;
/** @type {Promise<string>|null} */
let refreshInflight = null;

/** Backoff after failed refresh so Admin polling does not hammer Zoho. */
let lastFailAt = 0;
let lastFailMsg = null;
let failUntil = 0; // epoch ms — skip network refresh until then
let hardInvalid = false; // refresh token revoked — only fixed by new grant code

const BACKOFF_DEFAULT_MS = 60_000;
const BACKOFF_RATE_MS = 5 * 60_000;
const BACKOFF_INVALID_MS = 30 * 60_000;

function zohoErrorMessage(j) {
  return j?.error_description || j?.error || j?.message || JSON.stringify(j);
}

function classifyFailure(j, message) {
  const err = String(j?.error || '');
  const desc = String(j?.error_description || message || '');
  if (/invalid_code|invalid_token|invalid_grant/i.test(err)
      || /invalid.*token|revoked|expired.*refresh/i.test(desc)) {
    return { hardInvalid: true, backoffMs: BACKOFF_INVALID_MS };
  }
  if (/access denied|too many requests|rate/i.test(err + desc)) {
    return { hardInvalid: false, backoffMs: BACKOFF_RATE_MS };
  }
  return { hardInvalid: false, backoffMs: BACKOFF_DEFAULT_MS };
}

function loadDiskCache() {
  try {
    if (!fs.existsSync(TOKEN_CACHE_PATH)) return;
    const j = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH, 'utf8'));
    if (j?.accessToken && j.exp && j.exp > Date.now() + 60_000) {
      accessToken = j.accessToken;
      accessExp = j.exp;
    }
  } catch { /* ignore corrupt cache */ }
}

function saveDiskCache() {
  try {
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify({
      accessToken,
      exp: accessExp,
      savedAt: Date.now(),
    }), 'utf8');
  } catch (e) {
    console.warn('[zoho] token cache write failed:', e.message);
  }
}

function clearDiskCache() {
  accessToken = null;
  accessExp = 0;
  try {
    if (fs.existsSync(TOKEN_CACHE_PATH)) fs.unlinkSync(TOKEN_CACHE_PATH);
  } catch { /* */ }
}

loadDiskCache();

/**
 * Persist rotated credentials into server/.env without wiping other keys.
 */
function persistEnvUpdates(updates) {
  if (!fs.existsSync(ENV_PATH)) return;
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, text, 'utf8');
  console.log(`[zoho] updated ${Object.keys(updates).join(', ')} in .env`);
}

/**
 * Exchange grant_type=refresh_token (or authorization_code once) for tokens.
 * Zoho expects application/x-www-form-urlencoded body — not query params.
 */
async function tokenRequest(params) {
  const u = new URL('/oauth/v2/token', cfg.zoho.accountsBase);
  const body = new URLSearchParams(params);
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const err = new Error(`Zoho token request failed: ${zohoErrorMessage(j)}`);
    err.zoho = j;
    err.status = r.status;
    throw err;
  }
  return j;
}

function applyTokenResponse(j) {
  accessToken = j.access_token;
  accessExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  lastFailAt = 0;
  lastFailMsg = null;
  failUntil = 0;
  hardInvalid = false;
  saveDiskCache();

  // Zoho may return a new refresh_token when the app uses refresh-token rotation
  if (j.refresh_token && j.refresh_token !== cfg.zoho.refreshToken) {
    cfg.zoho.refreshToken = j.refresh_token;
    try {
      persistEnvUpdates({ ZOHO_REFRESH_TOKEN: j.refresh_token });
    } catch (e) {
      console.warn('[zoho] could not write rotated refresh token:', e.message);
    }
  }
  return accessToken;
}

function recordFailure(e) {
  lastFailAt = Date.now();
  lastFailMsg = e.message;
  const { hardInvalid: hard, backoffMs } = classifyFailure(e.zoho, e.message);
  hardInvalid = hard || hardInvalid;
  failUntil = Date.now() + backoffMs;
  clearDiskCache();
  console.warn(`[zoho] refresh failed; backoff ${Math.round(backoffMs / 1000)}s — ${e.message}`);
}

async function refreshAccessToken() {
  if (!cfg.zoho.refreshToken) {
    throw new Error('ZOHO_REFRESH_TOKEN is not set');
  }
  if (!cfg.zoho.clientId || !cfg.zoho.clientSecret) {
    throw new Error('ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET required');
  }
  if (Date.now() < failUntil) {
    const wait = Math.ceil((failUntil - Date.now()) / 1000);
    const err = new Error(
      (hardInvalid
        ? 'Zoho refresh token is invalid/revoked — exchange a new Self Client grant code. '
        : `Zoho token refresh cooling down (${wait}s). `)
      + (lastFailMsg ? `Last error: ${lastFailMsg}` : ''),
    );
    err.coolingDown = true;
    err.hardInvalid = hardInvalid;
    throw err;
  }

  try {
    const j = await tokenRequest({
      refresh_token: cfg.zoho.refreshToken,
      client_id: cfg.zoho.clientId,
      client_secret: cfg.zoho.clientSecret,
      grant_type: 'refresh_token',
    });
    return applyTokenResponse(j);
  } catch (e) {
    recordFailure(e);
    e.hardInvalid = hardInvalid;
    throw e;
  }
}

/**
 * One-time (or re-auth): exchange a Self Client / OAuth grant `code` for
 * access + refresh. Updates cfg + .env with ZOHO_REFRESH_TOKEN.
 *
 * Self Client (api-console): do not send redirect_uri.
 * Web app OAuth: set ZOHO_REDIRECT_URI to the registered redirect.
 */
export async function exchangeAuthCode(code, opts = {}) {
  if (!code) throw new Error('authorization code required');
  // Clear dead-token backoff so a fresh code can always be tried
  failUntil = 0;
  hardInvalid = false;
  lastFailMsg = null;

  const redirect = opts.redirectUri
    ?? (process.env.ZOHO_REDIRECT_URI || null);

  async function attempt(withRedirect) {
    const params = {
      code,
      client_id: cfg.zoho.clientId,
      client_secret: cfg.zoho.clientSecret,
      grant_type: 'authorization_code',
    };
    if (withRedirect && redirect) params.redirect_uri = redirect;
    const j = await tokenRequest(params);
    applyTokenResponse(j);
    if (j.refresh_token) {
      cfg.zoho.refreshToken = j.refresh_token;
      persistEnvUpdates({ ZOHO_REFRESH_TOKEN: j.refresh_token });
    }
    return {
      ok: true,
      expiresIn: j.expires_in,
      hasRefresh: Boolean(j.refresh_token),
    };
  }

  // Prefer Self Client exchange first (no redirect); then with redirect for browser apps.
  try {
    if (opts.preferRedirect && redirect) return await attempt(true);
    return await attempt(false);
  } catch (e1) {
    if (redirect && !opts.preferRedirect) {
      try {
        return await attempt(true);
      } catch (e2) {
        recordFailure(e2);
        throw e2;
      }
    }
    recordFailure(e1);
    throw e1;
  }
}

/**
 * Cached access token with proactive refresh (~60s before expiry).
 * Uses disk cache across process restarts.
 */
export async function getAccessToken({ force = false } = {}) {
  if (!force && accessToken && Date.now() < accessExp - 60_000) {
    return accessToken;
  }
  if (!force && !accessToken) loadDiskCache();
  if (!force && accessToken && Date.now() < accessExp - 60_000) {
    return accessToken;
  }
  if (!refreshInflight) {
    refreshInflight = refreshAccessToken()
      .finally(() => { refreshInflight = null; });
  }
  return refreshInflight;
}

/** Force-clear so the next call re-refreshes (e.g. after 401). */
export function invalidateAccessToken() {
  clearDiskCache();
}

async function zfetch(path, init = {}, { retried = false } = {}) {
  const t = await getAccessToken();
  const r = await fetch(`${cfg.zoho.apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${t}`,
      'ZANALYTICS-ORGID': cfg.zoho.orgId,
      ...init.headers,
    },
  });
  // Expired/revoked access token — refresh once and retry
  if ((r.status === 401 || r.status === 403) && !retried) {
    invalidateAccessToken();
    // Allow one forced refresh even mid-backoff for true 401
    failUntil = 0;
    await getAccessToken({ force: true });
    return zfetch(path, init, { retried: true });
  }
  if (!r.ok) throw new Error(`Zoho ${path} -> ${r.status} ${await r.text()}`);
  return r;
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/** Run a SQL SELECT against the workspace, return CSV text. */
export async function exportSql(sqlQuery, workspaceId) {
  const ws = workspaceId || cfg.zoho.workspaceId;
  const config = encodeURIComponent(JSON.stringify({ sqlQuery, responseFormat: 'csv' }));
  const create = await zfetch(`/restapi/v2/bulk/workspaces/${ws}/data?CONFIG=${config}`, { method: 'GET' });
  const { data } = await create.json();
  const jobId = data.jobId;
  // JOBCODEs: 1001 not started, 1002 running, 1003 error, 1004 done, 1005 not found
  for (let i = 0; i < 60; i++) {
    await sleep(3000);
    const st = await (await zfetch(`/restapi/v2/bulk/workspaces/${ws}/exportjobs/${jobId}`)).json();
    const code = String(st.data?.jobCode);
    if (code === '1004') break;
    if (code === '1003' || code === '1005') throw new Error(`Export job ${jobId} failed (${code})`);
    if (i === 59) throw new Error(`Export job ${jobId} timed out`);
  }
  const dl = await zfetch(`/restapi/v2/bulk/workspaces/${ws}/exportjobs/${jobId}/data`);
  return dl.text();
}

/**
 * Lightweight status for Admin UI — never hits Zoho unless a live token is already cached.
 * Use POST /zoho/refresh to attempt a network refresh on demand.
 */
export function zohoAuthStatus() {
  loadDiskCache();
  const hasRefresh = Boolean(cfg.zoho.refreshToken);
  const hasClient = Boolean(cfg.zoho.clientId && cfg.zoho.clientSecret);
  const accessValid = Boolean(accessToken && Date.now() < accessExp - 5_000);
  const coolingDown = Date.now() < failUntil;
  return {
    hasRefresh,
    hasClient,
    accessValid,
    accessExpiresAt: accessExp || null,
    accountsBase: cfg.zoho.accountsBase,
    needsReauth: hardInvalid || (Boolean(lastFailMsg) && /invalid_code|invalid.*grant|revoked/i.test(lastFailMsg || '')),
    coolingDown,
    coolDownSeconds: coolingDown ? Math.ceil((failUntil - Date.now()) / 1000) : 0,
    error: accessValid ? null : (lastFailMsg || (hasRefresh ? null : 'ZOHO_REFRESH_TOKEN not set')),
  };
}
