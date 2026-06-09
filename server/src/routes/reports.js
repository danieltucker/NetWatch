/**
 * GET /api/reports/generate?from=ISO&to=ISO
 *   Generates a report, auto-saves it (30-day retention), returns the data.
 *
 * GET /api/reports/history
 *   Returns metadata for all saved reports (newest first).
 *
 * GET /api/reports/:id
 *   Returns the full data for a previously saved report.
 */

import { Router }     from 'express';
import { randomUUID } from 'node:crypto';
import { db }         from '../db/index.js';

const router = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function buildReport(from, to) {
  const checkStats = db.prepare(`
    SELECT
      monitor_id,
      COUNT(*)                                                               AS total_checks,
      SUM(CASE WHEN status = 'up'                        THEN 1 ELSE 0 END) AS up_checks,
      SUM(CASE WHEN status = 'degraded'                  THEN 1 ELSE 0 END) AS degraded_checks,
      SUM(CASE WHEN status IN ('down','error','timeout')  THEN 1 ELSE 0 END) AS down_checks,
      ROUND(AVG(CASE WHEN total_ms IS NOT NULL AND total_ms > 0 THEN total_ms END), 1) AS avg_ping
    FROM check_history
    WHERE checked_at >= ? AND checked_at <= ?
    GROUP BY monitor_id
  `).all(from, to);

  const statsMap = new Map(checkStats.map(r => [r.monitor_id, r]));

  const incidentStats = db.prepare(`
    SELECT
      monitor_id,
      SUM(CASE WHEN type = 'outage'   THEN 1 ELSE 0 END) AS outage_count,
      SUM(CASE WHEN type = 'degraded' THEN 1 ELSE 0 END) AS degraded_count,
      SUM(
        CASE WHEN type = 'outage' AND resolved_at IS NOT NULL
          THEN CAST((julianday(resolved_at) - julianday(started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END
      ) AS total_downtime_ms
    FROM alerts
    WHERE started_at >= ? AND started_at <= ?
    GROUP BY monitor_id
  `).all(from, to);

  const incidentMap = new Map(incidentStats.map(r => [r.monitor_id, r]));

  const monitors = db.prepare(`
    SELECT id, label, target, check_type, tags
    FROM   monitors
    ORDER  BY label ASC
  `).all().filter(m => {
    try { return !JSON.parse(m.tags ?? '[]').includes('_ref'); }
    catch { return true; }
  });

  return monitors.map(m => {
    const s   = statsMap.get(m.id)    ?? { total_checks: 0, up_checks: 0, degraded_checks: 0, down_checks: 0, avg_ping: null };
    const inc = incidentMap.get(m.id) ?? { outage_count: 0, degraded_count: 0, total_downtime_ms: 0 };
    const upPct = s.total_checks > 0
      ? Math.round(((s.up_checks + s.degraded_checks) / s.total_checks) * 10000) / 100
      : null;
    return {
      id:              m.id,
      label:           m.label,
      target:          m.target,
      checkType:       m.check_type,
      totalChecks:     s.total_checks,
      upChecks:        s.up_checks,
      degradedChecks:  s.degraded_checks,
      downChecks:      s.down_checks,
      uptimePct:       upPct,
      avgPingMs:       s.avg_ping,
      outageCount:     inc.outage_count,
      degradedCount:   inc.degraded_count,
      totalDowntimeMs: inc.total_downtime_ms,
    };
  });
}

function purgeOldReports() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  db.prepare('DELETE FROM saved_reports WHERE generated_at < ?').run(cutoff);
}

// ── GET /api/reports/generate ─────────────────────────────────────────────────

router.get('/generate', (req, res) => {
  const toDate   = req.query.to   ? new Date(req.query.to)   : new Date();
  const fromDate = req.query.from ? new Date(req.query.from) : new Date(toDate - 30 * 24 * 60 * 60 * 1000);

  if (isNaN(fromDate) || isNaN(toDate)) {
    return res.status(400).json({ error: 'Invalid from/to date' });
  }

  const from        = fromDate.toISOString();
  const to          = toDate.toISOString();
  const generatedAt = new Date().toISOString();
  const monitors    = buildReport(from, to);
  const report      = { from, to, generatedAt, monitors };

  purgeOldReports();
  db.prepare(`
    INSERT INTO saved_reports (id, range_from, range_to, generated_at, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), from, to, generatedAt, JSON.stringify(report));

  res.json(report);
});

// ── GET /api/reports/history ──────────────────────────────────────────────────

router.get('/history', (_req, res) => {
  const rows = db.prepare(`
    SELECT id, range_from, range_to, generated_at
    FROM   saved_reports
    ORDER  BY generated_at DESC
  `).all();
  res.json(rows.map(r => ({
    id:          r.id,
    from:        r.range_from,
    to:          r.range_to,
    generatedAt: r.generated_at,
  })));
});

// ── GET /api/reports/:id ──────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT data FROM saved_reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Report not found' });
  try {
    res.json(JSON.parse(row.data));
  } catch {
    res.status(500).json({ error: 'Failed to parse stored report' });
  }
});

export default router;
