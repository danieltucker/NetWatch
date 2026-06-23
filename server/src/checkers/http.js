/**
 * HTTP/HTTPS checker — reachability only.
 *
 * Measures the full request lifecycle via got's timings.phases and checks TLS
 * cert expiry in parallel. No body is read — the response stream is discarded
 * immediately, so there is no memory cap and no body-size concern.
 *
 * For response body / JSON assertions use the API check type instead.
 *
 * Returned timing fields:
 *   dns    → DNS lookup
 *   tcp    → TCP handshake
 *   tls    → TLS negotiation  (null for plain HTTP)
 *   ttfb   → time to first byte
 *   total  → wall-clock total
 */

import got        from 'got';
import sslChecker from 'ssl-checker';
import { assertNotSsrfTarget } from './ssrf-guard.js';

const safe = (v) =>
  v != null && !Number.isNaN(v) ? Math.max(0, Math.round(v)) : null;

export async function httpCheck(target) {
  const url     = /^https?:\/\//i.test(target) ? target : `https://${target}`;
  const isHttps = url.startsWith('https://');
  let hostname;
  try { hostname = new URL(url).hostname; } catch {
    return { status: 'down', error: `Invalid URL: ${url}` };
  }

  try {
    await assertNotSsrfTarget(hostname);
  } catch (err) {
    return { status: 'down', error: err.message };
  }

  // Kick off SSL cert check in parallel — best-effort, never blocks the ping
  const certPromise = isHttps
    ? sslChecker(hostname, { port: 443 })
        .then(s => s.daysRemaining)
        .catch(() => null)
    : Promise.resolve(null);

  let response;
  try {
    response = await got(url, {
      timeout:         { request: 10_000 },
      followRedirect:  true,
      throwHttpErrors: false,
      headers:         { 'User-Agent': 'WatchTower/4.5' },
      hooks: {
        beforeRedirect: [
          async (options) => {
            await assertNotSsrfTarget(options.url.hostname);
          },
        ],
      },
    });
  } catch (err) {
    return { status: 'down', error: err.message };
  }

  const certDays = await certPromise;
  const p = response.timings?.phases ?? {};

  return {
    totalMs:    safe(p.total),
    dnsMs:      safe(p.dns),
    tcpMs:      safe(p.tcp),
    tlsMs:      safe(p.tls),
    ttfbMs:     safe(p.firstByte),
    httpStatus: response.statusCode,
    certDays,
    status:     response.statusCode < 400 ? 'up' : 'down',
  };
}
