/**
 * Generate ZOHO_REFRESH_TOKEN from client id/secret via browser OAuth
 * (or a pasted Self Client grant code).
 *
 * Prerequisite for browser flow (Zoho API Console → this client):
 *   Add Authorized Redirect URI: http://localhost:4300/callback
 *
 * Usage:
 *   npm run zoho:oauth
 *   npm run zoho:oauth -- --code=1000.xxxxx
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import 'dotenv/config';
import { exchangeAuthCode, zohoAuthStatus } from '../src/zoho/analyticsClient.js';
import { cfg } from '../src/config.js';

const PORT = Number(process.env.ZOHO_OAUTH_PORT || 4300);
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI || `http://localhost:${PORT}/callback`;
const SCOPE = process.env.ZOHO_OAUTH_SCOPE
  || 'ZohoAnalytics.fullaccess.all';

const codeArg = process.argv.find((a) => a.startsWith('--code='));
const pasteCode = codeArg ? codeArg.slice('--code='.length).trim() : null;

function openBrowser(url) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
}

async function finish(code, preferRedirect) {
  const r = await exchangeAuthCode(code, {
    redirectUri: REDIRECT_URI,
    preferRedirect: Boolean(preferRedirect),
  });
  console.log(JSON.stringify({ ok: true, exchanged: r, status: zohoAuthStatus() }, null, 2));
  if (!r.hasRefresh) {
    console.warn('\nNo refresh_token returned. Re-consent with access_type=offline.');
  } else {
    console.log('\nSaved ZOHO_REFRESH_TOKEN to .env — restart API if needed.');
  }
  process.exit(0);
}

if (!cfg.zoho.clientId || !cfg.zoho.clientSecret) {
  console.error('ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

if (pasteCode) {
  try {
    // Try Self Client (no redirect) then browser redirect
    await finish(pasteCode, false);
  } catch (e) {
    console.error(e.message);
    if (e.zoho) console.error(JSON.stringify(e.zoho, null, 2));
    process.exit(1);
  }
}

const authUrl = new URL('/oauth/v2/auth', cfg.zoho.accountsBase);
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('client_id', cfg.zoho.clientId);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('prompt', 'consent');

console.log('Circolife Maps — Zoho OAuth');
console.log('Client:   ', cfg.zoho.clientId);
console.log('Redirect: ', REDIRECT_URI);
console.log('Scope:    ', SCOPE);
console.log('');
console.log('In Zoho API Console for this client, set Authorized Redirect URI to:');
console.log(`  ${REDIRECT_URI}`);
console.log('');
console.log(authUrl.toString());
console.log('');

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    if (u.pathname !== '/callback') {
      res.writeHead(404); res.end('Not found'); return;
    }
    const err = u.searchParams.get('error');
    const code = u.searchParams.get('code');
    if (err) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h1>OAuth error</h1><pre>${err}</pre>`);
      console.error('OAuth error:', err);
      process.exit(1);
    }
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('<h1>Missing code</h1>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Connected</h1><p>Close this tab and return to the terminal.</p>');
    console.log('Authorization code received — exchanging for refresh token…');
    server.close();
    await finish(code, true);
  } catch (e) {
    console.error(e.message);
    if (e.zoho) console.error(JSON.stringify(e.zoho, null, 2));
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Waiting on ${REDIRECT_URI}`);
  console.log('Browser opening… (or paste a Self Client grant code + Enter)');
  openBrowser(authUrl.toString());
});

process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', async (chunk) => {
  buf += chunk;
  if (!buf.includes('\n') && !buf.includes('\r')) return;
  const line = buf.trim();
  buf = '';
  if (!line || line.length < 8) return;
  console.log('Pasted code — exchanging…');
  try {
    server.close();
    await finish(line, false);
  } catch (e) {
    console.error(e.message);
    if (e.zoho) console.error(JSON.stringify(e.zoho, null, 2));
    process.exit(1);
  }
});
