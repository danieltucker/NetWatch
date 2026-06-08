import { Router }             from 'express';
import { randomUUID }         from 'node:crypto';
import { db, rowToGroup }     from '../db/index.js';

const router = Router();

// ── GET /api/groups ───────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const groups = db.prepare(
    `SELECT g.*, GROUP_CONCAT(mg.monitor_id) AS monitor_ids_csv
     FROM groups g
     LEFT JOIN monitor_groups mg ON mg.group_id = g.id
     GROUP BY g.id
     ORDER BY g.display_order ASC, g.created_at ASC`
  ).all().map(row => ({
    ...rowToGroup(row),
    monitorIds: row.monitor_ids_csv ? row.monitor_ids_csv.split(',') : [],
  }));
  res.json(groups);
});

// ── POST /api/groups ──────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const maxOrder = db.prepare('SELECT MAX(display_order) AS m FROM groups').get()?.m ?? -1;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO groups (id, name, display_order) VALUES (?, ?, ?)`
  ).run(id, name.trim(), maxOrder + 1);

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  res.status(201).json({ ...rowToGroup(row), monitorIds: [] });
});

// ── PUT /api/groups/:id ───────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const { name, displayOrder, monitorIds } = req.body;
  const { id } = req.params;

  if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Group not found' });
  }

  if (name !== undefined) {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name.trim(), id);
  }
  if (displayOrder !== undefined) {
    db.prepare('UPDATE groups SET display_order = ? WHERE id = ?').run(displayOrder, id);
  }

  // Full replace of monitor assignments when monitorIds is provided
  if (Array.isArray(monitorIds)) {
    db.prepare('DELETE FROM monitor_groups WHERE group_id = ?').run(id);
    const insert = db.prepare('INSERT OR IGNORE INTO monitor_groups (monitor_id, group_id) VALUES (?, ?)');
    for (const mid of monitorIds) insert.run(mid, id);
  }

  const row = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  const members = db.prepare('SELECT monitor_id FROM monitor_groups WHERE group_id = ?').all(id);
  res.json({ ...rowToGroup(row), monitorIds: members.map(r => r.monitor_id) });
});

// ── DELETE /api/groups/:id ────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Group not found' });
  }
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ── PUT /api/groups/monitor/:monitorId ────────────────────────────────────────
// Assign or remove a monitor from a group. Body: { groupId: string | null }
router.put('/monitor/:monitorId', (req, res) => {
  const { monitorId } = req.params;
  const { groupId }   = req.body;

  if (!db.prepare('SELECT id FROM monitors WHERE id = ?').get(monitorId)) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  // Remove from all groups first, then add to new one if specified
  db.prepare('DELETE FROM monitor_groups WHERE monitor_id = ?').run(monitorId);
  if (groupId) {
    if (!db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId)) {
      return res.status(404).json({ error: 'Group not found' });
    }
    db.prepare('INSERT OR IGNORE INTO monitor_groups (monitor_id, group_id) VALUES (?, ?)').run(monitorId, groupId);
  }

  res.json({ ok: true, monitorId, groupId: groupId ?? null });
});

export default router;
