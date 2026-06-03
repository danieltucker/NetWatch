import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useAlerts — fetches alert state from the backend and keeps it live via SSE.
 *
 * Alert types returned by the API:
 *   type='outage'   resolved_at=null  → active outage
 *   type='degraded' resolved_at=null  → active degraded
 *   resolved_at set                   → recovered (show until dismissed)
 *
 * Dismiss behaviour:
 *   - Ongoing alert: dismissed_at is reset to null on the next check that
 *     confirms the bad state, so it re-surfaces automatically.
 *   - Resolved alert: permanent dismiss.
 */
export function useAlerts(onNewAlert) {
  const [alerts, setAlerts] = useState([]);

  // Keep a ref so the SSE closure always sees the latest callback without
  // needing to re-subscribe to the event stream on every render.
  const onNewAlertRef = useRef(onNewAlert);
  useEffect(() => { onNewAlertRef.current = onNewAlert; }, [onNewAlert]);

  // ── Initial fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/alerts')
      .then(r => r.ok ? r.json() : [])
      .then(setAlerts)
      .catch(console.error);
  }, []);

  // ── SSE stream ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('alert:new', (e) => {
      const a = JSON.parse(e.data);
      setAlerts(prev => [a, ...prev.filter(x => x.id !== a.id)]);
      onNewAlertRef.current?.(a);
    });

    es.addEventListener('alert:updated', (e) => {
      const a = JSON.parse(e.data);
      // Reset dismissedAt when the scheduler re-surfaces an ongoing alert
      setAlerts(prev => prev.map(x => x.id === a.id ? a : x));
    });

    es.addEventListener('alert:resolved', (e) => {
      const a = JSON.parse(e.data);
      setAlerts(prev => prev.map(x => x.id === a.id ? a : x));
    });

    es.addEventListener('alert:dismissed', (e) => {
      const { id } = JSON.parse(e.data);
      setAlerts(prev => prev.filter(x => x.id !== id));
    });

    es.addEventListener('alert:dismissed-all', () => {
      setAlerts([]);
    });

    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const dismiss = useCallback(async (id) => {
    setAlerts(prev => prev.filter(x => x.id !== id)); // optimistic
    await fetch(`/api/alerts/${id}/dismiss`, { method: 'PUT' })
      .catch(console.error);
  }, []);

  const dismissAll = useCallback(async () => {
    setAlerts([]); // optimistic
    await fetch('/api/alerts/dismiss-all', { method: 'DELETE' })
      .catch(console.error);
  }, []);

  return { alerts, dismiss, dismissAll };
}
