import express                from 'express';
import session               from 'express-session';
import { randomBytes }       from 'node:crypto';
import { join, dirname }     from 'node:path';
import { fileURLToPath }     from 'node:url';
import { sseHandler }        from './sse.js';
import { initScheduler }     from './scheduler.js';
import monitorsRouter        from './routes/monitors.js';
import settingsRouter        from './routes/settings.js';
import alertsRouter          from './routes/alerts.js';
import moduleInstancesRouter from './routes/module-instances.js';
import toolsRouter           from './routes/tools.js';
import keysRouter            from './routes/keys.js';
import configRouter          from './routes/config.js';
import oauthRouter           from './routes/oauth.js';
import v1Router              from './routes/v1.js';
import groupsRouter          from './routes/groups.js';
import maintenanceRouter     from './routes/maintenance.js';
import reportsRouter         from './routes/reports.js';
import authRouter            from './routes/auth.js';
import publicRouter          from './routes/public.js';
import { requireSession }    from './middleware/requireSession.js';
import { BetterSqliteStore } from './db/sqlite-session-store.js';
import { loadModules, registry }    from './modules/registry.js';
import { initReportScheduler }       from './report-scheduler.js';
import { getSetting, setSetting }    from './db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 3000;

// ── Session secret ────────────────────────────────────────────────────────────
function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
    console.warn('[auth] SESSION_SECRET not set — generated a random secret stored in DB.');
    console.warn('[auth] Set SESSION_SECRET env var to pin a stable secret.');
  }
  return secret;
}

// ── Session expiry ────────────────────────────────────────────────────────────
function getSessionMaxAge() {
  const days = parseInt(getSetting('session_expiry_days', '30'), 10);
  return (Number.isFinite(days) && days > 0 ? days : 30) * 24 * 60 * 60 * 1000;
}

const app = express();

// Trust proxy headers (needed so secure cookies work behind nginx/Caddy/etc.)
app.set('trust proxy', 1);

app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Session middleware ────────────────────────────────────────────────────────
const sessionStore = new BetterSqliteStore();

app.use(session({
  store:             sessionStore,
  secret:            getSessionSecret(),
  name:              'nw.sid',
  resave:            false,
  saveUninitialized: false,
  rolling:           true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   getSessionMaxAge(),
  },
}));

// Clean up expired sessions every 15 minutes
setInterval(() => sessionStore.cleanup(), 15 * 60 * 1000);

// Static frontend
const PUBLIC_DIR = join(__dirname, '../public');
app.use(express.static(PUBLIC_DIR));

// ── Public routes — no auth required ─────────────────────────────────────────
app.use('/api/auth',   authRouter);
app.use('/api/public', publicRouter);

// Reject non-JSON content type on mutating requests
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.startsWith('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
});

// ── Load modules ──────────────────────────────────────────────────────────────
await loadModules();

for (const [id, def] of registry) {
  if (def.router) {
    app.use(`/api/modules/${id}`, def.router);
    console.log(`[modules] routes mounted: /api/modules/${id}`);
  }
}

// ── Protected API — session required ─────────────────────────────────────────
// /api/v1 has its own requireApiKey middleware; exclude it from session gate.
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/v1')) return next(); // api key auth handles it
  requireSession(req, res, next);
});

app.get('/api/events',          sseHandler);
app.use('/api/monitors',         monitorsRouter);
app.use('/api/settings',         settingsRouter);
app.use('/api/alerts',           alertsRouter);
app.use('/api/module-instances', moduleInstancesRouter);
app.use('/api/tools',            toolsRouter);
app.use('/api/keys',             keysRouter);
app.use('/api/config',           configRouter);
app.use('/api/oauth',            oauthRouter);
app.use('/api/v1',               v1Router);
app.use('/api/groups',           groupsRouter);
app.use('/api/maintenance',      maintenanceRouter);
app.use('/api/reports',          reportsRouter);

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[netwatch] server listening on http://localhost:${PORT}`);
  initScheduler();
  initReportScheduler();
});
