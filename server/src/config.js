import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';

function optional(k) {
  return process.env[k] || '';
}

function required(k) {
  const v = process.env[k];
  if (!v) {
    if (isProd) {
      console.error(`[config] FATAL: ${k} is required in production`);
      process.exit(1);
    }
    console.warn(`[config] ${k} not set`);
  }
  return v || '';
}

export const cfg = {
  isProd,
  port: Number(process.env.PORT || 4000),
  dbUrl: required('DATABASE_URL'),
  /** Optional comma-separated origins; empty = allow any origin (dev). */
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** When set, serve built SPA from this directory (production). */
  webDist: process.env.WEB_DIST || '',
  dbSsl: process.env.DATABASE_SSL === '1' || process.env.DATABASE_SSL === 'true',
  zoho: {
    accountsBase: process.env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.in',
    apiBase: process.env.ZOHO_ANALYTICS_BASE || 'https://analyticsapi.zoho.in',
    clientId: optional('ZOHO_CLIENT_ID'),
    clientSecret: optional('ZOHO_CLIENT_SECRET'),
    refreshToken: optional('ZOHO_REFRESH_TOKEN'),
    orgId: process.env.ZOHO_ORG_ID || '60041938002',
    workspaceId: process.env.ZOHO_WORKSPACE_ID || '441267000002068095',
    fsmWorkspaceId: process.env.ZOHO_FSM_WORKSPACE_ID || '441267000003723011',
    redirectUri: optional('ZOHO_REDIRECT_URI'),
    /** Server-based OAuth client for Maps sign-in (falls back to ZOHO_CLIENT_*). */
    loginClientId: optional('ZOHO_LOGIN_CLIENT_ID'),
    loginClientSecret: optional('ZOHO_LOGIN_CLIENT_SECRET'),
    loginRedirectUri: process.env.ZOHO_LOGIN_REDIRECT_URI || '',
  },
  geocoder: process.env.GEOCODER || 'google',
  olaKey: process.env.OLAMAPS_API_KEY,
  googleKey: process.env.GOOGLE_MAPS_API_KEY,
  /** Shared secret still used to bootstrap the first admin (and HMAC fallback). */
  appPassword: process.env.APP_PASSWORD || '',
  /**
   * Optional second secret for Admin mutations from scripts (X-Admin-Token).
   * Browser admins use their logged-in account instead.
   */
  adminToken: process.env.ADMIN_TOKEN || '',
  /** HMAC secret for session tokens (defaults to APP_PASSWORD). */
  sessionSecret: process.env.SESSION_SECRET || '',
  /** Comma-separated emails that are always treated as admin. */
  adminEmails: process.env.ADMIN_EMAILS || '',
  /** First admin created when app_accounts is empty. */
  bootstrapAdminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL || '',
  bootstrapAdminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD || '',
};

// Prefer APP_PASSWORD; fall back to ADMIN_TOKEN only if APP_PASSWORD empty (legacy)
if (!cfg.appPassword && cfg.adminToken) {
  cfg.appPassword = cfg.adminToken;
  console.warn('[config] ADMIN_TOKEN is deprecated as app gate — prefer APP_PASSWORD + optional separate ADMIN_TOKEN for admin writes');
}

if (!cfg.sessionSecret) {
  cfg.sessionSecret = cfg.appPassword || 'dev-open';
}

if (isProd && !cfg.appPassword) {
  console.error('[config] FATAL: APP_PASSWORD is required when NODE_ENV=production');
  process.exit(1);
}

if (isProd && !cfg.googleKey) {
  console.warn('[config] GOOGLE_MAPS_API_KEY not set — basemap/geocoding limited');
}
