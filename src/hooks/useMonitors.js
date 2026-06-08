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
  const [monitors,      setMonitors]      = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(null);
  const [sseConnected,  setSseConnected]  = useState(null); // null=unknown, true=live, false=offline

  // ── Fetch / re-fetch when window or custom range changes ───────────────────
  useEffect(() => {
    setLoading(true);
    setError(null);
    const url = `/api/monitors?${buildParams(historyRange, historyWindow)}`;
    console.debug('[useMonitors] fetch start — window=%s url=%s', historyWindow, url);
    fetch(url)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        const first = data[0];
        console.debug('[useMonitors] fetch done — %d monitors, first={ label:%s, historyWindow:%s, historyLen:%d }',
          data.length, first?.label, first?.historyWindow, first?.history?.length ?? 0);
        setMonitors(data);
        setLoading(false);
      })
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

        // Append the raw point for all raw-data windows (15m, 1h, 6h).
        // Filter by timestamp rather than capping at a fixed count — this stays
        // correct regardless of the monitor's check interval (30s vs 60s etc.)
        // and matches what the API returns on a full fetch.
        // Aggregated windows (12h+) use pre-bucketed data — a raw point would
        // break the bucket shape, so leave those static.
        const WINDOW_MS = { '15m': 15*60*1000, '1h': 60*60*1000, '6h': 6*60*60*1000 };
        if (m.historyWindow in WINDOW_MS) {
          const cutoff  = Date.now() - WINDOW_MS[m.historyWindow];
          const history = [...m.history, u.newPoint]
            .filter(h => h.timestamp && new Date(h.timestamp).getTime() >= cutoff);
          console.debug('[useMonitors:SSE] checked — label=%s window=%s pts=%d', m.label, m.historyWindow, history.length);
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

    es.onopen  = () => {
      setSseConnected(true);
    };

    // onerror fires on every retry attempt; only flag offline after a sustained gap
    let offlineTimer = null;
    es.onerror = () => {
      clearTimeout(offlineTimer);
      offlineTimer = setTimeout(() => setSseConnected(false), 4000);
    };

    // Receiving any event means the connection is alive
    const markAlive = () => {
      clearTimeout(offlineTimer);
      setSseConnected(true);
    };
    es.addEventListener('monitor:checked', markAlive);

    return () => {
      clearTimeout(offlineTimer);
      es.close();
    };
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

  return { monitors, loading, error, sseConnected, addMonitor, updateMonitor, deleteMonitor, refresh };
}
