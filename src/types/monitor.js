/**
 * Monitor schema — mirrors the server DB row + computed fields.
 *
 * {
 *   id:            string
 *   label:         string
 *   target:        string          — IP or domain
 *   description:   string
 *   interval:      number          — seconds: 30 | 60 | 300 | 900 | 1800 | 3600
 *   alertTypes:    string[]        — ['Email','Webhook'] | ['None']
 *   tags:          string[]
 *   checkType:     'http'|'tcp'|'icmp'
 *   port:          number|null     — required for tcp checks
 *   status:        'up'|'down'|'pending'
 *   currentPing:   number|null     — total_ms of latest check
 *   uptimePercent: number          — computed from last 50 results
 *   lastChecked:   string|null     — ISO-8601
 *   latest:        LatestCheck|null
 *   history:       CheckPoint[]    — last 50, oldest first
 *   createdAt:     string          — ISO-8601
 * }
 *
 * LatestCheck: { dnsMs, tcpMs, tlsMs, ttfbMs, totalMs, httpStatus, certDays }
 * CheckPoint:  { timestamp, ping, status, dnsMs?, tcpMs?, tlsMs?, ttfbMs?,
 *               httpStatus?, certDays?, error? }
 */

export const INTERVAL_OPTIONS = [
  { label: '15s',  value: 15 },
  { label: '30s',  value: 30 },
  { label: '1m',   value: 60 },
  { label: '5m',   value: 300 },
  { label: '15m',  value: 900 },
  { label: '30m',  value: 1800 },
  { label: '1hr',  value: 3600 },
];

export const ALERT_TYPES  = ['Email', 'SMS', 'Telegram', 'Webhook', 'None'];
export const CHECK_TYPES  = [
  { label: 'HTTP / HTTPS', value: 'http' },
  { label: 'API',          value: 'api'  },
  { label: 'TCP Port',     value: 'tcp'  },
  { label: 'ICMP Ping',    value: 'icmp' },
];

export function formatInterval(seconds) {
  const opt = INTERVAL_OPTIONS.find(o => o.value === seconds);
  return opt ? opt.label : `${seconds}s`;
}

export function formatTimestamp(iso) {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

export function certDaysColor(days) {
  if (days == null) return 'text-gray-600';
  if (days > 30)    return 'text-green-400';
  if (days > 7)     return 'text-amber-400';
  return 'text-red-400';
}
