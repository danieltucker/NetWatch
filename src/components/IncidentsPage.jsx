import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle, Loader } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { formatTimestamp } from '../types/monitor';

function formatDuration(ms) {
  if (!ms || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1)  return '< 1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function LiveElapsed({ since }) {
  const [elapsed, setElapsed] = useState(Date.now() - new Date(since).getTime());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(since).getTime()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span>{formatDuration(elapsed)}</span>;
}

function alertsToIncidents(alerts) {
  return alerts.map(a => ({
    id:           a.id,
    monitorId:    a.monitorId,
    monitorLabel: a.monitorLabel,
    type:         a.type,
    start:        a.startedAt,
    end:          a.resolvedAt ?? null,
    durationMs:   a.resolvedAt
                    ? new Date(a.resolvedAt) - new Date(a.startedAt)
                    : null,
    ongoing:      a.resolvedAt === null,
  })).sort((a, b) => {
    if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
    return new Date(b.start) - new Date(a.start);
  });
}

// IncidentsPage fetches its own full history so dismissed alerts remain visible.
// The `alerts` prop (live banner state) is only used for the active count badge.
export function IncidentsPage({ alerts: liveAlerts, monitors, onOpenDetail }) {
  const { t } = useTheme();
  const [filter,    setFilter]    = useState('all');
  const [history,   setHistory]   = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    fetch('/api/alerts/history?limit=500')
      .then(r => r.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => setLoadError('Failed to load incident history'));
  }, []);

  // Refresh history when a live alert resolves or is dismissed
  const liveKey = liveAlerts.map(a => `${a.id}:${a.resolvedAt ?? ''}:${a.dismissedAt ?? ''}`).join(',');
  useEffect(() => {
    if (history === null) return;
    fetch('/api/alerts/history?limit=500')
      .then(r => r.json())
      .then(data => setHistory(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [liveKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const allIncidents = useMemo(() => history ? alertsToIncidents(history) : [], [history]);

  const filtered = useMemo(() => allIncidents.filter(inc => {
    if (filter === 'active')   return inc.ongoing;
    if (filter === 'resolved') return !inc.ongoing;
    return true;
  }), [allIncidents, filter]);

  const activeCount   = allIncidents.filter(i => i.ongoing).length;
  const resolvedCount = allIncidents.filter(i => !i.ongoing).length;

  const findMonitor = (id) => monitors.find(m => m.id === id);

  if (history === null && !loadError) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-sm wt-mono"
        style={{ color: 'var(--wt-text-faint)' }}>
        <Loader size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      {/* Filter toolbar */}
      <div className="flex items-center justify-between pb-4">
        <div className="wt-seg">
          <button aria-selected={filter === 'all'}      onClick={() => setFilter('all')}>
            All <span className="wt-mono opacity-60 ml-0.5" style={{ fontSize: 10 }}>{allIncidents.length}</span>
          </button>
          <button aria-selected={filter === 'active'}   onClick={() => setFilter('active')}>Active</button>
          <button aria-selected={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolved</button>
        </div>
      </div>

      {loadError ? (
        <div className="py-12 text-center text-sm wt-mono" style={{ color: 'var(--wt-down-600)' }}>
          {loadError}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <CheckCircle size={36} style={{ color: 'var(--wt-up-500)', opacity: 0.4 }} />
          <p className="text-sm font-medium" style={{ color: t.textMuted }}>
            {filter === 'active'   ? 'No active incidents' :
             filter === 'resolved' ? 'No resolved incidents' :
             'No incidents on record'}
          </p>
          <p className="text-xs" style={{ color: t.textFaint }}>
            {filter === 'all' ? 'All monitors have been healthy' : ''}
          </p>
        </div>
      ) : (
        <div className="wt-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--wt-border)' }}>
                <th className="px-4 py-2.5 text-left"><span className="wt-eyebrow">Monitor</span></th>
                <th className="px-4 py-2.5 text-left"><span className="wt-eyebrow">Status</span></th>
                <th className="px-4 py-2.5 text-left"><span className="wt-eyebrow">Started</span></th>
                <th className="px-4 py-2.5 text-left"><span className="wt-eyebrow">Duration</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => {
                const monitor = findMonitor(inc.monitorId);
                return (
                  <tr key={inc.id}
                    className="border-b transition-colors cursor-pointer"
                    style={{ borderColor: 'var(--wt-border)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--wt-surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
                    onClick={() => monitor && onOpenDetail(monitor, 'incidents', inc.start)}>

                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: t.textPrimary }}>
                        {inc.monitorLabel}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      {inc.ongoing ? (
                        inc.type === 'degraded' ? (
                          <span className="wt-pill wt-pill--warn"><span className="wt-pill__dot" />Degraded</span>
                        ) : (
                          <span className="wt-pill wt-pill--down"><span className="wt-pill__dot" />Down</span>
                        )
                      ) : (
                        <span className="wt-pill wt-pill--muted">Resolved</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span className="wt-mono text-xs" style={{ color: t.textMuted }}>
                        {formatTimestamp(inc.start)}
                      </span>
                    </td>

                    <td className="px-4 py-3">
                      <span className="wt-mono text-xs"
                        style={{ color: inc.ongoing ? (inc.type === 'degraded' ? 'var(--wt-warn-600)' : 'var(--wt-down-600)') : t.textFaint }}>
                        {inc.ongoing
                          ? <LiveElapsed since={inc.start} />
                          : (inc.durationMs ? formatDuration(inc.durationMs) : '—')
                        }
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="mt-3 text-xs wt-mono" style={{ color: t.textFaint }}>
          {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
          {activeCount > 0 && filter !== 'resolved' ? ` · ${activeCount} active` : ''}
          {resolvedCount > 0 && filter !== 'active'  ? ` · ${resolvedCount} resolved` : ''}
        </div>
      )}
    </div>
  );
}
