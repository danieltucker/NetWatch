import { Router }        from 'express';
import { db, rowToMonitor } from '../db/index.js';
import { requireApiKey }  from '../middleware/apiKeyAuth.js';

const router = Router();

router.use(requireApiKey);

// NOTE: check_history.checked_at is stored as ISO-8601 UTC ('...T...Z'). When
// filtering by a time window we use strftime('%Y-%m-%dT%H:%M:%fZ', 'now', <span>)
// so the comparison value matches that exact format — NOT datetime('now', ...),
// which yields a space-separated form and breaks the lexical TEXT comparison.

// ── GET /api/v1/monitors ──────────────────────────────────────────────────────

router.get('/monitors', (_req, res) => {
  const rows = db.prepare('SELECT * FROM monitors ORDER BY created_at ASC').all();

  const result = rows.map(row => {
    const m = rowToMonitor(row);
    // Mask credentials
    if (m.authPass)  m.authPass  = '***';
    if (m.authToken) m.authToken = '***';

    const latest = db.prepare(`
      SELECT status, total_ms, checked_at FROM check_history
      WHERE  monitor_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(m.id);

    const upCount = db.prepare(`
      SELECT COUNT(*) AS n FROM check_history
      WHERE  monitor_id = ? AND status = 'up'
        AND  checked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    `).get(m.id)?.n ?? 0;
    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM check_history
      WHERE  monitor_id = ? AND checked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    `).get(m.id)?.n ?? 0;

    return {
      ...m,
      status:        latest?.status    ?? 'pending',
      currentPing:   latest?.total_ms  ?? null,
      lastChecked:   latest?.checked_at ?? null,
      uptimePercent: total ? Math.round((upCount / total) * 1000) / 10 : 100,
    };
  });

  res.json(result);
});

// ── GET /api/v1/monitors/:id ──────────────────────────────────────────────────

router.get('/monitors/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Monitor not found' });

  const m = rowToMonitor(row);
  if (m.authPass)  m.authPass  = '***';
  if (m.authToken) m.authToken = '***';

  const latest = db.prepare(`
    SELECT status, total_ms, checked_at FROM check_history
    WHERE  monitor_id = ? ORDER BY checked_at DESC LIMIT 1
  `).get(m.id);

  const history = db.prepare(`
    SELECT checked_at, status, total_ms, dns_ms, tcp_ms, tls_ms,
           ttfb_ms, http_status, cert_days, error
    FROM   check_history WHERE monitor_id = ?
    ORDER  BY checked_at DESC LIMIT 100
  `).all(m.id).reverse();

  const upCount = history.filter(r => r.status === 'up').length;

  res.json({
    ...m,
    status:        latest?.status    ?? 'pending',
    currentPing:   latest?.total_ms  ?? null,
    lastChecked:   latest?.checked_at ?? null,
    uptimePercent: history.length ? Math.round((upCount / history.length) * 1000) / 10 : 100,
    history: history.map(r => ({
      timestamp:  r.checked_at,
      status:     r.status,
      ping:       r.total_ms,
      dnsMs:      r.dns_ms,
      tcpMs:      r.tcp_ms,
      tlsMs:      r.tls_ms,
      ttfbMs:     r.ttfb_ms,
      httpStatus: r.http_status,
      certDays:   r.cert_days,
      error:      r.error,
    })),
  });
});

// ── GET /api/v1/summary ───────────────────────────────────────────────────────

router.get('/summary', (_req, res) => {
  const monitors = db.prepare('SELECT id FROM monitors').all();

  let up = 0, down = 0, pending = 0, pingSum = 0, pingCount = 0;

  for (const { id } of monitors) {
    const latest = db.prepare(`
      SELECT status, total_ms FROM check_history
      WHERE  monitor_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(id);

    if (!latest)              { pending++; continue; }
    if (latest.status === 'up')   { up++; }
    else                          { down++; }
    if (latest.total_ms != null)  { pingSum += latest.total_ms; pingCount++; }
  }

  res.json({
    total:      monitors.length,
    up,
    down,
    pending,
    avgPingMs:  pingCount ? Math.round(pingSum / pingCount) : null,
  });
});

// ── GET /api/v1/metrics (Prometheus exposition format) ────────────────────────

router.get('/metrics', (_req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors ORDER BY created_at ASC').all();
  const lines    = [];

  lines.push('# HELP watchtower_up 1 if the monitor is currently up, 0 if down');
  lines.push('# TYPE watchtower_up gauge');
  lines.push('# HELP watchtower_ping_ms Latest ping in milliseconds');
  lines.push('# TYPE watchtower_ping_ms gauge');
  lines.push('# HELP watchtower_uptime_percent Uptime % over the last 24 hours');
  lines.push('# TYPE watchtower_uptime_percent gauge');

  for (const row of monitors) {
    const m = rowToMonitor(row);
    const label  = m.label.replace(/["\\\n]/g, c => `\\${c}`);
    const target = m.target.replace(/["\\\n]/g, c => `\\${c}`);
    const tags   = `id="${m.id}",label="${label}",target="${target}",type="${m.checkType}"`;

    const latest = db.prepare(`
      SELECT status, total_ms FROM check_history
      WHERE  monitor_id = ? ORDER BY checked_at DESC LIMIT 1
    `).get(m.id);

    const upVal  = !latest ? 'NaN' : latest.status === 'up' ? '1' : '0';
    const pingVal = latest?.total_ms != null ? String(latest.total_ms) : 'NaN';

    const upCount = db.prepare(`
      SELECT COUNT(*) AS n FROM check_history
      WHERE  monitor_id = ? AND status = 'up'
        AND  checked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    `).get(m.id)?.n ?? 0;
    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM check_history
      WHERE  monitor_id = ? AND checked_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
    `).get(m.id)?.n ?? 0;
    const uptimeVal = total ? String(Math.round((upCount / total) * 1000) / 10) : 'NaN';

    lines.push(`watchtower_up{${tags}} ${upVal}`);
    lines.push(`watchtower_ping_ms{${tags}} ${pingVal}`);
    lines.push(`watchtower_uptime_percent{${tags}} ${uptimeVal}`);
  }

  lines.push('');
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n'));
});

export default router;
