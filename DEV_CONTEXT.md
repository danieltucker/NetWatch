# DEV_CONTEXT — NetWatch

## Overview

NetWatch is a self-hosted, real-time network uptime monitoring dashboard. Users add monitors (HTTP, TCP, ICMP, API) for IPs/domains and the app continuously checks them, displays status/ping/uptime on cards, and fires alerts when services go down or degrade.

**Previous name:** Watchtower (being rebranded to NetWatch in the current release)

## Tech Stack

- **Frontend:** React (Vite), Tailwind CSS, Recharts (sparklines), DnD-Kit (card drag/sort), Lucide icons
- **Backend:** Node.js/Express, better-sqlite3 (SQLite), SSE for real-time push
- **Checkers:** HTTP, API (with assertions), TCP, ICMP — run on a per-monitor `setInterval`
- **Alerts:** Stored in SQLite `alerts` table; dispatched via configurable alerters; surfaced live via SSE
- **Modules:** Pluggable cards (e.g., Cloudflare Analytics, Claude Usage) loaded from `server/src/modules/`

## Features & Current State

- Real-time monitor cards with sparkline history, ping/uptime metrics, timing breakdown (DNS/TCP/TLS/TTFB)
- Configurable check intervals, degraded-threshold alerting, SSL cert monitoring
- Alert panel (bell icon in header) with dismiss/dismiss-all
- Tag-based filtering and drag-to-reorder cards
- History time window selector (1h / 12h / 1d / 1w / 30d) — currently labeled "Window" in UI
- Embed modal for sharing individual monitors or full dashboard
- Console panel (backtick toggle) for debugging
- Reference monitors (tag `_ref`) shown in a compact section
- Module instances (Cloudflare Analytics, Claude Usage) shown below main monitors

## Key Decisions

- **Uptime calc (GET):** Computed from windowed history (time-range query), aggregated into buckets for windows > 1h
- **Uptime calc (SSE):** Computed from last 50 raw checks (count-based) — this is the root cause of the uptime inconsistency bug
- **localStorage keys:** `wt-history-window`, `wt-chart-y-max` (prefixed `wt-` from old Watchtower name)
- **Bucket logic for longer windows:** Each bucket is marked `down` if ANY check in that bucket was down — slightly pessimistic
- **Auth credentials** masked as `***` on GET; credential update protected by `applyCredential()`

## Active Work

- **NetWatch v6.0 release:** Full rebrand + uptime bug fix + major toolbar/filter/history redesign (see project plan)
- **NetWatch v6.16.0:** Session-based login to enable public deployment. Main dashboard protected; `/embed/*` routes and their supporting read-only APIs (`GET /api/monitors`, `GET /api/events`) remain public.

## Open Questions

- Zoom to incident: global (all monitors snap to same range) or per-monitor? → Decided: global
- Alerts auto-open: only outages or also degraded? → TBD by user
- Date range picker: should it show local timezone or UTC? → TBD
- v6.16.0: Single admin user or multi-user auth? → Multi-user from day one; admin is a seeded default; user management UI is a future release
- v6.16.0: Session "remember me" / expiry duration? → 30-day rolling; configurable in settings
- v6.16.0: First-run UX when no credentials configured? → Redirect to a setup screen to set admin password before the app is usable; also "Change password" in Settings modal
- v6.16.0: Embed data exposure? → `/api/public/monitors` strips to safe fields only (label, status, ping, uptime, chart history); target URL/IP never exposed publicly

## Key Decisions (v6.16.0 — Auth / Security)

- **Auth pattern:** Session-based (express-session + connect-sqlite3), 30-day rolling cookie, configurable via `session_expiry_days` setting
- **Session cookie flags:** `httpOnly: true`, `sameSite: 'lax'`, `secure: NODE_ENV === 'production'`; requires `app.set('trust proxy', 1)` behind reverse proxy
- **SESSION_SECRET:** Required env var; refuse startup or generate+warn if missing; never hardcode
- **bcrypt cost factor:** 12
- **Session fixation:** `req.session.regenerate()` called immediately after credential verify, before writing `userId` to session
- **Login rate limiting:** 5 attempts / 15 min / IP; generic error message (no user-not-found vs. wrong-password distinction)
- **Public SSE architecture:** Two-client-set design — `authClients` (full events) and `publicClients` (filtered `monitor:checked` only, safe fields). Cannot share a single broadcast without field filtering.
- **Public monitors field allowlist:** `{ id, label, status, currentPing, uptimePercent, lastChecked, history: [{ timestamp, ping, status }] }` — no target, authUser, requestHeaders, history[].error, alertConfig, tags, etc.
- **`requestHeaders` is an unmasked credential vector** — values may contain raw Authorization headers; strip from all public responses and flag for future masking in /api/v1
- **`/api/v1` excluded from session middleware** — already protected by API key auth
- **Password hash never returned in API responses** — explicit column exclusion in all user queries (never SELECT *)
- **Minimum password length:** 12 characters, enforced at setup and change-password
- **Public SSE connection cap:** 100 concurrent connections; return 503 if exceeded
- **Role check:** Included in session middleware from day one even though only `admin` role exists in v6.16.0

## Key Decisions (v6.0)

- History "Window" renamed to "History"; dropdown replaced by pill-button group
- New presets: 15m, 6h added; keeping 1h, 12h, 1d, 1w, 30d
- Custom from/to date range supported via backend API extension
- Bucket size for custom ranges auto-calculated from span
- localStorage keys migrated from `wt-` to `nw-` with one-time migration
- SSE uptimePercent fixed to use 1h time-range query, not last-50-count
- Status filter (All/Down/Degraded/Up) added to toolbar
- Text search (by label + target) added as frontend-only filter
- Sort expanded with Status (bad-first) and Name (A-Z) options
- Zoom to incident: clicking a down dot on sparkline sets global time range ±30min around event
- Zoom badge color: amber (#f59e0b) to distinguish from blue custom range badge; uses Zap icon
- SparkDot: transparent r=10 hit target above visual r=3 dot; cursor:crosshair; pointerEvents:none on visual circle; stopPropagation to prevent card modal opening
- dotRenderer created as memoised closure in MonitorCardInner to pass onZoomToPoint cleanly through Recharts dot prop
- History pills: connected segmented group (no gaps, border-radius only on outer edges), Custom appended at end
- Status filter: colored status dots in each pill (opacity 0.45 when inactive, 1.0 when active)
- Date picker panel: right-aligned to avoid mobile overflow; native datetime-local inputs; Cancel + Apply footer
- Custom range badge: blue for manual, amber for zoom; × to clear returns to preset 1h
- Sort dropdown: kept as <select> for simplicity and accessibility; options expanded to Default/Status/Uptime/Name/Slowest
- Controls row: ml-auto on Sort to push it to the right on wide screens
- Search input: animates width 140→160px when active; Escape clears and blurs
- Alerts moved into Console panel (backtick toggle); AlertsBanner removed from all views; AlertsPanel.jsx is now unused
- Bell icon no longer opens an alert panel — it opens the console instead; `alertsExpanded` state removed
- Bell dots: up to 3 stacked colored pills (red/amber/green) by severity (outage/degraded/recovered); hover expands pills to show count using max-width CSS transition; `BellDots` component in App.jsx
- Console alert section: pinned above command output; filter input narrows by label/type; "clear" sets `clearedAt` timestamp — only alerts with activity after that timestamp show; rolling 200-alert cap; no per-alert dismiss
- Alerts auto-open setting removed from Settings → General (console never auto-opens)
- GeneralTab pattern: prop-drilled from App.jsx → SettingsPanel → GeneralTab, same as chartYMax
