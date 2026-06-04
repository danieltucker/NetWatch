import { Router }      from 'express';
import { randomBytes } from 'node:crypto';
import got             from 'got';
import { getSetting, setSetting } from '../db/index.js';

const router = Router();

const TENANT    = 'common';
const AUTH_URL  = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const SCOPES    = 'https://outlook.office.com/SMTP.Send offline_access openid email';

// ── CSRF state store (in-memory, 10-minute TTL) ───────────────────────────────
const pendingStates = new Map();
const STATE_TTL_MS  = 10 * 60 * 1000;

function pruneStates() {
  const now = Date.now();
  for (const [s, { expires }] of pendingStates) {
    if (now > expires) pendingStates.delete(s);
  }
}

// ── GET /api/oauth/microsoft/start ────────────────────────────────────────────

router.get('/microsoft/start', (req, res) => {
  const clientId = getSetting('email_oauth_client_id');
  if (!clientId?.trim()) {
    return res.status(400).json({ error: 'Client ID is not configured. Save it first.' });
  }

  pruneStates();
  const state = randomBytes(16).toString('hex');
  pendingStates.set(state, { expires: Date.now() + STATE_TTL_MS });

  const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/microsoft/callback`;

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri',  redirectUri);
  url.searchParams.set('scope',         SCOPES);
  url.searchParams.set('state',         state);
  url.searchParams.set('prompt',        'select_account');

  res.json({ url: url.toString() });
});

// ── GET /api/oauth/microsoft/callback ─────────────────────────────────────────

router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    return res.send(callbackPage(null, error_description || error));
  }

  if (!state || !pendingStates.has(state)) {
    return res.send(callbackPage(null, 'Invalid or expired session. Please try connecting again.'));
  }
  pendingStates.delete(state);

  const clientId     = getSetting('email_oauth_client_id');
  const clientSecret = getSetting('email_oauth_client_secret');
  if (!clientSecret) {
    return res.send(callbackPage(null, 'Client Secret is not saved. Please save your settings first.'));
  }

  const redirectUri = `${req.protocol}://${req.get('host')}/api/oauth/microsoft/callback`;

  try {
    const tokenRes = await got.post(TOKEN_URL, {
      form: {
        client_id:     clientId,
        client_secret: clientSecret,
        code,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        scope:         SCOPES,
      },
    }).json();

    const { access_token, refresh_token, expires_in, id_token } = tokenRes;

    if (!access_token) throw new Error('No access token in response');

    // Extract the user's email from the id_token JWT payload
    let userEmail = '';
    if (id_token) {
      try {
        const payload = JSON.parse(
          Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8')
        );
        userEmail = payload.email || payload.preferred_username || '';
      } catch { /* non-fatal */ }
    }

    const expiry = new Date(Date.now() + Number(expires_in) * 1000).toISOString();

    setSetting('email_oauth_access_token',  access_token);
    setSetting('email_oauth_refresh_token', refresh_token || '');
    setSetting('email_oauth_token_expiry',  expiry);
    if (userEmail) setSetting('email_smtp_user', userEmail);

    res.send(callbackPage(userEmail, null));
  } catch (err) {
    let msg = err.message;
    try {
      const body = JSON.parse(err.response?.body ?? '{}');
      if (body.error_description) msg = body.error_description;
    } catch { /* use raw message */ }
    res.send(callbackPage(null, msg));
  }
});

// ── POST /api/oauth/microsoft/disconnect ──────────────────────────────────────

router.post('/microsoft/disconnect', (_req, res) => {
  setSetting('email_oauth_access_token',  '');
  setSetting('email_oauth_refresh_token', '');
  setSetting('email_oauth_token_expiry',  '');
  setSetting('email_smtp_user',           '');
  setSetting('email_auth_type',           'basic');
  res.json({ ok: true });
});

// ── Callback HTML page ────────────────────────────────────────────────────────
// Sends a postMessage to the opener and auto-closes after 1.5 s.

function callbackPage(email, error) {
  const message = error
    ? JSON.stringify({ type: 'ms-oauth-error',   error })
    : JSON.stringify({ type: 'ms-oauth-success', email: email || '' });

  const heading = error ? 'Connection failed'     : 'Connected successfully';
  const detail  = error ? String(error)           : 'You may close this window.';
  const color   = error ? '#ef4444'               : '#22c55e';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Microsoft OAuth</title></head>
<body style="font-family:monospace;background:#0d1117;color:#e6edf3;
             display:flex;align-items:center;justify-content:center;
             height:100vh;margin:0;padding:16px;box-sizing:border-box">
  <div style="text-align:center;max-width:480px">
    <div style="font-size:16px;color:${color};margin-bottom:8px">${heading}</div>
    <div style="font-size:13px;color:#8d96a0;line-height:1.5">${detail}</div>
  </div>
  <script>
    (function () {
      try { window.opener.postMessage(${message}, window.location.origin); } catch (e) {}
      setTimeout(function () { window.close(); }, 1500);
    })();
  </script>
</body>
</html>`;
}

export default router;
