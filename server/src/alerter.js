/**
 * Alert dispatcher — sends outage, degraded, and recovery notifications.
 *
 * Each channel (Telegram, Email, Twilio) is independently enabled via settings.
 * Per-monitor alertTypes controls which channels fire for that monitor:
 *   'Telegram' → telegram channel
 *   'Email'    → email (SMTP) channel
 *   'SMS'      → Twilio SMS channel
 *   'None'     → no alerts
 *
 * event values: 'down' | 'degraded' | 'recovered'
 */

import got        from 'got';
import nodemailer from 'nodemailer';
import { getSetting, setSetting } from './db/index.js';
import { assertNotSsrfTarget } from './checkers/ssrf-guard.js';

// ── Message formatting ────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function subject(monitor, event) {
  const label = {
    down:      'DOWN',
    degraded:  'DEGRADED',
    recovered: 'RECOVERED',
  }[event] ?? event.toUpperCase();
  return `[NetWatch] ${monitor.label} is ${label}`;
}

function plainText(monitor, event) {
  const status = {
    down:      'DOWN',
    degraded:  `DEGRADED (ping over ${monitor.degradedThreshold ?? '?'}ms threshold)`,
    recovered: 'RECOVERED',
  }[event] ?? event.toUpperCase();
  return `NetWatch Alert\n\n${monitor.label} is ${status}\nTarget: ${monitor.target}\nTime: ${new Date().toLocaleString()}`;
}

function htmlBody(monitor, event) {
  const color = { down: '#ef4444', degraded: '#f59e0b', recovered: '#22c55e' }[event] ?? '#6b7280';
  const status = {
    down:      'DOWN',
    degraded:  `DEGRADED`,
    recovered: 'RECOVERED',
  }[event] ?? event.toUpperCase();
  const detail = event === 'degraded' && monitor.degradedThreshold
    ? `<div>Threshold: <span style="color:#e6edf3">${escHtml(String(monitor.degradedThreshold))}ms</span></div>`
    : '';
  return `
    <div style="font-family:monospace;max-width:480px;padding:24px;background:#0d1117;color:#e6edf3;border-radius:8px">
      <div style="font-size:11px;letter-spacing:0.1em;color:#6e7681;margin-bottom:16px">NETWATCH ALERT</div>
      <div style="font-size:20px;font-weight:bold;color:${color};margin-bottom:12px">${escHtml(monitor.label)} is ${status}</div>
      <div style="font-size:13px;color:#8d96a0;line-height:1.6">
        <div>Target: <span style="color:#e6edf3">${escHtml(monitor.target)}</span></div>
        ${detail}
        <div>Time: <span style="color:#e6edf3">${new Date().toLocaleString()}</span></div>
      </div>
    </div>
  `;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function sendTelegramAlert(monitor, event, overrides = {}) {
  const token  = overrides.telegram_token   ?? getSetting('telegram_token');
  const chatId = overrides.telegram_chat_id ?? getSetting('telegram_chat_id');
  if (!token)  throw new Error('Telegram bot token is not configured');
  if (!chatId) throw new Error('Telegram chat ID is not configured');

  const icon = { down: '🔴', degraded: '🟡', recovered: '🟢' }[event] ?? '⚪';
  const statusText = { down: 'DOWN', degraded: 'DEGRADED', recovered: 'RECOVERED' }[event] ?? event.toUpperCase();
  const detail = event === 'degraded' && monitor.degradedThreshold
    ? `\nThreshold: ${monitor.degradedThreshold}ms` : '';
  const text = `${icon} <b>NetWatch</b>\n\n<b>${monitor.label}</b> is <b>${statusText}</b>\n<code>${monitor.target}</code>${detail}\n${new Date().toLocaleString()}`;

  await got.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    json: { chat_id: chatId, text, parse_mode: 'HTML' },
  });
}

// ── Email transport builder (shared with reporter.js) ─────────────────────────

const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export async function buildEmailTransport(overrides = {}) {
  const authType = overrides.email_auth_type ?? getSetting('email_auth_type', 'basic');
  const host     = overrides.email_smtp_host ?? getSetting('email_smtp_host');
  const port     = overrides.email_smtp_port ?? getSetting('email_smtp_port', '587');
  const user     = overrides.email_smtp_user ?? getSetting('email_smtp_user');

  if (authType === 'oauth2') {
    const clientId     = getSetting('email_oauth_client_id');
    const clientSecret = getSetting('email_oauth_client_secret');
    let   accessToken  = getSetting('email_oauth_access_token');
    const refreshToken = getSetting('email_oauth_refresh_token');
    const expiryStr    = getSetting('email_oauth_token_expiry');

    // Proactively refresh when token expires within 5 minutes
    if (refreshToken && expiryStr && Date.now() + 5 * 60 * 1000 >= new Date(expiryStr).getTime()) {
      try {
        const res = await got.post(MS_TOKEN_URL, {
          form: {
            client_id:     clientId,
            client_secret: clientSecret,
            grant_type:    'refresh_token',
            refresh_token: refreshToken,
            scope:         'https://outlook.office.com/SMTP.Send offline_access',
          },
        }).json();
        accessToken = res.access_token;
        setSetting('email_oauth_access_token', accessToken);
        setSetting('email_oauth_token_expiry', new Date(Date.now() + Number(res.expires_in) * 1000).toISOString());
        if (res.refresh_token) setSetting('email_oauth_refresh_token', res.refresh_token);
      } catch (err) {
        throw new Error('OAuth2 token refresh failed — please reconnect your Microsoft account in Settings');
      }
    }

    return nodemailer.createTransport({
      host,
      port:   Number(port),
      secure: Number(port) === 465,
      auth: {
        type:         'OAuth2',
        user,
        clientId,
        clientSecret,
        refreshToken,
        accessToken,
      },
    });
  }

  // Basic auth (default)
  const pass = overrides.email_smtp_pass ?? getSetting('email_smtp_pass');
  return nodemailer.createTransport({
    host,
    port:   Number(port),
    secure: Number(port) === 465,
    auth:   user ? { user, pass } : undefined,
  });
}

// ── Email ─────────────────────────────────────────────────────────────────────

export async function sendEmailAlert(monitor, event, overrides = {}) {
  const host = overrides.email_smtp_host ?? getSetting('email_smtp_host');
  const user = overrides.email_smtp_user ?? getSetting('email_smtp_user');
  const from = overrides.email_from      ?? getSetting('email_from');
  const to   = overrides.email_to        ?? getSetting('email_to');

  if (!host) throw new Error('SMTP host is not configured');
  if (!to)   throw new Error('Recipient email address is not configured');

  const transporter = await buildEmailTransport(overrides);

  await transporter.sendMail({
    from:    from || user,
    to,
    subject: subject(monitor, event),
    text:    plainText(monitor, event),
    html:    htmlBody(monitor, event),
  });
}

// ── Twilio SMS ────────────────────────────────────────────────────────────────

export async function sendTwilioAlert(monitor, event, overrides = {}) {
  const sid   = overrides.twilio_account_sid  ?? getSetting('twilio_account_sid');
  const token = overrides.twilio_auth_token   ?? getSetting('twilio_auth_token');
  const from  = overrides.twilio_from         ?? getSetting('twilio_from');
  const to    = overrides.twilio_to           ?? getSetting('twilio_to');

  if (!sid)   throw new Error('Twilio Account SID is not configured');
  if (!token) throw new Error('Twilio Auth Token is not configured');
  if (!from)  throw new Error('Twilio From number is not configured');
  if (!to)    throw new Error('Twilio To number is not configured');

  await got.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    username: sid,
    password: token,
    form: {
      From: from,
      To:   to,
      Body: plainText(monitor, event),
    },
  });
}

// ── Webhook ───────────────────────────────────────────────────────────────────

export async function sendWebhookAlert(monitor, event, overrides = {}) {
  const url = overrides.webhook_url ?? getSetting('webhook_url');
  if (!url?.trim()) throw new Error('Webhook URL is not configured');

  let webhookHostname;
  try { webhookHostname = new URL(url.trim()).hostname; } catch {
    throw new Error('Invalid webhook URL');
  }
  await assertNotSsrfTarget(webhookHostname);

  await got.post(url.trim(), {
    json: {
      event,
      monitor: {
        id:        monitor.id,
        label:     monitor.label,
        target:    monitor.target,
        checkType: monitor.checkType ?? 'http',
        tags:      monitor.tags ?? [],
      },
      timestamp: new Date().toISOString(),
    },
    timeout: { request: 10_000 },
  });
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function dispatchAlerts(monitor, event, overrides = {}) {
  const types = monitor.alertTypes ?? [];
  if (types.includes('None') && types.length === 1) return;

  const tasks = [];

  if (types.includes('Telegram') && getSetting('telegram_enabled') === '1') {
    tasks.push(
      sendTelegramAlert(monitor, event, overrides)
        .catch(e => console.error(`[alerter] Telegram failed for ${monitor.label}:`, e.message))
    );
  }
  if (types.includes('Email') && getSetting('email_enabled') === '1') {
    tasks.push(
      sendEmailAlert(monitor, event, overrides)
        .catch(e => console.error(`[alerter] Email failed for ${monitor.label}:`, e.message))
    );
  }
  if (types.includes('SMS') && getSetting('twilio_enabled') === '1') {
    tasks.push(
      sendTwilioAlert(monitor, event, overrides)
        .catch(e => console.error(`[alerter] Twilio failed for ${monitor.label}:`, e.message))
    );
  }
  if (types.includes('Webhook') && getSetting('webhook_enabled') === '1') {
    tasks.push(
      sendWebhookAlert(monitor, event, overrides)
        .catch(e => console.error(`[alerter] Webhook failed for ${monitor.label}:`, e.message))
    );
  }

  await Promise.allSettled(tasks);
}
