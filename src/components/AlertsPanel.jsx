import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const secs = Math.floor(ms / 1000);
  if (secs < 60)  return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60)  return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), today = new Date();
  const timeStr = d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (d.toDateString() === today.toDateString()) return timeStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
}

function LiveElapsed({ since }) {
  const [elapsed, setElapsed] = useState(Date.now() - new Date(since).getTime());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - new Date(since).getTime()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return <span>{formatDuration(elapsed)}</span>;
}

function AlertRow({ alert, onDismiss }) {
  const { t } = useTheme();
  const isActive   = !alert.resolvedAt;
  const isOutage   = alert.type === 'outage';
  const isDegraded = alert.type === 'degraded';

  // Status-color tokens: outage=down, degraded=warn, recovered=up
  const accentColor  = isActive ? (isOutage ? 'var(--wt-down-600)' : 'var(--wt-warn-600)') : 'var(--wt-up-600)';
  const bgColor      = isActive ? (isOutage ? 'var(--wt-down-50)'  : 'var(--wt-warn-50)')  : 'var(--wt-up-50)';
  const borderColor  = isActive
    ? (isOutage ? 'color-mix(in oklch, var(--wt-down-500) 25%, transparent)' : 'color-mix(in oklch, var(--wt-warn-500) 25%, transparent)')
    : 'color-mix(in oklch, var(--wt-up-500) 20%, transparent)';

  const Icon = isActive ? (isOutage ? AlertTriangle : AlertCircle) : CheckCircle;
  const typeLabel = isOutage ? 'OUTAGE' : isDegraded ? 'DEGRADED' : 'RECOVERED';
  const duration  = alert.resolvedAt ? formatDuration(new Date(alert.resolvedAt) - new Date(alert.startedAt)) : null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border"
      style={{ backgroundColor: bgColor, borderColor }}>
      <div className="mt-0.5 shrink-0">
        <Icon size={15} style={{ color: accentColor }} className={isActive && isOutage ? 'animate-pulse' : ''} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: t.textPrimary }}>
            {alert.monitorLabel}
          </span>
          <span className="wt-mono text-xs font-bold px-1.5 py-0.5 rounded border"
            style={{ color: accentColor, borderColor, backgroundColor: bgColor, letterSpacing: '0.06em' }}>
            {typeLabel}
          </span>
        </div>
        <div className="wt-mono text-xs flex flex-wrap gap-x-4 gap-y-0.5" style={{ color: t.textMuted }}>
          <span className="flex items-center gap-1">
            <Clock size={9} />
            Started {formatDateTime(alert.startedAt)}
          </span>
          {isActive ? (
            <>
              <span>Last seen {formatDateTime(alert.lastOccurredAt)}</span>
              <span style={{ color: accentColor }}>Ongoing · <LiveElapsed since={alert.startedAt} /></span>
            </>
          ) : (
            <>
              <span>Last occurred {formatDateTime(alert.lastOccurredAt)}</span>
              <span style={{ color: 'var(--wt-up-600)' }}>
                Recovered {formatDateTime(alert.resolvedAt)}
                {duration && <> · was down {duration}</>}
              </span>
            </>
          )}
          <span style={{ color: t.textFaint }}>{alert.target}</span>
        </div>
      </div>
      <button onClick={() => onDismiss(alert.id)}
        className="p-1 rounded shrink-0 transition-opacity opacity-40 hover:opacity-100"
        style={{ color: t.textSecondary }}
        title={isActive ? 'Acknowledge' : 'Dismiss'}>
        <X size={13} />
      </button>
    </div>
  );
}

function SectionHeading({ label, count, colorToken }) {
  const { t } = useTheme();
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <span className="wt-eyebrow" style={{ color: colorToken }}>{label}</span>
      <span className="wt-mono text-xs px-1.5 py-0.5 rounded-full"
        style={{ color: colorToken, backgroundColor: `color-mix(in oklch, ${colorToken} 12%, transparent)` }}>
        {count}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: t.cardBorder }} />
    </div>
  );
}

export function AlertsPanel({ alerts, onDismiss, onDismissAll, onClose }) {
  const { t } = useTheme();
  const outages   = alerts.filter(a => a.type === 'outage'   && !a.resolvedAt);
  const degraded  = alerts.filter(a => a.type === 'degraded' && !a.resolvedAt);
  const recovered = alerts.filter(a => a.resolvedAt);
  const totalActive = outages.length + degraded.length;

  return (
    <div className="wt-card shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: t.cardBorder }}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="wt-eyebrow" style={{ color: t.textPrimary }}>Alerts</span>
          {outages.length > 0 && (
            <span className="wt-mono text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--wt-down-50)', color: 'var(--wt-down-700)' }}>
              {outages.length} outage{outages.length !== 1 ? 's' : ''}
            </span>
          )}
          {degraded.length > 0 && (
            <span className="wt-mono text-xs font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--wt-warn-50)', color: 'var(--wt-warn-700)' }}>
              {degraded.length} degraded
            </span>
          )}
        </div>
        <button onClick={onClose} className="wt-btn wt-btn--ghost wt-btn--sm"><X size={14} /></button>
      </div>

      {/* Content */}
      <div className="p-3 space-y-3 max-h-96 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: t.textMuted }}>
            No alerts — all monitors are healthy
          </div>
        ) : (
          <>
            {outages.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Outages"  count={outages.length}  colorToken="var(--wt-down-600)" />
                {outages.map(a => <AlertRow key={a.id} alert={a} onDismiss={onDismiss} />)}
              </div>
            )}
            {degraded.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Degraded" count={degraded.length} colorToken="var(--wt-warn-600)" />
                {degraded.map(a => <AlertRow key={a.id} alert={a} onDismiss={onDismiss} />)}
              </div>
            )}
            {recovered.length > 0 && (
              <div className="space-y-2">
                <SectionHeading label="Recovered" count={recovered.length} colorToken="var(--wt-up-600)" />
                {recovered.map(a => <AlertRow key={a.id} alert={a} onDismiss={onDismiss} />)}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {alerts.length > 1 && (
        <div className="px-4 py-2 border-t flex justify-between items-center" style={{ borderColor: t.cardBorder }}>
          <span className="text-xs" style={{ color: t.textFaint }}>
            {totalActive > 0 ? 'Acknowledge re-surfaces on next check if still active' : null}
          </span>
          <button onClick={onDismissAll} className="wt-btn wt-btn--ghost wt-btn--sm">Dismiss all</button>
        </div>
      )}
    </div>
  );
}
