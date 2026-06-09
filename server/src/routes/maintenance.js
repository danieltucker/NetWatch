import { Router }                    from 'express';
import { randomUUID }                from 'node:crypto';
import { db, rowToMaintenanceEvent } from '../db/index.js';

const router = Router();

const VALID_RECURRENCES = new Set(['daily', 'weekly', 'monthly']);

function getEventWithMonitors(id) {
  const row = db.prepare('SELECT * FROM maintenance_events WHERE id = ?').get(id);
  if (!row) return null;
  const members = db.prepare(
    'SELECT monitor_id FROM maintenance_monitors WHERE event_id = ?'
  ).all(id);
  return { ...rowToMaintenanceEvent(row), monitorIds: members.map(r => r.monitor_id) };
}

// ── GET /api/maintenance ──────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const rows = db.prepare(
    `SELECT me.*, GROUP_CONCAT(mm.monitor_id) AS monitor_ids_csv
     FROM maintenance_events me
     LEFT JOIN maintenance_monitors mm ON mm.event_id = me.id
     GROUP BY me.id
     ORDER BY me.start_at DESC`
  ).all().map(row => ({
    ...rowToMaintenanceEvent(row),
    monitorIds: row.monitor_ids_csv ? row.monitor_ids_csv.split(',') : [],
  }));
  res.json(rows);
});

// ── GET /api/maintenance/active ───────────────────────────────────────────────
router.get('/active', (_req, res) => {
  const now = new Date().toISOString();
  const rows = db.prepare(
    `SELECT me.*, GROUP_CONCAT(mm.monitor_id) AS monitor_ids_csv
     FROM maintenance_events me
     LEFT JOIN maintenance_monitors mm ON mm.event_id = me.id
     WHERE me.start_at <= ? AND me.end_at >= ?
     GROUP BY me.id`
  ).all(now, now).map(row => ({
    ...rowToMaintenanceEvent(row),
    monitorIds: row.monitor_ids_csv ? row.monitor_ids_csv.split(',') : [],
  }));
  res.json(rows);
});

// ── POST /api/maintenance ─────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name, startAt, endAt, monitorIds = [], note = '', recurrence = null, recurrenceEnd = null } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: 'name is required' });
  if (!startAt)       return res.status(400).json({ error: 'startAt is required' });
  if (!endAt)         return res.status(400).json({ error: 'endAt is required' });
  if (startAt >= endAt) return res.status(400).json({ error: 'endAt must be after startAt' });
  if (recurrence && !VALID_RECURRENCES.has(recurrence)) {
    return res.status(400).json({ error: 'recurrence must be daily, weekly, or monthly' });
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO maintenance_events (id, name, note, start_at, end_at, recurrence, recurrence_end)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name.trim(), note.trim(), startAt, endAt, recurrence ?? null, recurrenceEnd ?? null);

  const insert = db.prepare('INSERT OR IGNORE INTO maintenance_monitors (event_id, monitor_id) VALUES (?, ?)');
  for (const mid of monitorIds) insert.run(id, mid);

  res.status(201).json(getEventWithMonitors(id));
});

// ── PUT /api/maintenance/:id ──────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM maintenance_events WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Maintenance event not found' });
  }

  const { name, startAt, endAt, note, monitorIds, recurrence, recurrenceEnd } = req.body;
  if (name          !== undefined) db.prepare('UPDATE maintenance_events SET name          = ? WHERE id = ?').run(name.trim(), id);
  if (note          !== undefined) db.prepare('UPDATE maintenance_events SET note          = ? WHERE id = ?').run(note.trim(), id);
  if (startAt       !== undefined) db.prepare('UPDATE maintenance_events SET start_at      = ? WHERE id = ?').run(startAt, id);
  if (endAt         !== undefined) db.prepare('UPDATE maintenance_events SET end_at        = ? WHERE id = ?').run(endAt, id);
  if (recurrence    !== undefined) db.prepare('UPDATE maintenance_events SET recurrence    = ? WHERE id = ?').run(recurrence ?? null, id);
  if (recurrenceEnd !== undefined) db.prepare('UPDATE maintenance_events SET recurrence_end = ? WHERE id = ?').run(recurrenceEnd ?? null, id);

  if (Array.isArray(monitorIds)) {
    db.prepare('DELETE FROM maintenance_monitors WHERE event_id = ?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO maintenance_monitors (event_id, monitor_id) VALUES (?, ?)');
    for (const mid of monitorIds) insert.run(id, mid);
  }

  res.json(getEventWithMonitors(id));
});

// ── DELETE /api/maintenance/:id ───────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM maintenance_events WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Maintenance event not found' });
  }
  db.prepare('DELETE FROM maintenance_events WHERE id = ?').run(id);
  res.json({ ok: true });
});

export default router;
