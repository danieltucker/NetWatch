import { Router }                               from 'express';
import { getSetting, setSetting, getAllSettings } from '../db/index.js';
import { sendTelegramAlert, sendEmailAlert,
         sendTwilioAlert, sendWebhookAlert }      from '../alerter.js';
import { sendReport }                            from '../reporter.js';

const router = Router();

const KNOWN_KEYS = [
  'telegram_enabled', 'telegram_token', 'telegram_chat_id',
  'email_enabled', 'email_smtp_host', 'email_smtp_port',
  'email_smtp_user', 'email_smtp_pass', 'email_from', 'email_to',
  'email_auth_type',
  'email_oauth_client_id',
  'email_oauth_client_secret',
  'email_oauth_access_token',
  'email_oauth_refresh_token',
  'email_oauth_token_expiry',
  'twilio_enabled', 'twilio_account_sid', 'twilio_auth_token',
  'twilio_from', 'twilio_to',
  'webhook_enabled', 'webhook_url',
  'report_enabled', 'report_interval', 'report_time', 'report_tag_filter',
  'report_last_sent',
  'network_refs_enabled', 'network_refs_custom',
];

const SECRET_KEYS = new Set([
  'telegram_token', 'email_smtp_pass', 'twilio_auth_token',
  'twilio_account_sid', 'webhook_url',
  'email_oauth_client_secret', 'email_oauth_access_token', 'email_oauth_refresh_token',
]);

function isModuleSecret(key) {
  const field = key.split('.').slice(2).join('.');
  return field.endsWith('_token') || field.endsWith('_key') || field.endsWith('_secret');
}

// ── GET /api/settings ─────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  const stored = getAllSettings();
  const result = {};
  for (const key of KNOWN_KEYS) {
    const val = stored[key] ?? '';
    result[key] = (SECRET_KEYS.has(key) && val) ? '***' : val;
  }
  for (const [key, value] of Object.entries(stored)) {
    if (key.startsWith('module.')) {
      result[key] = (isModuleSecret(key) && value) ? '***' : value;
    }
  }
  res.json(result);
});

// ── PUT /api/settings ─────────────────────────────────────────────────────────

// These keys are written only by server-side processes, never from the UI PUT endpoint
const READ_ONLY_KEYS = new Set([
  'report_last_sent',
  'email_oauth_access_token',
  'email_oauth_refresh_token',
  'email_oauth_token_expiry',
]);

router.put('/', (req, res) => {
  for (const key of KNOWN_KEYS) {
    if (READ_ONLY_KEYS.has(key)) continue;
    if (key in req.body && req.body[key] !== '***') setSetting(key, req.body[key]);
  }
  for (const [key, value] of Object.entries(req.body)) {
    if (key.startsWith('module.') && value !== '***') setSetting(key, value);
  }
  res.json({ ok: true });
});

// ── POST /api/settings/test/:channel ─────────────────────────────────────────
// Accepts credentials directly in the body so the user can test before saving.

const TEST_MONITOR = { id: 'test', label: 'Test Monitor', target: 'watchtower.test', alertTypes: [] };

const testLastSent = new Map();
const TEST_RATE_LIMIT_MS = 30_000;

router.post('/test/:channel', async (req, res) => {
  const channel = req.params.channel;
  const now = Date.now();
  const last = testLastSent.get(channel) ?? 0;
  if (now - last < TEST_RATE_LIMIT_MS) {
    const waitSec = Math.ceil((TEST_RATE_LIMIT_MS - (now - last)) / 1000);
    return res.status(429).json({ error: `Please wait ${waitSec}s before testing again` });
  }
  testLastSent.set(channel, now);

  const overrides = req.body ?? {};
  try {
    switch (req.params.channel) {
      case 'telegram':
        await sendTelegramAlert(TEST_MONITOR, 'down', overrides);
        break;
      case 'email':
        await sendEmailAlert(TEST_MONITOR, 'down', overrides);
        break;
      case 'twilio':
        await sendTwilioAlert(TEST_MONITOR, 'down', overrides);
        break;
      case 'webhook':
        await sendWebhookAlert(TEST_MONITOR, 'down', overrides);
        break;
      case 'report': {
        const end   = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        await sendReport('Test', start.toISOString(), end.toISOString());
        break;
      }
      default:
        return res.status(400).json({ error: 'Unknown channel' });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
