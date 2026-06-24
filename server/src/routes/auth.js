import { Router }    from 'express';
import bcrypt         from 'bcryptjs';
import {
  getUserByUsername, getUserById,
  setPasswordHash, updateLastLogin, db,
} from '../db/index.js';

const router = Router();

// ── Rate limiting — 5 attempts / 15 min / IP ──────────────────────────────────
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// Pre-computed dummy hash — used when user not found to normalise response time
// and prevent username enumeration via timing.
const DUMMY_HASH = bcrypt.hashSync('__dummy__', 12);

// ── GET /api/auth/check-setup ─────────────────────────────────────────────────
router.get('/check-setup', (_req, res) => {
  const admin = getUserByUsername('admin');
  res.json({ setupRequired: !admin?.password_hash });
});

// ── POST /api/auth/setup — first-run password set ────────────────────────────
router.post('/setup', async (req, res) => {
  const admin = getUserByUsername('admin');
  if (admin?.password_hash) {
    return res.status(403).json({ error: 'Setup already complete' });
  }
  const { password } = req.body ?? {};
  if (!password || password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }
  const hash = await bcrypt.hash(password, 12);
  setPasswordHash(admin.id, hash);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = admin.id;
    req.session.role   = admin.role;
    updateLastLogin(admin.id);
    res.json({ id: admin.id, username: admin.username, role: admin.role });
  });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const ip = req.ip;

  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user         = getUserByUsername(username);
  const hashToVerify = user?.password_hash ?? DUMMY_HASH;
  const valid        = await bcrypt.compare(password, hashToVerify);

  if (!user || !user.password_hash || !valid) {
    // Only count failed attempts toward the rate limit
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    console.warn(`[auth] failed login for "${username}" from ${ip}`);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.role   = user.role;
    updateLastLogin(user.id);
    res.json({ id: user.id, username: user.username, role: user.role });
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('nw.sid');
    res.json({ ok: true });
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = getUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'User not found' });
  }
  res.json({ id: user.id, username: user.username, role: user.role });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 12) {
    return res.status(400).json({ error: 'New password must be at least 12 characters' });
  }

  const row = db.prepare(
    'SELECT id, password_hash FROM users WHERE id = ?'
  ).get(req.session.userId);
  if (!row?.password_hash) return res.status(400).json({ error: 'No password set' });

  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = await bcrypt.hash(newPassword, 12);
  setPasswordHash(row.id, hash);
  res.json({ ok: true });
});

export default router;
