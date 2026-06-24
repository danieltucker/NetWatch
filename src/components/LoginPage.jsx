import React, { useState } from 'react';
import { Radio, AlertCircle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';

export function LoginPage() {
  const { login }                   = useAuth();
  const { isDark }                  = useTheme();
  const [username,  setUsername]    = useState('');
  const [password,  setPassword]    = useState('');
  const [error,     setError]       = useState('');
  const [loading,   setLoading]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--wt-bg)' }}>
      <div style={{ width: '100%', maxWidth: 380 }}>

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

        {/* Card */}
        <div className="wt-card" style={{ padding: 28 }}>
          <span className="wt-eyebrow" style={{ display: 'block', marginBottom: 20 }}>Sign in</span>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="wt-field">
              <label className="wt-label">Username</label>
              <input
                className="wt-input"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            <div className="wt-field">
              <label className="wt-label">Password</label>
              <input
                className="wt-input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                required
              />
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
              disabled={loading || !username || !password}
              style={{ marginTop: 4, width: '100%', justifyContent: 'center' }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
