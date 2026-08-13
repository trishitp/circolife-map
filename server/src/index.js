import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.js';
import { auth, requireAuth, requireAdmin } from './auth.js';
import { ensureBootstrapAdmin } from './accounts.js';
import { layers } from './routes/layers.js';
import { meta } from './routes/meta.js';
import { gaps } from './routes/gaps.js';
import { admin } from './routes/admin.js';
import { discrepancies } from './routes/discrepancies.js';
import { activity } from './routes/activity.js';
import { routes as routePlanning, routesShare } from './routes/routes.js';
import { coverage } from './routes/coverage.js';

const app = express();
app.set('trust proxy', 1);

function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowed = cfg.corsOrigins;
  if (!allowed.length) {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (origin && allowed.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-App-Token, X-Admin-Token');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
}

app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '5mb' }));

app.get('/healthz', async (_req, res) => {
  try {
    const { pool } = await import('./db.js');
    await pool.query('SELECT 1');
    res.json({
      ok: true,
      auth: Boolean(cfg.appPassword),
      time: new Date().toISOString(),
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message || 'db unavailable' });
  }
});

app.use('/api/auth', auth);

// Public RM share view (token in URL; no app password)
app.use('/api/routes/share', routesShare);

// All other data APIs require session when APP_PASSWORD is set
app.use('/api', requireAuth);
app.use('/api/layers', layers);
app.use('/api/meta', meta);
app.use('/api/gaps', gaps);
app.use('/api/discrepancies', discrepancies);
app.use('/api/activity', activity);
app.use('/api/routes', routePlanning);
app.use('/api/coverage', coverage);
app.use('/api/admin', requireAdmin, admin);

// Optional production SPA (set WEB_DIST or use default ../web/dist)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distCandidates = [
  cfg.webDist,
  path.resolve(__dirname, '../../web/dist'),
  path.resolve(process.cwd(), '../web/dist'),
  path.resolve(process.cwd(), 'web/dist'),
].filter(Boolean);

const webDist = distCandidates.find((d) => {
  try {
    return fs.existsSync(path.join(d, 'index.html'));
  } catch {
    return false;
  }
});

if (webDist) {
  console.log(`[static] serving SPA from ${webDist}`);
  app.use(express.static(webDist, { index: false, maxAge: cfg.isProd ? '1h' : 0 }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/healthz') return next();
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) next();
    });
  });
}

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  if (cfg.isProd) process.exit(1);
});

app.listen(cfg.port, async () => {
  const boot = await ensureBootstrapAdmin();
  console.log(
    `circolife-maps api on :${cfg.port}`
    + `${cfg.appPassword || boot.count ? ' (auth on)' : ' (auth open)'}`
    + `${webDist ? ' + spa' : ''}`,
  );
});
