/**
 * Config export / import
 *
 * GET  /api/config/export  — download a JSON snapshot of monitors, groups,
 *                            maintenance events, and non-secret settings.
 * POST /api/config/import  — restore from that snapshot.
 *                            mode=merge (default): adds to existing data,
 *                            skipping any monitor whose label already exists.
 *                            mode=replace: clears monitors, groups, and
 *                            maintenance before importing.
 *
 * Sensitive fields (passwords, tokens) are stripped on export and skipped on
 * import when their value is null or "***".
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

// Settings keys that must never appear in an export file
const STRIP_SETTINGS = new Set([
  'telegram_token',
  'email_smtp_pass',
  'twilio_auth_token',
  'twilio_account_sid',
  'webhook_url',
  'email_oauth_client_secret',
  'email_oauth_access_token',
  'email_oauth_refresh_token',
  'email_oauth_token_expiry',
  'report_last_sent',
]);

// ── GET /api/config/export ────────────────────────────────────────────────────

router.get('/export', (_req, res) => {
  const monitors = db.prepare('SELECT * FROM monitors').all().map(row => {
    const m = rowToMonitor(row);
    // Strip auth credentials from export
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
    if (!STRIP_SETTINGS.has(k)) settings[k] = v;
  }

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="netwatch-config-${new Date().toISOString().slice(0, 10)}.json"`
  );
  res.json({
    version:          '1',
    exportedAt:       new Date().toISOString(),
    netwatchVersion:  '6.11.0',
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

  let importedMonitors = 0, importedGroups = 0, importedMaintenance = 0, skippedMonitors = 0;

  db.transaction(() => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM monitors').run();
      db.prepare('DELETE FROM groups').run();
      db.prepare('DELETE FROM maintenance_events').run();
    }

    // monitors — map old IDs to new IDs so group/maintenance links resolve
    const monitorIdMap = new Map();

    for (const m of monitors) {
      if (mode === 'merge') {
        const existing = db.prepare('SELECT id FROM monitors WHERE label = ?').get(m.label);
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
        m.label,
        m.target,
        m.description   ?? '',
        m.interval      ?? 60,
        JSON.stringify(m.alertTypes ?? ['None']),
        JSON.stringify(m.tags ?? []),
        m.checkType     ?? 'http',
        m.port          ?? null,
        m.degradedThreshold ?? null,
        m.alertConfig   ?? '{}',
        m.bodyMatch     ?? null,
        m.expectedStatus ?? null,
        m.jsonPath      ?? null,
        m.jsonExpected  ?? null,
        m.authType      ?? 'none',
        m.authUser      ?? null,
        m.createdAt     ?? new Date().toISOString(),
      );
      importedMonitors++;
    }

    // groups
    for (const g of groups) {
      const newGroupId = randomUUID();
      db.prepare(
        'INSERT INTO groups (id, name, display_order, created_at) VALUES (?, ?, ?, ?)'
      ).run(newGroupId, g.name, g.displayOrder ?? 0, new Date().toISOString());

      const insertMember = db.prepare(
        'INSERT OR IGNORE INTO monitor_groups (monitor_id, group_id) VALUES (?, ?)'
      );
      for (const oldMonId of (g.monitorIds ?? [])) {
        const newMonId = monitorIdMap.get(oldMonId);
        if (newMonId) insertMember.run(newMonId, newGroupId);
      }
      importedGroups++;
    }

    // maintenance events
    for (const me of maintenance) {
      const newEventId = randomUUID();
      db.prepare(`
        INSERT INTO maintenance_events
          (id, name, note, start_at, end_at, recurrence, recurrence_end, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newEventId,
        me.name,
        me.note          ?? '',
        me.startAt,
        me.endAt,
        me.recurrence    ?? null,
        me.recurrenceEnd ?? null,
        new Date().toISOString(),
      );

      const insertMM = db.prepare(
        'INSERT OR IGNORE INTO maintenance_monitors (event_id, monitor_id) VALUES (?, ?)'
      );
      for (const oldMonId of (me.monitorIds ?? [])) {
        const newMonId = monitorIdMap.get(oldMonId);
        if (newMonId) insertMM.run(newEventId, newMonId);
      }
      importedMaintenance++;
    }

    // settings — skip secrets and masked values
    for (const [k, v] of Object.entries(settings)) {
      if (STRIP_SETTINGS.has(k)) continue;
      if (v === null || v === undefined || v === '***') continue;
      setSetting(k, v);
    }
  })();

  res.json({
    ok: true,
    imported: { monitors: importedMonitors, groups: importedGroups, maintenance: importedMaintenance },
    skipped:  { monitors: skippedMonitors },
  });
});

export default router;
