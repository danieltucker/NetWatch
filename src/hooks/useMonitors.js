import { useState, useEffect, useCallback } from 'react';

/**
 * useMonitors — manages monitor state via the Express REST API + SSE stream.
 *
 * Data flow:
 *  1. Mount / window change  → GET /api/monitors?window=1h|12h|1d|1w
 *  2. Always                 → EventSource /api/events (scheduler pushes check results)
 *  3. CRUD                   → POST / PUT / DELETE /api/monitors/:id
 *
 * The SSE 'monitor:checked' event updates status/ping/uptime fields live.
 * For the 1h window it also appends a raw history point so the sparkline
 * stays live. For longer windows the sparkline is static between fetches
 * (the buckets are already wide enough that one new point doesn't matter).
 */
// Build the API query string from either a custom/zoom range or a preset window key.
// Defined outside the hook so it's a stable reference with no closure over state.
function buildParams(range, window) {
  if (range?.type === 'custom' || range?.type === 'zoom') {
    return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
  }
  return `window=${window}`;
}

export function useMonitors(historyWindow = '1h', historyRange = null) {
  const [monitors, setMonitors] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);

  // ── Fetch / re-fetch when window or custom range changes ───────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/monitors?${buildParams(historyRange, historyWindow)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => { setMonitors(data); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); });
  }, [historyWindow, historyRange]);

  // ── SSE stream ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('monitor:checked', (e) => {
      const u = JSON.parse(e.data);
      setMonitors(prev => prev.map(m => {
        if (m.id !== u.id) return m;

        // Always update live fields. uptimePercent from SSE is computed from
        // the last 1h of data — only apply it when the client is also on the
        // 1h window; otherwise preserve the value from the last full fetch so
        // the displayed % stays consistent with the selected window.
        const base = {
          ...m,
          status:      u.status,
          currentPing: u.currentPing,
          lastChecked: u.lastChecked,
          latest:      u.latest,
          ...(m.historyWindow === '1h' ? { uptimePercent: u.uptimePercent } : {}),
        };

        // Only append the raw point to history for the 1h (raw) window.
        // Longer windows use pre-aggregated buckets — appending a single
        // raw point would break the bucket shape.
        if (m.historyWindow === '1h') {
          const history = [...m.history, u.newPoint].slice(-120);
          return { ...base, history };
        }

        return base;
      }));
    });

    es.addEventListener('monitor:created', (e) => {
      const created = JSON.parse(e.data);
      setMonitors(prev => prev.some(m => m.id === created.id) ? prev : [...prev, created]);
    });

    es.addEventListener('monitor:updated', (e) => {
      const updated = JSON.parse(e.data);
      setMonitors(prev => prev.map(m => {
        if (m.id !== updated.id) return m;
        // The SSE payload always uses the default 1h window. Preserve the
        // current window's history so the chart doesn't jump when the user
        // is viewing a different window (e.g. 6h or 1d).
        return { ...updated, history: m.history, historyWindow: m.historyWindow };
      }));
    });

    es.addEventListener('monitor:deleted', (e) => {
      const { id } = JSON.parse(e.data);
      setMonitors(prev => prev.filter(m => m.id !== id));
    });

    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => es.close();
  }, []);

  // ── CRUD ────────────────────────────────────────────────────────────────────

  const addMonitor = useCallback(async (data) => {
    const res = await fetch('/api/monitors', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to create monitor (${res.status})`);
    const monitor = await res.json();
    setMonitors(prev => [...prev, monitor]);
    return monitor;
  }, []);

  const updateMonitor = useCallback(async (id, data) => {
    const res = await fetch(`/api/monitors/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Failed to update monitor (${res.status})`);
    const updated = await res.json();
    setMonitors(prev => prev.map(m => m.id === id ? updated : m));
    return updated;
  }, []);

  const deleteMonitor = useCallback(async (id) => {
    const res = await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete monitor (${res.status})`);
    setMonitors(prev => prev.filter(m => m.id !== id));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    return fetch(`/api/monitors?${buildParams(historyRange, historyWindow)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => { setMonitors(data); setLoading(false); })
      .catch(err  => { setError(err.message); setLoading(false); throw err; });
  }, [historyWindow, historyRange]);

  return { monitors, loading, error, addMonitor, updateMonitor, deleteMonitor, refresh };
}
