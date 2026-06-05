import { Router }                       from 'express';
import { randomUUID }                   from 'node:crypto';
import { db, rowToMonitor }             from '../db/index.js';
import { scheduleMonitor, stopMonitor,
         executeCheck }                 from '../scheduler.js';
import { broadcast }                    from '../sse.js';

const router = Router();

const ALLOWED_CHECK_TYPES = new Set(['http', 'tcp', 'icmp', 'api']);
const MIN_INTERVAL_S = 30;

// ── Window config ─────────────────────────────────────────────────────────────
// ms: lookback span in milliseconds — used to compute an ISO cutoff in JS.
// bucketMinutes: null = return raw points; number = aggregate into N-min buckets
//
// NOTE: checked_at is stored as an ISO-8601 UTC string (new Date().toISOString(),
// e.g. '2026-06-05T08:46:19.000Z'). We must NOT compare it against SQLite's
// datetime('now', ...) which yields a space-separated form ('2026-06-05 08:46:19').
// SQLite does a lexical TEXT comparison, and the 'T' (0x54) vs ' ' (0x20) at index
// 10 makes every same-date row sort "greater", so the time-of-day filter is ignored
// and all windows return the same rows. Instead we bind a JS-computed ISO cutoff so
// the comparison is ISO-vs-ISO (lexically == chronologically for UTC).

const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const WINDOWS = {
  '15m': { ms: 15 * MIN, bucketMinutes: null },
  '1h':  { ms: HOUR,     bucketMinutes: null },
  '6h':  { ms: 6 * HOUR, bucketMinutes: null },
  '12h': { ms: 12 * HOUR, bucketMinutes: 15   },
  '1d':  { ms: DAY,       bucketMinutes: 60   },
  '1w':  { ms: 7 * DAY,   bucketMinutes: 360  },
  '30d': { ms: 30 * DAY,  bucketMinutes: 1440 },
};

// ── Bucket helper (shared by preset + custom range paths) ─────────────────────

function bucketRows(rows, bucketMinutes) {
  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets  = new Map();

  for (const r of rows) {
    const ts   = new Date(r.checked_at).getTime();
    const bKey = Math.floor(ts / bucketMs) * bucketMs;
    if (!buckets.has(bKey)) buckets.set(bKey, { ts: bKey, pings: [], statuses: [] });
    const b = buckets.get(bKey);
    if (r.total_ms != null) b.pings.push(r.total_ms);
    b.statuses.push(r.status);
  }

  return [...buckets.values()]
    .sort((a, b) => a.ts - b.ts)
    .map(b => ({
      timestamp:  new Date(b.ts).toISOString(),
      ping:       b.pings.length
        ? Math.round(b.pings.reduce((s, v) => s + v, 0) / b.pings.length)
        : null,
      status:     b.statuses.some(s => s === 'down') ? 'down' : 'up',
      aggregated: true,
      uptimePct:  b.statuses.length
        ? Math.round((b.statuses.filter(s => s === 'up').length / b.statuses.length) * 100)
        : 100,
    }));
}

function rowsToRaw(rows) {
  return rows.map(r => ({
    timestamp:  r.checked_at,
    ping:       r.total_ms,
    status:     r.status,
    dnsMs:      r.dns_ms,
    tcpMs:      r.tcp_ms,
    tlsMs:      r.tls_ms,
    ttfbMs:     r.ttfb_ms,
    httpStatus: r.http_status,
    certDays:   r.cert_days,
    error:      r.error,
  }));
}

// ── Windowed history query ────────────────────────────────────────────────────
// Accepts either a preset window key OR explicit from/to ISO timestamps.
// When from+to are provided they take precedence; bucket size is auto-selected
// from the span so the sparkline stays readable at any zoom level.

function getWindowedHistory(monitorId, window, from = null, to = null) {
  const historyQuery = db.prepare(`
    SELECT checked_at, status, total_ms, dns_ms, tcp_ms, tls_ms,
           ttfb_ms, http_status, cert_days, error
    FROM   check_history
    WHERE  monitor_id = ? AND checked_at >= ? AND checked_at <= ?
    ORDER  BY checked_at ASC
  `);

  if (from && to) {
    const rows   = historyQuery.all(monitorId, from, to);
    const spanH  = (new Date(to) - new Date(from)) / (1000 * 60 * 60);
    // Auto-select bucket granularity from the requested span
    const bucketMinutes =
      spanH <= 6   ? null :
      spanH <= 24  ? 15   :
      spanH <= 168 ? 60   : 360;

    return bucketMinutes ? bucketRows(rows, bucketMinutes) : rowsToRaw(rows);
  }

  const cfg       = WINDOWS[window] ?? WINDOWS['1h'];
  const cutoffIso = new Date(Date.now() - cfg.ms).toISOString();
  const rows = db.prepare(`
    SELECT checked_at, status, total_ms, dns_ms, tcp_ms, tls_ms,
           ttfb_ms, http_status, cert_days, error
    FROM   check_history
    WHERE  monitor_id = ? AND checked_at >= ?
    ORDER  BY checked_at ASC
  `).all(monitorId, cutoffIso);

  return cfg.bucketMinutes ? bucketRows(rows, cfg.bucketMinutes) : rowsToRaw(rows);
}

// ── Build full monitor payload ─────────────────────────────────────────────────

function buildMonitorPayload(id, window = '1h', from = null, to = null) {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
  if (!row) return null;

  const monitor = rowToMonitor(row);
  if (monitor.authPass)  monitor.authPass  = '***';
  if (monitor.authToken) monitor.authToken = '***';
  // Parse alertConfig so the frontend gets a JS object, not a raw string
  let alertConfig = {};
  try { alertConfig = JSON.parse(monitor.alertConfig || '{}'); } catch {}
  monitor.alertConfig = alertConfig;
  const history = getWindowedHistory(id, window, from, to);

  // Uptime% calculated from the windowed/custom history
  const upCount       = history.filter(r => r.status === 'up').length;
  const uptimePercent = history.length
    ? Math.round((upCount / history.length) * 1000) / 10
    : 100;

  // Always use the most recent raw check for current ping, last-checked, and
  // the timing breakdown row shown beneath the card header
  const latestRaw = db.prepare(`
    SELECT checked_at, status, total_ms, dns_ms, tcp_ms, tls_ms,
           ttfb_ms, http_status, cert_days, error
    FROM   check_history
    WHERE  monitor_id = ?
    ORDER  BY checked_at DESC
    LIMIT  1
  `).get(id);

  return {
    ...monitor,
    status:        latestRaw?.status      ?? 'pending',
    currentPing:   latestRaw?.total_ms    ?? null,
    uptimePercent,
    lastChecked:   latestRaw?.checked_at  ?? null,
    historyWindow: from ? 'custom' : window,
    latest: latestRaw ? {
      dnsMs:      latestRaw.dns_ms,
      tcpMs:      latestRaw.tcp_ms,
      tlsMs:      latestRaw.tls_ms,
      ttfbMs:     latestRaw.ttfb_ms,
      totalMs:    latestRaw.total_ms,
      httpStatus: latestRaw.http_status,
      certDays:   latestRaw.cert_days,
      error:      latestRaw.error ?? null,
    } : null,
    history,
  };
}

// ── GET /api/monitors ─────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const window = WINDOWS[req.query.window] ? req.query.window : '1h';
  const from   = req.query.from || null;
  const to     = req.query.to   || null;
  const ids    = db.prepare('SELECT id FROM monitors ORDER BY created_at ASC').all();
  res.json(ids.map(r => buildMonitorPayload(r.id, window, from, to)));
});

// ── GET /api/monitors/:id ─────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const window  = WINDOWS[req.query.window] ? req.query.window : '1h';
  const from    = req.query.from || null;
  const to      = req.query.to   || null;
  const payload = buildMonitorPayload(req.params.id, window, from, to);
  if (!payload) return res.status(404).json({ error: 'Monitor not found' });
  res.json(payload);
});

// ── POST /api/monitors ────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const {
    label, target, description = '', interval = 60,
    alertTypes = ['None'], tags = [], checkType = 'http', port,
    degradedThreshold, alertConfig = {}, bodyMatch,
    expectedStatus, jsonPath, jsonExpected,
    authType, authUser, authPass, authToken, requestHeaders = [],
  } = req.body;

  if (!target?.trim()) return res.status(400).json({ error: '`target` is required' });

  const parsedInterval = Number(interval);
  if (!Number.isInteger(parsedInterval) || parsedInterval < MIN_INTERVAL_S) {
    return res.status(400).json({ error: `\`interval\` must be an integer ≥ ${MIN_INTERVAL_S} seconds` });
  }

  if (!ALLOWED_CHECK_TYPES.has(checkType)) {
    return res.status(400).json({ error: `Invalid \`checkType\`; must be one of: ${[...ALLOWED_CHECK_TYPES].join(', ')}` });
  }

  const id = randomUUID();

  db.prepare(`
    INSERT INTO monitors
      (id, label, target, description, interval, alert_types, tags, check_type, port,
       degraded_threshold, alert_config, body_match,
       expected_status, json_path, json_expected,
       auth_type, auth_user, auth_pass, auth_token, request_headers,
       created_at)
    VALUES
      (@id, @label, @target, @description, @interval, @alertTypes, @tags, @checkType, @port,
       @degradedThreshold, @alertConfig, @bodyMatch,
       @expectedStatus, @jsonPath, @jsonExpected,
       @authType, @authUser, @authPass, @authToken, @requestHeaders,
       @createdAt)
  `).run({
    id,
    label:             (label || target).trim(),
    target:            target.trim(),
    description:       description.trim(),
    interval,
    alertTypes:        JSON.stringify(alertTypes),
    tags:              JSON.stringify(tags),
    checkType,
    port:              port ?? null,
    degradedThreshold: degradedThreshold ?? null,
    alertConfig:       JSON.stringify(alertConfig),
    bodyMatch:         bodyMatch?.trim() || null,
    expectedStatus:    expectedStatus ?? null,
    jsonPath:          jsonPath?.trim() || null,
    jsonExpected:      jsonExpected?.trim() || null,
    authType:          authType || null,
    authUser:          authUser?.trim() || null,
    authPass:          authPass?.trim() || null,
    authToken:         authToken?.trim() || null,
    requestHeaders:    JSON.stringify(requestHeaders),
    createdAt:         new Date().toISOString(),
  });

  scheduleMonitor(id, interval);

  const payload = buildMonitorPayload(id);
  broadcast('monitor:created', payload);
  res.status(201).json(payload);
});

// ── PUT /api/monitors/:id ─────────────────────────────────────────────────────

function applyCredential(incoming, existing) {
  if (incoming === '***') return existing;
  if (incoming !== undefined) return incoming?.trim() || null;
  return existing;
}

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Monitor not found' });

  const {
    label, target, description, interval,
    alertTypes, tags, checkType, port,
    degradedThreshold, alertConfig, bodyMatch,
    expectedStatus, jsonPath, jsonExpected,
    authType, authUser, authPass, authToken, requestHeaders,
  } = req.body;

  if (interval !== undefined) {
    const parsedInterval = Number(interval);
    if (!Number.isInteger(parsedInterval) || parsedInterval < MIN_INTERVAL_S) {
      return res.status(400).json({ error: `\`interval\` must be an integer ≥ ${MIN_INTERVAL_S} seconds` });
    }
  }

  if (checkType !== undefined && !ALLOWED_CHECK_TYPES.has(checkType)) {
    return res.status(400).json({ error: `Invalid \`checkType\`; must be one of: ${[...ALLOWED_CHECK_TYPES].join(', ')}` });
  }

  const next = {
    label:             label             ?? existing.label,
    target:            target            ?? existing.target,
    description:       description       ?? existing.description,
    interval:          interval          ?? existing.interval,
    alertTypes:        JSON.stringify(alertTypes    ?? JSON.parse(existing.alert_types)),
    tags:              JSON.stringify(tags          ?? JSON.parse(existing.tags)),
    checkType:         checkType         ?? existing.check_type,
    port:              port              ?? existing.port,
    degradedThreshold: degradedThreshold !== undefined ? (degradedThreshold ?? null) : existing.degraded_threshold,
    alertConfig:       JSON.stringify(alertConfig   ?? JSON.parse(existing.alert_config ?? '{}')),
    bodyMatch:         bodyMatch         !== undefined ? (bodyMatch?.trim()     || null) : existing.body_match,
    expectedStatus:    expectedStatus    !== undefined ? (expectedStatus        ?? null) : existing.expected_status,
    jsonPath:          jsonPath          !== undefined ? (jsonPath?.trim()      || null) : existing.json_path,
    jsonExpected:      jsonExpected      !== undefined ? (jsonExpected?.trim()  || null) : existing.json_expected,
    authType:          authType          !== undefined ? (authType              || null) : existing.auth_type,
    authUser:          authUser          !== undefined ? (authUser?.trim()      || null) : existing.auth_user,
    authPass:          applyCredential(authPass,  existing.auth_pass),
    authToken:         applyCredential(authToken, existing.auth_token),
    requestHeaders:    requestHeaders    !== undefined ? JSON.stringify(requestHeaders) : (existing.request_headers ?? '[]'),
  };

  db.prepare(`
    UPDATE monitors SET
      label = @label, target = @target, description = @description,
      interval = @interval, alert_types = @alertTypes, tags = @tags,
      check_type = @checkType, port = @port,
      degraded_threshold = @degradedThreshold, alert_config = @alertConfig,
      body_match = @bodyMatch,
      expected_status = @expectedStatus, json_path = @jsonPath,
      json_expected = @jsonExpected, auth_type = @authType,
      auth_user = @authUser, auth_pass = @authPass, auth_token = @authToken,
      request_headers = @requestHeaders
    WHERE id = @id
  `).run({ ...next, id });

  scheduleMonitor(id, next.interval);

  const payload = buildMonitorPayload(id);
  broadcast('monitor:updated', payload);
  res.json(payload);
});

// ── DELETE /api/monitors/:id ──────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM monitors WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  stopMonitor(id);
  db.prepare('DELETE FROM monitors WHERE id = ?').run(id);
  broadcast('monitor:deleted', { id });

  res.status(204).end();
});

// ── POST /api/monitors/:id/check — manual trigger ─────────────────────────────

router.post('/:id/check', async (req, res) => {
  const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Monitor not found' });

  const result = await executeCheck(rowToMonitor(row));
  res.json(result);
});

export default router;
