import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Save, Loader, Tag, AlertCircle } from 'lucide-react';
import { INTERVAL_OPTIONS, ALERT_TYPES, CHECK_TYPES } from '../types/monitor';
import { useTheme } from '../hooks/useTheme';

const DEFAULT_ALERT_CONFIG = {
  outage:    { panel: true,  notify: 'once'  },
  degraded:  { panel: false, notify: 'never' },
  recovered: { panel: true,  notify: 'once'  },
};

const NOTIFY_OPTIONS = [
  { label: 'Never',        value: 'never'  },
  { label: 'Once',         value: 'once'   },
  { label: 'Every 15 min', value: 'repeat' },
];

const ALERT_ROWS = [
  { key: 'outage',    label: 'Outage',    hint: 'service is DOWN' },
  { key: 'degraded',  label: 'Degraded',  hint: 'ping over threshold' },
  { key: 'recovered', label: 'Recovered', hint: 'back to healthy' },
];

// Which settings keys must be non-empty for a channel to be considered configured
const CHANNEL_CREDENTIAL_KEYS = {
  Telegram: ['telegram_token', 'telegram_chat_id'],
  Email:    ['email_smtp_host', 'email_smtp_user', 'email_smtp_pass', 'email_from', 'email_to'],
  SMS:      ['twilio_account_sid', 'twilio_auth_token', 'twilio_from', 'twilio_to'],
  Webhook:  ['webhook_url'],
};

// Channels that are always available regardless of settings
const ALWAYS_AVAILABLE = new Set(['None']);

const DEFAULT_FORM = {
  target:           '',
  label:            '',
  description:      '',
  checkType:        'http',
  port:             '',
  interval:         60,
  alertTypes:       ['None'],
  degradedThreshold: '',
  // API-check fields
  expectedStatus:   '',
  bodyMatch:        '',
  jsonPath:         '',
  jsonExpected:     '',
  authType:         'none',
  authUser:         '',
  authPass:         '',
  authToken:        '',
  requestHeaders:   [{ key: '', value: '' }],
  alertConfig:      DEFAULT_ALERT_CONFIG,
  tags:             [],
  tagInput:         '',
};

export function MonitorForm({ editingMonitor, onSubmit, onCancel, submitting = false, allTags = [], error = '', availableModules = [], onAddModule, embedded = false }) {
  const { t } = useTheme();
  const [activeTab,  setActiveTab]  = useState('monitor');
  const [form,       setForm]       = useState(DEFAULT_FORM);
  const [settings,   setSettings]   = useState({});
  const [formError,  setFormError]  = useState('');

  // Tag autocomplete state
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagInputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Load saved settings so we know which channels are configured
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (editingMonitor) {
      const rawCfg = editingMonitor.alertConfig ?? {};
      const alertConfig = {
        outage:    { ...DEFAULT_ALERT_CONFIG.outage,    ...(rawCfg.outage    || {}) },
        degraded:  { ...DEFAULT_ALERT_CONFIG.degraded,  ...(rawCfg.degraded  || {}) },
        recovered: { ...DEFAULT_ALERT_CONFIG.recovered, ...(rawCfg.recovered || {}) },
      };
      const rh = editingMonitor.requestHeaders ?? [];
      setForm({
        target:            editingMonitor.target,
        label:             editingMonitor.label,
        description:       editingMonitor.description,
        checkType:         editingMonitor.checkType ?? 'http',
        port:              editingMonitor.port ?? '',
        interval:          editingMonitor.interval,
        alertTypes:        editingMonitor.alertTypes,
        degradedThreshold: editingMonitor.degradedThreshold ?? '',
        expectedStatus:    editingMonitor.expectedStatus ?? '',
        bodyMatch:         editingMonitor.bodyMatch ?? '',
        jsonPath:          editingMonitor.jsonPath ?? '',
        jsonExpected:      editingMonitor.jsonExpected ?? '',
        authType:          editingMonitor.authType ?? 'none',
        authUser:          editingMonitor.authUser ?? '',
        authPass:          editingMonitor.authPass ?? '',
        authToken:         editingMonitor.authToken ?? '',
        requestHeaders:    rh.length > 0 ? rh : [{ key: '', value: '' }],
        alertConfig,
        tags:              editingMonitor.tags.filter(t => t !== '_ref'),
        tagInput:          '',
      });
    } else {
      setForm(DEFAULT_FORM);
    }
    setFormError('');
  }, [editingMonitor]);

  // Whether a channel is toggled enabled in Settings (i.e. should be shown as an option)
  const channelEnabled = (type) => {
    if (ALWAYS_AVAILABLE.has(type)) return true;
    if (type === 'Telegram') return settings.telegram_enabled === '1';
    if (type === 'Email')    return settings.email_enabled    === '1';
    if (type === 'SMS')      return settings.twilio_enabled   === '1';
    if (type === 'Webhook')  return settings.webhook_enabled  === '1';
    return false;
  };

  // Whether a channel has all required credentials filled in
  const channelConfigured = (type) => {
    if (ALWAYS_AVAILABLE.has(type)) return true;
    const keys = CHANNEL_CREDENTIAL_KEYS[type] ?? [];
    return keys.every(k => settings[k]?.trim());
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          tagInputRef.current && !tagInputRef.current.contains(e.target)) {
        setTagDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  // ── Tag autocomplete logic ────────────────────────────────────────────────

  const currentTokenRaw = form.tagInput.trim().toLowerCase();

  const tagSuggestions = allTags.filter(tag => {
    if (form.tags.includes(tag)) return false;                      // already added
    if (!currentTokenRaw) return true;                               // show all when empty
    return tag.toLowerCase().includes(currentTokenRaw);              // filter by typing
  });

  const addTag = (tag) => {
    const trimmed = tag.trim();
    if (!trimmed || form.tags.includes(trimmed)) return;
    set('tags', [...form.tags, trimmed]);
    set('tagInput', '');
    setTagDropdownOpen(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tag) => set('tags', form.tags.filter(t => t !== tag));

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (form.tagInput.trim()) addTag(form.tagInput);
    } else if (e.key === 'Backspace' && !form.tagInput && form.tags.length > 0) {
      removeTag(form.tags[form.tags.length - 1]);
    } else if (e.key === 'Escape') {
      setTagDropdownOpen(false);
    } else if (e.key === 'ArrowDown' && tagDropdownOpen && tagSuggestions.length > 0) {
      e.preventDefault();
      dropdownRef.current?.querySelector('button')?.focus();
    }
  };

  // ── Alert toggle ──────────────────────────────────────────────────────────

  const toggleAlert = (type) => {
    setForm(prev => {
      if (type === 'None') return { ...prev, alertTypes: ['None'] };
      const without = prev.alertTypes.filter(a => a !== 'None' && a !== type);
      const adding  = !prev.alertTypes.includes(type);
      const next    = adding ? [...without, type] : without;
      return { ...prev, alertTypes: next.length ? next : ['None'] };
    });
  };

  // ── Submit ────────────────────────────────────────────────────────────────

  const setAlertConfig = (type, key, value) =>
    setForm(prev => ({
      ...prev,
      alertConfig: {
        ...prev.alertConfig,
        [type]: { ...prev.alertConfig[type], [key]: value },
      },
    }));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.target.trim()) return;

    // Validate: selected channels must have credentials saved in Settings
    const missingCreds = form.alertTypes.filter(
      type => !ALWAYS_AVAILABLE.has(type) && !channelConfigured(type)
    );
    if (missingCreds.length > 0) {
      setFormError(
        `${missingCreds.join(', ')} ${missingCreds.length === 1 ? 'has' : 'have'} no saved credentials. ` +
        `Add them in Settings before enabling this channel.`
      );
      return;
    }

    setFormError('');
    const finalTags = form.tagInput.trim()
      ? [...new Set([...form.tags, form.tagInput.trim()])]
      : form.tags;

    const isApi = form.checkType === 'api';

    // Only send non-empty header rows
    const cleanHeaders = isApi
      ? form.requestHeaders.filter(h => h.key?.trim())
      : [];

    onSubmit({
      target:            form.target.trim(),
      label:             form.label.trim(),
      description:       form.description.trim(),
      checkType:         form.checkType,
      port:              form.checkType === 'tcp' && form.port ? Number(form.port) : null,
      interval:          form.interval,
      alertTypes:        form.alertTypes,
      degradedThreshold: form.degradedThreshold !== '' ? Number(form.degradedThreshold) : null,
      bodyMatch:         isApi && form.bodyMatch.trim() ? form.bodyMatch.trim() : null,
      expectedStatus:    isApi && form.expectedStatus !== '' ? Number(form.expectedStatus) : null,
      jsonPath:          isApi && form.jsonPath.trim()    ? form.jsonPath.trim()    : null,
      jsonExpected:      isApi && form.jsonExpected.trim() ? form.jsonExpected.trim() : null,
      authType:          isApi ? (form.authType || 'none') : null,
      authUser:          isApi && form.authType === 'basic'  ? form.authUser.trim()  : null,
      authPass:          isApi && form.authType === 'basic'  ? form.authPass.trim()  : null,
      authToken:         isApi && form.authType === 'bearer' ? form.authToken.trim() : null,
      requestHeaders:    cleanHeaders,
      alertConfig:       form.alertConfig,
      tags:              finalTags,
    });
  };

  const isEditing = !!editingMonitor;

  const targetPlaceholder =
    form.checkType === 'http'  ? 'https://example.com  or  google.com' :
    form.checkType === 'api'   ? 'https://api.example.com/health' :
    form.checkType === 'tcp'   ? '192.168.1.1  or  db.internal' :
                                  '192.168.1.1  or  router.local';

  // Header row helpers for the custom headers section
  const setHeader = (i, field, val) =>
    set('requestHeaders', form.requestHeaders.map((h, idx) =>
      idx === i ? { ...h, [field]: val } : h
    ));
  const addHeaderRow = () =>
    set('requestHeaders', [...form.requestHeaders, { key: '', value: '' }]);
  const removeHeaderRow = (i) =>
    set('requestHeaders', form.requestHeaders.filter((_, idx) => idx !== i));

  // ── Derived input style ───────────────────────────────────────────────────

  const inputStyle = {};
  const inputCls = 'wt-input';

  const formContent = (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">

          {/* Module picker — shown when module tab is active */}
          {!embedded && activeTab === 'module' && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
              {availableModules.map(mod => {
                const Icon = mod.icon;
                return (
                  <div key={mod.id}
                    className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3.5"
                    style={{ borderColor: t.cardBorder, backgroundColor: t.inputBg }}>
                    <div className="flex items-center gap-3 min-w-0">
                      {Icon && <Icon size={18} style={{ color: t.textMuted, flexShrink: 0 }} />}
                      <div className="min-w-0">
                        <div className="text-sm font-mono font-semibold" style={{ color: t.textPrimary }}>
                          {mod.name}
                        </div>
                        <div className="text-xs font-mono mt-0.5 leading-relaxed truncate"
                          style={{ color: t.textMuted }}>
                          {mod.description}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onAddModule?.(mod.id)}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all"
                      style={{
                        background: 'linear-gradient(135deg, var(--wt-brand-500), var(--wt-brand-600))',
                        color:      '#fff',
                        boxShadow:  '0 2px 8px rgba(59,130,246,0.35)',
                      }}>
                      <Plus size={11} /> Add card
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Monitor form fields — shown when monitor tab is active */}
          <div className={`flex-1 overflow-y-auto px-6 py-5 space-y-4 ${!embedded && activeTab !== 'monitor' ? 'hidden' : ''}`}>

          {/* Check type */}
          <Field label="Check Type" t={t}>
            <div className="flex gap-2">
              {CHECK_TYPES.map(ct => (
                <button key={ct.value} type="button"
                  onClick={() => set('checkType', ct.value)}
                  className="flex-1 py-2 text-xs font-mono rounded border transition-colors"
                  style={form.checkType === ct.value
                    ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', color: 'var(--wt-brand-400)' }
                    : { backgroundColor: t.tagBg, borderColor: t.tagBorder, color: t.textMuted }
                  }>
                  {ct.label}
                </button>
              ))}
            </div>
          </Field>

          {/* Target */}
          <Field label="Target" required t={t}>
            <input type="text" value={form.target}
              onChange={e => set('target', e.target.value)}
              placeholder={targetPlaceholder}
              required autoFocus
              className={inputCls}
              style={inputStyle}            />
          </Field>

          {/* Port — TCP only */}
          {form.checkType === 'tcp' && (
            <Field label="Port" required hint="e.g. 5432, 3306, 6379" t={t}>
              <input type="number" min={1} max={65535}
                value={form.port}
                onChange={e => set('port', e.target.value)}
                placeholder="443" required
                className={inputCls}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                onBlur={e  => e.target.style.borderColor = t.cardBorder}
              />
            </Field>
          )}

          {/* Label */}
          <Field label="Label" hint="defaults to target" t={t}>
            <input type="text" value={form.label}
              onChange={e => set('label', e.target.value)}
              placeholder="Production API Gateway"
              className={inputCls} style={inputStyle}            />
          </Field>

          {/* Description */}
          <Field label="Description" t={t}>
            <input type="text" value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional free-form note"
              className={inputCls} style={inputStyle}            />
          </Field>

          {/* Interval + Tags */}
          <div className="grid grid-cols-2 gap-4">

            <Field label="Check Interval" t={t}>
              <select value={form.interval}
                onChange={e => set('interval', Number(e.target.value))}
                className={inputCls} style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                onBlur={e  => e.target.style.borderColor = t.cardBorder}>
                {INTERVAL_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>

            {/* Tags with autocomplete */}
            <Field label="Tags" hint="Enter or , to add" t={t}>
              <div className="relative">
                {/* Tag pill container + input */}
                <div
                  className="flex flex-wrap items-center gap-1 min-h-[36px] rounded border px-2 py-1 cursor-text"
                  style={{ backgroundColor: t.inputBg, borderColor: t.cardBorder }}
                  onClick={() => tagInputRef.current?.focus()}>
                  {form.tags.map(tag => (
                    <span key={tag}
                      className="flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded"
                      style={{ color: 'var(--wt-brand-500)', backgroundColor: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)' }}>
                      <Tag size={8} />
                      {tag}
                      <button type="button" onClick={() => removeTag(tag)}
                        className="ml-0.5 opacity-60 hover:opacity-100">
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={form.tagInput}
                    onChange={e => { set('tagInput', e.target.value); setTagDropdownOpen(true); }}
                    onFocus={() => setTagDropdownOpen(true)}
                    onKeyDown={handleTagKeyDown}
                    placeholder={form.tags.length === 0 ? 'web, critical…' : ''}
                    className="flex-1 min-w-[60px] bg-transparent text-xs font-mono outline-none"
                    style={{ color: t.textPrimary, caretColor: 'var(--wt-brand-500)' }}
                  />
                </div>

                {/* Suggestions dropdown */}
                {tagDropdownOpen && tagSuggestions.length > 0 && (
                  <div ref={dropdownRef}
                    className="absolute z-10 left-0 right-0 top-full mt-1 rounded border shadow-xl overflow-hidden"
                    style={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder }}>
                    {tagSuggestions.slice(0, 8).map(tag => (
                      <button key={tag} type="button"
                        onMouseDown={e => { e.preventDefault(); addTag(tag); }}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-left transition-colors"
                        style={{ color: t.textSecondary }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = t.tagBg}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                        <Tag size={9} style={{ color: 'var(--wt-brand-500)' }} />
                        {tag}
                      </button>
                    ))}
                    {form.tagInput.trim() && !allTags.includes(form.tagInput.trim()) && (
                      <button type="button"
                        onMouseDown={e => { e.preventDefault(); addTag(form.tagInput); }}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-left border-t transition-colors"
                        style={{ color: 'var(--wt-brand-500)', borderColor: t.tooltipBorder }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = t.tagBg}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                        <Plus size={9} />
                        Create &quot;{form.tagInput.trim()}&quot;
                      </button>
                    )}
                  </div>
                )}
              </div>
            </Field>
          </div>

          {/* Alert types — only show channels enabled in Settings */}
          <Field label="Notification Channels" hint="enable channels in Settings" t={t}>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {ALERT_TYPES.filter(channelEnabled).map(type => {
                const active       = form.alertTypes.includes(type);
                const misconfigured = active && !channelConfigured(type);
                return (
                  <button key={type} type="button" onClick={() => { toggleAlert(type); setFormError(''); }}
                    className="px-3 py-1.5 text-xs font-mono rounded border transition-colors"
                    style={misconfigured
                      ? { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: 'rgba(245,158,11,0.5)', color: 'var(--wt-warn-500)' }
                      : active
                        ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', color: 'var(--wt-brand-400)' }
                        : { backgroundColor: t.tagBg, borderColor: t.tagBorder, color: t.textMuted }
                    }>
                    {type}
                    {misconfigured && <span className="ml-1 opacity-70">⚠</span>}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* HTTP / API — degraded ping threshold */}
          {(form.checkType === 'http' || form.checkType === 'api') && (
            <Field label="Degraded Threshold" hint="ms — leave blank to disable" t={t}>
              <input type="number" min={1} max={60000}
                value={form.degradedThreshold}
                onChange={e => set('degradedThreshold', e.target.value)}
                placeholder="e.g. 500"
                className={inputCls} style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--wt-warn-500)'}
                onBlur={e  => e.target.style.borderColor = t.cardBorder}
              />
            </Field>
          )}

          {/* API-only fields */}
          {form.checkType === 'api' && (
            <>
              {/* Expected status + Auth type on one row */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Expected Status" hint="default 200" t={t}>
                  <input type="number" min={100} max={599}
                    value={form.expectedStatus}
                    onChange={e => set('expectedStatus', e.target.value)}
                    placeholder="200"
                    className={inputCls} style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                    onBlur={e  => e.target.style.borderColor = t.cardBorder}
                  />
                </Field>

                <Field label="Authentication" t={t}>
                  <select value={form.authType}
                    onChange={e => set('authType', e.target.value)}
                    className={inputCls} style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                    onBlur={e  => e.target.style.borderColor = t.cardBorder}>
                    <option value="none">None</option>
                    <option value="basic">Basic Auth</option>
                    <option value="bearer">Bearer Token</option>
                  </select>
                </Field>
              </div>

              {/* Basic auth credentials */}
              {form.authType === 'basic' && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Username" t={t}>
                    <input type="text" value={form.authUser}
                      onChange={e => set('authUser', e.target.value)}
                      placeholder="user"
                      className={inputCls} style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                      onBlur={e  => e.target.style.borderColor = t.cardBorder}
                    />
                  </Field>
                  <Field label="Password" t={t}>
                    <input type="password" value={form.authPass}
                      onChange={e => set('authPass', e.target.value)}
                      placeholder="••••••••"
                      className={inputCls} style={inputStyle}
                      onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                      onBlur={e  => e.target.style.borderColor = t.cardBorder}
                    />
                  </Field>
                </div>
              )}

              {/* Bearer token */}
              {form.authType === 'bearer' && (
                <Field label="Bearer Token" t={t}>
                  <input type="password" value={form.authToken}
                    onChange={e => set('authToken', e.target.value)}
                    placeholder="eyJ…"
                    className={inputCls} style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                    onBlur={e  => e.target.style.borderColor = t.cardBorder}
                  />
                </Field>
              )}

              {/* Custom headers */}
              <Field label="Custom Headers" hint="up to 5 — leave blank to skip" t={t}>
                <div className="space-y-1.5">
                  {form.requestHeaders.slice(0, 5).map((h, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input type="text" value={h.key}
                        onChange={e => setHeader(i, 'key', e.target.value)}
                        placeholder="Header-Name"
                        className={`${inputCls} flex-1`} style={inputStyle}
                        onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                        onBlur={e  => e.target.style.borderColor = t.cardBorder}
                      />
                      <input type="text" value={h.value}
                        onChange={e => setHeader(i, 'value', e.target.value)}
                        placeholder="value"
                        className={`${inputCls} flex-1`} style={inputStyle}
                        onFocus={e => e.target.style.borderColor = 'var(--wt-brand-500)'}
                        onBlur={e  => e.target.style.borderColor = t.cardBorder}
                      />
                      {form.requestHeaders.length > 1 && (
                        <button type="button" onClick={() => removeHeaderRow(i)}
                          className="shrink-0 p-1 opacity-40 hover:opacity-80"
                          style={{ color: t.textMuted }}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  {form.requestHeaders.length < 5 && (
                    <button type="button" onClick={addHeaderRow}
                      className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border transition-colors"
                      style={{ color: t.textMuted, borderColor: t.tagBorder, backgroundColor: t.tagBg }}>
                      <Plus size={10} /> Add Header
                    </button>
                  )}
                </div>
              </Field>

              {/* Body Contains */}
              <Field label="Body Contains" hint="plain string, case-insensitive — leave blank to skip" t={t}>
                <input type="text"
                  value={form.bodyMatch}
                  onChange={e => set('bodyMatch', e.target.value)}
                  placeholder='"ok"  or  "status":"healthy"'
                  className={inputCls} style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--wt-viz-6)'}
                  onBlur={e  => e.target.style.borderColor = t.cardBorder}
                />
              </Field>

              {/* JSON assertion */}
              <Field label="JSON Assertion" hint="dot-path + expected value — leave blank to skip" t={t}>
                <div className="flex gap-2">
                  <input type="text" value={form.jsonPath}
                    onChange={e => set('jsonPath', e.target.value)}
                    placeholder="data.status"
                    className={`${inputCls} flex-1`} style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--wt-viz-6)'}
                    onBlur={e  => e.target.style.borderColor = t.cardBorder}
                  />
                  <span className="flex items-center text-xs font-mono shrink-0"
                    style={{ color: t.textFaint }}>=</span>
                  <input type="text" value={form.jsonExpected}
                    onChange={e => set('jsonExpected', e.target.value)}
                    placeholder="healthy"
                    className={`${inputCls} flex-1`} style={inputStyle}
                    onFocus={e => e.target.style.borderColor = 'var(--wt-viz-6)'}
                    onBlur={e  => e.target.style.borderColor = t.cardBorder}
                  />
                </div>
              </Field>
            </>
          )}

          {/* Alert behaviour per event type */}
          <Field label="Alert Behaviour" t={t}>
            <div className="rounded border overflow-hidden" style={{ borderColor: t.cardBorder }}>
              {/* Header row */}
              <div className="grid grid-cols-3 px-3 py-1.5 border-b text-xs font-mono uppercase tracking-wider"
                style={{ borderColor: t.cardBorder, backgroundColor: t.metricGap, color: t.textFaint }}>
                <span>Event</span>
                <span className="text-center">Show in Panel</span>
                <span className="text-center">Notify</span>
              </div>
              {ALERT_ROWS.filter(({ key }) =>
                key !== 'degraded' ||
                form.checkType === 'http' ||
                form.checkType === 'api'
              ).map(({ key, label, hint }) => {
                const cfg = form.alertConfig[key];
                return (
                  <div key={key}
                    className="grid grid-cols-3 items-center px-3 py-2 border-b last:border-0"
                    style={{ borderColor: t.cardBorder }}>

                    {/* Label */}
                    <div>
                      <div className="text-xs font-mono" style={{ color: t.textSecondary }}>{label}</div>
                      <div className="text-xs font-mono" style={{ color: t.textFaint }}>{hint}</div>
                    </div>

                    {/* Panel toggle */}
                    <div className="flex justify-center">
                      <button type="button"
                        onClick={() => setAlertConfig(key, 'panel', !cfg.panel)}
                        className="w-9 h-5 rounded-full border transition-colors relative"
                        style={{
                          backgroundColor: cfg.panel ? 'rgba(59,130,246,0.3)' : t.tagBg,
                          borderColor:     cfg.panel ? 'rgba(59,130,246,0.6)' : t.tagBorder,
                        }}>
                        <span className="absolute top-0.5 h-4 w-4 rounded-full transition-all"
                          style={{
                            left:            cfg.panel ? '18px' : '2px',
                            backgroundColor: cfg.panel ? 'var(--wt-brand-500)' : t.textFaint,
                          }} />
                      </button>
                    </div>

                    {/* Notify frequency */}
                    <div className="flex justify-center">
                      <select
                        value={cfg.notify}
                        onChange={e => setAlertConfig(key, 'notify', e.target.value)}
                        className="text-xs font-mono rounded border px-1.5 py-0.5 appearance-none cursor-pointer focus:outline-none"
                        style={{ backgroundColor: t.inputBg, color: t.textSecondary, borderColor: t.cardBorder }}>
                        {NOTIFY_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </Field>

          {/* Form-level error */}
          {formError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded border text-xs font-mono"
              style={{ backgroundColor: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--wt-warn-500)' }}>
              <span className="shrink-0 mt-0.5">⚠</span>
              {formError}
            </div>
          )}

          </div>{/* end scrollable fields */}

          {/* Actions — fixed footer */}
          <div className="flex flex-col gap-2 px-6 py-4 border-t shrink-0"
            style={{ borderColor: t.metricGap }}>
            {error && (activeTab === 'monitor' || embedded) && (
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--wt-down-600)' }}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}
            <div className="flex justify-end items-center gap-2">
            {!embedded && (
            <button type="button" onClick={onCancel} disabled={submitting} className="wt-btn wt-btn--ghost">
              Cancel
            </button>
            )}
            {(activeTab === 'monitor' || embedded) && (
              <button type="submit" disabled={submitting} className="wt-btn wt-btn--primary" style={{ opacity: submitting ? 0.6 : 1 }}>
                {submitting
                  ? <><Loader size={13} className="animate-spin" /> Saving…</>
                  : isEditing
                    ? <><Save size={13} /> Save Changes</>
                    : <><Plus size={13} /> Add Monitor</>
                }
              </button>
            )}
            </div>
          </div>
    </form>
  );

  if (embedded) return formContent;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => e.target === e.currentTarget && !submitting && onCancel()}
    >
      <div className="w-full max-w-lg rounded-lg shadow-2xl border flex flex-col"
        style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder, maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Header — fixed */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: t.metricGap }}>
          <h2 className="text-xs font-mono font-bold uppercase tracking-widest"
            style={{ color: t.textSecondary }}>
            {isEditing ? '// Edit Monitor' : '// Add'}
          </h2>
          <button onClick={onCancel} disabled={submitting}
            className="p-1.5 rounded transition-colors disabled:opacity-40"
            style={{ color: t.textFaint }}>
            <X size={16} />
          </button>
        </div>

        {/* Tab bar — only show when not editing */}
        {!isEditing && availableModules.length > 0 && (
          <div className="flex gap-0 border-b shrink-0" style={{ borderColor: t.metricGap }}>
            {[{ id: 'monitor', label: 'Monitor' }, { id: 'module', label: 'Module' }].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="px-5 py-2.5 text-xs font-mono font-semibold transition-colors border-b-2 -mb-px"
                style={{
                  color:          activeTab === tab.id ? 'var(--wt-brand-500)' : t.textMuted,
                  borderColor:    activeTab === tab.id ? 'var(--wt-brand-500)' : 'transparent',
                  backgroundColor: 'transparent',
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {formContent}
      </div>
    </div>
  );
}

function Field({ label, hint, required, children, t }) {
  return (
    <div className="wt-field">
      <div className="flex items-baseline gap-2">
        <label className="wt-eyebrow">
          {label}{required && <span style={{ color: 'var(--wt-down-500)', marginLeft: 2 }}>*</span>}
        </label>
        {hint && <span className="text-xs" style={{ color: t.textFaint }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}
