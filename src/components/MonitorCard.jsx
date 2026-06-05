import React, { useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { Edit2, Tag, ShieldCheck, ShieldAlert, ExternalLink } from 'lucide-react';
import { formatInterval, formatTimestamp, certDaysColor } from '../types/monitor';
import { useTheme } from '../hooks/useTheme';

// ---------------------------------------------------------------------------
// Status pill — replaces the 8px dot on full cards
// ---------------------------------------------------------------------------

const STATUS_PILL_STYLES = {
  up:       { bg: 'rgba(34,197,94,0.12)',  color: '#4ade80', border: 'rgba(34,197,94,0.3)',  text: 'UP',       glow: false },
  degraded: { bg: 'rgba(245,158,11,0.12)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)', text: 'DEGRADED', glow: false },
  down:     { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', border: 'rgba(239,68,68,0.4)',  text: 'DOWN',     glow: true  },
  pending:  { bg: 'rgba(107,114,128,0.1)', color: '#9ca3af', border: 'rgba(107,114,128,0.2)',text: 'PENDING',  glow: false },
};

export function StatusPill({ status, size = 'sm' }) {
  const s = STATUS_PILL_STYLES[status] ?? STATUS_PILL_STYLES.pending;
  return (
    <span
      className={`shrink-0 font-mono font-bold tracking-widest uppercase rounded-full ${s.glow ? 'animate-pulse' : ''}`}
      style={{
        fontSize:        size === 'lg' ? 11 : 10,
        padding:         size === 'lg' ? '3px 10px' : '2px 8px',
        backgroundColor: s.bg,
        color:           s.color,
        border:          `1px solid ${s.border}`,
        boxShadow:       s.glow ? '0 0 0 1px rgba(239,68,68,0.3), 0 0 10px rgba(239,68,68,0.2)' : 'none',
      }}>
      {s.text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Small status dot — used in compact card and history tables
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS = {
  up: '#4ade80', degraded: '#fbbf24', down: '#ef4444', pending: '#6b7280',
};

export function StatusDot({ status }) {
  const color = STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.pending;
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0${status === 'down' ? ' animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  );
}

// ---------------------------------------------------------------------------
// Sparkline tooltip
// ---------------------------------------------------------------------------

const TIMING_SEGMENTS = [
  { key: 'dnsMs',  label: 'DNS',  color: '#3b82f6' },
  { key: 'tcpMs',  label: 'TCP',  color: '#22c55e' },
  { key: 'tlsMs',  label: 'TLS',  color: '#f59e0b' },
  { key: 'ttfbMs', label: 'TTFB', color: '#a78bfa' },
];

function SparkTooltipContent({ d, t }) {
  const isDown       = d.status === 'down';
  const total        = d.ping ?? 0;
  const isAggregated = d.aggregated === true;
  const hasBreakdown = !isDown && !isAggregated && d.dnsMs != null;
  const segments     = hasBreakdown ? TIMING_SEGMENTS.filter(s => d[s.key] != null) : [];

  const timeLabel = d.timestamp
    ? new Date(d.timestamp).toLocaleString('en-US', {
        hour12: false, month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <div className="rounded-lg text-xs font-mono shadow-xl border"
      style={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, minWidth: 172, padding: '10px 12px' }}>
      {isDown ? (
        <div className="text-red-400 font-bold tracking-widest mb-1.5">DOWN</div>
      ) : (
        <>
          <div className="font-bold mb-2.5" style={{ color: t.textPrimary }}>
            {isAggregated ? `avg ${total}ms` : `${total}ms total`}
          </div>
          {segments.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {segments.map(({ key, label, color }) => {
                const value = d[key];
                const pct   = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 4;
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span style={{ color: t.textMuted, width: 28, flexShrink: 0 }}>{label}</span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: t.metricGap }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <span style={{ color, width: 42, textAlign: 'right', flexShrink: 0 }}>{value}ms</span>
                  </div>
                );
              })}
            </div>
          )}
          {isAggregated && d.uptimePct != null && (
            <div className="mb-1.5 flex items-center gap-2">
              <span style={{ color: t.textMuted }}>Uptime</span>
              <span style={{ color: d.uptimePct === 100 ? '#4ade80' : d.uptimePct >= 95 ? '#fbbf24' : '#f87171' }}>
                {d.uptimePct}%
              </span>
            </div>
          )}
          {/* Explain absence of timing detail so users know why it's missing */}
          {!hasBreakdown && !isAggregated && total > 0 && (
            <div className="mb-1.5 text-[10px]" style={{ color: t.textFaint }}>
              timing breakdown unavailable for this check type
            </div>
          )}
          {!hasBreakdown && isAggregated && (
            <div className="mb-1.5 text-[10px]" style={{ color: t.textFaint }}>
              switch to 1h or 6h for per-request timing
            </div>
          )}
        </>
      )}
      {/* HTTP status shown for both up and down states — failed status codes are useful when down */}
      {d.httpStatus != null && (
        <div className="mb-1.5 flex items-center gap-2">
          <span style={{ color: t.textMuted }}>HTTP</span>
          <span style={{ color: d.httpStatus < 400 ? 'rgba(74,222,128,0.7)' : '#f87171' }}>
            {d.httpStatus}
          </span>
        </div>
      )}
      <div className="pt-1.5 border-t" style={{ borderColor: t.tooltipBorder, color: t.textFaint }}>
        {timeLabel}
      </div>
    </div>
  );
}

function SparkTooltip({ active, payload, coordinate, containerRef }) {
  const { t } = useTheme();
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d || !coordinate) return null;
  const rect  = containerRef?.current?.getBoundingClientRect();
  const pageX = rect ? rect.left + coordinate.x : coordinate.x;
  const pageY = rect ? rect.top  + coordinate.y : coordinate.y;
  const above = pageY > 160;
  return createPortal(
    <div style={{
      position: 'fixed', left: pageX, top: pageY,
      transform: above ? 'translate(-50%, calc(-100% - 10px))' : 'translate(-50%, 10px)',
      zIndex: 9999, pointerEvents: 'none',
    }}>
      <SparkTooltipContent d={d} t={t} />
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Down-event dot on sparkline
// ---------------------------------------------------------------------------

const SparkDot = ({ cx, cy, payload, index, onZoom }) => {
  if (!cx || !cy) return null;
  if (payload?.status === 'down') {
    return (
      <g key={`d-${index}`}>
        {onZoom && (
          <circle cx={cx} cy={cy} r={10} fill="transparent" style={{ cursor: 'pointer' }}
            title="View incident"
            onClick={e => { e.stopPropagation(); onZoom(payload.timestamp); }} />
        )}
        <circle cx={cx} cy={cy} r={3} fill="#ef4444" style={{ pointerEvents: 'none' }} />
      </g>
    );
  }
  return <circle key={`u-${index}`} cx={cx} cy={cy} r={0} fill="none" />;
};

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function CertBadge({ certDays }) {
  if (certDays == null) return null;
  const colorCls = certDaysColor(certDays);
  const Icon = certDays > 7 ? ShieldCheck : ShieldAlert;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-mono ${colorCls}`}
      title={`SSL cert expires in ${certDays} days`}>
      <Icon size={11} />{certDays}d
    </span>
  );
}

const CHECK_TYPE_LABELS = { http: 'HTTP', api: 'API', tcp: 'TCP', icmp: 'ICMP' };

function CheckTypeBadge({ checkType }) {
  const { t } = useTheme();
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
      style={{ color: t.textFaint, borderColor: t.cardBorder }}>
      {CHECK_TYPE_LABELS[checkType] ?? checkType}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

function computeTrend(history) {
  if (!history || history.length < 6) return { ping: null, uptime: null };
  const mid = Math.floor(history.length / 2);
  const [first, second] = [history.slice(0, mid), history.slice(mid)];

  const fp = first.map(h => h.ping).filter(p => p != null);
  const sp = second.map(h => h.ping).filter(p => p != null);
  let ping = null;
  if (fp.length >= 3 && sp.length >= 3) {
    const d = Math.round(sp.reduce((s, v) => s + v, 0) / sp.length - fp.reduce((s, v) => s + v, 0) / fp.length);
    if (Math.abs(d) >= 2) ping = { delta: Math.abs(d), direction: d < 0 ? 'faster' : 'slower' };
  }

  const toU = h => h.uptimePct ?? (h.status === 'up' ? 100 : h.status === 'down' ? 0 : null);
  const fu = first.map(toU).filter(v => v != null);
  const su = second.map(toU).filter(v => v != null);
  let uptime = null;
  if (fu.length >= 3 && su.length >= 3) {
    const d = Math.round((su.reduce((s, v) => s + v, 0) / su.length - fu.reduce((s, v) => s + v, 0) / fu.length) * 10) / 10;
    if (Math.abs(d) >= 0.1) uptime = { delta: Math.abs(d), direction: d > 0 ? 'up' : 'down' };
  }
  return { ping, uptime };
}

// ---------------------------------------------------------------------------
// Ping metric cell
// ---------------------------------------------------------------------------

function PingMetric({ ping, trend, hovered, isDark, t, degradedThreshold }) {
  const hasValue = ping != null;
  const color = !hasValue ? t.textFaint
    : degradedThreshold != null
      ? (ping < degradedThreshold ? '#4ade80' : '#fbbf24')
      : (ping < 200 ? '#4ade80' : ping < 500 ? '#fbbf24' : '#f87171');
  const barPct = hasValue ? Math.max(3, 100 - Math.min(100, (ping / 1000) * 100)) : 0;
  const tileBg = isDark ? (hovered ? 'rgba(255,255,255,0.025)' : t.cardBg)
                        : (hovered ? 'rgba(0,0,0,0.015)'       : t.cardBg);
  const trendColor = trend?.direction === 'faster' ? '#4ade80' : '#f87171';

  return (
    <div style={{ backgroundColor: tileBg, transition: 'background-color 150ms ease', padding: '12px 14px 10px' }}>
      <div className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: t.textFaint }}>Ping</div>
      <div className="text-xl font-mono font-bold leading-none mb-1" style={{ color: hasValue ? color : t.textFaint }}>
        {hasValue ? `${ping}ms` : '—'}
      </div>
      <div className="h-[14px] text-[10px] font-mono opacity-75 mb-1.5" style={{ color: trendColor }}>
        {trend ? `${trend.direction === 'faster' ? '↓' : '↑'} ${trend.delta}ms` : ''}
      </div>
      <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: t.metricGap }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barPct}%`, backgroundColor: hasValue ? color : 'transparent' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uptime metric cell
// ---------------------------------------------------------------------------

function UptimeMetric({ uptimePercent, hasHistory, trend, hovered, isDark, t }) {
  const color = !hasHistory ? t.textFaint : uptimePercent >= 99 ? '#4ade80' : uptimePercent >= 95 ? '#fbbf24' : '#f87171';
  const barPct = hasHistory ? uptimePercent : 0;
  const tileBg = isDark ? (hovered ? 'rgba(255,255,255,0.025)' : t.cardBg)
                        : (hovered ? 'rgba(0,0,0,0.015)'       : t.cardBg);
  const trendColor = trend?.direction === 'up' ? '#4ade80' : '#f87171';

  return (
    <div style={{ backgroundColor: tileBg, transition: 'background-color 150ms ease', padding: '12px 14px 10px' }}>
      <div className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: t.textFaint }}>Uptime</div>
      <div className="text-xl font-mono font-bold leading-none mb-1" style={{ color: hasHistory ? color : t.textFaint }}>
        {hasHistory ? `${uptimePercent}%` : '—'}
      </div>
      <div className="h-[14px] text-[10px] font-mono opacity-75 mb-1.5" style={{ color: trendColor }}>
        {trend ? `${trend.direction === 'up' ? '↑' : '↓'} ${trend.delta}%` : ''}
      </div>
      <div className="h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: t.metricGap }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barPct}%`, backgroundColor: hasHistory ? color : 'transparent' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MonitorCard
// ---------------------------------------------------------------------------

function MonitorCardInner({
  monitor, onEdit, onCardClick, compact = false,
  dragHandleProps, isDragging = false,
  chartYMax = 'auto', onIncidentClick,
}) {
  const { t, isDark } = useTheme();
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  const tooltipContent = useMemo(() => (props) => <SparkTooltip {...props} containerRef={chartRef} />, []);
  // Wrap the incident click to include the monitor so App.jsx can open the right modal
  const handleDotClick = useCallback((timestamp) => {
    onIncidentClick?.(monitor, timestamp);
  }, [onIncidentClick, monitor]);
  const dotRenderer = useMemo(() => (props) => <SparkDot {...props} onZoom={handleDotClick} />, [handleDotClick]);
  const trend = useMemo(() => computeTrend(monitor.history), [monitor.history]);

  const chartData = monitor.history.map((h, i) => ({
    i, ping: h.ping ?? 0, status: h.status, timestamp: h.timestamp,
    dnsMs: h.dnsMs, tcpMs: h.tcpMs, tlsMs: h.tlsMs, ttfbMs: h.ttfbMs,
    httpStatus: h.httpStatus,
  }));

  const displayStatus =
    monitor.status === 'up' && monitor.degradedThreshold != null && monitor.currentPing != null &&
    monitor.currentPing > monitor.degradedThreshold ? 'degraded' : monitor.status;

  const lineColor  = displayStatus === 'down' ? '#ef4444' : displayStatus === 'degraded' ? '#f59e0b' : '#22c55e';
  const gradientId = `spark-${monitor.id}`;
  const alertBadges = monitor.alertTypes?.filter(a => a !== 'None') ?? [];
  const yDomain = [0, chartYMax === 'auto' ? 'auto' : Number(chartYMax)];

  const showThresholdLine = monitor.degradedThreshold != null &&
    (monitor.checkType === 'http' || monitor.checkType === 'api');

  // ── Status-derived styles ────────────────────────────────────────────────
  const statusTopBorder = displayStatus === 'down'     ? '#ef4444'
    : displayStatus === 'degraded'                     ? '#f59e0b'
    : displayStatus === 'up'                           ? 'rgba(34,197,94,0.4)'
    : 'transparent';

  const cardBg = hovered
    ? (isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)')
    : displayStatus === 'down'
      ? (isDark ? 'rgba(239,68,68,0.04)' : 'rgba(239,68,68,0.03)')
      : t.cardBg;

  const cardBorder = isDragging
    ? (isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)')
    : hovered
      ? (displayStatus === 'down'     ? 'rgba(239,68,68,0.5)'
        : displayStatus === 'degraded' ? 'rgba(245,158,11,0.4)'
        : isDark                       ? 'rgba(255,255,255,0.15)'
        :                                'rgba(0,0,0,0.15)')
      : t.cardBorder;

  const cardShadow = hovered
    ? (isDark ? '0 2px 6px rgba(0,0,0,0.5), 0 8px 24px rgba(0,0,0,0.25)'
              : '0 2px 4px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.09)')
    : (isDark ? '0 1px 3px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.2)'
              : '0 1px 2px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06)');

  // ── Compact layout (reference monitors) ─────────────────────────────────
  if (compact) {
    return (
      <div className="flex flex-col rounded-lg border"
        style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder, boxShadow: cardShadow }}>
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5 gap-1.5">
          <StatusDot status={displayStatus} />
          <span className="text-xs font-mono truncate font-semibold flex-1 ml-1" style={{ color: t.textSecondary }}>
            {monitor.label}
          </span>
          {monitor.currentPing != null && (
            <span className="text-xs font-mono shrink-0" style={{ color: t.textMuted }}>{monitor.currentPing}ms</span>
          )}
        </div>
        <div className="px-2 py-1.5">
          {chartData.length > 0 ? (
            <div ref={chartRef} style={{ width: '100%', height: 36 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={lineColor} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="ping" stroke={lineColor} strokeWidth={1.5}
                    fill={`url(#${gradientId})`} dot={dotRenderer}
                    activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }} isAnimationActive={false} />
                  <Tooltip content={tooltipContent} cursor={{ stroke: t.cardBorder, strokeWidth: 1 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-9 text-xs font-mono" style={{ color: t.textFaint }}>
              pending…
            </div>
          )}
        </div>
        <div className="px-3 pb-2">
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>{monitor.target}</span>
        </div>
      </div>
    );
  }

  // ── Full layout ──────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col rounded-lg border cursor-pointer"
      style={{
        backgroundColor: cardBg,
        borderColor:     cardBorder,
        borderTop:       `3px solid ${statusTopBorder}`,
        opacity:         isDragging ? 0.85 : 1,
        boxShadow:       cardShadow,
        transition:      'background-color 150ms ease, border-color 150ms ease, box-shadow 200ms ease',
      }}
      onClick={() => onCardClick?.(monitor)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-2 rounded-t-lg"
        style={{ cursor: dragHandleProps ? 'grab' : 'default' }}
        {...(dragHandleProps || {})}>
        <div className="flex items-center gap-2">
          <StatusPill status={displayStatus} />
          <span className="text-[15px] font-semibold leading-snug flex-1 truncate min-w-0"
            title={monitor.label} style={{ color: t.textPrimary }}>
            {monitor.label}
          </span>
          {(monitor.checkType === 'http' || monitor.checkType === 'api') && (() => {
            const href = monitor.target.startsWith('http') ? monitor.target : `https://${monitor.target}`;
            return (
              <button
                className="shrink-0 p-1 rounded transition-opacity opacity-30 hover:opacity-80"
                title={monitor.target}
                onClick={e => { e.stopPropagation(); window.open(href, '_blank', 'noopener,noreferrer'); }}
                onPointerDown={e => e.stopPropagation()}>
                <ExternalLink size={11} style={{ color: t.textSecondary }} />
              </button>
            );
          })()}
          <CheckTypeBadge checkType={monitor.checkType} />
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(monitor); }}
              onPointerDown={e => e.stopPropagation()} title="Edit"
              className="p-1.5 rounded transition-opacity opacity-40 hover:opacity-100 shrink-0"
              style={{ color: t.textSecondary }}>
              <Edit2 size={13} />
            </button>
          )}
        </div>
        {monitor.description && (
          <div className="mt-1 text-xs font-mono truncate" style={{ color: t.textFaint }}>
            {monitor.description}
          </div>
        )}
      </div>

      {/* ── Metrics row ── */}
      <div className="grid grid-cols-2">
        <PingMetric   ping={monitor.currentPing} trend={trend.ping}
          hovered={hovered} isDark={isDark} t={t}
          degradedThreshold={monitor.degradedThreshold} />
        <UptimeMetric uptimePercent={monitor.uptimePercent} hasHistory={monitor.history.length > 0}
          trend={trend.uptime} hovered={hovered} isDark={isDark} t={t} />
      </div>

      {/* ── Assertion error hint ── */}
      {monitor.status === 'down' && monitor.latest?.error && (
        <div className="px-3 pb-2">
          <span className="text-xs font-mono leading-relaxed line-clamp-2" style={{ color: '#f87171' }}
            title={monitor.latest.error}>
            {monitor.latest.error}
          </span>
        </div>
      )}

      {/* ── Sparkline ── */}
      <div className="px-2 pb-2">
        {chartData.length > 0 ? (
          <div ref={chartRef} style={{ width: '100%', height: 64 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={yDomain} hide />
                <Area type="monotone" dataKey="ping" stroke={lineColor} strokeWidth={1.5}
                  fill={`url(#${gradientId})`} dot={<SparkDot />}
                  activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }} isAnimationActive={false} />
                {showThresholdLine && (
                  <ReferenceLine y={monitor.degradedThreshold} stroke="#f59e0b"
                    strokeDasharray="4 3" strokeWidth={1} />
                )}
                <Tooltip content={tooltipContent} cursor={{ stroke: t.cardBorder, strokeWidth: 1 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-16 text-xs font-mono" style={{ color: t.textFaint }}>
            awaiting first check…
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-auto opacity-60">
        <div className="flex items-center gap-2 mr-auto">
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>
            {monitor.lastChecked ? (
              <><span style={{ color: t.textMuted }}>checked</span>{' '}{formatTimestamp(monitor.lastChecked)}</>
            ) : 'not yet checked'}
          </span>
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>· {formatInterval(monitor.interval)}</span>
          <CertBadge certDays={monitor.latest?.certDays} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {alertBadges.map(a => (
            <span key={a} className="text-xs font-mono px-1.5 py-0.5 rounded border"
              style={{ color: t.textSecondary, backgroundColor: t.tagBg, borderColor: t.tagBorder }}>
              {a}
            </span>
          ))}
          {monitor.tags?.filter(tag => tag !== '_ref').map(tag => (
            <span key={tag} className="flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)' }}>
              <Tag size={9} />{tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const MonitorCard = React.memo(MonitorCardInner, (prev, next) =>
  prev.monitor        === next.monitor        &&
  prev.chartYMax      === next.chartYMax      &&
  prev.isDragging     === next.isDragging     &&
  prev.compact        === next.compact        &&
  prev.onIncidentClick === next.onIncidentClick
);
