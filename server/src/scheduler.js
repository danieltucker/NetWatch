/**
 * Scheduler — manages a setInterval per monitor.
 * Each tick fetches the latest monitor config from DB (so edits take effect
 * on the next check without restarting the server) then runs the appropriate
 * checker and persists + broadcasts the result.
 *
 * Alert state is stored in the database (alerts table).  Three event types:
 *   outage   — monitor is DOWN
 *   degraded — monitor is UP but ping exceeds degraded_threshold
 *   (resolved outage/degraded shows as "recovered" in the UI)
 *
 * Dismiss behaviour: when a check confirms the bad state is ongoing the alert's
 * dismissed_at is reset to NULL so it re-surfaces in the panel.
 */

import { randomUUID }       from 'node:crypto';
import { db, rowToMonitor, rowToAlert } from './db/index.js';
import { runCheck }         from './checkers/index.js';
import { broadcast }        from './sse.js';
import { dispatchAlerts }   from './alerter.js';

const timers = new Map(); // monitorId → NodeJS.Timer

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// ── Alert config helpers ──────────────────────────────────────────────────────

function parseAlertConfig(monitor) {
  let cfg = {};
  try { cfg = JSON.parse(monitor.alertConfig || '{}'); } catch {}
  return {
    outage:    { panel: true,  notify: 'once',  ...(cfg.outage    || {}) },
    degraded:  { panel: false, notify: 'never', ...(cfg.degraded  || {}) },
    recovered: { panel: true,  notify: 'once',  ...(cfg.recovered || {}) },
  };
}

function buildAlertPayload(alertId) {
  const row = db.prepare(`
    SELECT a.*, m.label AS monitor_label, m.target AS monitor_target
    FROM   alerts a JOIN monitors m ON a.monitor_id = m.id
    WHERE  a.id = ?
  `).get(alertId);
  return row ? rowToAlert(row) : null;
}

function shouldRepeatNotify(notifyMode, notifiedAt) {
  if (notifyMode !== 'repeat') return false;
  if (!notifiedAt) return true;
  return Date.now() - new Date(notifiedAt).getTime() > FIFTEEN_MINUTES;
}

// ── Alert state machine ───────────────────────────────────────────────────────

function handleAlertLogic(monitor, result, now) {
  const cfg    = parseAlertConfig(monitor);
  const isDown = result.status === 'down';
  const isDegraded = !isDown
    && monitor.degradedThreshold != null
    && result.totalMs != null
    && result.totalMs > monitor.degradedThreshold;

  const activeAlert = db.prepare(`
    SELECT * FROM alerts
    WHERE  monitor_id = ? AND resolved_at IS NULL
    ORDER  BY started_at DESC LIMIT 1
  `).get(monitor.id);

  // ── Service is DOWN ───────────────────────────────────────────────────────
  if (isDown) {
    if (activeAlert?.type === 'outage') {
      // Still down — reset dismissed so it re-surfaces, update last_occurred
      db.prepare(`
        UPDATE alerts SET last_occurred_at = ?, dismissed_at = NULL WHERE id = ?
      `).run(now, activeAlert.id);

      if (shouldRepeatNotify(cfg.outage.notify, activeAlert.notified_at)) {
        dispatchAlerts(monitor, 'down').catch(console.error);
        db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?').run(now, activeAlert.id);
      }

      broadcast('alert:updated', buildAlertPayload(activeAlert.id));
    } else {
      // New outage (or transition from degraded → outage)
      if (activeAlert) {
        // Resolve the previous degraded alert
        db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').run(now, activeAlert.id);
        broadcast('alert:resolved', buildAlertPayload(activeAlert.id));
        if (cfg.recovered.notify !== 'never') {
          dispatchAlerts(monitor, 'recovered').catch(console.error);
        }
      }

      const id = randomUUID();
      db.prepare(`
        INSERT INTO alerts (id, monitor_id, type, started_at, last_occurred_at)
        VALUES (?, ?, 'outage', ?, ?)
      `).run(id, monitor.id, now, now);

      if (cfg.outage.notify !== 'never') {
        dispatchAlerts(monitor, 'down').catch(console.error);
        db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?').run(now, id);
      }

      broadcast('alert:new', buildAlertPayload(id));
    }

  // ── Service is DEGRADED ───────────────────────────────────────────────────
  } else if (isDegraded) {
    if (activeAlert?.type === 'degraded') {
      db.prepare(`
        UPDATE alerts SET last_occurred_at = ?, dismissed_at = NULL WHERE id = ?
      `).run(now, activeAlert.id);

      if (shouldRepeatNotify(cfg.degraded.notify, activeAlert.notified_at)) {
        dispatchAlerts(monitor, 'degraded').catch(console.error);
        db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?').run(now, activeAlert.id);
      }

      broadcast('alert:updated', buildAlertPayload(activeAlert.id));
    } else {
      // New degraded (or transition from outage → degraded)
      if (activeAlert) {
        db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').run(now, activeAlert.id);
        broadcast('alert:resolved', buildAlertPayload(activeAlert.id));
        if (cfg.recovered.notify !== 'never') {
          dispatchAlerts(monitor, 'recovered').catch(console.error);
        }
      }

      const id = randomUUID();
      db.prepare(`
        INSERT INTO alerts (id, monitor_id, type, started_at, last_occurred_at)
        VALUES (?, ?, 'degraded', ?, ?)
      `).run(id, monitor.id, now, now);

      if (cfg.degraded.notify !== 'never') {
        dispatchAlerts(monitor, 'degraded').catch(console.error);
        db.prepare('UPDATE alerts SET notified_at = ? WHERE id = ?').run(now, id);
      }

      broadcast('alert:new', buildAlertPayload(id));
    }

  // ── Service is HEALTHY ────────────────────────────────────────────────────
  } else {
    if (activeAlert) {
      db.prepare('UPDATE alerts SET resolved_at = ? WHERE id = ?').run(now, activeAlert.id);
      if (cfg.recovered.notify !== 'never') {
        dispatchAlerts(monitor, 'recovered').catch(console.error);
      }
      broadcast('alert:resolved', buildAlertPayload(activeAlert.id));
    }
  }
}

// ── Core check execution ──────────────────────────────────────────────────────

export async function executeCheck(monitor) {
  const result    = await runCheck(monitor);
  const checkedAt = new Date().toISOString();

  // Persist result
  db.prepare(`
    INSERT INTO check_history
      (monitor_id, checked_at, status, total_ms, dns_ms, tcp_ms,
       tls_ms, ttfb_ms, http_status, cert_days, error)
    VALUES
      (@monitorId, @checkedAt, @status, @totalMs, @dnsMs, @tcpMs,
       @tlsMs, @ttfbMs, @httpStatus, @certDays, @error)
  `).run({
    monitorId:  monitor.id,
    checkedAt,
    status:     result.status,
    totalMs:    result.totalMs    ?? null,
    dnsMs:      result.dnsMs      ?? null,
    tcpMs:      result.tcpMs      ?? null,
    tlsMs:      result.tlsMs      ?? null,
    ttfbMs:     result.ttfbMs     ?? null,
    httpStatus: result.httpStatus ?? null,
    certDays:   result.certDays   ?? null,
    error:      result.error ? result.error.slice(0, 256) : null,
  });

  // Uptime % from the last hour — matches the 1h window the GET endpoint uses by default.
  // Using a time-range query (not LIMIT N) keeps SSE values consistent with what
  // the client computed from the windowed history on page load.
  // NOTE: checked_at is ISO-8601 UTC ('...T...Z'); bind a JS-computed ISO cutoff
  // rather than datetime('now','-1 hour') (space-separated) so the TEXT comparison
  // is ISO-vs-ISO. See the WINDOWS note in routes/monitors.js for the full rationale.
  const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const history = db.prepare(`
    SELECT status FROM check_history
    WHERE monitor_id = ? AND checked_at >= ?
  `).all(monitor.id, oneHourAgoIso);

  const upCount       = history.filter(h => h.status === 'up').length;
  const uptimePercent = history.length
    ? Math.round((upCount / history.length) * 1000) / 10
    : 100;

  // Alert logic (skip reference monitors)
  if (!monitor.tags?.includes('_ref')) {
    handleAlertLogic(monitor, result, checkedAt);
  }

  // Push real-time update to all connected browsers
  broadcast('monitor:checked', {
    id:           monitor.id,
    status:       result.status,
    currentPing:  result.totalMs ?? null,
    uptimePercent,
    lastChecked:  checkedAt,
    latest: {
      dnsMs:      result.dnsMs      ?? null,
      tcpMs:      result.tcpMs      ?? null,
      tlsMs:      result.tlsMs      ?? null,
      ttfbMs:     result.ttfbMs     ?? null,
      totalMs:    result.totalMs    ?? null,
      httpStatus: result.httpStatus ?? null,
      certDays:   result.certDays   ?? null,
    },
    newPoint: {
      timestamp: checkedAt,
      ping:      result.totalMs ?? null,
      status:    result.status,
    },
  });

  return result;
}

// ── Scheduling ────────────────────────────────────────────────────────────────

export function scheduleMonitor(id, intervalSeconds) {
  stopMonitor(id);

  const tick = async () => {
    const row = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id);
    if (!row) { stopMonitor(id); return; }
    await executeCheck(rowToMonitor(row));
  };

  tick();
  timers.set(id, setInterval(tick, intervalSeconds * 1000));
}

export function stopMonitor(id) {
  const timer = timers.get(id);
  if (timer) { clearInterval(timer); timers.delete(id); }
}

/** Restore schedules on startup. */
export function initScheduler() {
  const monitors = db.prepare('SELECT * FROM monitors').all().map(rowToMonitor);
  for (const m of monitors) {
    scheduleMonitor(m.id, m.interval);
  }
  console.log(`[netwatch:scheduler] ${monitors.length} monitor(s) scheduled`);
}
