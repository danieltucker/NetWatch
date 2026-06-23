/**
 * Config export / import
 *
 * GET  /api/config/export  — download a JSON snapshot of monitors, groups,
 *                            maintenance events, and settings (including
 *                            notification credentials for full portability).
 * POST /api/config/import  — restore from that snapshot.
 *                            mode=merge (default): adds to existing data,
 *                            skipping any monitor whose label already exists.
 *                            mode=replace: clears monitors, groups, and
 *                            maintenance before importing.
 */

import { Router }     from 'express';
import { randomUUID } from 'node:crypto';
import {
  db,
  rowToMonitor,
  rowToGroup,
  rowToMaintenanceEvent,
  getAllSettings,
  setSetting,
} from '../db/index.js';

const router = Router();

// Keys excluded from export — OAuth session tokens (expire) and internal state
const STRIP_SETTINGS = new Set([
  'email_oauth_access_token',
  'email_oauth_refresh_token',
  'email_oauth_token_expiry',
  'report_last_sent',
]);

// Secret keys masked as '***' in GET /api/settings — same treatment on export
// so credentials are never exposed to anyone who can reach the HTTP port.
const MASKED_SETTINGS = new Set([
  'telegram_token', 'email_smtp_pass', 'twilio_auth_token',
  'twilio_account_sid', 'webhook_url',
  'email_oauth_client_secret',
]);

function isModuleSecretKey(key) {
  const field = key.split('.').slice(2).join('.');
  return field.endsWith('_token') || field.endsWith('_key') || field.endsWith('_secret');
}

// Valid values for enum-like fields
const VALID_CHECK_TYPES  = new Set(['http', 'api', 'tcp', 'icmp']);
const VALID_RECURRENCES  = new Set(['daily', 'weekly', 'monthly']);

// Allowlist for importable settings keys — mirrors KNOWN_KEYS in routes/settings.js
const IMPORTABLE_SETTINGS_KEYS = new Set([
  'telegram_enabled', 'telegram_token', 'telegram_chat_id',
  'email_enabled', 'email_smtp_host', 'email_smtp_port',
  'email_smtp_user', 'email_smtp_pass', 'email_from', 'email_to',
  'email_auth_type', 'email_oauth_client_id', 'email_oauth_client_secret',
  'twilio_enabled', 'twilio_account_sid', 'twilio_auth_token',
  'twilio_from', 'twilio_to',
  'webhook_enabled', 'webhook_url',
  'report_enabled', 'report_interval', 'report_time', 'report_tag_filter',
  'network_refs_enabled', 'network_refs_custom',
]);

function isIso(str) {
  return typeof str === 'string' && !isNaN(Date.parse(str));
}

// ── GET /api/config/export ────────────────────────────────────────────────────

router.get('/export', (_req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors').all().map(row => {
    const m = rowToMonitor(row);
    // Strip HTTP auth pass/token — these are per-monitor secrets, not settings
    return { ...m, authPass: null, authToken: null };
  });

  const groups = db.prepare('SELECT * FROM groups ORDER BY display_order').all().map(rowToGroup);

  const groupMembers = db.prepare('SELECT * FROM monitor_groups').all();
  const groupsWithMembers = groups.map(g => ({
    ...g,
    monitorIds: groupMembers.filter(gm => gm.group_id === g.id).map(gm => gm.monitor_id),
  }));

  const maintenance = db.prepare(
    `SELECT me.*, GROUP_CONCAT(mm.monitor_id) AS monitor_ids_csv
     FROM maintenance_events me
     LEFT JOIN maintenance_monitors mm ON mm.event_id = me.id
     GROUP BY me.id ORDER BY me.start_at`
  ).all().map(row => ({
    ...rowToMaintenanceEvent(row),
    monitorIds: row.monitor_ids_csv ? row.monitor_ids_csv.split(',') : [],
  }));

  const allSettings = getAllSettings();
  const settings = {};
  for (const [k, v] of Object.entries(allSettings)) {
    if (STRIP_SETTINGS.has(k)) continue;
    const isMasked = MASKED_SETTINGS.has(k) || (k.startsWith('module.') && isModuleSecretKey(k));
    settings[k] = (isMasked && v) ? '***' : v;
  }

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="netwatch-config-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json({
    version:          '1',
    exportedAt:       new Date().toISOString(),
    netwatchVersion:  '6.15.1',
    monitors,
    groups:           groupsWithMembers,
    maintenance,
    settings,
  });
});

// ── POST /api/config/import ───────────────────────────────────────────────────

router.post('/import', (req, res) => {
  const { version, monitors = [], groups = [], maintenance = [], settings = {}, mode = 'merge' } = req.body;

  if (!version) return res.status(400).json({ error: 'Invalid import file: missing version' });
  if (!['merge', 'replace'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "merge" or "replace"' });
  }
  if (!Array.isArray(monitors) || !Array.isArray(groups) || !Array.isArray(maintenance)) {
    return res.status(400).json({ error: 'monitors, groups, and maintenance must be arrays' });
  }
  if (typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings must be an object' });
  }

  let importedMonitors = 0, importedGroups = 0, importedMaintenance = 0;
  let skippedMonitors = 0, skippedMaintenance = 0;

  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM monitors').run();
      db.prepare('DELETE FROM groups').run();
      db.prepare('DELETE FROM maintenance_events').run();
    }

    // monitors — map old IDs to new IDs so group/maintenance links resolve
    const monitorIdMap = new Map();

    for (const m of monitors) {
      // Validate required fields
      if (!m.label || typeof m.label !== 'string' || !m.label.trim()) {
        skippedMonitors++; continue;
      }
      if (!m.target || typeof m.target !== 'string' || !m.target.trim()) {
        skippedMonitors++; continue;
      }
      const checkType = m.checkType ?? 'http';
      if (!VALID_CHECK_TYPES.has(checkType)) {
        skippedMonitors++; continue;
      }
      // Validate interval is a positive integer
      const interval = typeof m.interval === 'number' && m.interval > 0
        ? Math.round(m.interval) : 60;

      if (mode === 'merge') {
        const existing = db.prepare('SELECT id FROM monitors WHERE label = ?').get(m.label.trim());
        if (existing) {
          monitorIdMap.set(m.id, existing.id);
          skippedMonitors++;
          continue;
        }
      }
      const newId = randomUUID();
      monitorIdMap.set(m.id, newId);
      db.prepare(`
        INSERT INTO monitors
          (id, label, target, description, interval, alert_types, tags, check_type,
           port, degraded_threshold, alert_config, body_match, expected_status,
           json_path, json_expected, auth_type, auth_user, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        m.label.trim(),
        m.target.trim(),
        typeof m.description === 'string' ? m.description : '',
        interval,
        JSON.stringify(Array.isArray(m.alertTypes) ? m.alertTypes : ['None']),
        JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
        checkType,
        typeof m.port === 'number' ? m.port : null,
        typeof m.degradedThreshold === 'number' && m.degradedThreshold > 0 ? m.degradedThreshold : null,
        typeof m.alertConfig === 'string' ? m.alertConfig : '{}',
        typeof m.bodyMatch === 'string' ? m.bodyMatch : null,
        typeof m.expectedStatus === 'number' ? m.expectedStatus : null,
        typeof m.jsonPath === 'string' ? m.jsonPath : null,
        typeof m.jsonExpected === 'string' ? m.jsonExpected : null,
        m.authType === 'basic' || m.authType === 'bearer' ? m.authType : 'none',
        typeof m.authUser === 'string' ? m.authUser : null,
        m.createdAt && isIso(m.createdAt) ? m.createdAt : new Date().toISOString(),
      );
      importedMonitors++;
    }

    // groups
    for (const g of groups) {
      if (!g.name || typeof g.name !== 'string' || !g.name.trim()) continue;

      const newGroupId = randomUUID();
      db.prepare(
        'INSERT INTO groups (id, name, display_order, created_at) VALUES (?, ?, ?, ?)'
      ).run(
        newGroupId,
        g.name.trim(),
        typeof g.displayOrder === 'number' ? g.displayOrder : 0,
        new Date().toISOString(),
      );

      const insertMember = db.prepare(
        'INSERT OR IGNORE INTO monitor_groups (monitor_id, group_id) VALUES (?, ?)'
      );
      for (const oldMonId of (Array.isArray(g.monitorIds) ? g.monitorIds : [])) {
        const newMonId = monitorIdMap.get(oldMonId);
        if (newMonId) insertMember.run(newMonId, newGroupId);
      }
      importedGroups++;
    }

    // maintenance events
    for (const me of maintenance) {
      if (!me.name || typeof me.name !== 'string' || !me.name.trim()) {
        skippedMaintenance++; continue;
      }
      if (!isIso(me.startAt) || !isIso(me.endAt)) {
        skippedMaintenance++; continue;
      }
      // Coerce invalid recurrence to null rather than rejecting the whole event
      const recurrence = VALID_RECURRENCES.has(me.recurrence) ? me.recurrence : null;
      const recurrenceEnd = recurrence && isIso(me.recurrenceEnd) ? me.recurrenceEnd : null;

      const newEventId = randomUUID();
      db.prepare(`
        INSERT INTO maintenance_events
          (id, name, note, start_at, end_at, recurrence, recurrence_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newEventId,
        me.name.trim(),
        typeof me.note === 'string' ? me.note : '',
        me.startAt,
        me.endAt,
        recurrence,
        recurrenceEnd,
        new Date().toISOString(),
      );

      const insertMM = db.prepare(
        'INSERT OR IGNORE INTO maintenance_monitors (event_id, monitor_id) VALUES (?, ?)'
      );
      for (const oldMonId of (Array.isArray(me.monitorIds) ? me.monitorIds : [])) {
        const newMonId = monitorIdMap.get(oldMonId);
        if (newMonId) insertMM.run(newEventId, newMonId);
      }
      importedMaintenance++;
    }

    // settings — accept only known keys (prevents arbitrary key injection)
    for (const [k, v] of Object.entries(settings)) {
      if (typeof k !== 'string' || !k.trim()) continue;
      if (STRIP_SETTINGS.has(k)) continue;
      if (v === null || v === undefined || v === '***') continue;
      if (!['string', 'number', 'boolean'].includes(typeof v)) continue;
      // Only write keys in the allowlist or module.* dynamic keys
      if (!IMPORTABLE_SETTINGS_KEYS.has(k) && !k.startsWith('module.')) continue;
      setSetting(k, v);
    }
  })();

  res.json({
    ok: true,
    imported: { monitors: importedMonitors, groups: importedGroups, maintenance: importedMaintenance },
    skipped:  { monitors: skippedMonitors, maintenance: skippedMaintenance },
  });
});

export default router;
