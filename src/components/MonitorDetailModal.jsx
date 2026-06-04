import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AreaChart, Area, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { X, Trash2, Copy, Check, Monitor, LayoutGrid, ArrowLeftRight, ExternalLink } from 'lucide-react';
import { MonitorForm } from './MonitorForm';
import { TimingChip }  from './TimingRow';
import { useTheme }    from '../hooks/useTheme';
import { formatTimestamp } from '../types/monitor';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS = {
  up: '#4ade80', degraded: '#fbbf24', down: '#ef4444', pending: '#6b7280',
};

const CHECK_TYPE_LABELS = { http: 'HTTP', api: 'API', tcp: 'TCP', icmp: 'ICMP' };

const WINDOWS = ['1h', '6h', '1d', '1w'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusDot({ status }) {
  return (
    <span className="rounded-full shrink-0 inline-block"
      style={{ width: 8, height: 8, backgroundColor: STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.pending }} />
  );
}

function computeTrend(history) {
  if (!history || history.length < 6) return { ping: null, uptime: null };
  const mid   = Math.floor(history.length / 2);
  const first = history.slice(0, mid);
  const second = history.slice(mid);

  const fp = first.map(h => h.ping).filter(p => p != null);
  const sp = second.map(h => h.ping).filter(p => p != null);
  let ping = null;
  if (fp.length >= 3 && sp.length >= 3) {
    const d = Math.round(sp.reduce((s, v) => s + v, 0) / sp.length - fp.reduce((s, v) => s + v, 0) / fp.length);
    if (Math.abs(d) >= 2) ping = { delta: Math.abs(d), direction: d < 0 ? 'faster' : 'slower' };
  }

  const toU = h => h.uptimePct ?? (h.status === 'up' ? 100 : h.status === 'down' ? 0 : null);
  const fu  = first.map(toU).filter(v => v != null);
  const su  = second.map(toU).filter(v => v != null);
  let uptime = null;
  if (fu.length >= 3 && su.length >= 3) {
    const d = Math.round((su.reduce((s, v) => s + v, 0) / su.length - fu.reduce((s, v) => s + v, 0) / fu.length) * 10) / 10;
    if (Math.abs(d) >= 0.1) uptime = { delta: Math.abs(d), direction: d > 0 ? 'up' : 'down' };
  }
  return { ping, uptime };
}

function computeStats(history, window) {
  const pings     = history.map(h => h.ping).filter(p => p != null);
  const upCount   = history.filter(h => h.status === 'up').length;
  const downCount = history.filter(h => h.status === 'down').length;
  const avgPing   = pings.length ? Math.round(pings.reduce((s, v) => s + v, 0) / pings.length) : null;

  let p95 = null, bestPing = null;
  if (window === '1h' && pings.length >= 5) {
    p95 = [...pings].sort((a, b) => a - b)[Math.floor(pings.length * 0.95)];
  } else if (pings.length > 0) {
    bestPing = Math.min(...pings);
  }

  const uptimePct = history.length ? Math.round((upCount / history.length) * 1000) / 10 : null;

  // Count incident transitions
  let incidents = 0;
  let wasDown = false;
  for (const h of history) {
    const isDown = h.status === 'down';
    if (isDown && !wasDown) incidents++;
    wasDown = isDown;
  }

  return { upCount, downCount, avgPing, p95, bestPing, uptimePct, incidents };
}

function computeIncidents(history) {
  const result = [];
  let start = null, startIdx = null;
  for (let i = 0; i < history.length; i++) {
    const isDown = history[i].status === 'down';
    if (isDown && start === null) {
      start = history[i].timestamp;
      startIdx = i;
    } else if (!isDown && start !== null) {
      const startMs = new Date(start).getTime();
      const endMs   = new Date(history[i].timestamp).getTime();
      result.push({
        start,
        end:         history[i].timestamp,
        durationMin: Math.max(1, Math.round((endMs - startMs) / 60000)),
        error:       history[startIdx]?.error ?? null,
        ongoing:     false,
      });
      start = null; startIdx = null;
    }
  }
  if (start !== null) {
    result.push({ start, end: null, durationMin: null, error: history[startIdx]?.error ?? null, ongoing: true });
  }
  return result.reverse();
}

// ---------------------------------------------------------------------------
// Simple chart tooltip (no portal needed inside fixed modal)
// ---------------------------------------------------------------------------

function ModalTooltip({ active, payload, t }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const timeLabel = d.timestamp
    ? new Date(d.timestamp).toLocaleString('en-US', {
        hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  return (
    <div className="rounded-lg text-xs font-mono shadow-xl border px-3 py-2"
      style={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, minWidth: 110 }}>
      {d.status === 'down'
        ? <div className="text-red-400 font-bold mb-1">DOWN</div>
        : <div className="font-bold mb-1" style={{ color: t.textPrimary }}>{d.ping != null ? `${d.ping}ms` : '—'}</div>}
      <div style={{ color: t.textFaint }}>{timeLabel}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History tab
// ---------------------------------------------------------------------------

function HistoryTab({ history, t, isDark }) {
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-xs font-mono"
        style={{ color: t.textFaint }}>
        No history yet — awaiting first check
      </div>
    );
  }

  const reversed = [...history].reverse();

  return (
    <table className="w-full text-xs font-mono">
      <thead className="sticky top-0" style={{ backgroundColor: t.cardBg }}>
        <tr className="border-b" style={{ borderColor: t.metricGap }}>
          <th className="px-4 py-2 text-left font-semibold" style={{ color: t.textFaint }}>Time</th>
          <th className="px-4 py-2 text-left font-semibold" style={{ color: t.textFaint }}>Status</th>
          <th className="px-4 py-2 text-right font-semibold" style={{ color: t.textFaint }}>Ping</th>
          <th className="px-4 py-2 text-left font-semibold" style={{ color: t.textFaint }}>Info</th>
        </tr>
      </thead>
      <tbody>
        {reversed.map((entry, i) => {
          const isExpanded  = expandedIdx === i;
          const statusColor = entry.status === 'down' ? '#f87171'
            : entry.status === 'up' ? '#4ade80'
            : t.textSecondary;
          const hasTimings  = entry.dnsMs != null;
          const hasDetail   = hasTimings || entry.httpStatus != null || !!entry.error ||
                              (entry.aggregated && entry.uptimePct != null);

          let info = null;
          if (entry.aggregated && entry.uptimePct != null) {
            info = <span style={{ color: t.textFaint }}>{entry.uptimePct}% up</span>;
          } else if (entry.httpStatus != null) {
            info = (
              <span className={entry.httpStatus >= 400 ? 'text-red-400' : ''}
                style={entry.httpStatus < 400 ? { color: t.textFaint } : {}}>
                HTTP {entry.httpStatus}
              </span>
            );
          } else if (entry.error) {
            info = (
              <span className="text-red-400/80 truncate block max-w-[140px]" title={entry.error}>
                {entry.error}
              </span>
            );
          }

          return (
            <React.Fragment key={i}>
              <tr
                className="border-b cursor-pointer hover:opacity-80 transition-opacity"
                style={{ borderColor: t.metricGap }}
                onClick={() => setExpandedIdx(isExpanded ? null : i)}>
                <td className="py-2 pl-2 pr-4 border-l-2 transition-colors"
                  style={{
                    color:            t.textFaint,
                    borderLeftColor:  isExpanded ? '#60a5fa' : 'transparent',
                  }}>
                  {entry.timestamp ? formatTimestamp(entry.timestamp) : '—'}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={entry.status} />
                    <span style={{ color: statusColor }}>{entry.status}</span>
                    {entry.aggregated && (
                      <span className="opacity-50" style={{ color: t.textFaint }}>(avg)</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-right" style={{ color: t.textSecondary }}>
                  {entry.ping != null ? `${entry.ping}ms` : '—'}
                </td>
                <td className="px-4 py-2">{info ?? <span style={{ color: t.textFaint }}>—</span>}</td>
              </tr>

              {isExpanded && (
                <tr className="border-b" style={{ borderColor: t.metricGap }}>
                  <td colSpan={4} className="px-5 py-3 border-l-2"
                    style={{
                      borderLeftColor:  '#60a5fa',
                      backgroundColor:  isDark ? 'rgba(96,165,250,0.05)' : 'rgba(59,130,246,0.03)',
                      borderTopColor:   t.metricGap,
                    }}>
                    {hasDetail ? (
                      <div className="space-y-2">
                        {hasTimings && (
                          <div className="flex items-center gap-3 flex-wrap">
                            <TimingChip label="DNS"  value={entry.dnsMs}  color="#3b82f6" t={t} />
                            <TimingChip label="TCP"  value={entry.tcpMs}  color="#22c55e" t={t} />
                            {entry.tlsMs != null && (
                              <TimingChip label="TLS" value={entry.tlsMs} color="#f59e0b" t={t} />
                            )}
                            <TimingChip label="TTFB" value={entry.ttfbMs} color="#a78bfa" t={t} />
                            {entry.httpStatus != null && (
                              <span className="ml-2 text-xs font-mono"
                                style={{ color: entry.httpStatus >= 400 ? '#f87171' : t.textMuted }}>
                                HTTP {entry.httpStatus}
                              </span>
                            )}
                          </div>
                        )}
                        {!hasTimings && entry.httpStatus != null && (
                          <div className="text-xs font-mono"
                            style={{ color: entry.httpStatus >= 400 ? '#f87171' : t.textMuted }}>
                            HTTP {entry.httpStatus}
                          </div>
                        )}
                        {entry.error && (
                          <div className="text-xs font-mono leading-relaxed" style={{ color: '#f87171' }}>
                            {entry.error}
                          </div>
                        )}
                        {entry.aggregated && entry.uptimePct != null && (
                          <div className="text-xs font-mono" style={{ color: t.textSecondary }}>
                            Uptime:{' '}
                            <span style={{
                              color: entry.uptimePct >= 99 ? '#4ade80'
                                : entry.uptimePct >= 95 ? '#fbbf24' : '#f87171',
                            }}>
                              {entry.uptimePct}%
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs font-mono" style={{ color: t.textFaint }}>
                        No additional detail available
                      </span>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Incidents tab
// ---------------------------------------------------------------------------

function IncidentsTab({ history, t, isDark }) {
  const incidents = useMemo(() => computeIncidents(history), [history]);
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (history.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-xs font-mono"
        style={{ color: t.textFaint }}>
        No history yet — awaiting first check
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <span className="text-lg" style={{ color: '#4ade80' }}>✓</span>
        <span className="text-xs font-mono" style={{ color: '#4ade80' }}>
          All checks passed in this window
        </span>
      </div>
    );
  }

  return (
    <div className="divide-y" style={{ borderColor: t.metricGap }}>
      {incidents.map((inc, i) => {
        const isExpanded = expandedIdx === i;
        return (
          <div key={i}>
            {/* Collapsed row */}
            <div
              className="flex items-start gap-3 px-5 py-3.5 border-l-2 cursor-pointer hover:opacity-80 transition-opacity"
              style={{ borderLeftColor: isExpanded ? '#ef4444' : 'rgba(239,68,68,0.5)' }}
              onClick={() => setExpandedIdx(isExpanded ? null : i)}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono font-semibold" style={{ color: '#f87171' }}>
                    ↓ Down
                  </span>
                  {inc.ongoing && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                      ongoing
                    </span>
                  )}
                </div>
                <div className="text-xs font-mono" style={{ color: t.textSecondary }}>
                  {inc.start ? formatTimestamp(inc.start) : '—'}
                  {inc.end && (
                    <span style={{ color: t.textFaint }}>
                      {' — '}{formatTimestamp(inc.end)}
                    </span>
                  )}
                </div>
                {inc.error && !isExpanded && (
                  <div className="mt-1 text-[10px] font-mono truncate"
                    style={{ color: 'rgba(248,113,113,0.7)' }}
                    title={inc.error}>
                    {inc.error}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                {inc.durationMin != null ? (
                  <span className="text-xs font-mono" style={{ color: t.textMuted }}>
                    {inc.durationMin < 1 ? '< 1 min' : `${inc.durationMin} min`}
                  </span>
                ) : (
                  <span className="text-xs font-mono" style={{ color: t.textFaint }}>—</span>
                )}
              </div>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-5 py-3 border-l-2 border-t"
                style={{
                  borderLeftColor:   '#ef4444',
                  borderTopColor:    t.metricGap,
                  backgroundColor:   isDark ? 'rgba(239,68,68,0.06)' : 'rgba(239,68,68,0.03)',
                }}>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
                  <div>
                    <span style={{ color: t.textFaint }}>Started</span>
                    <div style={{ color: t.textSecondary }}>
                      {inc.start ? new Date(inc.start).toLocaleString() : '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: t.textFaint }}>Resolved</span>
                    <div style={{ color: t.textSecondary }}>
                      {inc.ongoing ? (
                        <span style={{ color: '#f87171' }}>Ongoing</span>
                      ) : inc.end ? (
                        new Date(inc.end).toLocaleString()
                      ) : '—'}
                    </div>
                  </div>
                  <div>
                    <span style={{ color: t.textFaint }}>Duration</span>
                    <div style={{ color: t.textSecondary }}>
                      {inc.ongoing
                        ? <span style={{ color: '#f87171' }}>Ongoing</span>
                        : inc.durationMin != null
                          ? `${inc.durationMin} minute${inc.durationMin !== 1 ? 's' : ''}`
                          : '—'}
                    </div>
                  </div>
                </div>
                {inc.error && (
                  <div className="mt-2.5 text-xs font-mono leading-relaxed"
                    style={{ color: '#f87171' }}>
                    {inc.error}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Embed tab (unchanged)
// ---------------------------------------------------------------------------

function EmbedTab({ monitor, t }) {
  const [embedType, setEmbedType] = useState('widget');
  const [copied,    setCopied]    = useState(false);

  const origin    = window.location.origin;
  const widgetSrc = `${origin}/embed/monitor/${monitor.id}`;
  const pageSrc   = `${origin}/embed`;

  const widgetCode = `<iframe\n  src="${widgetSrc}"\n  width="360"\n  height="230"\n  frameborder="0"\n  style="border-radius:8px;overflow:hidden"\n></iframe>`;
  const pageCode   = `<iframe\n  src="${pageSrc}"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border-radius:8px;overflow:hidden"\n></iframe>`;
  const activeCode = embedType === 'widget' ? widgetCode : pageCode;

  const copy = () => {
    navigator.clipboard.writeText(activeCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="px-6 py-5 space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setEmbedType('widget')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors"
          style={embedType === 'widget'
            ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', color: '#93c5fd' }
            : { backgroundColor: t.tagBg, borderColor: t.tagBorder, color: t.textMuted }}>
          <Monitor size={11} /> This Monitor
        </button>
        <button onClick={() => setEmbedType('page')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded border transition-colors"
          style={embedType === 'page'
            ? { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: 'rgba(59,130,246,0.5)', color: '#93c5fd' }
            : { backgroundColor: t.tagBg, borderColor: t.tagBorder, color: t.textMuted }}>
          <LayoutGrid size={11} /> Full Dashboard
        </button>
      </div>
      <p className="text-xs font-mono" style={{ color: t.textMuted }}>
        {embedType === 'widget'
          ? `Embeds just the ${monitor.label} card. No edit or delete controls.`
          : 'Embeds the full read-only dashboard. No edit, delete, or settings controls.'}
      </p>
      <div className="rounded border px-3 py-2 text-xs font-mono truncate"
        style={{ backgroundColor: t.inputBg, borderColor: t.cardBorder, color: t.textFaint }}>
        {embedType === 'widget' ? widgetSrc : pageSrc}
      </div>
      <div className="relative">
        <pre className="rounded border px-4 py-3 text-xs font-mono overflow-x-auto leading-relaxed"
          style={{ backgroundColor: t.inputBg, borderColor: t.cardBorder, color: t.textSecondary }}>
          {activeCode}
        </pre>
        <button onClick={copy}
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded text-xs font-mono border transition-colors"
          style={{ backgroundColor: t.tagBg, borderColor: t.tagBorder, color: copied ? '#4ade80' : t.textMuted }}>
          {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
        </button>
      </div>
      <p className="text-xs font-mono" style={{ color: t.textFaint }}>
        {embedType === 'widget'
          ? 'Recommended size: 360 x 230px. Adjust height if the monitor has many tags.'
          : 'Set height to match your content. Use 100% width for responsive layouts.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MonitorDetailModal
// ---------------------------------------------------------------------------

export function MonitorDetailModal({
  monitor,
  initialTab = 'history',
  onClose,
  onSave,
  onDelete,
  width,
  onSetWidth,
  allTags = [],
}) {
  const { t, isDark } = useTheme();
  const [activeTab,     setActiveTab]     = useState(initialTab);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [formError,     setFormError]     = useState('');
  const [deleteError,   setDeleteError]   = useState('');
  const [historyWindow, setHistoryWindow] = useState('1h');
  const [localHistory,  setLocalHistory]  = useState(null);
  const [windowLoading, setWindowLoading] = useState(false);
  const chartRef = useRef(null);

  // Active history — local fetch overrides prop when a window has been selected
  const history = localHistory ?? monitor.history ?? [];

  // Fetch history when window selector changes
  const changeWindow = async (w) => {
    if (w === historyWindow || windowLoading) return;
    setHistoryWindow(w);
    setWindowLoading(true);
    try {
      const res = await fetch(`/api/monitors/${monitor.id}?window=${w}`);
      if (res.ok) {
        const data = await res.json();
        setLocalHistory(data.history ?? []);
      }
    } catch { /* keep existing history on error */ }
    finally { setWindowLoading(false); }
  };

  const stats = useMemo(() => computeStats(history, historyWindow), [history, historyWindow]);
  const trend = useMemo(() => computeTrend(history), [history]);

  const chartData = history.map((h, i) => ({
    i,
    ping:      h.ping ?? 0,
    status:    h.status,
    timestamp: h.timestamp,
  }));

  const displayStatus = monitor.status === 'up' &&
    monitor.degradedThreshold != null &&
    monitor.currentPing != null &&
    monitor.currentPing > monitor.degradedThreshold
      ? 'degraded' : monitor.status;

  const lineColor  = displayStatus === 'down' ? '#ef4444' : displayStatus === 'degraded' ? '#f59e0b' : '#22c55e';
  const gradientId = `modal-${monitor.id}`;

  const isHttpLike = monitor.checkType === 'http' || monitor.checkType === 'api';
  const targetHref = monitor.target.startsWith('http') ? monitor.target : `https://${monitor.target}`;

  const tooltipContent = useMemo(
    () => (props) => <ModalTooltip {...props} t={t} />,
    [t]
  );

  const switchTab = (tab) => {
    setActiveTab(tab);
    setConfirmDelete(false);
    setDeleteError('');
  };

  const handleSave = async (data) => {
    setSubmitting(true);
    setFormError('');
    try {
      await onSave(monitor.id, data);
      onClose();
    } catch (err) {
      setFormError(`Failed to save: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await onDelete(monitor.id);
      onClose();
    } catch (err) {
      setDeleteError(`Delete failed: ${err.message}`);
      setConfirmDelete(false);
    }
  };

  const uptimeColor = stats.uptimePct == null ? t.textFaint
    : stats.uptimePct >= 99 ? '#4ade80'
    : stats.uptimePct >= 95 ? '#fbbf24'
    : '#f87171';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div
        className="w-full max-w-2xl rounded-lg border shadow-2xl flex flex-col"
        style={{
          backgroundColor: t.cardBg,
          borderColor:     t.cardBorder,
          height:          'min(680px, calc(100vh - 2rem))',
        }}>

        {/* ── 1. Header ── */}
        <div className="shrink-0 px-6 py-4 border-b" style={{ borderColor: t.metricGap }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot status={displayStatus} />
              <h2 className="text-sm font-mono font-bold truncate" style={{ color: t.textPrimary }}>
                {monitor.label}
              </h2>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded border shrink-0"
                style={{ color: t.textFaint, borderColor: t.cardBorder }}>
                {CHECK_TYPE_LABELS[monitor.checkType] ?? (monitor.checkType ?? 'HTTP').toUpperCase()}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Window selector */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg border"
                style={{ borderColor: t.cardBorder }}>
                {WINDOWS.map(w => (
                  <button key={w} onClick={() => changeWindow(w)}
                    className="px-2 py-0.5 text-xs font-mono rounded transition-colors"
                    style={historyWindow === w
                      ? { backgroundColor: 'rgba(96,165,250,0.15)', color: '#60a5fa' }
                      : { backgroundColor: 'transparent', color: t.textMuted }}>
                    {w}
                  </button>
                ))}
              </div>
              <button onClick={onClose}
                className="p-1.5 rounded opacity-50 hover:opacity-100 shrink-0 transition-opacity"
                style={{ color: t.textSecondary }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Target + last checked */}
          <div className="flex items-center justify-between mt-1.5 gap-3">
            {isHttpLike ? (
              <a href={targetHref} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-mono truncate hover:underline"
                style={{ color: t.textMuted }}
                onClick={e => e.stopPropagation()}>
                {monitor.target}
                <ExternalLink size={10} className="shrink-0 opacity-60" />
              </a>
            ) : (
              <span className="text-xs font-mono truncate" style={{ color: t.textMuted }}>
                {monitor.target}
              </span>
            )}
            <span className="text-[10px] font-mono shrink-0" style={{ color: t.textFaint }}>
              {monitor.lastChecked ? `checked ${formatTimestamp(monitor.lastChecked)}` : 'not yet checked'}
            </span>
          </div>
        </div>

        {/* ── 2. Stats row ── */}
        <div className="shrink-0 grid grid-cols-4 divide-x border-b"
          style={{ borderColor: t.metricGap, '--tw-divide-opacity': 1 }}>
          {/* Uptime */}
          <div className="px-5 py-3.5" style={{ borderColor: t.metricGap }}>
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: t.textFaint }}>
              Uptime
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-mono font-bold" style={{ color: uptimeColor }}>
                {stats.uptimePct != null ? `${stats.uptimePct}%` : '—'}
              </span>
              {trend.uptime && (
                <span className="text-[10px] font-mono opacity-75"
                  style={{ color: trend.uptime.direction === 'up' ? '#4ade80' : '#f87171' }}>
                  {trend.uptime.direction === 'up' ? '↑' : '↓'} {trend.uptime.delta}%
                </span>
              )}
            </div>
          </div>

          {/* Avg Response */}
          <div className="px-5 py-3.5" style={{ borderColor: t.metricGap }}>
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: t.textFaint }}>
              Avg
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-mono font-bold" style={{ color: t.textSecondary }}>
                {stats.avgPing != null ? `${stats.avgPing}ms` : '—'}
              </span>
              {trend.ping && (
                <span className="text-[10px] font-mono opacity-75"
                  style={{ color: trend.ping.direction === 'faster' ? '#4ade80' : '#f87171' }}>
                  {trend.ping.direction === 'faster' ? '↓' : '↑'} {trend.ping.delta}ms
                </span>
              )}
            </div>
          </div>

          {/* P95 or Best */}
          <div className="px-5 py-3.5" style={{ borderColor: t.metricGap }}>
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: t.textFaint }}>
              {historyWindow === '1h' ? 'P95' : 'Best'}
            </div>
            <span className="text-sm font-mono font-bold" style={{ color: t.textSecondary }}>
              {historyWindow === '1h'
                ? (stats.p95 != null ? `${stats.p95}ms` : '—')
                : (stats.bestPing != null ? `${stats.bestPing}ms` : '—')}
            </span>
          </div>

          {/* Incidents */}
          <div className="px-5 py-3.5" style={{ borderColor: t.metricGap }}>
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: t.textFaint }}>
              Incidents
            </div>
            <span className="text-sm font-mono font-bold"
              style={{ color: stats.incidents > 0 ? '#f87171' : t.textFaint }}>
              {stats.incidents}
            </span>
          </div>
        </div>

        {/* ── 3. Response time chart ── */}
        <div className="shrink-0 px-4 pt-3 pb-2 relative border-b" style={{ borderColor: t.metricGap }}>
          {/* Trend label */}
          {trend.ping && (
            <div className="absolute top-3 right-5 text-[10px] font-mono opacity-75 z-10"
              style={{ color: trend.ping.direction === 'faster' ? '#4ade80' : '#f87171' }}>
              {trend.ping.direction === 'faster' ? '↓' : '↑'} {trend.ping.delta}ms {trend.ping.direction}
            </div>
          )}
          {/* Loading overlay */}
          {windowLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10 rounded"
              style={{ backgroundColor: isDark ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.6)' }}>
              <span className="text-xs font-mono" style={{ color: t.textFaint }}>Loading…</span>
            </div>
          )}
          {chartData.length > 0 ? (
            <div ref={chartRef} style={{ width: '100%', height: 96 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 40, left: 0, bottom: 4 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid horizontal vertical={false}
                    stroke={t.metricGap} strokeOpacity={0.6} />
                  <YAxis
                    orientation="right"
                    width={36}
                    tickCount={3}
                    tickFormatter={v => `${v}ms`}
                    tick={{ fontSize: 9, fontFamily: 'monospace', fill: t.textFaint }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Area type="monotone" dataKey="ping"
                    stroke={lineColor} strokeWidth={1.5}
                    fill={`url(#${gradientId})`}
                    dot={(props) => {
                      const { cx, cy, payload } = props;
                      if (!cx || !cy || payload?.status !== 'down') return <circle r={0} key={props.index} />;
                      return <circle key={props.index} cx={cx} cy={cy} r={3} fill="#ef4444" style={{ pointerEvents: 'none' }} />;
                    }}
                    activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                  {monitor.degradedThreshold != null && isHttpLike && (
                    <ReferenceLine y={monitor.degradedThreshold} stroke="#f59e0b"
                      strokeDasharray="4 3" strokeWidth={1} />
                  )}
                  <Tooltip content={tooltipContent}
                    cursor={{ stroke: t.cardBorder, strokeWidth: 1 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-xs font-mono"
              style={{ color: t.textFaint }}>
              awaiting first check…
            </div>
          )}
        </div>

        {/* ── 4. Timing waterfall (HTTP / API only) ── */}
        {isHttpLike && monitor.latest?.dnsMs != null && (
          <div className="shrink-0 px-6 py-2.5 border-b flex items-center gap-3 flex-wrap"
            style={{ borderColor: t.metricGap }}>
            <span className="text-[10px] font-mono uppercase tracking-wider shrink-0 mr-1"
              style={{ color: t.textFaint }}>
              Latest
            </span>
            <TimingChip label="DNS"  value={monitor.latest.dnsMs}  color="#3b82f6" t={t} />
            <TimingChip label="TCP"  value={monitor.latest.tcpMs}  color="#22c55e" t={t} />
            {monitor.latest.tlsMs != null && (
              <TimingChip label="TLS" value={monitor.latest.tlsMs} color="#f59e0b" t={t} />
            )}
            <TimingChip label="TTFB" value={monitor.latest.ttfbMs} color="#a78bfa" t={t} />
            {monitor.latest.httpStatus != null && (
              <span className={`text-xs font-mono ml-auto ${monitor.latest.httpStatus < 400 ? '' : 'text-red-400'}`}
                style={monitor.latest.httpStatus < 400 ? { color: t.textFaint } : {}}>
                HTTP {monitor.latest.httpStatus}
              </span>
            )}
          </div>
        )}

        {/* ── 5. Tab bar ── */}
        <div className="flex border-b shrink-0" style={{ borderColor: t.metricGap }}>
          {[
            { id: 'history',   label: 'History'   },
            { id: 'incidents', label: 'Incidents'  },
            { id: 'configure', label: 'Configure'  },
            { id: 'embed',     label: 'Embed'      },
          ].map(tab => (
            <button key={tab.id} onClick={() => switchTab(tab.id)}
              className="px-5 py-2.5 text-xs font-mono font-semibold transition-colors border-b-2 -mb-px"
              style={{
                color:           activeTab === tab.id ? '#60a5fa' : t.textMuted,
                borderColor:     activeTab === tab.id ? '#60a5fa' : 'transparent',
                backgroundColor: 'transparent',
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── 6. Tab content — fixed height, each panel absolutely positioned ── */}
        <div className="flex-1 min-h-0 relative overflow-hidden">

          {/* History */}
          <div className={`absolute inset-0 overflow-y-auto ${activeTab === 'history' ? '' : 'hidden'}`}>
            <HistoryTab history={history} t={t} isDark={isDark} />
          </div>

          {/* Incidents */}
          <div className={`absolute inset-0 overflow-y-auto ${activeTab === 'incidents' ? '' : 'hidden'}`}>
            <IncidentsTab history={history} t={t} isDark={isDark} />
          </div>

          {/* Configure — flex column so footer stays pinned */}
          <div className={`absolute inset-0 flex flex-col ${activeTab === 'configure' ? '' : 'hidden'}`}>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <MonitorForm
                embedded
                editingMonitor={monitor}
                onSubmit={handleSave}
                onCancel={onClose}
                submitting={submitting}
                allTags={allTags}
                error={formError}
              />
            </div>
            {/* Width toggle + Delete — pinned footer */}
            <div className="shrink-0 border-t px-4 py-3 flex items-center justify-between gap-3"
              style={{ borderColor: t.metricGap }}>
              <div className="flex items-center gap-2">
                <ArrowLeftRight size={12} style={{ color: t.textFaint }} />
                <span className="text-xs font-mono" style={{ color: t.textFaint }}>Width</span>
                <div className="flex rounded border overflow-hidden" style={{ borderColor: t.cardBorder }}>
                  {[1, 2].map(w => (
                    <button key={w} type="button" onClick={() => onSetWidth?.(w)}
                      className="px-2.5 py-1 text-xs font-mono transition-colors"
                      style={width === w
                        ? { backgroundColor: 'rgba(59,130,246,0.2)', color: '#93c5fd' }
                        : { backgroundColor: t.inputBg, color: t.textMuted }}>
                      {w === 1 ? 'Narrow' : 'Wide'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                {deleteError && (
                  <span className="text-xs font-mono text-red-400">{deleteError}</span>
                )}
                {confirmDelete ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono" style={{ color: '#f87171' }}>Sure?</span>
                    <button type="button" onClick={handleDelete}
                      className="px-2.5 py-1 text-xs font-mono rounded border transition-colors"
                      style={{ backgroundColor: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}>
                      Delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}
                      className="px-2.5 py-1 text-xs font-mono rounded border transition-colors"
                      style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: t.inputBg }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border transition-colors"
                    style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: t.inputBg }}>
                    <Trash2 size={11} /> Delete
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Embed */}
          <div className={`absolute inset-0 overflow-y-auto ${activeTab === 'embed' ? '' : 'hidden'}`}>
            <EmbedTab monitor={monitor} t={t} />
          </div>

        </div>
      </div>
    </div>
  );
}
