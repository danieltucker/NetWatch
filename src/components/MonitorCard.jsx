import React, { useRef, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { Edit2, Tag, ShieldCheck, ShieldAlert, ExternalLink, Wrench } from 'lucide-react';
import { formatInterval, formatTimestamp, certDaysColor } from '../types/monitor';
import { useTheme } from '../hooks/useTheme';
import { StatusPill, StatusDot } from './StatusIndicators';
import { resolveChartColors } from './chartColors';

// ---------------------------------------------------------------------------
// Sparkline tooltip
// ---------------------------------------------------------------------------
// Timing segments are categorical data → the viz ramp (NOT status colors).
const TIMING_SEGMENTS = [
  { key: 'dnsMs',  label: 'DNS',  viz: 0 },
  { key: 'tcpMs',  label: 'TCP',  viz: 1 },
  { key: 'tlsMs',  label: 'TLS',  viz: 3 },
  { key: 'ttfbMs', label: 'TTFB', viz: 5 },
];

function SparkTooltipContent({ d, t, chart }) {
  const isDown       = d.status === 'down';
  const total        = d.ping ?? 0;
  const isAggregated = d.aggregated === true;
  const hasBreakdown = !isDown && !isAggregated && d.dnsMs != null;
  const segments     = hasBreakdown ? TIMING_SEGMENTS.filter(s => d[s.key] != null) : [];

  const timeLabel = d.timestamp
    ? new Date(d.timestamp).toLocaleString('en-US', {
        hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <div className="wt-mono rounded-lg text-xs shadow-xl border"
      style={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, minWidth: 172, padding: '10px 12px' }}>
      {isDown ? (
        <div className="font-bold tracking-widest mb-1.5" style={{ color: 'var(--wt-down-600)' }}>DOWN</div>
      ) : (
        <>
          <div className="font-bold mb-2.5" style={{ color: t.textPrimary }}>
            {isAggregated ? `avg ${total}ms` : `${total}ms total`}
          </div>
          {segments.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              {segments.map(({ key, label, viz }) => {
                const value = d[key];
                const pct   = total > 0 ? Math.max(4, Math.round((value / total) * 100)) : 4;
                const color = chart.viz[viz];
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
              <span style={{ color: d.uptimePct === 100 ? 'var(--wt-up-600)' : d.uptimePct >= 95 ? 'var(--wt-warn-600)' : 'var(--wt-down-600)' }}>
                {d.uptimePct}%
              </span>
            </div>
          )}
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
      {d.httpStatus != null && (
        <div className="mb-1.5 flex items-center gap-2">
          <span style={{ color: t.textMuted }}>HTTP</span>
          <span style={{ color: d.httpStatus < 400 ? 'var(--wt-up-600)' : 'var(--wt-down-600)' }}>
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

function SparkTooltip({ active, payload, coordinate, containerRef, chart }) {
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
      <SparkTooltipContent d={d} t={t} chart={chart} />
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Down-event dot on sparkline
// ---------------------------------------------------------------------------

// Maintenance purple — matches wt-viz-5 categorical ramp
const MAINT_COLOR = 'var(--wt-viz-5)';

const SparkDot = ({ cx, cy, payload, index, onZoom, downColor }) => {
  if (!cx || !cy) return null;
  if (payload?.maintenanceEventId) {
    return <circle key={`m-${index}`} cx={cx} cy={cy} r={2.5} fill={MAINT_COLOR} style={{ pointerEvents: 'none' }} />;
  }
  if (payload?.status === 'down') {
    return (
      <g key={`d-${index}`}>
        {onZoom && (
          <circle cx={cx} cy={cy} r={10} fill="transparent" style={{ cursor: 'pointer' }}
            title="View incident"
            onClick={e => { e.stopPropagation(); onZoom(payload.timestamp); }} />
        )}
        <circle cx={cx} cy={cy} r={3} fill={downColor} style={{ pointerEvents: 'none' }} />
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
    <span className={`wt-mono flex items-center gap-0.5 text-xs ${colorCls}`}
      title={`SSL cert expires in ${certDays} days`}>
      <Icon size={11} />{certDays}d
    </span>
  );
}

const CHECK_TYPE_LABELS = { http: 'HTTP', api: 'API', tcp: 'TCP', icmp: 'ICMP' };

function CheckTypeBadge({ checkType }) {
  return (
    <span className="wt-chip wt-chip--plain shrink-0">
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
// Metric cell (ping / uptime) — eyebrow label + mono value + meter
// Principle 5: color encodes good/bad. Faster ping is GOOD → green (wt-trend--up),
// even though the number went down.
// ---------------------------------------------------------------------------

function MetricCell({ label, value, unit, valueColor, barPct, barColor, trendText, trendGood, t }) {
  return (
    <div style={{ padding: '12px 14px 10px' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="wt-eyebrow">{label}</span>
        <span className={`wt-trend ${trendGood ? 'wt-trend--up' : 'wt-trend--down'}`}
          style={{ visibility: trendText ? 'visible' : 'hidden' }}>
          {trendText ?? ' '}
        </span>
      </div>
      <div className="wt-mono font-semibold leading-none mb-2" style={{ fontSize: 22, letterSpacing: '-0.02em', color: valueColor }}>
        {value}{unit && <span style={{ fontSize: '0.55em', color: t.textMuted, marginLeft: 1 }}>{unit}</span>}
      </div>
      <div className="wt-meter">
        <div className="wt-meter__fill" style={{ width: `${barPct}%`, background: barColor }} />
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
  chartYMax = 'auto', onIncidentClick, inMaintenance = false,
}) {
  const { t, isDark } = useTheme();
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  const chart = useMemo(() => resolveChartColors(), [isDark]);
  const tooltipContent = useMemo(() => (props) => <SparkTooltip {...props} containerRef={chartRef} chart={chart} />, [chart]);
  const handleDotClick = useCallback((timestamp) => { onIncidentClick?.(monitor, timestamp); }, [onIncidentClick, monitor]);
  const dotRenderer = useMemo(() => (props) => <SparkDot {...props} onZoom={handleDotClick} downColor={chart.down} />, [handleDotClick, chart]);
  const trend = useMemo(() => computeTrend(monitor.history), [monitor.history]);

  const chartData = monitor.history.map((h, i) => ({
    i, ping: h.ping ?? 0, status: h.status, timestamp: h.timestamp,
    dnsMs: h.dnsMs, tcpMs: h.tcpMs, tlsMs: h.tlsMs, ttfbMs: h.ttfbMs, httpStatus: h.httpStatus,
  }));

  const displayStatus =
    monitor.status === 'up' && monitor.degradedThreshold != null && monitor.currentPing != null &&
    monitor.currentPing > monitor.degradedThreshold ? 'degraded' : monitor.status;

  const lineColor  = displayStatus === 'down' ? chart.down : displayStatus === 'degraded' ? chart.warn : chart.up;
  const gradientId = `spark-${monitor.id}`;
  const alertBadges = monitor.alertTypes?.filter(a => a !== 'None') ?? [];
  const yDomain = [0, chartYMax === 'auto' ? 'auto' : Number(chartYMax)];
  const showThresholdLine = monitor.degradedThreshold != null &&
    (monitor.checkType === 'http' || monitor.checkType === 'api');
  const isDown = displayStatus === 'down';

  // ── Compact layout (reference monitors) ─────────────────────────────────
  if (compact) {
    return (
      <div className="wt-card flex flex-col">
        <div className="flex items-center justify-between px-3 pt-3 pb-1.5 gap-1.5">
          <StatusDot status={displayStatus} />
          <span className="truncate font-semibold flex-1 ml-1 text-sm" style={{ color: t.textSecondary }}>
            {monitor.label}
          </span>
          {monitor.currentPing != null && (
            <span className="wt-mono text-xs shrink-0" style={{ color: t.textMuted }}>{monitor.currentPing}ms</span>
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
                  <Tooltip content={tooltipContent} cursor={{ stroke: chart.border, strokeWidth: 1 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-9 text-xs" style={{ color: t.textFaint }}>pending…</div>
          )}
        </div>
        <div className="px-3 pb-2">
          <span className="wt-mono text-xs" style={{ color: t.textFaint }}>{monitor.target}</span>
        </div>
      </div>
    );
  }

  // ── Metric values/colors ──────────────────────────────────────────────────
  const ping = monitor.currentPing;
  const pingHas = ping != null;
  const pingColor = !pingHas ? t.textFaint
    : monitor.degradedThreshold != null
      ? (ping < monitor.degradedThreshold ? 'var(--wt-up-600)' : 'var(--wt-warn-600)')
      : (ping < 200 ? 'var(--wt-up-600)' : ping < 500 ? 'var(--wt-warn-600)' : 'var(--wt-down-600)');
  const pingBarPct = pingHas ? Math.max(3, 100 - Math.min(100, (ping / 1000) * 100)) : 0;

  const up = monitor.uptimePercent;
  const upHas = monitor.history.length > 0;
  const upColor = !upHas ? t.textFaint : up >= 99 ? 'var(--wt-up-600)' : up >= 95 ? 'var(--wt-warn-600)' : 'var(--wt-down-600)';

  // ── Full layout ──────────────────────────────────────────────────────────
  return (
    <div
      className="wt-card flex flex-col cursor-pointer"
      style={{
        ...(isDown ? { background: 'var(--wt-down-50)', borderColor: 'color-mix(in oklch, var(--wt-down-500) 35%, transparent)' } : {}),
        boxShadow: hovered ? 'var(--wt-shadow-md)' : 'var(--wt-shadow-sm)',
        opacity: isDragging ? 0.85 : 1,
        transition: 'box-shadow var(--wt-dur) var(--wt-ease)',
      }}
      onClick={() => onCardClick?.(monitor)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-2" style={{ cursor: dragHandleProps ? 'grab' : 'default' }} {...(dragHandleProps || {})}>
        <div className="flex items-center gap-2">
          <StatusPill status={displayStatus} />
          <span className="text-[15px] font-semibold leading-snug flex-1 truncate min-w-0"
            title={monitor.label} style={{ color: t.textPrimary }}>
            {monitor.label}
          </span>
          {(monitor.checkType === 'http' || monitor.checkType === 'api') && (() => {
            const href = monitor.target.startsWith('http') ? monitor.target : `https://${monitor.target}`;
            return (
              <button className="shrink-0 p-1 rounded transition-opacity opacity-40 hover:opacity-90"
                title={monitor.target}
                onClick={e => { e.stopPropagation(); window.open(href, '_blank', 'noopener,noreferrer'); }}
                onPointerDown={e => e.stopPropagation()}>
                <ExternalLink size={12} style={{ color: t.textMuted }} />
              </button>
            );
          })()}
          <CheckTypeBadge checkType={monitor.checkType} />
          {inMaintenance && (
            <span className="wt-mono text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
              style={{ color: MAINT_COLOR, backgroundColor: `color-mix(in oklch, ${MAINT_COLOR} 12%, transparent)` }}
              title="Active maintenance window">
              <Wrench size={9} /> Maint.
            </span>
          )}
          {onEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit(monitor); }}
              onPointerDown={e => e.stopPropagation()} title="Edit"
              className="p-1.5 rounded transition-opacity opacity-50 hover:opacity-100 shrink-0"
              style={{ color: t.textMuted }}>
              <Edit2 size={13} />
            </button>
          )}
        </div>
        {monitor.description && (
          <div className="mt-1 text-xs truncate" style={{ color: t.textMuted }}>{monitor.description}</div>
        )}
      </div>

      {/* ── Metrics row ── */}
      <div className="grid grid-cols-2 pt-1">
        <div>
          <MetricCell label="Ping"
            value={pingHas ? ping : '—'} unit={pingHas ? 'ms' : ''} valueColor={pingColor}
            barPct={pingBarPct} barColor={pingColor}
            trendText={trend.ping ? `${trend.ping.direction === 'faster' ? '↓' : '↑'} ${trend.ping.delta}ms` : null}
            trendGood={trend.ping?.direction === 'faster'} t={t} />
        </div>
        <MetricCell label="Uptime"
          value={upHas ? up : '—'} unit={upHas ? '%' : ''} valueColor={upColor}
          barPct={upHas ? up : 0} barColor={upColor}
          trendText={trend.uptime ? `${trend.uptime.direction === 'up' ? '↑' : '↓'} ${trend.uptime.delta}%` : null}
          trendGood={trend.uptime?.direction === 'up'} t={t} />
      </div>

      {/* ── Assertion error hint ── */}
      {monitor.status === 'down' && monitor.latest?.error && (
        <div className="px-3 pb-2">
          <span className="wt-mono text-xs leading-relaxed line-clamp-2" style={{ color: 'var(--wt-down-600)' }}
            title={monitor.latest.error}>
            {monitor.latest.error}
          </span>
        </div>
      )}

      {/* ── Sparkline ── */}
      <div className="px-2 pb-2 pt-1">
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
                  fill={`url(#${gradientId})`} dot={dotRenderer}
                  activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }} isAnimationActive={false} />
                {showThresholdLine && (
                  <ReferenceLine y={monitor.degradedThreshold} stroke={chart.warn} strokeDasharray="4 3" strokeWidth={1} />
                )}
                <Tooltip content={tooltipContent} cursor={{ stroke: chart.border, strokeWidth: 1 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-16 text-xs" style={{ color: t.textFaint }}>
            {monitor.lastChecked ? 'no data in this window' : 'awaiting first check…'}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-auto">
        <div className="flex items-center gap-2 mr-auto wt-mono text-xs" style={{ color: t.textFaint }}>
          <span>
            {monitor.lastChecked ? (
              <><span style={{ color: t.textMuted }}>checked</span>{' '}{formatTimestamp(monitor.lastChecked)}</>
            ) : 'not yet checked'}
          </span>
          <span>· {formatInterval(monitor.interval)}</span>
          <CertBadge certDays={monitor.latest?.certDays} />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {alertBadges.map(a => (
            <span key={a} className="wt-chip wt-chip--plain">{a}</span>
          ))}
          {monitor.tags?.filter(tag => tag !== '_ref').map(tag => (
            <span key={tag} className="wt-chip"><Tag size={9} />{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const MonitorCard = React.memo(MonitorCardInner, (prev, next) =>
  prev.monitor        === next.monitor        &&
  prev.chartYMax      === next.chartYMax       &&
  prev.isDragging     === next.isDragging      &&
  prev.compact        === next.compact         &&
  prev.onIncidentClick === next.onIncidentClick &&
  prev.inMaintenance   === next.inMaintenance
);
