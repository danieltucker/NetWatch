import { Router }       from 'express';
import { db, rowToAlert } from '../db/index.js';
import { broadcast }      from '../sse.js';

const router = Router();

// ── GET /api/alerts ───────────────────────────────────────────────��───────────
// Returns all non-dismissed alerts (active + recent resolved).
// Active = resolved_at IS NULL.
// Recovered = resolved_at IS NOT NULL, within the last 7 days.
//
// resolved_at is stored as ISO-8601 UTC ('...T...Z'), so the 7-day window uses
// strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') to match that exact format —
// datetime('now', ...) would yield a space-separated form and compare wrong.

router.get('/', (_req, res) => {
  const rows = db.prepare(`
    SELECT a.*, m.label AS monitor_label, m.target AS monitor_target
    FROM   alerts a JOIN monitors m ON a.monitor_id = m.id
    WHERE  a.dismissed_at IS NULL
      AND  (a.resolved_at IS NULL OR a.resolved_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'))
    ORDER  BY a.resolved_at ASC NULLS FIRST, a.started_at DESC
  `).all();
  res.json(rows.map(rowToAlert));
});

// ── PUT /api/alerts/:id/dismiss ──────────────────────��────────────────────────

router.put('/:id/dismiss', (req, res) => {
  const { id } = req.params;
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
  if (!alert) return res.status(404).json({ error: 'Alert not found' });

  const now = new Date().toISOString();
  db.prepare('UPDATE alerts SET dismissed_at = ? WHERE id = ?').run(now, id);
  broadcast('alert:dismissed', { id });
  res.status(204).end();
});

// ── DELETE /api/alerts/dismiss-all ──────────────────────��────────────────────

router.delete('/dismiss-all', (_req, res) => {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE alerts SET dismissed_at = ?
    WHERE  dismissed_at IS NULL
      AND  (resolved_at IS NULL OR resolved_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'))
  `).run(now);
  broadcast('alert:dismissed-all', {});
  res.status(204).end();
});

export default router;
