import React, { useState } from 'react';
import { Radio, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export function SetupPage() {
  const { completeSetup }             = useAuth();
  const [password,  setPassword]      = useState('');
  const [confirm,   setConfirm]       = useState('');
  const [error,     setError]         = useState('');
  const [loading,   setLoading]       = useState(false);

  const mismatch  = confirm && password !== confirm;
  const tooShort  = password && password.length < 12;
  const canSubmit = password.length >= 12 && password === confirm && !loading;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setLoading(true);
    try {
      await completeSetup(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--wt-bg)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Wordmark */}
        <div className="flex items-center gap-2 justify-center mb-8">
          <span className="wt-appicon"
            style={{ '--ai-size': '32px', '--ai-from': 'var(--nw-from)', '--ai-to': 'var(--nw-to)' }}>
            <Radio size={16} />
          </span>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--wt-text)' }}>
            Net<span style={{ color: 'var(--nw-ink)' }}>Watch</span>
          </span>
        </div>

        <div className="wt-card" style={{ padding: 28 }}>
          <span className="wt-eyebrow" style={{ display: 'block', marginBottom: 6 }}>First-time setup</span>
          <h2 style={{ fontSize: 'var(--wt-text-md)', fontWeight: 700, color: 'var(--wt-text)',
            letterSpacing: '-0.02em', marginBottom: 4 }}>
            Set your admin password
          </h2>
          <p style={{ fontSize: 'var(--wt-text-sm)', color: 'var(--wt-text-muted)', marginBottom: 20 }}>
            Choose a strong password (12+ characters) to protect your dashboard.
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="wt-field">
              <label className="wt-label">Password</label>
              <input
                className="wt-input"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                required
                minLength={12}
              />
              {tooShort && (
                <span className="wt-hint" style={{ color: 'var(--wt-warn-600)' }}>
                  Must be at least 12 characters
                </span>
              )}
            </div>

            <div className="wt-field">
              <label className="wt-label">Confirm password</label>
              <input
                className="wt-input"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                disabled={loading}
                required
              />
              {mismatch && (
                <span className="wt-hint" style={{ color: 'var(--wt-down-600)' }}>
                  Passwords do not match
                </span>
              )}
              {!mismatch && confirm && password === confirm && (
                <span className="wt-hint flex items-center gap-1" style={{ color: 'var(--wt-up-600)' }}>
                  <CheckCircle size={11} /> Passwords match
                </span>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs wt-mono"
                style={{ color: 'var(--wt-down-600)', padding: '8px 10px',
                  backgroundColor: 'var(--wt-down-50)', borderRadius: 'var(--wt-r-md)',
                  border: '1px solid color-mix(in oklch, var(--wt-down-500) 25%, transparent)' }}>
                <AlertCircle size={12} style={{ flexShrink: 0 }} />
                {error}
              </div>
            )}

            <button
              type="submit"
              className="wt-btn wt-btn--primary"
              disabled={!canSubmit}
              style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}>
              {loading ? 'Setting up…' : 'Get started'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
