import { lookup } from 'node:dns/promises';

function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0 ||
    // RFC 6598 carrier-grade NAT (100.64.0.0/10)
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(address) {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // IPv4-mapped: dotted form ::ffff:127.0.0.1
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isPrivateIPv4(dotted[1]);
  // IPv4-mapped: hex form ::ffff:7f00:1 — convert two 16-bit groups to dotted IPv4
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi  = parseInt(hex[1], 16);
    const lo  = parseInt(hex[2], 16);
    return isPrivateIPv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  // Any other ::ffff: variant — block to be safe
  if (lower.startsWith('::ffff:')) return true;
  const m = lower.match(/^fe([0-9a-f]{2}):/);
  if (m && parseInt(m[1], 16) >= 0x80 && parseInt(m[1], 16) <= 0xbf) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  return false;
}

export async function assertNotSsrfTarget(hostname) {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    return;
  }

  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
    if (blocked) throw new Error('Target resolves to a private address (SSRF protection)');
  }
}
