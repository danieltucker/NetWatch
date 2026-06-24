import React, { useState, useEffect } from 'react';
import { Radio } from 'lucide-react';
import { MonitorCard } from './MonitorCard';
import { SummaryBar }  from './SummaryBar';
import { useTheme }    from '../hooks/useTheme';

/**
 * Read-only dashboard rendered at /embed and /embed/monitor/:id.
 * No header chrome, no edit/delete controls, no settings or alerts.
 */
export function EmbedView({ monitorId }) {
  const { t } = useTheme();
  const [monitors, setMonitors] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/public/monitors?window=1h')
      .then(r => r.json())
      .then(data => { setMonitors(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/public/events');
    es.addEventListener('monitor:checked', (e) => {
      const u = JSON.parse(e.data);
      setMonitors(prev => prev.map(m => {
        if (m.id !== u.id) return m;
        const history = [...m.history, u.newPoint].slice(-120);
        return { ...m, status: u.status, currentPing: u.currentPing,
                 uptimePercent: u.uptimePercent, lastChecked: u.lastChecked,
                 latest: u.latest, history };
      }));
    });
    es.onerror = () => {};
    return () => es.close();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen wt-mono text-xs"
        style={{ backgroundColor: t.pageBg, color: t.textMuted }}>
        <span className="animate-spin mr-2">⟳</span> Loading…
      </div>
    );
  }

  if (monitorId) {
    const monitor = monitors.find(m => m.id === monitorId);
    if (!monitor) {
      return (
        <div className="flex items-center justify-center min-h-screen wt-mono text-xs"
          style={{ backgroundColor: t.pageBg, color: t.textMuted }}>
          Monitor not found
        </div>
      );
    }
    return (
      <div style={{ backgroundColor: t.pageBg, padding: 12 }}>
        <MonitorCard monitor={monitor} onEdit={null} onDelete={null} />
      </div>
    );
  }

  const userMonitors = monitors.filter(m => !m.tags?.includes('_ref'));
  const refMonitors  = monitors.filter(m =>  m.tags?.includes('_ref'));

  return (
    <div className="min-h-screen" style={{ backgroundColor: t.pageBg, color: t.textPrimary }}>

      {/* Minimal header */}
      <div className="px-6 py-3 border-b flex items-center gap-2"
        style={{ backgroundColor: t.headerBg, borderColor: t.cardBorder }}>
        <Radio size={14} style={{ color: 'var(--wt-up-500)' }} />
        <span className="wt-eyebrow" style={{ color: t.textSecondary }}>
          NETWATCH
        </span>
        {/* live indicator */}
        <span className="relative flex h-1.5 w-1.5 ml-auto">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full"
            style={{ backgroundColor: 'var(--wt-up-500)', opacity: 0.5 }} />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5"
            style={{ backgroundColor: 'var(--wt-up-500)' }} />
        </span>
      </div>

      <div className="px-6 py-5 space-y-5">
        {userMonitors.length > 0 && <SummaryBar monitors={userMonitors} />}

        {userMonitors.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {userMonitors.map(m => (
              <MonitorCard key={m.id} monitor={m} onEdit={null} onDelete={null} />
            ))}
          </div>
        )}

        {refMonitors.length > 0 && (
          <section>
            <div className="section-head"><span className="wt-eyebrow">Reference</span></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {refMonitors.map(m => (
                <MonitorCard key={m.id} monitor={m} onEdit={null} onDelete={null} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
