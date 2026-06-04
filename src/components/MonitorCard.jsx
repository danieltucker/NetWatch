import React, { useRef, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { Edit2, Tag, ShieldCheck, ShieldAlert } from 'lucide-react';
import { formatInterval, formatTimestamp, certDaysColor } from '../types/monitor';
import { useTheme } from '../hooks/useTheme';
import { TimingRow } from './TimingRow';

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS = {
  up:       '#4ade80',
  degraded: '#fbbf24',
  down:     '#ef4444',
  pending:  '#6b7280',
};

function StatusDot({ status }) {
  const color = STATUS_DOT_COLORS[status] ?? STATUS_DOT_COLORS.pending;
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0${status === 'down' ? ' animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  );
}

// ---------------------------------------------------------------------------
// Graphical HTTP timing tooltip
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
      style={{
        backgroundColor: t.tooltipBg,
        borderColor:     t.tooltipBorder,
        minWidth:        172,
        padding:         '10px 12px',
      }}>
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
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden"
                      style={{ backgroundColor: t.metricGap }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <span style={{ color, width: 42, textAlign: 'right', flexShrink: 0 }}>
                      {value}ms
                    </span>
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
        </>
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
      position:      'fixed',
      left:           pageX,
      top:            pageY,
      transform:      above ? 'translate(-50%, calc(-100% - 10px))' : 'translate(-50%, 10px)',
      zIndex:         9999,
      pointerEvents:  'none',
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
          <circle
            cx={cx} cy={cy} r={10}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            title="Zoom to this incident"
            onClick={e => { e.stopPropagation(); onZoom(payload.timestamp); }}
          />
        )}
        <circle cx={cx} cy={cy} r={3} fill="#ef4444" style={{ pointerEvents: 'none' }} />
      </g>
    );
  }
  return <circle key={`u-${index}`} cx={cx} cy={cy} r={0} fill="none" />;
};

// ---------------------------------------------------------------------------
// SSL cert badge
// ---------------------------------------------------------------------------

function CertBadge({ certDays }) {
  if (certDays == null) return null;
  const colorCls = certDaysColor(certDays);
  const Icon = certDays > 7 ? ShieldCheck : ShieldAlert;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-mono ${colorCls}`}
      title={`SSL cert expires in ${certDays} days`}>
      <Icon size={11} />
      {certDays}d
    </span>
  );
}

// ---------------------------------------------------------------------------
// Check-type badge
// ---------------------------------------------------------------------------

const CHECK_TYPE_LABELS = { http: 'HTTP', api: 'API', tcp: 'TCP', icmp: 'ICMP' };

function CheckTypeBadge({ checkType }) {
  const { t } = useTheme();
  return (
    <span className="text-xs font-mono px-1.5 py-0.5 rounded border"
      style={{ color: t.textFaint, borderColor: t.cardBorder }}>
      {CHECK_TYPE_LABELS[checkType] ?? checkType}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Trend computation — split history into two halves, compare averages
// ---------------------------------------------------------------------------

function computeTrend(history) {
  if (!history || history.length < 6) return { ping: null, uptime: null };
  const mid    = Math.floor(history.length / 2);
  const first  = history.slice(0, mid);
  const second = history.slice(mid);

  // Ping trend
  const fp = first.map(h => h.ping).filter(p => p != null);
  const sp = second.map(h => h.ping).filter(p => p != null);
  let ping = null;
  if (fp.length >= 3 && sp.length >= 3) {
    const fa = fp.reduce((s, v) => s + v, 0) / fp.length;
    const sa = sp.reduce((s, v) => s + v, 0) / sp.length;
    const d  = Math.round(sa - fa);
    if (Math.abs(d) >= 2) ping = { delta: Math.abs(d), direction: d < 0 ? 'faster' : 'slower' };
  }

  // Uptime trend
  const toU = h => h.uptimePct ?? (h.status === 'up' ? 100 : h.status === 'down' ? 0 : null);
  const fu  = first.map(toU).filter(v => v != null);
  const su  = second.map(toU).filter(v => v != null);
  let uptime = null;
  if (fu.length >= 3 && su.length >= 3) {
    const fa = fu.reduce((s, v) => s + v, 0) / fu.length;
    const sa = su.reduce((s, v) => s + v, 0) / su.length;
    const d  = Math.round((sa - fa) * 10) / 10;
    if (Math.abs(d) >= 0.1) uptime = { delta: Math.abs(d), direction: d > 0 ? 'up' : 'down' };
  }

  return { ping, uptime };
}

// ---------------------------------------------------------------------------
// Ping metric cell — inverted bar (full = fast, empty = slow)
// ---------------------------------------------------------------------------

function PingMetric({ ping, trend, hovered, isDark, t }) {
  const hasValue = ping != null;
  const color = !hasValue ? t.textFaint
    : ping < 100  ? '#4ade80'
    : ping < 300  ? '#fbbf24'
    :               '#f87171';
  const barPct = hasValue ? Math.max(3, 100 - Math.min(100, (ping / 1000) * 100)) : 0;
  const tileBg = isDark
    ? (hovered ? 'rgba(255,255,255,0.025)' : t.cardBg)
    : (hovered ? 'rgba(0,0,0,0.015)'       : t.cardBg);
  const trendColor = trend?.direction === 'faster' ? '#4ade80' : '#f87171';

  return (
    <div className="px-3 py-3" style={{ backgroundColor: tileBg, transition: 'background-color 150ms ease' }}>
      <div className="text-xs font-mono uppercase tracking-wider mb-1.5" style={{ color: t.textFaint }}>
        Ping
      </div>
      <div className="text-lg font-mono font-bold leading-none mb-1"
        style={{ color: hasValue ? color : t.textFaint }}>
        {hasValue ? `${ping}ms` : '—'}
      </div>
      {/* Fixed-height trend slot keeps tile height consistent whether or not trend data is present */}
      <div className="h-[14px] text-[10px] font-mono opacity-75 mb-1.5" style={{ color: trendColor }}>
        {trend ? `${trend.direction === 'faster' ? '↓' : '↑'} ${trend.delta}ms` : ''}
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: t.metricGap }}>
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${barPct}%`, backgroundColor: hasValue ? color : 'transparent' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uptime metric cell — bar fills with uptime %
// ---------------------------------------------------------------------------

function UptimeMetric({ uptimePercent, hasHistory, trend, hovered, isDark, t }) {
  const color = !hasHistory ? t.textFaint
    : uptimePercent >= 99 ? '#4ade80'
    : uptimePercent >= 95 ? '#fbbf24'
    :                       '#f87171';
  const barPct = hasHistory ? uptimePercent : 0;
  const tileBg = isDark
    ? (hovered ? 'rgba(255,255,255,0.025)' : t.cardBg)
    : (hovered ? 'rgba(0,0,0,0.015)'       : t.cardBg);
  const trendColor = trend?.direction === 'up' ? '#4ade80' : '#f87171';

  return (
    <div className="px-3 py-3" style={{ backgroundColor: tileBg, transition: 'background-color 150ms ease' }}>
      <div className="text-xs font-mono uppercase tracking-wider mb-1.5" style={{ color: t.textFaint }}>
        Uptime
      </div>
      <div className="text-lg font-mono font-bold leading-none mb-1"
        style={{ color: hasHistory ? color : t.textFaint }}>
        {hasHistory ? `${uptimePercent}%` : '—'}
      </div>
      {/* Fixed-height trend slot */}
      <div className="h-[14px] text-[10px] font-mono opacity-75 mb-1.5" style={{ color: trendColor }}>
        {trend ? `${trend.direction === 'up' ? '↑' : '↓'} ${trend.delta}%` : ''}
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: t.metricGap }}>
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
  chartYMax = 'auto',
  onZoomToPoint,
}) {
  const { t, isDark } = useTheme();
  const chartRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  const tooltipContent = useMemo(
    () => (props) => <SparkTooltip {...props} containerRef={chartRef} />,
    []
  );

  const dotRenderer = useMemo(
    () => (props) => <SparkDot {...props} onZoom={onZoomToPoint} />,
    [onZoomToPoint]
  );

  const trend = useMemo(() => computeTrend(monitor.history), [monitor.history]);

  const chartData = monitor.history.map((h, i) => ({
    i,
    ping:      h.ping ?? 0,
    status:    h.status,
    timestamp: h.timestamp,
    dnsMs:     h.dnsMs,
    tcpMs:     h.tcpMs,
    tlsMs:     h.tlsMs,
    ttfbMs:    h.ttfbMs,
  }));

  const displayStatus =
    monitor.status === 'up' &&
    monitor.degradedThreshold != null &&
    monitor.currentPing != null &&
    monitor.currentPing > monitor.degradedThreshold
      ? 'degraded'
      : monitor.status;

  const lineColor  = displayStatus === 'down' ? '#ef4444' : displayStatus === 'degraded' ? '#f59e0b' : '#22c55e';
  const gradientId = `spark-${monitor.id}`;

  const alertBadges = monitor.alertTypes?.filter(a => a !== 'None') ?? [];

  const cardShadow = isDark
    ? '0 2px 8px rgba(0,0,0,0.3)'
    : '0 1px 4px rgba(0,0,0,0.07)';

  const yMax    = chartYMax === 'auto' ? 'auto' : Number(chartYMax);
  const yDomain = [0, yMax];

  const showThresholdLine =
    monitor.degradedThreshold != null &&
    (monitor.checkType === 'http' || monitor.checkType === 'api');

  // ── Compact layout (reference monitors) ───────────────────────────────────
  if (compact) {
    return (
      <div className="flex flex-col rounded-lg border"
        style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder, boxShadow: cardShadow }}>

        <div className="flex items-center justify-between px-3 pt-3 pb-1.5 gap-1.5">
          <StatusDot status={displayStatus} />
          <span className="text-xs font-mono truncate font-semibold flex-1 ml-1"
            style={{ color: t.textSecondary }}>
            {monitor.label}
          </span>
          {monitor.currentPing != null && (
            <span className="text-xs font-mono shrink-0" style={{ color: t.textMuted }}>
              {monitor.currentPing}ms
            </span>
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
                  <Area type="monotone" dataKey="ping"
                    stroke={lineColor} strokeWidth={1.5}
                    fill={`url(#${gradientId})`}
                    dot={dotRenderer}
                    activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                  <Tooltip content={tooltipContent}
                    cursor={{ stroke: t.cardBorder, strokeWidth: 1 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-9 text-xs font-mono"
              style={{ color: t.textFaint }}>
              pending…
            </div>
          )}
        </div>

        <div className="px-3 pb-2">
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>
            {monitor.target}
          </span>
        </div>
      </div>
    );
  }

  const hoverBg          = isDark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.015)';
  const hoverBorderColor = isDark ? 'rgba(255,255,255,0.15)'  : 'rgba(0,0,0,0.15)';

  // ── Full layout ───────────────────────────────────────────────────────────
  return (
    <div
      className="flex flex-col rounded-lg border transition-colors cursor-pointer"
      style={{
        backgroundColor: hovered ? hoverBg : t.cardBg,
        borderColor:     isDragging ? hoverBorderColor : hovered ? hoverBorderColor : t.cardBorder,
        opacity:         isDragging ? 0.85 : 1,
        boxShadow:       cardShadow,
      }}
      onClick={() => onCardClick?.(monitor)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>

      {/* ── Header — drag handle ── */}
      <div
        className="px-4 pt-4 pb-2 rounded-t-lg"
        style={{ cursor: dragHandleProps ? 'grab' : 'default' }}
        {...(dragHandleProps || {})}>

        <div className="flex items-center gap-2">
          <StatusDot status={displayStatus} />
          <span className="text-sm font-semibold leading-snug flex-1 truncate min-w-0"
            title={monitor.label}
            style={{ color: t.textPrimary }}>
            {monitor.label}
          </span>
          <CheckTypeBadge checkType={monitor.checkType} />
          {onEdit && (
            <button
              onClick={e => { e.stopPropagation(); onEdit(monitor); }}
              onPointerDown={e => e.stopPropagation()}
              title="Edit"
              className="p-1.5 rounded transition-opacity opacity-40 hover:opacity-100 shrink-0"
              style={{ color: t.textSecondary }}>
              <Edit2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Target row ── */}
      <div className="px-4 pb-3">
        {(monitor.checkType === 'http' || monitor.checkType === 'api') ? (
          <a
            href={monitor.target.startsWith('http') ? monitor.target : `https://${monitor.target}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-xs font-mono truncate block hover:underline"
            style={{ color: t.textMuted }}>
            {monitor.target}
            {monitor.port && <span style={{ color: t.textFaint }}>:{monitor.port}</span>}
          </a>
        ) : (
          <span className="text-xs font-mono truncate block" style={{ color: t.textMuted }}>
            {monitor.target}
            {monitor.port && <span style={{ color: t.textFaint }}>:{monitor.port}</span>}
          </span>
        )}
        {monitor.description && (
          <span className="text-xs font-mono truncate block mt-0.5" style={{ color: t.textFaint }}>
            {monitor.description}
          </span>
        )}
      </div>

      {/* ── Metrics row: ping + uptime ── */}
      <div className="grid grid-cols-2 gap-px border-t border-b"
        style={{ backgroundColor: t.metricGap, borderColor: t.metricGap }}>
        <PingMetric
          ping={monitor.currentPing}
          trend={trend.ping}
          hovered={hovered}
          isDark={isDark}
          t={t} />
        <UptimeMetric
          uptimePercent={monitor.uptimePercent}
          hasHistory={monitor.history.length > 0}
          trend={trend.uptime}
          hovered={hovered}
          isDark={isDark}
          t={t} />
      </div>

      {/* ── Timing breakdown (HTTP / API) ── */}
      <TimingRow latest={monitor.latest} />

      {/* ── Assertion error hint (API checks) ── */}
      {monitor.status === 'down' && monitor.latest?.error && (
        <div className="px-3 pb-2">
          <span className="text-xs font-mono leading-relaxed line-clamp-2" style={{ color: '#f87171' }}
            title={monitor.latest.error}>
            {monitor.latest.error}
          </span>
        </div>
      )}

      {/* ── Sparkline ── */}
      <div className="px-2 py-2">
        {chartData.length > 0 ? (
          <div ref={chartRef} style={{ width: '100%', height: 68 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 2, left: 2, bottom: 4 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={lineColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis domain={yDomain} hide />
                <Area type="monotone" dataKey="ping"
                  stroke={lineColor} strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  dot={<SparkDot />}
                  activeDot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
                {showThresholdLine && (
                  <ReferenceLine
                    y={monitor.degradedThreshold}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1}
                  />
                )}
                <Tooltip content={tooltipContent}
                  cursor={{ stroke: t.cardBorder, strokeWidth: 1 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[68px] text-xs font-mono"
            style={{ color: t.textFaint }}>
            awaiting first check…
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-auto">
        <div className="flex items-center gap-2 mr-auto">
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>
            {monitor.lastChecked ? (
              <>
                <span style={{ color: t.textMuted }}>checked</span>{' '}
                {formatTimestamp(monitor.lastChecked)}
              </>
            ) : 'not yet checked'}
          </span>
          <span className="text-xs font-mono" style={{ color: t.textFaint }}>
            · {formatInterval(monitor.interval)}
          </span>
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
            <span key={tag}
              className="flex items-center gap-0.5 text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)' }}>
              <Tag size={9} />
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export const MonitorCard = React.memo(MonitorCardInner, (prev, next) =>
  prev.monitor       === next.monitor       &&
  prev.chartYMax     === next.chartYMax     &&
  prev.isDragging    === next.isDragging    &&
  prev.compact       === next.compact       &&
  prev.onZoomToPoint === next.onZoomToPoint
);
