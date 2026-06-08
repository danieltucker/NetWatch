import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';
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

function computeAllIncidents(monitors) {
  const result = [];
  for (const monitor of monitors) {
    const history = monitor.history ?? [];
    let start = null, startIdx = null;
    for (let i = 0; i < history.length; i++) {
      const isDown = history[i].status === 'down';
      if (isDown && start === null) {
        start = history[i].timestamp;
        startIdx = i;
      } else if (!isDown && start !== null) {
        result.push({
          monitorId:    monitor.id,
          monitorLabel: monitor.label,
          start,
          end:          history[i].timestamp,
          durationMs:   new Date(history[i].timestamp) - new Date(start),
          error:        history[startIdx]?.error ?? null,
          ongoing:      false,
        });
        start = null; startIdx = null;
      }
    }
    if (start !== null) {
      result.push({
        monitorId:    monitor.id,
        monitorLabel: monitor.label,
        start,
        end:          null,
        durationMs:   null,
        error:        history[startIdx]?.error ?? null,
        ongoing:      true,
      });
    }
  }
  // Ongoing first, then by start time descending
  return result.sort((a, b) => {
    if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
    return new Date(b.start) - new Date(a.start);
  });
}

export function IncidentsPage({ monitors, onOpenDetail }) {
  const { t } = useTheme();
  const [filter, setFilter] = useState('all');

  const allIncidents = useMemo(() => computeAllIncidents(monitors), [monitors]);

  const filtered = useMemo(() => allIncidents.filter(inc => {
    if (filter === 'active')   return inc.ongoing;
    if (filter === 'resolved') return !inc.ongoing;
    return true;
  }), [allIncidents, filter]);

  const activeCount   = allIncidents.filter(i => i.ongoing).length;
  const resolvedCount = allIncidents.filter(i => !i.ongoing).length;

  const findMonitor = (id) => monitors.find(m => m.id === id);

  return (
    <div>
      {/* Page header */}
      <div className="section-head flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="wt-eyebrow">Incidents</span>
          {activeCount > 0 && (
            <span className="wt-mono text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--wt-down-50)', color: 'var(--wt-down-700)' }}>
              {activeCount} active
            </span>
          )}
        </div>
        <div className="wt-seg">
          <button aria-selected={filter === 'all'}      onClick={() => setFilter('all')}>
            All <span className="wt-mono opacity-60 ml-0.5" style={{ fontSize: 10 }}>{allIncidents.length}</span>
          </button>
          <button aria-selected={filter === 'active'}   onClick={() => setFilter('active')}>Active</button>
          <button aria-selected={filter === 'resolved'} onClick={() => setFilter('resolved')}>Resolved</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <CheckCircle size={36} style={{ color: 'var(--wt-up-500)', opacity: 0.4 }} />
          <p className="text-sm font-medium" style={{ color: t.textMuted }}>
            {filter === 'active'   ? 'No active incidents' :
             filter === 'resolved' ? 'No resolved incidents' :
             'No incidents in this window'}
          </p>
          <p className="text-xs" style={{ color: t.textFaint }}>
            {filter === 'all' ? 'All monitors have been healthy during this period' : ''}
          </p>
        </div>
      ) : (
        <div className="wt-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--wt-border)' }}>
                <th className="px-4 py-2.5 text-left">
                  <span className="wt-eyebrow">Monitor</span>
                </th>
                <th className="px-4 py-2.5 text-left">
                  <span className="wt-eyebrow">Status</span>
                </th>
                <th className="px-4 py-2.5 text-left">
                  <span className="wt-eyebrow">Started</span>
                </th>
                <th className="px-4 py-2.5 text-left">
                  <span className="wt-eyebrow">Duration</span>
                </th>
                <th className="px-4 py-2.5 text-left hidden md:table-cell">
                  <span className="wt-eyebrow">Error</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc, i) => {
                const monitor = findMonitor(inc.monitorId);
                return (
                  <tr key={i}
                    className="border-b transition-colors cursor-pointer"
                    style={{ borderColor: 'var(--wt-border)' }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--wt-surface-2)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
                    onClick={() => monitor && onOpenDetail(monitor, 'incidents', inc.start)}>

                    {/* Monitor name */}
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium" style={{ color: t.textPrimary }}>
                        {inc.monitorLabel}
                      </span>
                    </td>

                    {/* Status pill */}
                    <td className="px-4 py-3">
                      {inc.ongoing ? (
                        <span className="wt-pill wt-pill--down">
                          <span className="wt-pill__dot" />Outage
                        </span>
                      ) : (
                        <span className="wt-pill wt-pill--muted">Resolved</span>
                      )}
                    </td>

                    {/* Start time */}
                    <td className="px-4 py-3">
                      <span className="wt-mono text-xs" style={{ color: t.textMuted }}>
                        {formatTimestamp(inc.start)}
                      </span>
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3">
                      <span className="wt-mono text-xs"
                        style={{ color: inc.ongoing ? 'var(--wt-down-600)' : t.textFaint }}>
                        {inc.ongoing
                          ? <LiveElapsed since={inc.start} />
                          : (inc.durationMs ? formatDuration(inc.durationMs) : '—')
                        }
                      </span>
                    </td>

                    {/* Error snippet */}
                    <td className="px-4 py-3 hidden md:table-cell max-w-[200px]">
                      {inc.error ? (
                        <span className="wt-mono text-xs truncate block"
                          style={{ color: t.textFaint }} title={inc.error}>
                          {inc.error}
                        </span>
                      ) : (
                        <span className="wt-mono text-xs" style={{ color: t.textFaint }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer count */}
      {filtered.length > 0 && (
        <div className="mt-3 text-xs wt-mono" style={{ color: t.textFaint }}>
          {filtered.length} incident{filtered.length !== 1 ? 's' : ''}
          {activeCount > 0 && filter !== 'resolved'
            ? ` · ${activeCount} active`
            : ''}
          {resolvedCount > 0 && filter !== 'active'
            ? ` · ${resolvedCount} resolved`
            : ''}
        </div>
      )}
    </div>
  );
}
