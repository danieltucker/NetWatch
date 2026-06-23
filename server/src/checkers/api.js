/**
 * API checker — HTTP GET with authentication, expected status code validation,
 * optional plain-string body match, and optional JSON dot-path assertion.
 *
 * Body is always capped at 256 KB (we always need to read it for assertions).
 * All timing fields match the HTTP checker so cards render identically.
 */

import got        from 'got';
import sslChecker from 'ssl-checker';
import { assertNotSsrfTarget } from './ssrf-guard.js';

const BODY_SIZE_LIMIT = 256 * 1024; // 256 KB

const safe = (v) =>
  v != null && !Number.isNaN(v) ? Math.max(0, Math.round(v)) : null;

/** Resolve a dot-notation path against a parsed object. Returns undefined if any
 *  segment is missing. Handles numeric keys for array access (e.g. "items.0.id"). */
function getByDotPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

export async function apiCheck(monitor) {
  const {
    target,
    expectedStatus  = null,
    bodyMatch       = null,
    jsonPath        = null,
    jsonExpected    = null,
    authType        = 'none',
    authUser        = null,
    authPass        = null,
    authToken       = null,
    requestHeaders  = [],
  } = monitor;

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

  // SSL cert check in parallel — best-effort, never blocks the ping
  const certPromise = isHttps
    ? sslChecker(hostname, { port: 443 })
        .then(s => s.daysRemaining)
        .catch(() => null)
    : Promise.resolve(null);

  // ── Build request headers ──────────────────────────────────────────────────
  const headers = { 'User-Agent': 'WatchTower/4.5' };

  if (authType === 'basic' && authUser && authPass) {
    headers['Authorization'] =
      `Basic ${Buffer.from(`${authUser}:${authPass}`).toString('base64')}`;
  } else if (authType === 'bearer' && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  for (const h of (requestHeaders || [])) {
    if (h.key?.trim()) headers[h.key.trim()] = h.value ?? '';
  }

  // ── HTTP request ───────────────────────────────────────────────────────────
  let response;
  let bodyTruncated = false;

  try {
    response = await got(url, {
      timeout:         { request: 10_000 },
      followRedirect:  true,
      throwHttpErrors: false,
      maxResponseSize: BODY_SIZE_LIMIT,
      headers,
      hooks: {
        beforeRedirect: [
          async (options) => {
            await assertNotSsrfTarget(options.url.hostname);
          },
        ],
      },
    });
  } catch (err) {
    if (err.code === 'ERR_BODY_OVERFLOW' && err.response) {
      response      = err.response;
      bodyTruncated = true;
    } else {
      return { status: 'down', error: err.message };
    }
  }

  const certDays = await certPromise;
  const p = response.timings?.phases ?? {};

  const base = {
    totalMs:    safe(p.total),
    dnsMs:      safe(p.dns),
    tcpMs:      safe(p.tcp),
    tlsMs:      safe(p.tls),
    ttfbMs:     safe(p.firstByte),
    httpStatus: response.statusCode,
    certDays,
  };

  // ── Status code assertion ──────────────────────────────────────────────────
  const expectedCode = expectedStatus ?? 200;
  if (response.statusCode !== expectedCode) {
    return {
      ...base,
      status: 'down',
      error:  `Expected status ${expectedCode}, got ${response.statusCode}`,
    };
  }

  // ── Plain-string body match ────────────────────────────────────────────────
  if (bodyMatch?.trim()) {
    if (bodyTruncated) {
      return {
        ...base,
        status: 'down',
        error:  `Response too large to check (>${BODY_SIZE_LIMIT / 1024}KB limit)`,
      };
    }
    const needle   = bodyMatch.trim().toLowerCase();
    const haystack = (response.body ?? '').toLowerCase();
    if (!haystack.includes(needle)) {
      return {
        ...base,
        status: 'down',
        error:  `Expected "${bodyMatch.trim()}" not found in response body`,
      };
    }
  }

  // ── JSON dot-path assertion ────────────────────────────────────────────────
  if (jsonPath?.trim()) {
    if (bodyTruncated) {
      return {
        ...base,
        status: 'down',
        error:  `Response too large to check (>${BODY_SIZE_LIMIT / 1024}KB limit)`,
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body ?? '');
    } catch {
      return {
        ...base,
        status: 'down',
        error:  'Response is not valid JSON',
      };
    }
    const actual = getByDotPath(parsed, jsonPath.trim());
    if (actual === undefined) {
      return {
        ...base,
        status: 'down',
        error:  `JSON path "${jsonPath.trim()}" not found in response`,
      };
    }
    if (jsonExpected?.trim()) {
      const actualStr = String(actual);
      if (actualStr !== jsonExpected.trim()) {
        return {
          ...base,
          status: 'down',
          error:  `JSON path "${jsonPath.trim()}": expected "${jsonExpected.trim()}", got "${actualStr}"`,
        };
      }
    }
  }

  return { ...base, status: 'up' };
}
