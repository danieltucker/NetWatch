import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, Send, CheckCircle, AlertCircle, Loader, Bell, Settings2, SlidersHorizontal, Puzzle, ExternalLink, FileBarChart2, Plus, Wifi, Globe, Terminal, Palette, Key, Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useTheme, THEMES } from '../hooks/useTheme';
import { moduleRegistry } from '../modules/index.js';
import { NETWORK_REF_PRESETS, DEFAULT_NETWORK_REFS_ENABLED } from '../types/networkRefs.js';

const DEFAULT_SETTINGS = {
  telegram_enabled: '', telegram_token: '', telegram_chat_id: '',
  email_enabled: '', email_smtp_host: '', email_smtp_port: '587',
  email_smtp_user: '', email_smtp_pass: '', email_from: '', email_to: '',
  email_auth_type: '', email_oauth_client_id: '', email_oauth_client_secret: '',
  email_oauth_token_expiry: '',
  twilio_enabled: '', twilio_account_sid: '', twilio_auth_token: '',
  twilio_from: '', twilio_to: '',
  webhook_enabled: '', webhook_url: '',
  report_enabled: '', report_interval: 'weekly', report_time: '08:00', report_tag_filter: '',
};

const TABS = [
  { id: 'appearance',    label: 'Appearance',     Icon: Palette        },
  { id: 'general',       label: 'General',        Icon: SlidersHorizontal },
  { id: 'notifications', label: 'Notifications',  Icon: Bell           },
  { id: 'reports',       label: 'Reports',        Icon: FileBarChart2  },
  { id: 'network',       label: 'Network',        Icon: Wifi           },
  { id: 'modules',       label: 'Modules',        Icon: Puzzle         },
  { id: 'api-keys',      label: 'API Keys',       Icon: Key            },
];

// Required fields per channel — used for pre-save validation.
// Email uses getFields() because required fields differ between basic and OAuth2 auth.
const CHANNEL_VALIDATION = [
  { label: 'Telegram', enabledKey: 'telegram_enabled',
    fields: ['telegram_token', 'telegram_chat_id'] },
  { label: 'Email',    enabledKey: 'email_enabled',
    getFields: (s) => s.email_auth_type === 'oauth2'
      ? ['email_smtp_host', 'email_smtp_port', 'email_oauth_client_id',
         'email_oauth_client_secret', 'email_smtp_user', 'email_from', 'email_to']
      : ['email_smtp_host', 'email_smtp_port', 'email_smtp_user',
         'email_smtp_pass', 'email_from', 'email_to'] },
  { label: 'SMS',      enabledKey: 'twilio_enabled',
    fields: ['twilio_account_sid', 'twilio_auth_token', 'twilio_from', 'twilio_to'] },
  { label: 'Webhook',  enabledKey: 'webhook_enabled',
    fields: ['webhook_url'] },
];

// ── SettingsPanel ─────────────────────────────────────────────────────────────

export function SettingsPanel({ onClose, chartYMax = 'auto', onChartYMaxChange, alertsAutoOpen = 'outage', onAlertsAutoOpenChange }) {
  const { t, isDark, themeMode, setThemeMode, themeName, setThemeName } = useTheme();
  const [activeTab,        setActiveTab]        = useState('appearance');
  const [mobileContentOpen, setMobileContentOpen] = useState(false);
  const [settings,      setSettings]      = useState(DEFAULT_SETTINGS);
  const [moduleSettings, setModuleSettings] = useState({});  // module.* keys
  const [moduleSaving,   setModuleSaving]   = useState({});  // moduleId → bool
  const [moduleSaved,    setModuleSaved]    = useState({});  // moduleId → bool
  const [networkRefsEnabled, setNetworkRefsEnabled] = useState(DEFAULT_NETWORK_REFS_ENABLED);
  const [networkRefsCustom,  setNetworkRefsCustom]  = useState([]);
  const [reportLastSent, setReportLastSent] = useState('');
  const [saving,        setSaving]        = useState(false);
  const [saved,         setSaved]         = useState(false);
  const [saveError,     setSaveError]     = useState('');
  const [invalidFields, setInvalidFields] = useState(new Set());
  const [testState,     setTestState]     = useState({});

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        // Separate module.* keys from notification keys
        const notifData  = {};
        const moduleData = {};
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith('module.')) {
            moduleData[k] = v;
          } else if (k === 'report_last_sent') {
            setReportLastSent(v);
          } else if (k === 'network_refs_enabled') {
            try { setNetworkRefsEnabled(v ? JSON.parse(v) : DEFAULT_NETWORK_REFS_ENABLED); }
            catch { setNetworkRefsEnabled(DEFAULT_NETWORK_REFS_ENABLED); }
          } else if (k === 'network_refs_custom') {
            try { setNetworkRefsCustom(v ? JSON.parse(v) : []); }
            catch { setNetworkRefsCustom([]); }
          } else {
            notifData[k] = v;
          }
        }
        setSettings(s => ({ ...s, ...notifData }));
        setModuleSettings(moduleData);
      })
      .catch(console.error);
  }, []);

  const saveModuleSettings = async (moduleId, fields) => {
    setModuleSaving(p => ({ ...p, [moduleId]: true }));
    try {
      const payload = {};
      for (const [k, v] of Object.entries(fields)) {
        payload[`module.${moduleId}.${k}`] = v;
      }
      await fetch('/api/settings', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      setModuleSettings(prev => ({ ...prev, ...payload }));
      setModuleSaved(p => ({ ...p, [moduleId]: true }));
      setTimeout(() => setModuleSaved(p => ({ ...p, [moduleId]: false })), 2500);
    } catch (err) {
      console.error('[modules] save failed:', err);
    } finally {
      setModuleSaving(p => ({ ...p, [moduleId]: false }));
    }
  };

  const set = (key, val) => {
    setSettings(s => ({ ...s, [key]: val }));
    // Clear the error highlight for this field as soon as the user edits it
    setInvalidFields(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      if (next.size === 0) setSaveError('');
      return next;
    });
  };

  const save = async () => {
    // Validate: every enabled channel must have all required fields filled
    const missing  = new Set();
    const badNames = [];

    for (const { label, enabledKey, fields, getFields } of CHANNEL_VALIDATION) {
      if (settings[enabledKey] !== '1') continue;
      const effectiveFields = getFields ? getFields(settings) : fields;
      const empty = effectiveFields.filter(f => !settings[f]?.trim());
      if (empty.length > 0) {
        empty.forEach(f => missing.add(f));
        badNames.push(label);
      }
    }

    if (missing.size > 0) {
      setSaveError(
        `${badNames.join(' and ')} ${badNames.length === 1 ? 'is' : 'are'} enabled but ` +
        `missing required fields. Please fill in the highlighted fields before saving.`
      );
      setInvalidFields(missing);
      return;
    }

    // Validate report settings when enabled
    if (settings.report_enabled === '1') {
      if (!settings.email_smtp_host?.trim() || !settings.email_to?.trim()) {
        setSaveError('Reports require Email to be configured in the Notifications tab first.');
        return;
      }
      if (!settings.report_time?.trim()) {
        setSaveError('Please set a send time for reports.');
        setInvalidFields(new Set(['report_time']));
        return;
      }
    }

    setSaveError('');
    setInvalidFields(new Set());
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...settings,
          network_refs_enabled: JSON.stringify(networkRefsEnabled),
          network_refs_custom:  JSON.stringify(networkRefsCustom),
        }),
      });
      await syncNetworkRefs(networkRefsEnabled, networkRefsCustom);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('[settings] save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const syncNetworkRefs = async (enabledTargets, customRefs) => {
    try {
      const res = await fetch('/api/monitors?window=1h');
      if (!res.ok) return;
      const allMonitors = await res.json();
      const currentRefs = allMonitors.filter(m => m.tags?.includes('_ref'));

      const enabledPresets = NETWORK_REF_PRESETS.filter(p => enabledTargets.includes(p.target));
      const desired = [...enabledPresets, ...customRefs];
      const desiredTargetSet = new Set(desired.map(d => d.target));
      const currentTargetSet = new Set(currentRefs.map(m => m.target));

      for (const entry of desired) {
        if (!currentTargetSet.has(entry.target)) {
          await fetch('/api/monitors', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              label:       entry.label,
              target:      entry.target,
              checkType:   entry.checkType,
              interval:    60,
              tags:        ['_ref'],
              alertTypes:  ['None'],
              description: 'Network reference',
            }),
          });
        }
      }

      for (const ref of currentRefs) {
        if (!desiredTargetSet.has(ref.target)) {
          await fetch(`/api/monitors/${ref.id}`, { method: 'DELETE' });
        }
      }
    } catch (err) {
      console.error('[network-refs] sync failed:', err);
    }
  };

  const test = async (channel) => {
    setTestState(s => ({ ...s, [channel]: 'loading' }));
    try {
      const overrides = Object.fromEntries(
        Object.entries(settings).filter(([, v]) => v !== '***')
      );
      const res = await fetch(`/api/settings/test/${channel}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(overrides),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');
      setTestState(s => ({ ...s, [channel]: 'ok' }));
    } catch (err) {
      setTestState(s => ({ ...s, [channel]: err.message }));
    } finally {
      setTimeout(() => setTestState(s => ({ ...s, [channel]: null })), 5000);
    }
  };

  const inputCls   = 'w-full rounded-lg border px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 transition-all';
  const inputStyle = { backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder };

  const sidebarBg = isDark ? '#12171e' : '#f0f3f6';

  const activeTabDef = TABS.find(tab => tab.id === activeTab);
  const contentSubtitle =
    activeTab === 'appearance'    ? 'Theme and visual preferences'              :
    activeTab === 'general'       ? 'Dashboard-wide display preferences'        :
    activeTab === 'notifications' ? 'Configure alert delivery channels'         :
    activeTab === 'reports'       ? 'Schedule periodic email status reports'    :
    activeTab === 'network'       ? 'Configure network reference monitors'      :
    activeTab === 'api-keys'      ? 'Manage API keys for external integrations' :
                                    'Install modules and manage credentials';

  return (
    <div
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      {/* Modal — full screen on mobile, floating panel on desktop */}
      <div
        className="flex w-full h-full sm:rounded-2xl sm:border sm:shadow-2xl overflow-hidden sm:w-full sm:max-w-[760px] sm:h-[680px] sm:max-h-[calc(100vh-2rem)]"
        style={{
          backgroundColor: sidebarBg,
          borderColor:     t.cardBorder,
          boxShadow: isDark
            ? '0 25px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05)'
            : '0 25px 80px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.06)',
        }}>

        {/* ── Sidebar — full width on mobile (tab list view), fixed 200px on desktop ── */}
        <aside
          className={`${mobileContentOpen ? 'hidden sm:flex' : 'flex'} flex-col w-full sm:w-[200px] shrink-0`}
          style={{ background: sidebarBg, borderRight: `1px solid ${t.cardBorder}` }}>

          {/* Mobile header: title + close button */}
          <div className="flex items-center justify-between px-5 pt-6 pb-3 sm:hidden">
            <div className="flex items-center gap-2.5">
              <Settings2 size={15} style={{ color: '#60a5fa' }} />
              <span className="text-sm font-mono font-bold uppercase tracking-[0.15em]"
                style={{ color: t.textSecondary }}>
                Settings
              </span>
            </div>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-mono font-medium transition-colors"
              style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
              <X size={14} /> Close
            </button>
          </div>

          {/* Desktop header: brand only */}
          <div className="hidden sm:block px-5 pt-6 pb-4">
            <div className="flex items-center gap-2.5 mb-1">
              <Settings2 size={14} style={{ color: '#60a5fa' }} />
              <span className="text-xs font-mono font-bold uppercase tracking-[0.15em]"
                style={{ color: t.textSecondary }}>
                Settings
              </span>
            </div>
            <div className="h-px mt-3" style={{ backgroundColor: t.cardBorder }} />
          </div>

          {/* Divider below mobile header */}
          <div className="sm:hidden mx-5 mb-2 h-px" style={{ backgroundColor: t.cardBorder }} />

          {/* Tab list */}
          <nav className="flex-1 px-3 space-y-0.5 py-1">
            {TABS.map(({ id, label, Icon }) => {
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => { setActiveTab(id); setMobileContentOpen(true); }}
                  className="w-full flex items-center gap-3 px-3 py-3.5 sm:py-2.5 rounded-lg text-sm font-mono transition-all text-left"
                  style={{
                    color:           isActive ? '#60a5fa' : t.textMuted,
                    backgroundColor: isActive
                      ? isDark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.08)'
                      : 'transparent',
                    fontWeight: isActive ? 600 : 400,
                    borderLeft: isActive ? '2px solid #60a5fa' : '2px solid transparent',
                  }}>
                  <Icon size={15} style={{ flexShrink: 0, opacity: isActive ? 1 : 0.6 }} />
                  {label}
                </button>
              );
            })}
          </nav>

          {/* Version label — desktop only */}
          <div className="hidden sm:block px-5 py-5">
            <div className="text-xs font-mono" style={{ color: t.textFaint }}>
              NetWatch v6.4.3
            </div>
          </div>
        </aside>

        {/* ── Content panel — hidden on mobile until a tab is selected ── */}
        <div className={`${mobileContentOpen ? 'flex' : 'hidden sm:flex'} flex-1 flex-col min-w-0`}>

          {/* Content header */}
          <div className="flex items-center gap-3 px-5 sm:px-7 pt-5 sm:pt-6 pb-4 shrink-0">

            {/* Back button — mobile only */}
            <button
              onClick={() => setMobileContentOpen(false)}
              className="sm:hidden flex items-center gap-1 px-2 py-1.5 -ml-1 rounded-lg text-sm font-mono transition-colors"
              style={{ color: '#60a5fa' }}>
              <ChevronLeft size={16} />
              Back
            </button>

            {/* Title block */}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold font-mono"
                style={{ color: t.textPrimary }}>
                {activeTabDef?.label}
              </h2>
              <p className="text-xs font-mono mt-0.5 hidden sm:block" style={{ color: t.textMuted }}>
                {contentSubtitle}
              </p>
            </div>

            {/* Close — unified "✕ Close" pill on all screen sizes */}
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-mono font-medium transition-colors"
              style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}>
              <X size={14} /> Close
            </button>
          </div>

          {/* Divider */}
          <div className="mx-5 sm:mx-7 mb-4 sm:mb-5 h-px" style={{ backgroundColor: t.cardBorder }} />

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 sm:px-7 pb-4">
            {activeTab === 'appearance' && (
              <AppearanceTab
                themeMode={themeMode}
                setThemeMode={setThemeMode}
                themeName={themeName}
                setThemeName={setThemeName}
                isDark={isDark}
                t={t}
              />
            )}
            {activeTab === 'general' && (
              <GeneralTab
                chartYMax={chartYMax}
                onChartYMaxChange={onChartYMaxChange}
                alertsAutoOpen={alertsAutoOpen}
                onAlertsAutoOpenChange={onAlertsAutoOpenChange}
                t={t}
                isDark={isDark}
              />
            )}
            {activeTab === 'reports' && (
              <ReportsTab
                settings={settings}
                set={set}
                reportLastSent={reportLastSent}
                invalidFields={invalidFields}
                inputCls={inputCls}
                inputStyle={inputStyle}
                t={t}
                isDark={isDark}
              />
            )}
            {activeTab === 'network' && (
              <NetworkTab
                networkRefsEnabled={networkRefsEnabled}
                setNetworkRefsEnabled={setNetworkRefsEnabled}
                networkRefsCustom={networkRefsCustom}
                setNetworkRefsCustom={setNetworkRefsCustom}
                t={t}
                isDark={isDark}
              />
            )}
            {activeTab === 'modules' && (
              <ModulesTab
                moduleSettings={moduleSettings}
                onSaveModuleSettings={saveModuleSettings}
                moduleSaving={moduleSaving}
                moduleSaved={moduleSaved}
                t={t}
                isDark={isDark}
              />
            )}
            {activeTab === 'api-keys' && (
              <ApiKeysTab t={t} isDark={isDark} />
            )}
            {activeTab === 'notifications' && (
              <NotificationsTab
                settings={settings}
                set={set}
                testState={testState}
                test={test}
                inputCls={inputCls}
                inputStyle={inputStyle}
                invalidFields={invalidFields}
                t={t}
                isDark={isDark}
              />
            )}
          </div>

          {/* Footer — save on Notifications, Reports, and Network tabs */}
          {(activeTab === 'notifications' || activeTab === 'reports' || activeTab === 'network') && (
            <div
              className="flex items-center justify-between gap-4 px-5 sm:px-7 py-4 border-t shrink-0"
              style={{ borderColor: t.cardBorder }}>
              {saveError
                ? <span className="flex items-center gap-1.5 text-xs font-mono text-red-400 leading-snug">
                    <AlertCircle size={13} className="shrink-0" />
                    {saveError}
                  </span>
                : <span className="text-xs font-mono hidden sm:block" style={{ color: t.textFaint }}>
                    {activeTab === 'reports'
                      ? 'Reports use the Email channel configured in Notifications'
                      : activeTab === 'network'
                        ? 'Reference monitors update immediately after saving'
                        : 'Enable channels per monitor in the Edit form'}
                  </span>
              }
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 sm:py-2 rounded-lg text-sm sm:text-xs font-mono font-bold transition-all disabled:opacity-60 shrink-0 ml-auto"
                style={{
                  background: saved ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  boxShadow: saved ? '0 2px 12px rgba(34,197,94,0.35)' : '0 2px 12px rgba(59,130,246,0.35)',
                }}>
                {saving ? <><Loader size={12} className="animate-spin" /> Saving…</> :
                 saved  ? <><CheckCircle size={12} /> Saved</> :
                          'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

const CHART_Y_OPTIONS = [
  { label: 'Auto',   value: 'auto' },
  { label: '250ms',  value: '250'  },
  { label: '500ms',  value: '500'  },
  { label: '750ms',  value: '750'  },
];

function GeneralTab({ chartYMax, onChartYMaxChange, alertsAutoOpen, onAlertsAutoOpenChange, t, isDark }) {
  return (
    <div className="space-y-3">
      <SettingRow
        title="Chart scale"
        description="Maximum ping value shown on all graphs. Auto adjusts to your data; a fixed value lets you compare monitors side by side on the same scale."
        t={t}
        isDark={isDark}>
        <select
          value={chartYMax}
          onChange={e => onChartYMaxChange?.(e.target.value)}
          className="text-xs font-mono rounded-lg border px-2.5 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          style={{ backgroundColor: t.inputBg, color: t.textSecondary, borderColor: t.cardBorder }}>
          {CHART_Y_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </SettingRow>

      <SettingRow
        title="Auto-open alerts panel"
        description="Automatically expand the alerts panel when a new alert is detected via live updates."
        t={t}
        isDark={isDark}>
        <select
          value={alertsAutoOpen}
          onChange={e => onAlertsAutoOpenChange?.(e.target.value)}
          className="text-xs font-mono rounded-lg border px-2.5 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30"
          style={{ backgroundColor: t.inputBg, color: t.textSecondary, borderColor: t.cardBorder }}>
          <option value="outage">On outage only</option>
          <option value="both">On any alert</option>
          <option value="never">Never</option>
        </select>
      </SettingRow>
    </div>
  );
}

// ── Notifications tab ─────────────────────────────────────────────────────────

const SMTP_PRESETS = [
  { name: 'Gmail',   host: 'smtp.gmail.com',        port: '587', authType: 'basic',
    note: 'Gmail requires an App Password. Enable 2-Step Verification, then generate one at myaccount.google.com → Security → App Passwords.' },
  { name: 'Outlook', host: 'smtp-mail.outlook.com', port: '587', authType: 'oauth2',
    note: 'Microsoft requires OAuth2. Register an app in the Azure Portal, then enter your Client ID and Secret below and click Connect.' },
  { name: 'Yahoo',   host: 'smtp.mail.yahoo.com',   port: '587', authType: 'basic',
    note: 'Yahoo requires an App Password. Go to Yahoo Account Security and generate one under "Generate app password".' },
  { name: 'iCloud',  host: 'smtp.mail.me.com',      port: '587', authType: 'basic',
    note: 'iCloud requires an App-Specific Password. Generate one at appleid.apple.com → Sign-In and Security → App-Specific Passwords.' },
];

function NotificationsTab({ settings, set, testState, test, inputCls, inputStyle, invalidFields, t, isDark }) {
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthError,      setOauthError]      = useState('');

  const isOAuthConnected = !!(settings.email_smtp_user && settings.email_oauth_token_expiry);

  const startOAuthConnect = async () => {
    setOauthConnecting(true);
    setOauthError('');
    try {
      // Pre-save client credentials so the callback handler can read them from the DB
      await fetch('/api/settings', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_auth_type:       settings.email_auth_type,
          email_oauth_client_id: settings.email_oauth_client_id,
          ...(settings.email_oauth_client_secret !== '***'
            ? { email_oauth_client_secret: settings.email_oauth_client_secret }
            : {}),
        }),
      });
      const res = await fetch('/api/oauth/microsoft/start');
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start OAuth flow');
      }
      const { url } = await res.json();
      const popup = window.open(url, 'ms-oauth', 'width=600,height=700,scrollbars=yes');

      let closedPoll;
      const handler = (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data?.type === 'ms-oauth-success') {
          window.removeEventListener('message', handler);
          clearInterval(closedPoll);
          setOauthConnecting(false);
          fetch('/api/settings').then(r => r.json()).then(data => {
            if (data.email_smtp_user)          set('email_smtp_user',          data.email_smtp_user);
            if (data.email_oauth_token_expiry) set('email_oauth_token_expiry', data.email_oauth_token_expiry);
          });
        } else if (e.data?.type === 'ms-oauth-error') {
          window.removeEventListener('message', handler);
          clearInterval(closedPoll);
          setOauthConnecting(false);
          setOauthError(e.data.error || 'Authentication failed');
        }
      };
      window.addEventListener('message', handler);
      closedPoll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(closedPoll);
          window.removeEventListener('message', handler);
          setOauthConnecting(false);
        }
      }, 500);
    } catch (err) {
      setOauthConnecting(false);
      setOauthError(err.message);
    }
  };

  const disconnectOAuth = async () => {
    await fetch('/api/oauth/microsoft/disconnect', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    '{}',
    });
    set('email_smtp_user',          '');
    set('email_oauth_token_expiry', '');
    set('email_auth_type',          'basic');
  };

  // Returns input style with red border when the field has a validation error
  const fs = (key) => invalidFields.has(key)
    ? { ...inputStyle, borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' }
    : inputStyle;

  // Whether any field in a set of keys is invalid (used to flag the channel card)
  const channelHasError = (...keys) => keys.some(k => invalidFields.has(k));

  return (
    <div className="space-y-4">
      <Channel
        title="Telegram"
        description="Free push notifications via Telegram Bot API"
        enabled={settings.telegram_enabled === '1'}
        hasError={channelHasError('telegram_token', 'telegram_chat_id')}
        onToggle={v => set('telegram_enabled', v ? '1' : '')}
        testState={testState.telegram}
        onTest={() => test('telegram')}
        t={t}
        isDark={isDark}>
        <Field label="Bot Token" invalid={invalidFields.has('telegram_token')} t={t}>
          <input type="password"
            value={settings.telegram_token}
            onChange={e => set('telegram_token', e.target.value)}
            placeholder="123456:ABC-DEF..."
            className={inputCls} style={fs('telegram_token')} />
        </Field>
        <Field label="Chat ID" invalid={invalidFields.has('telegram_chat_id')} t={t}>
          <input value={settings.telegram_chat_id}
            onChange={e => set('telegram_chat_id', e.target.value)}
            placeholder="-1001234567890"
            className={inputCls} style={fs('telegram_chat_id')} />
        </Field>
      </Channel>

      <Channel
        title="Email"
        description="SMTP delivery — works with Gmail App Passwords, Outlook OAuth2, or any SMTP relay"
        enabled={settings.email_enabled === '1'}
        hasError={channelHasError('email_smtp_host', 'email_smtp_port', 'email_smtp_user', 'email_smtp_pass',
                                  'email_oauth_client_id', 'email_oauth_client_secret', 'email_from', 'email_to')}
        onToggle={v => set('email_enabled', v ? '1' : '')}
        testState={testState.email}
        onTest={() => test('email')}
        t={t}
        isDark={isDark}>

        {/* ── Provider presets ── */}
        {(() => {
          const active   = SMTP_PRESETS.find(p => p.host === settings.email_smtp_host) ?? null;
          const isOAuth2 = settings.email_auth_type === 'oauth2';
          return (
            <>
              <div className="space-y-2 pb-1">
                <div className="text-xs font-mono uppercase tracking-wider" style={{ color: t.textMuted }}>
                  Quick setup
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {SMTP_PRESETS.map(p => {
                    const isActive = p.host === settings.email_smtp_host;
                    return (
                      <button
                        key={p.name}
                        type="button"
                        onClick={() => {
                          set('email_smtp_host', p.host);
                          set('email_smtp_port', p.port);
                          set('email_auth_type', p.authType || 'basic');
                        }}
                        className="px-3 py-1.5 rounded-lg border text-xs font-mono font-medium transition-all"
                        style={{
                          backgroundColor: isActive
                            ? isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)'
                            : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                          borderColor: isActive ? '#60a5fa' : t.cardBorder,
                          color:       isActive ? '#60a5fa' : t.textSecondary,
                        }}>
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                {active?.note && (
                  <div className="flex items-start gap-1.5 text-xs font-mono leading-relaxed"
                    style={{ color: t.textMuted }}>
                    <AlertCircle size={11} className="mt-0.5 shrink-0" style={{ color: '#f59e0b' }} />
                    {active.note}
                    {active.authType === 'oauth2' && (
                      <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer"
                        className="ml-1 underline" style={{ color: '#60a5fa' }}>
                        Azure Portal
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="SMTP Host" invalid={invalidFields.has('email_smtp_host')} t={t}>
                  <input value={settings.email_smtp_host}
                    onChange={e => set('email_smtp_host', e.target.value)}
                    placeholder="smtp.gmail.com"
                    className={inputCls} style={fs('email_smtp_host')} />
                </Field>
                <Field label="Port" invalid={invalidFields.has('email_smtp_port')} t={t}>
                  <input value={settings.email_smtp_port}
                    onChange={e => set('email_smtp_port', e.target.value)}
                    placeholder="587"
                    className={inputCls} style={fs('email_smtp_port')} />
                </Field>
              </div>

              {isOAuth2 ? (
                <>
                  <Field label="Client ID" invalid={invalidFields.has('email_oauth_client_id')} t={t}>
                    <input value={settings.email_oauth_client_id}
                      onChange={e => set('email_oauth_client_id', e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={inputCls} style={fs('email_oauth_client_id')} />
                  </Field>
                  <Field label="Client Secret" invalid={invalidFields.has('email_oauth_client_secret')} t={t}>
                    <input type="password"
                      value={settings.email_oauth_client_secret}
                      onChange={e => set('email_oauth_client_secret', e.target.value)}
                      placeholder="••••••••••••••••"
                      className={inputCls} style={fs('email_oauth_client_secret')} />
                  </Field>
                  <div>
                    {isOAuthConnected ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
                        style={{
                          background:  isDark ? 'rgba(34,197,94,0.08)' : 'rgba(34,197,94,0.06)',
                          border:      '1px solid rgba(34,197,94,0.2)',
                        }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                          <span className="text-xs font-mono truncate" style={{ color: t.textSecondary }}>
                            {settings.email_smtp_user}
                          </span>
                        </div>
                        <button type="button" onClick={disconnectOAuth}
                          className="text-xs font-mono px-2 py-0.5 rounded flex-shrink-0"
                          style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <button type="button" onClick={startOAuthConnect}
                          disabled={oauthConnecting || !settings.email_oauth_client_id?.trim()}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-mono font-medium transition-all"
                          style={{
                            background: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(59,130,246,0.1)',
                            border:     '1px solid rgba(96,165,250,0.3)',
                            color:      '#60a5fa',
                            opacity:    (!settings.email_oauth_client_id?.trim() || oauthConnecting) ? 0.5 : 1,
                            cursor:     (!settings.email_oauth_client_id?.trim() || oauthConnecting) ? 'not-allowed' : 'pointer',
                          }}>
                          {oauthConnecting
                            ? <><Loader size={12} className="animate-spin" />&nbsp;Connecting…</>
                            : 'Connect Microsoft Account'}
                        </button>
                        {invalidFields.has('email_smtp_user') && (
                          <div className="text-xs font-mono" style={{ color: '#ef4444' }}>
                            Microsoft account not connected — click Connect above
                          </div>
                        )}
                        {oauthError && (
                          <div className="text-xs font-mono leading-relaxed" style={{ color: '#ef4444' }}>
                            {oauthError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <Field label="Username" invalid={invalidFields.has('email_smtp_user')} t={t}>
                    <input value={settings.email_smtp_user}
                      onChange={e => set('email_smtp_user', e.target.value)}
                      placeholder="you@gmail.com"
                      className={inputCls} style={fs('email_smtp_user')} />
                  </Field>
                  <Field label="Password / App Password" invalid={invalidFields.has('email_smtp_pass')} t={t}>
                    <input type="password"
                      value={settings.email_smtp_pass}
                      onChange={e => set('email_smtp_pass', e.target.value)}
                      placeholder="••••••••••••••••"
                      className={inputCls} style={fs('email_smtp_pass')} />
                  </Field>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="From" invalid={invalidFields.has('email_from')} t={t}>
                  <input value={settings.email_from}
                    onChange={e => set('email_from', e.target.value)}
                    placeholder="alerts@example.com"
                    className={inputCls} style={fs('email_from')} />
                </Field>
                <Field label="To" invalid={invalidFields.has('email_to')} t={t}>
                  <input value={settings.email_to}
                    onChange={e => set('email_to', e.target.value)}
                    placeholder="you@example.com"
                    className={inputCls} style={fs('email_to')} />
                </Field>
              </div>
            </>
          );
        })()}
      </Channel>

      <Channel
        title="SMS via Twilio"
        description="Paid per message (~$0.008/msg) — requires a Twilio account and purchased phone number"
        enabled={settings.twilio_enabled === '1'}
        hasError={channelHasError('twilio_account_sid', 'twilio_auth_token', 'twilio_from', 'twilio_to')}
        onToggle={v => set('twilio_enabled', v ? '1' : '')}
        testState={testState.twilio}
        onTest={() => test('twilio')}
        t={t}
        isDark={isDark}>
        <Field label="Account SID" invalid={invalidFields.has('twilio_account_sid')} t={t}>
          <input value={settings.twilio_account_sid}
            onChange={e => set('twilio_account_sid', e.target.value)}
            placeholder="ACxxxxxxxxxxxxxxxx"
            className={inputCls} style={fs('twilio_account_sid')} />
        </Field>
        <Field label="Auth Token" invalid={invalidFields.has('twilio_auth_token')} t={t}>
          <input type="password"
            value={settings.twilio_auth_token}
            onChange={e => set('twilio_auth_token', e.target.value)}
            placeholder="••••••••••••••••"
            className={inputCls} style={fs('twilio_auth_token')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From Number" invalid={invalidFields.has('twilio_from')} t={t}>
            <input value={settings.twilio_from}
              onChange={e => set('twilio_from', e.target.value)}
              placeholder="+15551234567"
              className={inputCls} style={fs('twilio_from')} />
          </Field>
          <Field label="To Number" invalid={invalidFields.has('twilio_to')} t={t}>
            <input value={settings.twilio_to}
              onChange={e => set('twilio_to', e.target.value)}
              placeholder="+15559876543"
              className={inputCls} style={fs('twilio_to')} />
          </Field>
        </div>
      </Channel>

      <Channel
        title="Webhook"
        description="POST a JSON payload to any URL — works with Slack, Discord, n8n, Zapier, Make, and more"
        enabled={settings.webhook_enabled === '1'}
        hasError={channelHasError('webhook_url')}
        onToggle={v => set('webhook_enabled', v ? '1' : '')}
        testState={testState.webhook}
        onTest={() => test('webhook')}
        t={t}
        isDark={isDark}>
        <Field label="Webhook URL" invalid={invalidFields.has('webhook_url')} t={t}>
          <input value={settings.webhook_url}
            onChange={e => set('webhook_url', e.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            className={inputCls} style={fs('webhook_url')} />
        </Field>
      </Channel>
    </div>
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

function ReportsTab({ settings, set, reportLastSent, invalidFields, inputCls, inputStyle, t, isDark }) {
  const [testState, setTestState] = useState(null); // null | 'loading' | 'ok' | errorString

  const fmtLastSent = reportLastSent
    ? new Date(reportLastSent).toLocaleString()
    : 'Never';

  const rowBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  const timeStyle = invalidFields.has('report_time')
    ? { ...inputStyle, borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' }
    : inputStyle;

  const sendTest = async () => {
    setTestState('loading');
    try {
      const res  = await fetch('/api/settings/test/report', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test failed');
      setTestState('ok');
    } catch (err) {
      setTestState(err.message);
    } finally {
      setTimeout(() => setTestState(null), 6000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <SettingRow
        title="Enable reports"
        description="Send a periodic email summary covering uptime, average ping, and incident counts for all your monitors."
        t={t}
        isDark={isDark}>
        <Toggle
          enabled={settings.report_enabled === '1'}
          onToggle={v => set('report_enabled', v ? '1' : '')}
          isDark={isDark}
        />
      </SettingRow>

      {/* Config card — always visible so users can configure before enabling */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: t.cardBorder }}>
        <div
          className="px-5 py-3 border-b"
          style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider"
            style={{ color: t.textSecondary }}>
            Schedule
          </div>
        </div>

        <div className="px-5 py-4 space-y-4" style={{ backgroundColor: t.cardBg }}>
          {/* Frequency */}
          <div>
            <label className="block text-xs font-mono font-medium uppercase tracking-wider mb-1.5"
              style={{ color: t.textMuted }}>
              Frequency
            </label>
            <select
              value={settings.report_interval}
              onChange={e => set('report_interval', e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-sm font-mono appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 transition-all"
              style={{ backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder }}>
              <option value="daily">Daily — every 24 hours</option>
              <option value="weekly">Weekly — every 7 days</option>
              <option value="monthly">Monthly — every 30 days</option>
            </select>
          </div>

          {/* Time */}
          <div>
            <label className="block text-xs font-mono font-medium uppercase tracking-wider mb-1.5"
              style={{ color: t.textMuted }}>
              Send time <span style={{ color: t.textFaint }}>(server local time, 24-hour)</span>
            </label>
            <input
              type="time"
              value={settings.report_time}
              onChange={e => set('report_time', e.target.value)}
              className={inputCls}
              style={timeStyle}
            />
          </div>

          {/* Tag filter */}
          <div>
            <label className="block text-xs font-mono font-medium uppercase tracking-wider mb-1.5"
              style={{ color: t.textMuted }}>
              Tag filter <span style={{ color: t.textFaint }}>(optional — blank = all monitors)</span>
            </label>
            <input
              type="text"
              value={settings.report_tag_filter}
              onChange={e => set('report_tag_filter', e.target.value)}
              placeholder="e.g. production"
              className={inputCls}
              style={inputStyle}
            />
          </div>
        </div>
      </div>

      {/* Last sent + test button */}
      <div
        className="rounded-xl border px-5 py-4"
        style={{ borderColor: t.cardBorder, backgroundColor: rowBg }}>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-mono font-semibold uppercase tracking-wider mb-0.5"
              style={{ color: t.textSecondary }}>
              Last report sent
            </div>
            <div className="text-sm font-mono truncate"
              style={{ color: reportLastSent ? t.textPrimary : t.textFaint }}>
              {fmtLastSent}
            </div>
          </div>

          {/* Test button */}
          <button
            onClick={sendTest}
            disabled={testState === 'loading'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-mono font-medium transition-all shrink-0 disabled:opacity-50"
            style={{
              color:           testState === 'ok' ? '#22c55e' : testState && testState !== 'loading' ? '#ef4444' : t.textSecondary,
              borderColor:     testState === 'ok' ? '#22c55e' : testState && testState !== 'loading' ? '#ef4444' : t.cardBorder,
              backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
            }}>
            {testState === 'loading' ? (
              <><Loader size={12} className="animate-spin" /> Sending…</>
            ) : testState === 'ok' ? (
              <><CheckCircle size={12} /> Sent</>
            ) : testState ? (
              <><AlertCircle size={12} /> Failed</>
            ) : (
              <><Send size={12} /> Send test</>
            )}
          </button>
        </div>

        {/* Inline error from test */}
        {testState && testState !== 'loading' && testState !== 'ok' && (
          <div className="mt-2 text-xs font-mono text-red-400 leading-snug">
            {testState}
          </div>
        )}
      </div>

      {/* Info note */}
      <div
        className="rounded-xl border px-5 py-4 space-y-1.5"
        style={{ borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.04)' }}>
        <div className="text-xs font-mono font-semibold" style={{ color: '#60a5fa' }}>
          How reports work
        </div>
        <div className="text-xs font-mono leading-relaxed" style={{ color: t.textMuted }}>
          Reports use the SMTP credentials from the{' '}
          <span style={{ color: t.textSecondary }}>Notifications</span> tab — the Email channel
          does not need to be enabled for alerts, only configured. Each report covers the full
          period since the previous send. The test button sends a 24-hour preview immediately.
        </div>
      </div>
    </div>
  );
}

// ── Modules tab ───────────────────────────────────────────────────────────────

function ModulesTab({ moduleSettings, onSaveModuleSettings, moduleSaving, moduleSaved, t, isDark }) {
  const mods = [...moduleRegistry.values()];

  if (mods.length === 0) {
    return (
      <div className="py-12 text-center text-xs font-mono" style={{ color: t.textMuted }}>
        No modules installed. See MODULES.md to build your own.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {mods.map(mod => {
        const localValues = {};
        for (const field of mod.settingsSchema ?? []) {
          localValues[field.key] = moduleSettings[`module.${mod.id}.${field.key}`] ?? '';
        }

        return (
          <ModuleSection
            key={mod.id}
            mod={mod}
            localValues={localValues}
            saving={!!moduleSaving[mod.id]}
            saved={!!moduleSaved[mod.id]}
            onSave={fields => onSaveModuleSettings(mod.id, fields)}
            t={t}
            isDark={isDark}
          />
        );
      })}

      {/* Install instructions */}
      <div className="rounded-xl border px-5 py-4 space-y-1"
        style={{ borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
        <div className="text-xs font-mono font-semibold" style={{ color: t.textSecondary }}>
          Add a module
        </div>
        <div className="text-xs font-mono leading-relaxed" style={{ color: t.textMuted }}>
          Drop a module folder into <span style={{ color: t.textSecondary }}>server/src/modules/</span> and{' '}
          <span style={{ color: t.textSecondary }}>src/modules/</span>, then restart the server.
          The module will appear here automatically.
        </div>
        <a
          href="MODULES.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-mono mt-1"
          style={{ color: '#60a5fa' }}>
          Read MODULES.md <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}

function ModuleSection({ mod, localValues, saving, saved, onSave, t, isDark }) {
  const [fields, setFields] = useState({ ...localValues });

  // Sync when async-loaded settings arrive after initial render
  useEffect(() => {
    setFields({ ...localValues });
  }, [JSON.stringify(localValues)]);

  const setField = (k, v) => setFields(prev => ({ ...prev, [k]: v }));

  const inputCls   = 'w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 transition-all';
  const inputStyle = { backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder };
  const IconComponent = mod.icon ? null : null; // resolved from frontend registry — icon is a component

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
      {/* Module header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b"
        style={{
          backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          borderColor: t.cardBorder,
        }}>
        <div>
          <div className="text-sm font-mono font-semibold" style={{ color: t.textPrimary }}>
            {mod.name}
            <span className="ml-2 text-xs font-normal" style={{ color: t.textFaint }}>v{mod.version}</span>
          </div>
          <div className="text-xs font-mono mt-0.5" style={{ color: t.textMuted }}>
            {mod.description}
          </div>
        </div>
      </div>

      <div className="px-5 py-4 space-y-4">
        {mod.settingsSchema?.length === 0 && (
          <p className="text-xs font-mono" style={{ color: t.textFaint }}>
            No credentials required. Use <strong>Add</strong> on the dashboard to place cards.
          </p>
        )}
        {/* Credential fields */}
        {mod.settingsSchema?.length > 0 && (
          <div className="space-y-3">
            <div className="text-xs font-mono uppercase tracking-wider" style={{ color: t.textMuted }}>
              Credentials
            </div>
            {mod.settingsSchema.map(field => (
              <div key={field.key}>
                <label className="block text-xs font-mono font-medium uppercase tracking-wider mb-1.5"
                  style={{ color: t.textMuted }}>
                  {field.label}{field.required ? ' *' : ''}
                </label>
                <input
                  type={field.type === 'password' ? 'password' : 'text'}
                  value={fields[field.key] ?? ''}
                  onChange={e => setField(field.key, e.target.value)}
                  placeholder={field.placeholder ?? ''}
                  className={inputCls}
                  style={inputStyle}
                />
                {field.hint && (
                  <p className="text-xs font-mono mt-1 leading-relaxed" style={{ color: t.textFaint }}>
                    {field.hint}
                  </p>
                )}
              </div>
            ))}
            <button
              onClick={() => onSave(fields)}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-mono font-bold transition-all disabled:opacity-60"
              style={{
                background:  saved ? 'linear-gradient(135deg, #22c55e, #16a34a)' : 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color:       '#fff',
                boxShadow:   saved ? '0 2px 8px rgba(34,197,94,0.3)' : '0 2px 8px rgba(59,130,246,0.3)',
              }}>
              {saving ? <><Loader size={11} className="animate-spin" /> Saving…</> :
               saved  ? <><CheckCircle size={11} /> Saved</>                      :
                        'Save credentials'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SettingRow({ title, description, children, t, isDark }) {
  return (
    <div
      className="flex items-center justify-between gap-6 px-4 py-4 rounded-xl border"
      style={{
        borderColor:     t.cardBorder,
        backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
      }}>
      <div>
        <div className="text-sm font-mono font-semibold" style={{ color: t.textPrimary }}>
          {title}
        </div>
        <div className="text-xs font-mono mt-1 leading-relaxed" style={{ color: t.textMuted }}>
          {description}
        </div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ enabled, onToggle, isDark }) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className="shrink-0 relative transition-all"
      style={{
        width:           44,
        height:          24,
        borderRadius:    12,
        backgroundColor: enabled ? '#3b82f6' : isDark ? '#374151' : '#d1d5db',
        boxShadow:       enabled ? '0 0 0 3px rgba(59,130,246,0.2)' : 'none',
        transition:      'background-color 0.2s, box-shadow 0.2s',
      }}>
      <span
        style={{
          position:       'absolute',
          top:            3,
          left:           enabled ? 23 : 3,
          width:          18,
          height:         18,
          borderRadius:   9,
          backgroundColor:'#fff',
          boxShadow:      '0 1px 3px rgba(0,0,0,0.3)',
          transition:     'left 0.2s',
        }}
      />
    </button>
  );
}

function Channel({ title, description, enabled, hasError = false, onToggle, testState, onTest, children, t, isDark }) {
  const isLoading = testState === 'loading';
  const isOk      = testState === 'ok';
  const isError   = testState && testState !== 'loading' && testState !== 'ok';

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{
        borderColor: hasError
          ? '#ef4444'
          : enabled
            ? isDark ? 'rgba(59,130,246,0.3)' : 'rgba(59,130,246,0.25)'
            : t.cardBorder,
        transition: 'border-color 0.2s',
      }}>

      {/* Channel header */}
      <div
        className="flex items-center justify-between px-5 py-3.5"
        style={{
          backgroundColor: enabled
            ? isDark ? 'rgba(59,130,246,0.07)' : 'rgba(59,130,246,0.04)'
            : isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          borderBottom: `1px solid ${enabled
            ? isDark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)'
            : t.cardBorder}`,
        }}>
        <div>
          <div className="flex items-center gap-2">
            {enabled && (
              <span
                className="inline-flex h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: '#3b82f6' }}
              />
            )}
            <span className="text-sm font-mono font-semibold" style={{ color: t.textPrimary }}>
              {title}
            </span>
          </div>
          <div className="text-xs font-mono mt-0.5" style={{ color: t.textMuted }}>
            {description}
          </div>
        </div>
        <Toggle enabled={enabled} onToggle={onToggle} isDark={isDark} />
      </div>

      {/* Fields */}
      <div className="px-5 py-4 space-y-3">
        {children}

        {/* Test button + result */}
        <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: t.cardBorder }}>
          <button
            onClick={onTest}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-mono font-medium transition-all disabled:opacity-50"
            style={{
              backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              border:          `1px solid ${t.cardBorder}`,
              color:           t.textSecondary,
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = t.cardBorderHover}
            onMouseLeave={e => e.currentTarget.style.borderColor = t.cardBorder}>
            {isLoading
              ? <><Loader size={11} className="animate-spin" /> Sending…</>
              : <><Send size={11} /> Send test</>}
          </button>
          {isOk && (
            <span className="flex items-center gap-1.5 text-xs font-mono" style={{ color: '#4ade80' }}>
              <CheckCircle size={12} /> Delivered
            </span>
          )}
          {isError && (
            <span className="flex items-center gap-1.5 text-xs font-mono text-red-400 max-w-xs truncate">
              <AlertCircle size={12} className="shrink-0" /> {testState}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, invalid = false, children, t }) {
  return (
    <div>
      <label className="block text-xs font-mono font-medium uppercase tracking-wider mb-1.5"
        style={{ color: invalid ? '#f87171' : t.textMuted }}>
        {label}{invalid && <span className="ml-1 normal-case tracking-normal">— required</span>}
      </label>
      {children}
    </div>
  );
}

// ── Appearance tab ────────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'auto',  label: 'Auto'  },
  { value: 'dark',  label: 'Dark'  },
];

function ThemeSwatch({ name, theme, isActive, onClick }) {
  const preview = theme.dark;
  return (
    <button
      onClick={onClick}
      className="text-left rounded-lg border-2 p-2.5 transition-all"
      style={{
        borderColor:     isActive ? '#60a5fa' : preview.cardBorder,
        backgroundColor: preview.pageBg,
        outline:         isActive ? '1px solid #60a5fa' : 'none',
        outlineOffset:   '1px',
      }}>
      {/* Mini card preview */}
      <div
        className="rounded mb-2 overflow-hidden"
        style={{ height: '32px', backgroundColor: preview.pageBg, padding: '4px' }}>
        <div
          className="rounded h-full flex items-center gap-1 px-2"
          style={{ backgroundColor: preview.cardBg }}>
          <div className="rounded-full shrink-0" style={{ width: '6px', height: '6px', backgroundColor: preview.textPrimary }} />
          <div className="rounded flex-1" style={{ height: '3px', backgroundColor: preview.textSecondary }} />
          <div className="rounded shrink-0" style={{ width: '12px', height: '3px', backgroundColor: preview.textMuted }} />
        </div>
      </div>
      {/* Label */}
      <div
        className="text-xs font-mono"
        style={{ color: isActive ? '#60a5fa' : preview.textSecondary }}>
        {theme.label}
      </div>
    </button>
  );
}

function AppearanceTab({ themeMode, setThemeMode, themeName, setThemeName, isDark, t }) {
  return (
    <div className="space-y-5">
      {/* Theme picker */}
      <div>
        <div className="text-xs font-mono font-medium mb-1" style={{ color: t.textPrimary }}>Color theme</div>
        <div className="text-xs font-mono mb-3" style={{ color: t.textMuted }}>
          Each theme has a dark and light variant — the mode selector below determines which is shown.
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(THEMES).map(([name, theme]) => (
            <ThemeSwatch
              key={name}
              name={name}
              theme={theme}
              isActive={themeName === name}
              onClick={() => setThemeName(name)}
            />
          ))}
        </div>
      </div>

      {/* Divider */}
      <div className="h-px" style={{ backgroundColor: t.cardBorder }} />

      {/* Mode selector */}
      <SettingRow
        title="Mode"
        description="Choose light or dark, or let NetWatch follow your operating system setting."
        t={t}
        isDark={isDark}>
        <div className="flex shrink-0">
          {THEME_OPTIONS.map(({ value, label }, i) => {
            const isActive = themeMode === value;
            const isFirst  = i === 0;
            const isLast   = i === THEME_OPTIONS.length - 1;
            return (
              <button
                key={value}
                onClick={() => setThemeMode(value)}
                className="px-4 py-1.5 text-xs font-mono font-medium border transition-all"
                style={{
                  borderRadius:    isFirst ? '0.5rem 0 0 0.5rem' : isLast ? '0 0.5rem 0.5rem 0' : '0',
                  marginLeft:      i > 0 ? '-1px' : 0,
                  position:        'relative',
                  zIndex:          isActive ? 1 : 0,
                  backgroundColor: isActive
                    ? isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)'
                    : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                  borderColor:     isActive ? '#60a5fa' : t.cardBorder,
                  color:           isActive ? '#60a5fa' : t.textSecondary,
                }}>
                {label}
              </button>
            );
          })}
        </div>
      </SettingRow>

      {themeMode === 'auto' && (
        <div
          className="px-4 py-2.5 rounded-lg text-xs font-mono"
          style={{ color: t.textMuted, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
          Currently showing{' '}
          <span style={{ color: t.textSecondary }}>{isDark ? 'dark' : 'light'}</span>
          {' '}mode based on your OS setting.
        </div>
      )}
    </div>
  );
}

// ── Network tab ───────────────────────────────────────────────────────────────

function NetworkTab({ networkRefsEnabled, setNetworkRefsEnabled, networkRefsCustom, setNetworkRefsCustom, t, isDark }) {
  const [newLabel,  setNewLabel]  = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newType,   setNewType]   = useState('http');
  const [addError,  setAddError]  = useState('');

  const httpPresets = NETWORK_REF_PRESETS.filter(p => p.checkType === 'http');
  const icmpPresets = NETWORK_REF_PRESETS.filter(p => p.checkType === 'icmp');

  const togglePreset = (target) => {
    setNetworkRefsEnabled(prev =>
      prev.includes(target) ? prev.filter(t => t !== target) : [...prev, target]
    );
  };

  const addCustom = () => {
    setAddError('');
    if (!newLabel.trim())  { setAddError('Label is required'); return; }
    if (!newTarget.trim()) { setAddError('Target is required'); return; }

    const allTargets = new Set([
      ...NETWORK_REF_PRESETS.map(p => p.target),
      ...networkRefsCustom.map(c => c.target),
    ]);
    if (allTargets.has(newTarget.trim())) { setAddError('This target already exists'); return; }

    setNetworkRefsCustom(prev => [...prev, { label: newLabel.trim(), target: newTarget.trim(), checkType: newType }]);
    setNewLabel('');
    setNewTarget('');
    setNewType('http');
  };

  const removeCustom = (target) => {
    setNetworkRefsCustom(prev => prev.filter(c => c.target !== target));
  };

  const inCls   = 'rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60 transition-all';
  const inStyle = { backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder };
  const rowBg   = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  return (
    <div className="space-y-5">

      {/* Info banner */}
      <div
        className="rounded-xl border px-4 py-3.5 space-y-1"
        style={{ borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.04)' }}>
        <div className="text-xs font-mono font-semibold" style={{ color: '#60a5fa' }}>
          What are network references?
        </div>
        <div className="text-xs font-mono leading-relaxed" style={{ color: t.textMuted }}>
          Reference monitors appear in a compact strip below your monitors and never trigger alerts.
          Enable a mix of HTTP and DNS/ICMP targets to quickly tell whether an outage is yours or a broader internet issue.
        </div>
      </div>

      {/* HTTP presets */}
      <PresetSection
        title="HTTP Endpoints"
        presets={httpPresets}
        enabled={networkRefsEnabled}
        onToggle={togglePreset}
        t={t}
        isDark={isDark}
      />

      {/* ICMP / DNS presets */}
      <PresetSection
        title="DNS / ICMP Ping"
        presets={icmpPresets}
        enabled={networkRefsEnabled}
        onToggle={togglePreset}
        t={t}
        isDark={isDark}
      />

      {/* Custom references */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
        <div
          className="px-5 py-3 border-b"
          style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: t.textSecondary }}>
            Custom
          </div>
          <div className="text-xs font-mono mt-0.5" style={{ color: t.textMuted }}>
            Add any URL or IP — useful for routers, local servers, or private hosts
          </div>
        </div>

        <div className="px-5 py-4 space-y-3" style={{ backgroundColor: t.cardBg }}>
          {/* Existing custom entries */}
          {networkRefsCustom.length > 0 && (
            <div className="space-y-2">
              {networkRefsCustom.map(entry => (
                <div
                  key={entry.target}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
                  style={{ borderColor: t.cardBorder, backgroundColor: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                  <span
                    className="shrink-0 text-xs font-mono px-1.5 py-0.5 rounded border uppercase tracking-wide"
                    style={{ color: t.textFaint, borderColor: t.cardBorder, fontSize: 10 }}>
                    {entry.checkType}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono font-medium truncate" style={{ color: t.textPrimary }}>{entry.label}</div>
                    <div className="text-xs font-mono truncate" style={{ color: t.textMuted }}>{entry.target}</div>
                  </div>
                  <button
                    onClick={() => removeCustom(entry.target)}
                    className="shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                    style={{ color: t.textMuted }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider mb-1" style={{ color: t.textMuted }}>
                  Label
                </label>
                <input
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustom()}
                  placeholder="My Router"
                  className={`w-full ${inCls}`}
                  style={inStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider mb-1" style={{ color: t.textMuted }}>
                  Target
                </label>
                <input
                  value={newTarget}
                  onChange={e => setNewTarget(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addCustom()}
                  placeholder="192.168.1.1"
                  className={`w-full ${inCls}`}
                  style={inStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider mb-1" style={{ color: t.textMuted }}>
                  Type
                </label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className={inCls}
                  style={{ ...inStyle, cursor: 'pointer' }}>
                  <option value="http">HTTP</option>
                  <option value="icmp">ICMP</option>
                </select>
              </div>
              <div>
                <button
                  onClick={addCustom}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-bold transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                    color:      '#fff',
                    boxShadow:  '0 2px 8px rgba(59,130,246,0.3)',
                    whiteSpace: 'nowrap',
                  }}>
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
            {addError && (
              <div className="flex items-center gap-1.5 text-xs font-mono text-red-400">
                <AlertCircle size={11} className="shrink-0" />
                {addError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── API Keys tab ──────────────────────────────────────────────────────────────

function ApiKeysTab({ t, isDark }) {
  const [keys,        setKeys]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [newName,     setNewName]     = useState('');
  const [creating,    setCreating]    = useState(false);
  const [revealedKey, setRevealedKey] = useState(null); // { id, key, name }
  const [copied,      setCopied]      = useState(false);
  const [error,       setError]       = useState('');

  const rowBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  useEffect(() => {
    fetch('/api/keys')
      .then(r => r.json())
      .then(data => { setKeys(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const generate = async () => {
    if (!newName.trim()) { setError('Enter a name for the key'); return; }
    setError('');
    setCreating(true);
    try {
      const res  = await fetch('/api/keys', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setKeys(prev => [{ id: data.id, name: data.name, key_prefix: data.key_prefix, created_at: data.created_at, last_used_at: null }, ...prev]);
      setRevealedKey({ id: data.id, key: data.key, name: data.name });
      setNewName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id) => {
    try {
      await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      setKeys(prev => prev.filter(k => k.id !== id));
      if (revealedKey?.id === id) setRevealedKey(null);
    } catch { /* ignore */ }
  };

  const rotate = async (id) => {
    try {
      const res  = await fetch(`/api/keys/${id}/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    '{}',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setKeys(prev => prev.map(k => k.id === id ? { ...k, key_prefix: data.key_prefix, last_used_at: null } : k));
      setRevealedKey({ id: data.id, key: data.key, name: data.name });
    } catch (err) {
      setError(err.message);
    }
  };

  const copyKey = async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="space-y-5">

      {/* Revealed key banner */}
      {revealedKey && (
        <div className="rounded-xl border p-4 space-y-3"
          style={{ borderColor: '#d97706', backgroundColor: isDark ? 'rgba(217,119,6,0.08)' : 'rgba(217,119,6,0.06)' }}>
          <div className="flex items-center gap-2">
            <AlertCircle size={13} style={{ color: '#d97706', flexShrink: 0 }} />
            <span className="text-xs font-mono font-semibold" style={{ color: '#d97706' }}>
              Copy this key now — it will not be shown again
            </span>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono px-3 py-2 rounded-lg break-all select-all"
              style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.06)', color: t.textPrimary }}>
              {revealedKey.key}
            </code>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-mono font-medium shrink-0 transition-colors"
              style={{
                borderColor:     copied ? '#22c55e' : t.cardBorder,
                color:           copied ? '#22c55e' : t.textSecondary,
                backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
              }}>
              {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setRevealedKey(null)}
            className="text-xs font-mono"
            style={{ color: t.textFaint }}>
            Dismiss
          </button>
        </div>
      )}

      {/* Generate new key */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
        <div className="px-5 py-3 border-b" style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: t.textSecondary }}>
            Generate New Key
          </div>
        </div>
        <div className="px-5 py-4 space-y-3" style={{ backgroundColor: t.cardBg }}>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => { setNewName(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && generate()}
              placeholder="Key name (e.g. Grafana, Home Assistant)"
              className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/60"
              style={{ backgroundColor: t.inputBg, color: t.textPrimary, borderColor: error ? '#ef4444' : t.cardBorder }}
            />
            <button
              onClick={generate}
              disabled={creating}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-mono font-bold transition-all disabled:opacity-60 shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff' }}>
              {creating ? <Loader size={13} className="animate-spin" /> : <Key size={13} />}
              Generate
            </button>
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-red-400">
              <AlertCircle size={11} className="shrink-0" /> {error}
            </div>
          )}
        </div>
      </div>

      {/* Key list */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
        <div className="px-5 py-3 border-b" style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: t.textSecondary }}>
            Active Keys
          </div>
        </div>
        <div style={{ backgroundColor: t.cardBg }}>
          {loading ? (
            <div className="px-5 py-4 flex items-center gap-2 text-xs font-mono" style={{ color: t.textFaint }}>
              <Loader size={13} className="animate-spin" /> Loading…
            </div>
          ) : keys.length === 0 ? (
            <div className="px-5 py-4 text-xs font-mono" style={{ color: t.textFaint }}>
              No API keys yet. Generate one above.
            </div>
          ) : keys.map((k, i) => (
            <div
              key={k.id}
              className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: i < keys.length - 1 ? `1px solid ${t.cardBorder}` : 'none' }}>
              <Key size={13} style={{ color: t.textFaint, flexShrink: 0 }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-medium" style={{ color: t.textPrimary }}>{k.name}</div>
                <div className="text-xs font-mono" style={{ color: t.textMuted }}>
                  <span className="font-mono" style={{ color: t.textFaint }}>{k.key_prefix}…</span>
                  {' · '}Created {fmtDate(k.created_at)}
                  {k.last_used_at ? ` · Last used ${fmtDate(k.last_used_at)}` : ' · Never used'}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => rotate(k.id)}
                  title="Rotate key"
                  className="flex items-center justify-center w-7 h-7 rounded-lg border transition-colors"
                  style={{ borderColor: t.cardBorder, color: t.textMuted, backgroundColor: 'transparent' }}>
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => revoke(k.id)}
                  title="Revoke key"
                  className="flex items-center justify-center w-7 h-7 rounded-lg border transition-colors"
                  style={{ borderColor: t.cardBorder, color: '#f87171', backgroundColor: 'transparent' }}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Endpoint reference */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
        <div className="px-5 py-3 border-b" style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
          <div className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: t.textSecondary }}>
            API Endpoints
          </div>
        </div>
        <div className="divide-y" style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder }}>
          {[
            { method: 'GET', path: '/api/v1/monitors',     desc: 'All monitors with current status' },
            { method: 'GET', path: '/api/v1/monitors/:id', desc: 'Single monitor + last 100 history entries' },
            { method: 'GET', path: '/api/v1/summary',      desc: 'Aggregate counts and average ping' },
            { method: 'GET', path: '/api/v1/metrics',      desc: 'Prometheus exposition format (Grafana)' },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-center gap-3 px-5 py-3"
              style={{ borderColor: t.cardBorder }}>
              <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: '#34d399', backgroundColor: isDark ? 'rgba(52,211,153,0.1)' : 'rgba(52,211,153,0.12)' }}>
                {method}
              </span>
              <code className="text-xs font-mono flex-1 min-w-0 truncate" style={{ color: t.textSecondary }}>
                {path}
              </code>
              <span className="text-xs font-mono hidden sm:block shrink-0" style={{ color: t.textFaint }}>
                {desc}
              </span>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t text-xs font-mono" style={{ borderColor: t.cardBorder, color: t.textFaint }}>
          Authenticate with <code style={{ color: t.textMuted }}>Authorization: Bearer &lt;key&gt;</code> or <code style={{ color: t.textMuted }}>?api_key=&lt;key&gt;</code>
        </div>
      </div>

    </div>
  );
}

function PresetSection({ title, presets, enabled, onToggle, t, isDark }) {
  const rowBg = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)';

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: t.cardBorder }}>
      <div
        className="px-5 py-3 border-b"
        style={{ backgroundColor: rowBg, borderColor: t.cardBorder }}>
        <div className="text-xs font-mono font-semibold uppercase tracking-wider" style={{ color: t.textSecondary }}>
          {title}
        </div>
      </div>
      <div style={{ backgroundColor: t.cardBg }}>
        {presets.map((preset, i) => {
          const isOn   = enabled.includes(preset.target);
          const isLast = i === presets.length - 1;
          return (
            <div
              key={preset.target}
              className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: isLast ? 'none' : `1px solid ${t.cardBorder}` }}>
              {preset.checkType === 'http'
                ? <Globe    size={13} style={{ color: t.textFaint, flexShrink: 0 }} />
                : <Terminal size={13} style={{ color: t.textFaint, flexShrink: 0 }} />
              }
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono font-medium" style={{ color: t.textPrimary }}>{preset.label}</div>
                <div className="text-xs font-mono" style={{ color: t.textMuted }}>{preset.target}</div>
              </div>
              <Toggle enabled={isOn} onToggle={() => onToggle(preset.target)} isDark={isDark} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
