# NetWatch

**Self-hosted uptime monitoring for developers, homelabbers, and small teams.**

NetWatch makes real HTTP(S), TCP, and ICMP checks on configurable intervals, stores the results in SQLite, and pushes every result to the browser the instant it lands via Server-Sent Events. No polling, no page refreshes. When something goes down you know immediately - and when it comes back up, you know that too.

Run it on a Raspberry Pi, a home server, or a cheap VPS. It tracks public-facing APIs and websites just as well as internal services like a Plex server, a NAS, a database port, or a self-hosted app behind a reverse proxy.

![Status: Active](https://img.shields.io/badge/status-active-brightgreen)
![Version](https://img.shields.io/badge/version-6.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

![NetWatch dashboard](images/screenshot.png)

---

## Features

### Monitoring
- **Four check types** - HTTP(S) with full timing breakdown, API with response/body validation, TCP port reachability, ICMP ping
- **Live dashboard** - cards update in real time via Server-Sent Events
- **Time-based history** - view 15m, 1h, 6h, 12h, 1d, 1w, or 30d of history, or set a custom date range; sparklines and uptime % always match the selected window
- **Detailed HTTP timing** - DNS, TCP, TLS, and TTFB measured and displayed separately
- **SSL certificate monitoring** - days until expiry shown on every HTTPS monitor
- **Summary bar** - total monitors, online/offline count, and average ping at a glance
- **Network Reference strip** - configurable set of external monitors (HTTP endpoints and DNS/ICMP targets) that appear below your main monitors so you can tell at a glance whether an outage is yours or a broader internet issue; never trigger alerts

### Organization
- **Tags** - freeform labels with autocomplete; filter the grid by one or more tags (OR logic)
- **Sorting** - by status (down first), uptime (worst first), name (A–Z), average ping (slowest first), or drag-to-reorder in default mode
- **Drag-to-reorder** - grab any card header and drag to rearrange; order persists across sessions
- **Resizable cards** - toggle any card between 1-column and 2-column width; persists across sessions
- **Compact reference cards** - reference monitors render in a smaller footprint so they don't crowd your real monitors

### Alerts
- **In-app alert panel** - bell icon surfaces active outages with a live elapsed-time counter; panel auto-opens on new outages (configurable); resolved alerts show total downtime; dismiss individually or all at once
- **Three alert levels** - Outage, Degraded (configurable ping threshold), and Recovered; each with independent panel visibility and notification frequency (once / every 15 min)
- **HTTP body validation** - optional plain-string check on the response body; treats a mismatch as DOWN even on a 2xx response
- **Telegram** - free push notifications via Telegram Bot API
- **Email** - SMTP delivery; works with Gmail App Passwords, Resend, or any relay; one-click provider presets for Gmail, Outlook, Yahoo, and iCloud
- **SMS** - Twilio integration (~$0.008/message)
- **Test before saving** - send a test alert with your current form values without committing to save

### Reports
- **Scheduled email reports** - periodic status summaries sent via email on a daily, weekly, or monthly schedule
- **Rich HTML email** - dark header with aggregate stats (avg uptime, up/down count, monitor total) followed by a per-monitor table showing status, uptime %, average ping, incident count, and total checks
- **Tag filtering** - optionally restrict a report to monitors with a specific tag; blank sends all monitors
- **Configurable send time** - reports fire at any HH:MM in server local time; the scheduler checks every 60 seconds
- **Test button** - send an immediate 24-hour preview report without waiting for the schedule
- **Email client compatibility** - inline styles, `bgcolor` HTML attributes for Outlook 2007–2019, and `color-scheme: light` meta to prevent dark-mode inversion in Gmail and Apple Mail

### Settings
- **Tabbed settings panel** - centered modal with General, Notifications, Reports, Network, and Modules tabs
- **General tab** - dashboard-wide preferences (chart Y-axis scale, theme)
- **Filtered channels** - per-monitor alert picker only shows channels enabled in Settings; incomplete credentials block save with an error
- **Reports tab** - schedule configuration, tag filter, last-sent timestamp, and test send button; save is blocked if SMTP is not yet configured
- **Network tab** - manage network reference monitors; toggle any of 14 preset endpoints on/off (8 HTTP, 6 DNS/ICMP) and add unlimited custom entries; changes sync immediately on save

### Embed
- **Per-monitor widget** - 360x230 iframe showing a single card with live updates
- **Full dashboard** - read-only iframe view of the entire dashboard; no edit, delete, or settings controls

### Other
- **Dark / Light theme** - toggle in the header; persists in localStorage
- **Persistent storage** - monitors, check history, and alert credentials all survive restarts (SQLite)
- **Docker Compose** - single service, named volume, ships ready to run

---

## Screenshots

### HTTP Performance Breakdown

Hover any sparkline bar to see the full HTTP timing breakdown - DNS, TCP, TLS, and TTFB rendered as proportional colored segments with millisecond labels. Aggregated windows (12h, 1d, 1w) show average ping and per-bucket uptime instead.

![HTTP timing tooltip](images/http-performance.png)

### Adding and Editing Monitors

Configure the target URL or IP, check type, interval, tags, and which alert channels fire for this monitor. Tag autocomplete suggests existing labels as you type.

![Edit monitor form](images/edit-monitor.png)

### Alert Panel

The bell icon in the header shows a count of active outages. Click it to expand the panel, which separates ongoing outages from degraded monitors and shows a live elapsed-time counter for anything still down.

![Alerts panel](images/notifications.png)

### Notification Settings

Configure alert channels in Settings > Notifications. Each channel can be individually enabled or disabled, tested before saving, and assigned per-monitor in the edit form.

![Notification settings](images/notification-settings.png)

### Telegram Notifications

DOWN, RECOVERED, and DEGRADED events are sent immediately to your configured channels. No polling interval - alerts fire the moment the check result lands.

![Telegram notifications](images/telegram-notifications.png)

---

## Check Types

### HTTP / HTTPS

Sends a real HTTP or HTTPS request and measures the full request lifecycle.

**Best for:** public websites, REST APIs, reverse-proxied services, anything with a TLS certificate, third-party SaaS your app depends on.

**You get:** DNS ms, TCP ms, TLS ms, TTFB ms, HTTP status code, SSL expiry countdown.

### API

Sends an HTTP GET request and validates the response against configurable rules — status code, response body, or a specific JSON field value. Uses the same timing infrastructure as HTTP checks.

**Best for:** `/health` endpoints, JSON APIs where you care about the response payload not just reachability, services that return `200 OK` even when degraded.

**You get:** DNS ms, TCP ms, TLS ms, TTFB ms, HTTP status code, SSL expiry countdown, pass/fail for any configured body or JSON assertion.

**Auth options:** basic auth (username + password), bearer token, or custom headers (up to 5 key-value pairs).

> **Security note:** auth credentials are stored as plaintext in SQLite. Credential encryption is planned for a future release.

### TCP

Opens a raw TCP connection to a host and port. No application-layer data exchanged - success means the port accepted the connection.

**Best for:** databases (Postgres :5432, MySQL :3306, Redis :6379), mail servers, internal services not exposed via URL, verifying firewall rules and port-forwards.

**You get:** connection latency in ms.

### ICMP (Ping)

Sends an ICMP echo request. Measures raw round-trip latency with no concern for open ports or services.

**Best for:** bare-metal servers, network equipment (routers, switches, access points), NAS boxes, IoT devices, diagnosing latency vs availability.

> **Note:** ICMP requires the `NET_RAW` capability. The provided `docker-compose.yml` sets this automatically. Running outside Docker may require `sudo` or `CAP_NET_RAW` on the Node process.

**You get:** round-trip latency in ms.

---

## Getting Started

### Docker (recommended)

```bash
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000). Data is stored in a named volume (`netwatch-data`) and survives container restarts.

### Building and publishing a Docker image

To publish the image to Docker Hub for deployment on a remote host (e.g. TrueNAS, a home server):

```bash
docker build -t your-username/netwatch:latest .
docker push your-username/netwatch:latest
```

**Cross-platform builds (Apple Silicon → amd64)**

If you're building on an M-series Mac but deploying to an x86 machine, you need to target `linux/amd64` explicitly. Use `buildx`:

```bash
# One-time setup
docker buildx create --name multi --use

# Build for amd64 and push directly to the registry
docker buildx build --platform linux/amd64 -t your-username/netwatch:latest --push .
```

To support both architectures (e.g. run locally on the Mac and deploy to x86):

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t your-username/netwatch:latest --push .
```

> **Note:** `buildx` cross-compiled images can't be loaded into your local Docker daemon — `--push` sends them directly to the registry.

### Local development

```bash
# Terminal 1 - backend (Express on :3000)
cd server
npm install
npm run dev

# Terminal 2 - frontend (Vite on :5173, proxies /api to :3000)
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

```bash
# Production build - outputs to server/public/, served by Express
npm run build
```

---

## Alert Notifications

Open the Settings panel (gear icon in the header) to configure channels. Test any channel before saving - credentials in the form are sent with the test request.

### Telegram (free)

1. Message `@BotFather` on Telegram and create a bot to get a token
2. Message your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID
3. Paste the token and chat ID into the Telegram section and enable the channel

### Email (SMTP)

| Field    | Example                          |
|----------|----------------------------------|
| Host     | `smtp.gmail.com`                 |
| Port     | `587` (STARTTLS) or `465` (SSL)  |
| Username | your email address               |
| Password | App Password or account password |
| From     | the sending address              |
| To       | where alerts should land         |

Use the **Quick setup** buttons in the Notifications tab to auto-fill the host and port for Gmail, Outlook, Yahoo, or iCloud. A contextual note appears for any provider that requires an App Password.

Gmail, Yahoo, and iCloud users: use an App Password, not your account password. Outlook users with 2FA enabled also need an App Password.

### SMS via Twilio

Requires a Twilio account and a purchased phone number (~$0.008/message). Paste your Account SID, Auth Token, and both phone numbers in E.164 format (e.g. `+15551234567`).

---

## Embedding

Click the `<>` icon on any monitor card for a single-monitor widget, or click `<>` in the header for the full dashboard. Both tabs show a live URL preview and copyable iframe code.

![Embed modal](images/embed.png)

```html
<!-- Single monitor widget -->
<iframe
  src="https://your-netwatch/embed/monitor/MONITOR_ID"
  width="360" height="230" frameborder="0"
  style="border-radius:8px;overflow:hidden"
></iframe>

<!-- Full read-only dashboard -->
<iframe
  src="https://your-netwatch/embed"
  width="100%" height="600" frameborder="0"
  style="border-radius:8px;overflow:hidden"
></iframe>
```

Embedded views receive live SSE updates and have no edit, delete, or settings controls.

---

## API Reference

NetWatch exposes two HTTP APIs:

- **Public API** (`/api/v1/`) — read-only, requires an API key. Use this to integrate with external tools, dashboards, or scripts.
- **Internal API** (`/api/`) — full CRUD, no key required. Intended for the dashboard UI on localhost. Restrict access at the network/proxy level if exposed.

---

### Authentication

The public API uses bearer token authentication. Generate a key in **Settings → API Keys**.

```
Authorization: Bearer wt_your_api_key_here
```

Keys are prefixed `wt_` and stored as SHA-256 hashes. The raw key is only shown once at creation.

#### Manage API keys

```
GET    /api/keys          List keys (returns prefix, not raw value)
POST   /api/keys          Create a new key
DELETE /api/keys/:id      Revoke a key
POST   /api/keys/:id/refresh   Rotate a key (issues a new raw value)
```

**Create a key**
```bash
curl -X POST http://localhost:3000/api/keys \
  -H "Content-Type: application/json" \
  -d '{ "name": "Grafana integration" }'
```
```json
{
  "id": "a1b2c3d4-...",
  "name": "Grafana integration",
  "key_prefix": "wt_abc123",
  "created_at": "2025-01-15T10:00:00.000Z",
  "key": "wt_abc123defghijklmnopqrstuvwxyz0123456789"
}
```
> Save the `key` value — it is not stored and cannot be retrieved again.

---

### Public API — `/api/v1/`

All endpoints require `Authorization: Bearer <key>`.

#### GET /api/v1/monitors

Returns all monitors with their current status, ping, and 24-hour uptime.

```bash
curl http://localhost:3000/api/v1/monitors \
  -H "Authorization: Bearer wt_your_key"
```

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "label": "My API",
    "target": "https://api.example.com/health",
    "checkType": "http",
    "interval": 60,
    "tags": ["production"],
    "status": "up",
    "currentPing": 142,
    "lastChecked": "2025-01-15T10:05:00.000Z",
    "uptimePercent": 99.8
  }
]
```

---

#### GET /api/v1/monitors/:id

Returns a single monitor with its last 100 check results.

```bash
curl http://localhost:3000/api/v1/monitors/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer wt_your_key"
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "My API",
  "target": "https://api.example.com/health",
  "checkType": "http",
  "status": "up",
  "currentPing": 142,
  "uptimePercent": 99.8,
  "lastChecked": "2025-01-15T10:05:00.000Z",
  "history": [
    {
      "timestamp": "2025-01-15T10:05:00.000Z",
      "status": "up",
      "ping": 142,
      "dnsMs": 12,
      "tcpMs": 28,
      "tlsMs": 45,
      "ttfbMs": 98,
      "httpStatus": 200,
      "certDays": 72,
      "error": null
    }
  ]
}
```

---

#### GET /api/v1/summary

Returns aggregate counts across all monitors.

```bash
curl http://localhost:3000/api/v1/summary \
  -H "Authorization: Bearer wt_your_key"
```

```json
{
  "total": 8,
  "up": 7,
  "down": 1,
  "pending": 0,
  "avgPingMs": 134
}
```

---

#### GET /api/v1/metrics

Returns Prometheus-compatible metrics for scraping.

```bash
curl http://localhost:3000/api/v1/metrics \
  -H "Authorization: Bearer wt_your_key"
```

```
# HELP watchtower_up 1 if the monitor is currently up, 0 if down
# TYPE watchtower_up gauge
# HELP watchtower_ping_ms Latest ping in milliseconds
# TYPE watchtower_ping_ms gauge
# HELP watchtower_uptime_percent Uptime % over the last 24 hours
# TYPE watchtower_uptime_percent gauge
watchtower_up{id="550e8400",label="My API",target="https://api.example.com/health",type="http"} 1
watchtower_ping_ms{id="550e8400",label="My API",target="https://api.example.com/health",type="http"} 142
watchtower_uptime_percent{id="550e8400",label="My API",target="https://api.example.com/health",type="http"} 99.8
```

Add to your `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: watchtower
    bearer_token: wt_your_key
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: /api/v1/metrics
```

---

### Internal API — `/api/`

No authentication required. Intended for use on the same host or private network.

#### GET /api/monitors

Returns all monitors with windowed history.

| Query param | Values | Default | Description |
|---|---|---|---|
| `window` | `15m` `1h` `6h` `12h` `1d` `1w` `30d` | `1h` | History lookback. Windows > 6h return bucketed averages. |
| `from` | ISO 8601 timestamp | — | Custom range start (overrides `window` when paired with `to`) |
| `to` | ISO 8601 timestamp | — | Custom range end |

```bash
curl "http://localhost:3000/api/monitors?window=1d"
```

---

#### POST /api/monitors

Creates a monitor and starts polling immediately.

```bash
curl -X POST http://localhost:3000/api/monitors \
  -H "Content-Type: application/json" \
  -d '{
    "label": "My API",
    "target": "https://api.example.com/health",
    "checkType": "http",
    "interval": 60,
    "tags": ["production"],
    "alertTypes": ["Telegram"]
  }'
```

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "label": "My API",
  "target": "https://api.example.com/health",
  "checkType": "http",
  "interval": 60,
  "status": "pending",
  "currentPing": null,
  "history": []
}
```

**Body fields**

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `target` | string | ✓ | — | URL, hostname, or IP |
| `label` | string | | target | Display name |
| `description` | string | | `""` | Notes shown on the card |
| `checkType` | `http` `api` `tcp` `icmp` | | `http` | Check strategy |
| `interval` | integer (seconds) | | `60` | Min `30` |
| `port` | integer | TCP only | — | Port to probe |
| `tags` | string[] | | `[]` | Freeform labels |
| `alertTypes` | string[] | | `["None"]` | `Email` `SMS` `Telegram` `Webhook` `None` |
| `degradedThreshold` | integer (ms) | | — | Ping above this marks the monitor degraded |
| `expectedStatus` | integer | API | `200` | Expected HTTP status code |
| `bodyMatch` | string | | — | String the response body must contain |
| `jsonPath` | string | API | — | Dot-notation path to a JSON field (e.g. `data.status`) |
| `jsonExpected` | string | API | — | Expected value at `jsonPath` |
| `authType` | `none` `basic` `bearer` | API | `none` | Auth method |
| `authUser` | string | API+basic | — | Basic auth username |
| `authPass` | string | API+basic | — | Basic auth password |
| `authToken` | string | API+bearer | — | Bearer token |
| `requestHeaders` | `{key,value}[]` | API | `[]` | Up to 5 custom request headers |

---

#### PUT /api/monitors/:id

Updates a monitor. All fields are optional — only send what you want to change.

```bash
curl -X PUT http://localhost:3000/api/monitors/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{ "interval": 30, "tags": ["production", "critical"] }'
```

Returns the updated monitor payload. Passing `"***"` for `authPass` or `authToken` leaves the existing value unchanged.

---

#### DELETE /api/monitors/:id

Stops polling and permanently deletes the monitor and its history.

```bash
curl -X DELETE http://localhost:3000/api/monitors/550e8400-e29b-41d4-a716-446655440000
```

Returns `204 No Content`.

---

#### POST /api/monitors/:id/check

Triggers an immediate out-of-schedule check and returns the result.

```bash
curl -X POST http://localhost:3000/api/monitors/550e8400-e29b-41d4-a716-446655440000/check
```

```json
{
  "status": "up",
  "total_ms": 138,
  "dns_ms": 11,
  "tcp_ms": 25,
  "tls_ms": 44,
  "ttfb_ms": 95,
  "http_status": 200,
  "cert_days": 72,
  "error": null
}
```

---

#### GET /api/events

Server-Sent Events stream. The dashboard subscribes to this for live updates.

```bash
curl -N http://localhost:3000/api/events
```

```
data: {"type":"check:result","payload":{"id":"550e8400","status":"up","total_ms":142,...}}

data: {"type":"monitor:deleted","payload":{"id":"550e8400"}}
```

| Event type | Payload | When |
|---|---|---|
| `check:result` | Full monitor object | After every scheduled or manual check |
| `monitor:deleted` | `{ id }` | When a monitor is deleted |

---

## Tech Stack

| Layer        | Library / Tool                       |
|--------------|--------------------------------------|
| UI           | React 18 (hooks + context)           |
| Styling      | Tailwind CSS (CDN play script)       |
| Charts       | recharts `AreaChart`                 |
| Icons        | lucide-react                         |
| Bundler      | Vite 5                               |
| Backend      | Node.js 20 + Express 4               |
| Database     | SQLite via better-sqlite3 (WAL mode) |
| HTTP checks  | got 13                               |
| Real-time    | Server-Sent Events (EventSource API) |
| Email alerts | nodemailer 8                         |
| SMS alerts   | Twilio REST API (via got)            |
| Chat alerts  | Telegram Bot API (via got)           |
| Container    | Docker + Docker Compose              |

---

## Project Structure

```
netwatch/
├── Dockerfile
├── docker-compose.yml
├── index.html
├── vite.config.js
├── images/                          # README screenshots
├── src/                             # React frontend
│   ├── main.jsx                     # Entry point - embed path detection, ThemeProvider
│   ├── App.jsx                      # Root layout, tag filter, alert tracking
│   ├── types/monitor.js             # Monitor schema + formatters
│   ├── types/networkRefs.js         # Network reference presets + default enabled list
│   ├── hooks/
│   │   ├── useMonitors.js           # REST + SSE state layer
│   │   └── useTheme.jsx             # Dark/light theme context + token sets
│   └── components/
│       ├── SummaryBar.jsx           # Aggregate stats bar
│       ├── MonitorCard.jsx          # Monitor card, graphical tooltip, compact mode
│       ├── MonitorForm.jsx          # Add / Edit modal with tag autocomplete
│       ├── AlertsPanel.jsx          # Dismissable outage alert panel
│       ├── SettingsPanel.jsx        # Slide-out alert channel configuration
│       ├── EmbedModal.jsx           # iframe code generator (widget + full dashboard)
│       └── EmbedView.jsx            # Read-only routes (/embed, /embed/monitor/:id)
└── server/
    ├── package.json
    └── src/
        ├── server.js                # Express app + static serving
        ├── scheduler.js             # Per-monitor polling + alert state machine
        ├── alerter.js               # Telegram / Email / Twilio dispatch
        ├── reporter.js              # Report data aggregation + HTML email template
        ├── report-scheduler.js      # 60s tick — fires scheduled reports at configured HH:MM
        ├── sse.js                   # SSE broadcast to connected clients
        ├── db/index.js              # SQLite schema, migrations, settings helpers
        ├── checkers/
        │   ├── index.js             # Dispatcher
        │   ├── http.js              # HTTP check with timing breakdown
        │   ├── api.js               # API check with body/JSON/auth validation
        │   ├── tcp.js               # TCP port reachability
        │   └── icmp.js              # ICMP ping (requires NET_RAW)
        └── routes/
            ├── monitors.js          # CRUD + manual trigger + windowed history
            └── settings.js          # Alert config + test endpoints
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

---

## Roadmap

### Tag groups

Tags become first-class objects on the dashboard. The default view collapses each tag into a single summary card rather than showing every monitor individually.

- **Tag summary cards** - each tag renders as one card showing the tag name, the names of its members, an aggregate status (worst status wins - one DOWN member makes the group DOWN), member count, and a combined uptime figure
- **Expand on click** - clicking a tag card or its label replaces it in the grid with all the individual member cards; clicking again collapses them back
- **Untagged items** - monitors and modules with no tags always appear individually and are not grouped

---

## License

MIT
