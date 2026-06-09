import React, { useState, useEffect } from 'react';
import { X, AlertTriangle, AlertCircle, CheckCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Expanded row — shown inside the expanded panel
// ---------------------------------------------------------------------------

function AlertRow({ alert, onDismiss, t }) {
  const isActive   = !alert.resolvedAt;
  const isOutage   = alert.type === 'outage';
  const isDegraded = alert.type === 'degraded';
  const accentColor = isActive
    ? (isOutage ? 'var(--wt-down-600)' : 'var(--wt-warn-600)')
    : 'var(--wt-up-600)';

  const Icon = isActive ? (isOutage ? AlertTriangle : AlertCircle) : CheckCircle;
  const typeLabel = isOutage ? 'OUTAGE' : isDegraded ? 'DEGRADED' : 'RECOVERED';
  const duration  = alert.resolvedAt
    ? formatDuration(new Date(alert.resolvedAt) - new Date(alert.startedAt))
    : null;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 shrink-0">
        <Icon size={13} style={{ color: accentColor }}
          className={isActive && isOutage ? 'animate-pulse' : ''} />
      </div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate" style={{ color: t.textPrimary }}>
            {alert.monitorLabel}
          </span>
          <span className="wt-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ color: accentColor, backgroundColor: `color-mix(in oklch, ${accentColor} 10%, transparent)`, letterSpacing: '0.06em' }}>
            {typeLabel}
          </span>
        </div>
        <div className="wt-mono text-xs flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: t.textMuted }}>
          <span className="flex items-center gap-1">
            <Clock size={9} /> {formatDateTime(alert.startedAt)}
          </span>
          {isActive
            ? <span style={{ color: accentColor }}>Ongoing · <LiveElapsed since={alert.startedAt} /></span>
            : <span style={{ color: 'var(--wt-up-600)' }}>
                Recovered {formatDateTime(alert.resolvedAt)}
                {duration && <> · was {isDegraded ? 'degraded' : 'down'} {duration}</>}
              </span>
          }
        </div>
      </div>
      <button onClick={() => onDismiss(alert.id)}
        className="p-1 rounded shrink-0 transition-opacity opacity-30 hover:opacity-80"
        style={{ color: t.textSecondary }}
        title={isActive ? 'Acknowledge' : 'Dismiss'}>
        <X size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertsBanner — persistent in the main content flow
//
// • Renders nothing when alerts array is empty
// • Shows a slim summary bar when collapsed
// • Expands inline to a scrollable list
// • "Calm by default, loud on failure" — no modal, no overlay,
//   just a colored stripe that stays in place until resolved
// ---------------------------------------------------------------------------

export function AlertsBanner({ alerts, onDismiss, onDismissAll, expanded, onToggle }) {
  const { t } = useTheme();

  // Show "all clear" empty state when user explicitly opens with no alerts
  if (alerts.length === 0) {
    if (!expanded) return null;
    return (
      <div className="rounded-lg border px-4 py-3 mb-5 flex items-center justify-between gap-3"
        style={{ borderColor: 'color-mix(in oklch, var(--wt-up-500) 25%, transparent)', backgroundColor: 'var(--wt-up-50)' }}>
        <div className="flex items-center gap-2">
          <CheckCircle size={14} style={{ color: 'var(--wt-up-500)' }} />
          <span className="wt-mono text-xs font-semibold" style={{ color: 'var(--wt-up-600)' }}>All clear</span>
          <span className="wt-mono text-xs" style={{ color: t.textMuted }}>— no active alerts</span>
        </div>
        <button onClick={onToggle} className="p-1 rounded opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: t.textSecondary }}>
          <X size={13} />
        </button>
      </div>
    );
  }

  const active    = alerts.filter(a => !a.resolvedAt);
  const outages   = active.filter(a => a.type === 'outage');
  const degraded  = active.filter(a => a.type === 'degraded');
  const recovered = alerts.filter(a => a.resolvedAt);

  const hasOutage    = outages.length > 0;
  const hasDegraded  = degraded.length > 0;
  const onlyResolved = active.length === 0;

  const accentColor   = hasOutage ? 'var(--wt-down-500)'  : hasDegraded ? 'var(--wt-warn-500)'  : 'var(--wt-up-500)';
  const accentText    = hasOutage ? 'var(--wt-down-600)'  : hasDegraded ? 'var(--wt-warn-600)'  : 'var(--wt-up-600)';
  const bgColor       = hasOutage ? 'var(--wt-down-50)'   : hasDegraded ? 'var(--wt-warn-50)'   : 'var(--wt-up-50)';
  const borderColor   = hasOutage
    ? 'color-mix(in oklch, var(--wt-down-500) 25%, transparent)'
    : hasDegraded
    ? 'color-mix(in oklch, var(--wt-warn-500) 25%, transparent)'
    : 'color-mix(in oklch, var(--wt-up-500) 20%, transparent)';

  // Summary text for the slim bar
  const parts = [];
  if (outages.length)  parts.push(`${outages.length} outage${outages.length !== 1 ? 's' : ''}`);
  if (degraded.length) parts.push(`${degraded.length} degraded`);
  if (onlyResolved)    parts.push(`${recovered.length} resolved`);

  const primaryLabel = (outages[0] || degraded[0])?.monitorLabel;
  const extraCount   = active.length - 1;

  const SummaryIcon = hasOutage ? AlertTriangle : hasDegraded ? AlertCircle : CheckCircle;

  // Alert render order: outages → degraded → recovered
  const ordered = [...outages, ...degraded, ...recovered];

  return (
    <div className="rounded-lg border overflow-hidden mb-5"
      style={{ borderColor, borderLeftWidth: 3, borderLeftColor: accentColor }}>

      {/* ── Slim summary bar ── */}
      <div className="flex items-center gap-3 px-4 py-2.5"
        style={{ backgroundColor: bgColor }}>

        {/* Icon + summary text */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <SummaryIcon size={14} style={{ color: accentColor, flexShrink: 0 }}
            className={hasOutage ? 'animate-pulse' : ''} />
          <span className="wt-mono text-xs font-semibold" style={{ color: accentText }}>
            {parts.join(' · ')}
          </span>
          {primaryLabel && !expanded && (
            <span className="wt-mono text-xs truncate" style={{ color: t.textMuted }}>
              — {primaryLabel}
              {extraCount > 0 && (
                <span style={{ color: t.textFaint }}> +{extraCount} more</span>
              )}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          {alerts.length > 1 && (
            <button onClick={onDismissAll}
              className="text-xs wt-mono px-2 py-1 rounded transition-opacity opacity-50 hover:opacity-100"
              style={{ color: t.textSecondary }}>
              dismiss all
            </button>
          )}
          <button onClick={onToggle}
            className="p-1.5 rounded transition-opacity opacity-50 hover:opacity-100"
            style={{ color: t.textSecondary }}
            aria-label={expanded ? 'Collapse alerts' : 'Expand alerts'}>
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
      </div>

      {/* ── Expanded list ── */}
      {expanded && (
        <div className="divide-y max-h-72 overflow-y-auto"
          style={{ borderColor, backgroundColor: 'var(--wt-surface)' }}>
          {ordered.map(alert => (
            <AlertRow key={alert.id} alert={alert} onDismiss={onDismiss} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}
