import { Router }                       from 'express';
import { randomBytes, createHash }      from 'node:crypto';
import { randomUUID }                   from 'node:crypto';
import { db }                           from '../db/index.js';

const router = Router();

// If ADMIN_SECRET is set, all key-management endpoints require the header.
// If it is not set the endpoints are open (backward-compatible local installs).
function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return next();
  if (req.headers['x-admin-secret'] !== secret) {
    return res.status(401).json({ error: 'Admin secret required' });
  }
  next();
}

router.use(requireAdminSecret);

function hashKey(raw) {
  return createHash('sha256').update(raw).digest('hex');
}

// ── GET /api/keys ─────────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const rows = db.prepare(
    'SELECT id, name, key_prefix, created_at, last_used_at FROM api_keys ORDER BY created_at DESC'
  ).all();
  res.json(rows);
});

// ── POST /api/keys ────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });

  const raw    = 'wt_' + randomBytes(24).toString('base64url');
  const prefix = raw.slice(0, 12);
  const hash   = hashKey(raw);
  const id     = randomUUID();
  const now    = new Date().toISOString();

  db.prepare(
    'INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name.trim(), prefix, hash, now);

  res.status(201).json({ id, name: name.trim(), key_prefix: prefix, created_at: now, key: raw });
});

// ── DELETE /api/keys/:id ──────────────────────────────────────────────────────

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Key not found' });
  res.status(204).end();
});

// ── POST /api/keys/:id/refresh ────────────────────────────────────────────────

router.post('/:id/refresh', (req, res) => {
  const existing = db.prepare(
    'SELECT id, name FROM api_keys WHERE id = ?'
  ).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Key not found' });

  const raw    = 'wt_' + randomBytes(24).toString('base64url');
  const prefix = raw.slice(0, 12);
  const hash   = hashKey(raw);

  db.prepare(
    `UPDATE api_keys SET key_prefix = ?, key_hash = ?, last_used_at = NULL WHERE id = ?`
  ).run(prefix, hash, req.params.id);

  res.json({ id: req.params.id, name: existing.name, key_prefix: prefix, key: raw });
});

export default router;
