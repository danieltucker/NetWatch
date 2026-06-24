/**
 * Server-Sent Events — push check results to connected browser clients.
 *
 * Two separate client sets:
 *   authClients   — authenticated dashboard sessions; receive all events
 *   publicClients — unauthenticated embed views; receive filtered monitor:checked
 *                   events with safe fields only (no target, no error, no timing)
 */

const MAX_PUBLIC_CLIENTS = 100;

const authClients   = new Set();
const publicClients = new Set();

function addClient(set, res) {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const heartbeat = setInterval(() => {
    try { res.write(':ping\n\n'); } catch { clearInterval(heartbeat); }
  }, 25_000);

  set.add(res);
  res.on('close', () => { clearInterval(heartbeat); set.delete(res); });
}

export function sseHandler(req, res) {
  addClient(authClients, res);
}

export function publicSseHandler(req, res) {
  if (publicClients.size >= MAX_PUBLIC_CLIENTS) {
    return res.status(503).json({ error: 'Too many embed connections' });
  }
  addClient(publicClients, res);
}

function write(set, payload) {
  for (const res of set) {
    try { res.write(payload); } catch { set.delete(res); }
  }
}

export function broadcast(event, data) {
  if (authClients.size === 0 && publicClients.size === 0) return;

  const authPayload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  if (authClients.size > 0) write(authClients, authPayload);

  // Public clients only get monitor:checked with a safe field subset
  if (publicClients.size > 0 && event === 'monitor:checked') {
    const safe = {
      id:           data.id,
      status:       data.status,
      currentPing:  data.currentPing,
      uptimePercent: data.uptimePercent,
      lastChecked:  data.lastChecked,
      newPoint: data.newPoint ? {
        timestamp: data.newPoint.timestamp,
        ping:      data.newPoint.ping,
        status:    data.newPoint.status,
      } : null,
    };
    write(publicClients, `event: ${event}\ndata: ${JSON.stringify(safe)}\n\n`);
  }
}
