import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * useTheme — light/dark only, driven by the Watchtower design tokens.
 *
 * Color no longer lives in JS. The `t` object below is a stable set of
 * references to the `--wt-*` CSS variables defined in watchtower.css; the
 * actual values flip when `data-theme` changes on <html>. Components keep
 * reading `t.cardBg` etc. exactly as before — they now resolve to tokens.
 */

// Stable token map — identical in both modes; data-theme does the flipping.
const t = {
  pageBg:          'var(--wt-bg)',
  headerBg:        'var(--wt-surface)',
  cardBg:          'var(--wt-surface)',
  cardBorder:      'var(--wt-border)',
  cardBorderHover: 'var(--wt-border-strong)',
  metricGap:       'var(--wt-border)',
  inputBg:         'var(--wt-surface-2)',
  summaryBg:       'var(--wt-surface-2)',
  summaryBorder:   'var(--wt-border)',
  tooltipBg:       'var(--wt-surface)',
  tooltipBorder:   'var(--wt-border)',
  tagBg:           'var(--wt-surface-2)',
  tagBorder:       'var(--wt-border)',
  textPrimary:     'var(--wt-text)',
  textSecondary:   'var(--wt-text-muted)',
  textMuted:       'var(--wt-text-subtle)',
  textFaint:       'var(--wt-text-faint)',
};

const ThemeContext = createContext({
  isDark: true, t, themeMode: 'auto', setThemeMode: () => {},
});

export function ThemeProvider({ children }) {
  const [themeMode, setThemeMode] = useState(() => {
    try {
      const stored = localStorage.getItem('wt-theme');
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
      return 'auto';
    } catch {
      return 'auto';
    }
  });

  const [osPrefersDark, setOsPrefersDark] = useState(() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
    catch { return true; }
  });

  useEffect(() => {
    if (themeMode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setOsPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  const isDark =
    themeMode === 'dark'  ? true  :
    themeMode === 'light' ? false :
    osPrefersDark;

  useEffect(() => {
    try { localStorage.setItem('wt-theme', themeMode); } catch {}
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }, [isDark, themeMode]);

  return (
    <ThemeContext.Provider value={{ isDark, t, themeMode, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
