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

## Open Questions

- Zoom to incident: global (all monitors snap to same range) or per-monitor? → Decided: global
- Alerts auto-open: only outages or also degraded? → TBD by user
- Date range picker: should it show local timezone or UTC? → TBD

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
- Alerts auto-open: user-configurable in Settings → General; options: "On outage" / "On any alert" / "Never"; stored in localStorage key `nw-alerts-auto-open`; default: "On outage"
- Alerts auto-open is frontend-only (localStorage) — no backend settings API changes needed
- GeneralTab pattern: prop-drilled from App.jsx → SettingsPanel → GeneralTab, same as chartYMax
