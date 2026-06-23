# Security Policy

## Supported Versions

WatchTower is a solo-maintained project. Security fixes are applied to the latest version on `main` only. Older tagged releases are not backported.

| Version | Supported |
|---------|-----------|
| 3.x (latest) | yes |
| < 3.0 | no |

## Reporting a Vulnerability

Please do not open a public GitHub issue for security vulnerabilities.

Use GitHub's private vulnerability reporting instead:
**[Report a vulnerability](../../security/advisories/new)**

Include as much detail as you can - steps to reproduce, affected component, and potential impact. I aim to respond within 7 days and will keep you updated as the issue is investigated and fixed.

## Scope

### In scope
- SMTP credential handling in the settings API
- SMTP command injection or header injection via alert inputs
- Unauthenticated access to monitor data or alert credentials via the API
- Server-Side Request Forgery (SSRF) via monitor targets
- XSS in the dashboard or embedded views
- Dependency vulnerabilities with a credible exploit path

### Out of scope
- The network WatchTower is deployed on - securing access to port 3000 is the operator's responsibility (firewall, reverse proxy with auth, VPN)
- SQLite file permissions - the host filesystem is the operator's responsibility
- `NET_RAW` capability required for ICMP - this is intentional and documented
- Denial of service via resource exhaustion on self-hosted infrastructure
- Vulnerabilities in browsers used to access the dashboard

## Deployment Notes

WatchTower has no built-in authentication. It is designed to run on a trusted internal network or behind a reverse proxy that handles access control. Exposing it directly to the public internet without additional protection is not recommended.

Alert credentials (Telegram token, SMTP password, Twilio auth token) are stored in plaintext in the SQLite database. Ensure the `data/` volume is not readable by untrusted users on the host.

## Mitigations in Place

### SSRF Protection

HTTP and API checkers, plus the webhook alerter, resolve the target hostname via DNS before connecting and block addresses in:

- Loopback (`127.0.0.0/8`, `::1`)
- RFC-1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- RFC-6598 carrier-grade NAT (`100.64.0.0/10`)
- Link-local (`169.254.0.0/16`, `fe80::/10`)
- Unique-local IPv6 (`fc00::/7`)
- IPv4-mapped IPv6 (`::ffff:x.x.x.x` — the embedded IPv4 is checked against all private ranges)

The guard also runs on every HTTP redirect hop (via a `beforeRedirect` hook) so a monitored URL that redirects to a private IP cannot bypass the guard.

**ICMP and TCP checks bypass this guard by design.** Both return only latency and up/down status — no response body can be exfiltrated. This allows monitoring internal hosts (routers, NAS, etc.), which is a core homelab use-case.

### Credential Masking

Secret fields are returned as `"***"` in all API responses **and in the config export**. Sending `"***"` back in a PUT request is treated as "no change" so credentials are never round-tripped through the browser. Affected fields: `telegram_token`, `email_smtp_pass`, `twilio_auth_token`, `twilio_account_sid`, `webhook_url`, `email_oauth_client_secret`, monitor `authPass` and `authToken`, and any module field whose key ends in `_token`, `_key`, or `_secret`.

### Input Validation

- `checkType` is validated against `http | tcp | icmp | api` on create and update
- `interval` must be an integer ≥ 15 seconds on create and update
- Monitor labels and targets are HTML-escaped before interpolation into email alert bodies
- Error strings stored in the database are capped at 256 characters

### Transport Hardening

- All mutating API routes (`POST`, `PUT`, `PATCH`) require `Content-Type: application/json`; requests without it receive 415. This prevents form-based CSRF.
- Test-channel endpoints are rate-limited to one request per channel per 30 seconds.

### Response Headers

Every response includes `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin`.

`X-Frame-Options` is intentionally omitted — the embed feature requires the app to be frameable. A full CSP is deferred until Tailwind is bundled at build time rather than loaded from CDN.

### Embed View Exposure

The `/embed` and `/embed/monitor/:id` routes are unauthenticated by design for public status-page use. If monitor names and targets are sensitive, protect the port at the network level or block `/embed` paths at the reverse proxy.
