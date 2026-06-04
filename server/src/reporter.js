/**
 * reporter.js — Builds and sends a periodic status report via email.
 *
 * HTML email is written for maximum client compatibility:
 *  - bgcolor attributes on every <td> (Outlook 2007-2019 ignores CSS background
 *    on table cells; only the HTML attribute is respected)
 *  - color-scheme: light meta tag prevents Gmail/Apple Mail dark-mode inversion
 *  - background properties only appear on <body> and outer <table>, never on <tr>
 *  - border-radius is kept for modern clients; Outlook renders square corners
 */

import { db, rowToMonitor }    from './db/index.js';
import { getSetting }           from './db/index.js';
import { buildEmailTransport }  from './alerter.js';

// ── Data aggregation ──────────────────────────────────────────────────────────

function getMonitorStats(monitorId, startIso, endIso) {
  const rows = db.prepare(`
    SELECT status, total_ms, checked_at
    FROM   check_history
    WHERE  monitor_id = ? AND checked_at >= ? AND checked_at <= ?
    ORDER  BY checked_at ASC
  `).all(monitorId, startIso, endIso);

  const total     = rows.length;
  const upCount   = rows.filter(r => r.status === 'up').length;
  const downCount = rows.filter(r => r.status === 'down').length;
  const pings     = rows.map(r => r.total_ms).filter(v => v != null);
  const avgPing   = pings.length
    ? Math.round(pings.reduce((s, v) => s + v, 0) / pings.length)
    : null;
  const uptimePct = total > 0
    ? Math.round((upCount / total) * 1000) / 10
    : 100;

  // Count distinct downtime incidents (sequences of consecutive 'down' rows)
  let incidents = 0;
  let wasDown   = false;
  for (const r of rows) {
    if (r.status === 'down' && !wasDown) { incidents++; wasDown = true; }
    else if (r.status !== 'down')         wasDown = false;
  }

  const latestRow = rows[rows.length - 1];

  return { total, upCount, downCount, avgPing, uptimePct, incidents,
    lastStatus: latestRow?.status ?? 'pending' };
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uptimeColor(pct) {
  if (pct >= 99) return '#15803d';
  if (pct >= 95) return '#b45309';
  return '#dc2626';
}

function statusBadge(status) {
  const styles = {
    up:      { bg: '#dcfce7', color: '#15803d', text: 'UP'      },
    down:    { bg: '#fee2e2', color: '#dc2626', text: 'DOWN'    },
    pending: { bg: '#f3f4f6', color: '#6b7280', text: 'PENDING' },
  };
  const s = styles[status] ?? styles.pending;
  // Use table-based badge for Outlook — <span> background is unreliable there
  return `<table cellpadding="0" cellspacing="0" align="center" style="display:inline-table">
    <tr>
      <td bgcolor="${s.bg}" style="background:${s.bg};border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;color:${s.color};letter-spacing:0.05em;white-space:nowrap;font-family:Arial,sans-serif">
        ${s.text}
      </td>
    </tr>
  </table>`;
}

// ── HTML template ─────────────────────────────────────────────────────────────

function buildReportHtml({ periodLabel, fromDate, toDate, monitors, tagFilter }) {
  const total     = monitors.length;
  const upNow     = monitors.filter(m => m.stats.lastStatus === 'up').length;
  const downNow   = monitors.filter(m => m.stats.lastStatus === 'down').length;
  const avgUptime = total > 0
    ? (monitors.reduce((s, m) => s + m.stats.uptimePct, 0) / total).toFixed(1)
    : '100.0';

  // ── Monitor table rows ─────────────────────────────────────────────────────
  const tableRows = monitors.map((m, i) => {
    const { stats } = m;
    // Alternating row colors go on <td>, not <tr> — Outlook ignores <tr> background
    const rowBg   = i % 2 === 0 ? '#ffffff' : '#f9fafb';
    const pingFmt = stats.avgPing != null ? `${stats.avgPing}ms` : '—';
    const incText = stats.incidents > 0
      ? `<span style="color:#dc2626;font-weight:700;font-family:Arial,sans-serif">${stats.incidents}</span>`
      : `<span style="color:#9ca3af;font-family:Arial,sans-serif">0</span>`;

    const cellStyle = `bgcolor="${rowBg}" style="background:${rowBg};padding:11px 20px;border-bottom:1px solid #e5e7eb"`;

    return `
      <tr>
        <td ${cellStyle}>
          <div style="font-size:13px;font-weight:600;color:#111827;font-family:Arial,sans-serif">${esc(m.label)}</div>
          <div style="font-size:11px;color:#9ca3af;margin-top:2px;font-family:monospace,Courier New,monospace">${esc(m.target)}</div>
        </td>
        <td ${cellStyle} align="center">
          ${statusBadge(stats.lastStatus)}
        </td>
        <td ${cellStyle} align="right" style="background:${rowBg};padding:11px 20px;border-bottom:1px solid #e5e7eb;font-family:monospace,Courier New,monospace;font-weight:700;font-size:13px;color:${uptimeColor(stats.uptimePct)}">
          ${stats.uptimePct.toFixed(1)}%
        </td>
        <td ${cellStyle} align="right" style="background:${rowBg};padding:11px 20px;border-bottom:1px solid #e5e7eb;font-family:monospace,Courier New,monospace;font-size:13px;color:#374151">
          ${pingFmt}
        </td>
        <td ${cellStyle} align="right" style="background:${rowBg};padding:11px 20px;border-bottom:1px solid #e5e7eb;font-size:13px">
          ${incText}
        </td>
        <td ${cellStyle} align="right" style="background:${rowBg};padding:11px 20px;border-bottom:1px solid #e5e7eb;font-family:monospace,Courier New,monospace;font-size:12px;color:#9ca3af">
          ${stats.total.toLocaleString()}
        </td>
      </tr>`;
  }).join('');

  const tagNote = tagFilter
    ? `<div style="margin-bottom:8px;font-size:12px;color:#6b7280;font-family:Arial,sans-serif">
         Filtered by tag: <strong style="color:#374151">${esc(tagFilter)}</strong>
       </div>`
    : '';

  // Divider color for the down count — conditional inline
  const downColor = downNow > 0 ? '#ef4444' : '#4b5563';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <!--[if !mso]><!-->
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <!--<![endif]-->
  <title>WatchTower ${esc(periodLabel)} Report</title>
  <style>
    /* Force light mode — prevents Gmail/Apple Mail dark-mode inversion */
    :root { color-scheme: light; supported-color-schemes: light; }
  </style>
</head>
<body bgcolor="#f3f4f6" style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">

<!-- Outer wrapper -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f4f6" style="background-color:#f3f4f6">
<tr><td align="center" style="padding:32px 16px">

<!-- Inner 660px container -->
<table role="presentation" width="660" cellpadding="0" cellspacing="0" style="max-width:660px;width:100%">

  <!-- ══ HEADER ══ -->
  <tr>
    <td bgcolor="#111827" style="background-color:#111827;border-radius:12px 12px 0 0;padding:28px 32px 24px">
      <div style="font-size:11px;letter-spacing:0.12em;color:#6b7280;font-weight:600;text-transform:uppercase;margin-bottom:8px;font-family:Arial,sans-serif">WatchTower</div>
      <div style="font-size:26px;font-weight:800;color:#f9fafb;letter-spacing:-0.02em;font-family:Arial,sans-serif">${esc(periodLabel)} Report</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:6px;font-family:Arial,sans-serif">${esc(fromDate)} &ndash; ${esc(toDate)}</div>
    </td>
  </tr>

  <!-- ══ SUMMARY STRIP ══ -->
  <tr>
    <td bgcolor="#1f2937" style="background-color:#1f2937;padding:0">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" width="25%" bgcolor="#1f2937" style="background-color:#1f2937;padding:22px 8px">
            <div style="font-size:30px;font-weight:800;color:#f9fafb;line-height:1;font-family:Arial,sans-serif">${avgUptime}%</div>
            <div style="font-size:10px;color:#6b7280;margin-top:6px;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,sans-serif">Avg Uptime</div>
          </td>
          <td width="1" bgcolor="#374151" style="background-color:#374151;font-size:1px;line-height:1">&nbsp;</td>
          <td align="center" width="25%" bgcolor="#1f2937" style="background-color:#1f2937;padding:22px 8px">
            <div style="font-size:30px;font-weight:800;color:#22c55e;line-height:1;font-family:Arial,sans-serif">${upNow}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:6px;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,sans-serif">Up Now</div>
          </td>
          <td width="1" bgcolor="#374151" style="background-color:#374151;font-size:1px;line-height:1">&nbsp;</td>
          <td align="center" width="25%" bgcolor="#1f2937" style="background-color:#1f2937;padding:22px 8px">
            <div style="font-size:30px;font-weight:800;color:${downColor};line-height:1;font-family:Arial,sans-serif">${downNow}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:6px;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,sans-serif">Down Now</div>
          </td>
          <td width="1" bgcolor="#374151" style="background-color:#374151;font-size:1px;line-height:1">&nbsp;</td>
          <td align="center" width="25%" bgcolor="#1f2937" style="background-color:#1f2937;padding:22px 8px">
            <div style="font-size:30px;font-weight:800;color:#f9fafb;line-height:1;font-family:Arial,sans-serif">${total}</div>
            <div style="font-size:10px;color:#6b7280;margin-top:6px;letter-spacing:0.08em;text-transform:uppercase;font-family:Arial,sans-serif">Monitors</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- ══ MONITOR TABLE ══ -->
  <tr>
    <td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:0 0 12px 12px">

      <!-- Section label -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 20px 12px 20px">
            <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;font-family:Arial,sans-serif">Monitor Overview</div>
            ${tagNote}
          </td>
        </tr>
      </table>

      <!-- Data table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <thead>
          <tr>
            <th bgcolor="#f9fafb" align="left"   style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Monitor</th>
            <th bgcolor="#f9fafb" align="center" style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Status</th>
            <th bgcolor="#f9fafb" align="right"  style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Uptime</th>
            <th bgcolor="#f9fafb" align="right"  style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Avg Ping</th>
            <th bgcolor="#f9fafb" align="right"  style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Incidents</th>
            <th bgcolor="#f9fafb" align="right"  style="background-color:#f9fafb;padding:9px 20px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;border-bottom:2px solid #e5e7eb;font-family:Arial,sans-serif">Checks</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>

      <!-- Footer stamp -->
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 20px 28px 20px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td bgcolor="#111827" style="background-color:#111827;border-radius:8px;padding:12px 20px;text-align:center">
                  <span style="font-size:12px;color:#6b7280;font-family:Arial,sans-serif">
                    Generated by <strong style="color:#60a5fa">WatchTower</strong> &nbsp;&middot;&nbsp; ${esc(new Date().toLocaleString())}
                  </span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

    </td>
  </tr>

</table>
<!-- /Inner container -->

</td></tr>
</table>
<!-- /Outer wrapper -->

</body>
</html>`;
}

// ── Build and send ────────────────────────────────────────────────────────────

export async function sendReport(periodLabel, startIso, endIso) {
  const host = getSetting('email_smtp_host');
  const user = getSetting('email_smtp_user');
  const from = getSetting('email_from');
  const to   = getSetting('email_to');

  if (!host) throw new Error('SMTP host is not configured');
  if (!to)   throw new Error('Recipient email address is not configured');

  const tagFilter = getSetting('report_tag_filter', '').trim();

  // Fetch monitors, apply optional tag filter
  const monitorRows = db.prepare('SELECT * FROM monitors ORDER BY created_at ASC').all();
  let monitors = monitorRows.map(r => rowToMonitor(r));
  if (tagFilter) {
    monitors = monitors.filter(m => m.tags?.includes(tagFilter));
  }

  if (monitors.length === 0) {
    throw new Error(
      tagFilter
        ? `No monitors match the tag filter "${tagFilter}"`
        : 'No monitors to report on'
    );
  }

  const withStats = monitors.map(m => ({
    ...m,
    stats: getMonitorStats(m.id, startIso, endIso),
  }));

  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const html = buildReportHtml({
    periodLabel,
    fromDate: fmtDate(startIso),
    toDate:   fmtDate(endIso),
    monitors: withStats,
    tagFilter,
  });

  const downNow = withStats.filter(m => m.stats.lastStatus === 'down').length;
  const subject = `[WatchTower] ${periodLabel} Report · ${downNow > 0 ? `${downNow} DOWN` : 'All UP'}`;

  const plain = [
    `WatchTower ${periodLabel} Report`,
    `Period: ${fmtDate(startIso)} – ${fmtDate(endIso)}`,
    '',
    ...withStats.map(m =>
      `${m.label}: ${m.stats.uptimePct.toFixed(1)}% uptime` +
      (m.stats.avgPing != null ? `, ${m.stats.avgPing}ms avg` : '') +
      `, ${m.stats.incidents} incident(s)`)
  ].join('\n');

  const transporter = await buildEmailTransport();

  await transporter.sendMail({ from: from || user, to, subject, text: plain, html });

  console.log(`[reporter] ${periodLabel} report sent → ${to} (${withStats.length} monitors)`);
}
