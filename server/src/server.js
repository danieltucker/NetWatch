import express                from 'express';
import { join, dirname }      from 'node:path';
import { fileURLToPath }      from 'node:url';
import { sseHandler }         from './sse.js';
import { initScheduler }      from './scheduler.js';
import monitorsRouter         from './routes/monitors.js';
import settingsRouter         from './routes/settings.js';
import alertsRouter           from './routes/alerts.js';
import moduleInstancesRouter  from './routes/module-instances.js';
import toolsRouter            from './routes/tools.js';
import keysRouter             from './routes/keys.js';
import oauthRouter            from './routes/oauth.js';
import v1Router               from './routes/v1.js';
import groupsRouter           from './routes/groups.js';
import maintenanceRouter      from './routes/maintenance.js';
import { loadModules, registry } from './modules/registry.js';
import { initReportScheduler }  from './report-scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = process.env.PORT ?? 3000;

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Static frontend (built by `npm run build` at repo root → dist/ → copied to server/public/)
const PUBLIC_DIR = join(__dirname, '../public');
app.use(express.static(PUBLIC_DIR));

// Reject mutating API requests that don't declare JSON content-type (CSRF mitigation)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] ?? '';
    if (!ct.startsWith('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
  }
  next();
});

// ── Load modules (async dynamic imports) ──────────────────────────────────────
await loadModules();

// Mount per-module routers at /api/modules/:moduleId/...
for (const [id, def] of registry) {
  if (def.router) {
    app.use(`/api/modules/${id}`, def.router);
    console.log(`[modules] routes mounted: /api/modules/${id}`);
  }
}

// ── API ───────────────────────────────────────────────────────────────────────

app.get('/api/events',          sseHandler);
app.use('/api/monitors',         monitorsRouter);
app.use('/api/settings',         settingsRouter);
app.use('/api/alerts',           alertsRouter);
app.use('/api/module-instances', moduleInstancesRouter);
app.use('/api/tools',            toolsRouter);
app.use('/api/keys',             keysRouter);
app.use('/api/oauth',            oauthRouter);
app.use('/api/v1',               v1Router);
app.use('/api/groups',           groupsRouter);
app.use('/api/maintenance',      maintenanceRouter);

// Fallback: let the React router handle all non-API paths
app.get('*', (_req, res) => {
  res.sendFile(join(PUBLIC_DIR, 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[netwatch] server listening on http://localhost:${PORT}`);
  initScheduler();
  initReportScheduler();
});
