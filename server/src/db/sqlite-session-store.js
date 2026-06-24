import session from 'express-session';
import { db }  from './index.js';

const { Store } = session;

/**
 * A minimal express-session store backed by the existing better-sqlite3 database.
 * Extends session.Store so express-session gets regenerate(), destroy(), etc.
 */
export class BetterSqliteStore extends Store {
  get(sid, cb) {
    try {
      const row = db.prepare(
        'SELECT data FROM sessions WHERE sid = ? AND expires_at > ?'
      ).get(sid, Date.now());
      cb(null, row ? JSON.parse(row.data) : null);
    } catch (err) { cb(err); }
  }

  set(sid, session, cb) {
    try {
      const expires = session.cookie?.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;
      db.prepare(
        'INSERT OR REPLACE INTO sessions (sid, data, expires_at) VALUES (?, ?, ?)'
      ).run(sid, JSON.stringify(session), expires);
      cb(null);
    } catch (err) { cb(err); }
  }

  destroy(sid, cb) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb?.(null);
    } catch (err) { cb?.(err); }
  }

  touch(sid, session, cb) { this.set(sid, session, cb); }

  cleanup() {
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }
}
