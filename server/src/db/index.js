import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? join(__dirname, '../../../data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'watchtower.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id                 TEXT    PRIMARY KEY,
    label              TEXT    NOT NULL,
    target             TEXT    NOT NULL,
    description        TEXT    NOT NULL DEFAULT '',
    interval           INTEGER NOT NULL DEFAULT 60,
    alert_types        TEXT    NOT NULL DEFAULT '["None"]',
    tags               TEXT    NOT NULL DEFAULT '[]',
    check_type         TEXT    NOT NULL DEFAULT 'http',
    port               INTEGER,
    body_match         TEXT,
    expected_status    INTEGER,
    json_path          TEXT,
    json_expected      TEXT,
    auth_type          TEXT,
    auth_user          TEXT,
    auth_pass          TEXT,
    auth_token         TEXT,
    request_headers    TEXT,
    created_at         TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS check_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id  TEXT    NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    checked_at  TEXT    NOT NULL,
    status      TEXT    NOT NULL,
    total_ms    INTEGER,
    dns_ms      INTEGER,
    tcp_ms      INTEGER,
    tls_ms      INTEGER,
    ttfb_ms     INTEGER,
    http_status INTEGER,
    cert_days   INTEGER,
    error       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_history_monitor
    ON check_history (monitor_id, checked_at DESC);

  CREATE TABLE IF NOT EXISTS alerts (
    id               TEXT    PRIMARY KEY,
    monitor_id       TEXT    NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    type             TEXT    NOT NULL,
    started_at       TEXT    NOT NULL,
    last_occurred_at TEXT    NOT NULL,
    resolved_at      TEXT,
    dismissed_at     TEXT,
    notified_at      TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_monitor
    ON alerts (monitor_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS module_instances (
    id          TEXT    PRIMARY KEY,
    module_id   TEXT    NOT NULL,
    label       TEXT    NOT NULL DEFAULT '',
    description TEXT    NOT NULL DEFAULT '',
    interval    INTEGER NOT NULL DEFAULT 3600,
    tags        TEXT    NOT NULL DEFAULT '[]',
    alert_types TEXT    NOT NULL DEFAULT '["None"]',
    config      TEXT    NOT NULL DEFAULT '{}',
    position    INTEGER NOT NULL DEFAULT 0,
    col_span    INTEGER NOT NULL DEFAULT 1,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    key_prefix   TEXT NOT NULL,
    key_hash     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    last_used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS groups (
    id            TEXT    PRIMARY KEY,
    name          TEXT    NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monitor_groups (
    monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    group_id   TEXT NOT NULL REFERENCES groups(id)   ON DELETE CASCADE,
    PRIMARY KEY (monitor_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS maintenance_events (
    id         TEXT    PRIMARY KEY,
    name       TEXT    NOT NULL,
    note       TEXT    NOT NULL DEFAULT '',
    start_at   TEXT    NOT NULL,
    end_at     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_monitors (
    event_id   TEXT NOT NULL REFERENCES maintenance_events(id) ON DELETE CASCADE,
    monitor_id TEXT NOT NULL REFERENCES monitors(id)           ON DELETE CASCADE,
    PRIMARY KEY (event_id, monitor_id)
  );

  CREATE TABLE IF NOT EXISTS saved_reports (
    id           TEXT PRIMARY KEY,
    range_from   TEXT NOT NULL,
    range_to     TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    data         TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_saved_reports_generated
    ON saved_reports (generated_at DESC);
`);

// ── Migrations for existing databases ─────────────────────────────────────────
for (const sql of [
  `ALTER TABLE monitors      ADD COLUMN degraded_threshold INTEGER`,
  `ALTER TABLE monitors      ADD COLUMN alert_config TEXT NOT NULL DEFAULT '{}'`,
  `ALTER TABLE monitors      ADD COLUMN body_match TEXT`,
  `ALTER TABLE monitors      ADD COLUMN expected_status INTEGER`,
  `ALTER TABLE monitors      ADD COLUMN json_path TEXT`,
  `ALTER TABLE monitors      ADD COLUMN json_expected TEXT`,
  `ALTER TABLE monitors      ADD COLUMN auth_type TEXT`,
  `ALTER TABLE monitors      ADD COLUMN auth_user TEXT`,
  `ALTER TABLE monitors      ADD COLUMN auth_pass TEXT`,
  `ALTER TABLE monitors      ADD COLUMN auth_token TEXT`,
  `ALTER TABLE monitors      ADD COLUMN request_headers TEXT`,
  `ALTER TABLE check_history       ADD COLUMN maintenance_event_id TEXT`,
  `ALTER TABLE alerts               ADD COLUMN maintenance_event_id TEXT`,
  `ALTER TABLE maintenance_events   ADD COLUMN recurrence      TEXT`,
  `ALTER TABLE maintenance_events   ADD COLUMN recurrence_end  TEXT`,
  `ALTER TABLE maintenance_events   ADD COLUMN parent_id       TEXT`,
]) {
  try { db.exec(sql); } catch { /* column already exists */ }
}

// ── v4.2 data migration: HTTP monitors with body_match → API check type ───────
try {
  db.prepare(`
    UPDATE monitors
    SET check_type = 'api'
    WHERE check_type = 'http'
      AND body_match IS NOT NULL
      AND body_match != ''
  `).run();
} catch { /* ignore */ }

// ── Row → JS object ───────────────────────────────────────────────────────────
export function rowToMonitor(row) {
  let requestHeaders = [];
  try { requestHeaders = JSON.parse(row.request_headers || '[]'); } catch {}
  return {
    id:               row.id,
    label:            row.label,
    target:           row.target,
    description:      row.description,
    interval:         row.interval,
    alertTypes:       JSON.parse(row.alert_types),
    tags:             JSON.parse(row.tags),
    checkType:        row.check_type,
    port:             row.port               ?? null,
    degradedThreshold: row.degraded_threshold ?? null,
    alertConfig:      row.alert_config        ?? '{}',
    bodyMatch:        row.body_match          ?? null,
    expectedStatus:   row.expected_status     ?? null,
    jsonPath:         row.json_path           ?? null,
    jsonExpected:     row.json_expected       ?? null,
    authType:         row.auth_type           ?? 'none',
    authUser:         row.auth_user           ?? null,
    authPass:         row.auth_pass           ?? null,
    authToken:        row.auth_token          ?? null,
    requestHeaders,
    createdAt:        row.created_at,
  };
}

export function rowToAlert(row) {
  return {
    id:                 row.id,
    monitorId:          row.monitor_id,
    monitorLabel:       row.monitor_label  ?? null,
    target:             row.monitor_target ?? null,
    type:               row.type,
    startedAt:          row.started_at,
    lastOccurredAt:     row.last_occurred_at,
    resolvedAt:         row.resolved_at        ?? null,
    dismissedAt:        row.dismissed_at       ?? null,
    maintenanceEventId: row.maintenance_event_id ?? null,
  };
}

export function rowToGroup(row) {
  return {
    id:           row.id,
    name:         row.name,
    displayOrder: row.display_order,
    createdAt:    row.created_at,
  };
}

export function rowToMaintenanceEvent(row) {
  return {
    id:             row.id,
    name:           row.name,
    note:           row.note,
    startAt:        row.start_at,
    endAt:          row.end_at,
    recurrence:     row.recurrence     ?? null,
    recurrenceEnd:  row.recurrence_end ?? null,
    parentId:       row.parent_id      ?? null,
    createdAt:      row.created_at,
    monitorIds:     row.monitor_ids ? JSON.parse(row.monitor_ids) : [],
  };
}

// ── Settings helpers ──────────────────────────────────────────────────────────
export function getSetting(key, defaultValue = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

export function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value ?? ''));
}

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

export { db };
