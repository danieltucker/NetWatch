/**
 * Public read-only routes for embed views — no authentication required.
 * Returns a safe field subset: no target, authUser, requestHeaders, or error messages.
 */
import { Router } from 'express';
import { db }     from '../db/index.js';
import { publicSseHandler } from '../sse.js';

const router = Router();

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const WINDOWS = {
  '15m': { ms: 15 * MIN, bucketMinutes: null },
  '1h':  { ms: HOUR,     bucketMinutes: null },
  '6h':  { ms: 6 * HOUR, bucketMinutes: null },
  '12h': { ms: 12 * HOUR, bucketMinutes: 15  },
  '1d':  { ms: DAY,       bucketMinutes: 60  },
};

function bucketRows(rows, bucketMinutes) {
  const bucketMs = bucketMinutes * 60_000;
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
      timestamp: new Date(b.ts).toISOString(),
      ping:      b.pings.length ? Math.round(b.pings.reduce((s, v) => s + v, 0) / b.pings.length) : null,
      status:    b.statuses.some(s => s === 'down') ? 'down' : 'up',
    }));
}

function buildPublicPayload(id, window = '1h') {
  const row = db.prepare('SELECT id, label FROM monitors WHERE id = ?').get(id);
  if (!row) return null;

  const cfg       = WINDOWS[window] ?? WINDOWS['1h'];
  const cutoffIso = new Date(Date.now() - cfg.ms).toISOString();
  const histRows  = db.prepare(`
    SELECT checked_at, status, total_ms FROM check_history
    WHERE  monitor_id = ? AND checked_at >= ?
    ORDER  BY checked_at ASC
  `).all(id, cutoffIso);

  const history = cfg.bucketMinutes
    ? bucketRows(histRows, cfg.bucketMinutes)
    : histRows.map(r => ({ timestamp: r.checked_at, ping: r.total_ms, status: r.status }));

  const upCount       = history.filter(h => h.status === 'up').length;
  const uptimePercent = history.length
    ? Math.round((upCount / history.length) * 1000) / 10
    : 100;

  const latest = db.prepare(`
    SELECT status, total_ms, checked_at FROM check_history
    WHERE  monitor_id = ? ORDER BY checked_at DESC LIMIT 1
  `).get(id);

  return {
    id:           row.id,
    label:        row.label,
    status:       latest?.status     ?? 'pending',
    currentPing:  latest?.total_ms   ?? null,
    uptimePercent,
    lastChecked:  latest?.checked_at ?? null,
    history,
  };
}

// ── GET /api/public/monitors ──────────────────────────────────────────────────
router.get('/monitors', (req, res) => {
  const window = WINDOWS[req.query.window] ? req.query.window : '1h';
  const ids    = db.prepare('SELECT id FROM monitors ORDER BY created_at ASC').all();
  res.json(ids.map(r => buildPublicPayload(r.id, window)).filter(Boolean));
});

// ── GET /api/public/monitors/:id ──────────────────────────────────────────────
router.get('/monitors/:id', (req, res) => {
  const payload = buildPublicPayload(req.params.id);
  if (!payload) return res.status(404).json({ error: 'Monitor not found' });
  res.json(payload);
});

// ── GET /api/public/events (SSE) ─────────────────────────────────────────────
router.get('/events', publicSseHandler);

export default router;
