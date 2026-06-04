import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../hooks/useTheme';

// ---------------------------------------------------------------------------
// Color maps
// ---------------------------------------------------------------------------

const COLORS_DARK = {
  up:       'rgba(34,197,94,0.8)',
  down:     '#ef4444',
  degraded: '#f59e0b',
  empty:    'rgba(255,255,255,0.06)',
};

const COLORS_LIGHT = {
  up:       'rgba(22,163,74,0.7)',
  down:     '#dc2626',
  degraded: '#d97706',
  empty:    'rgba(0,0,0,0.06)',
};

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

function bucketHistory(history, count) {
  const total = history?.length ?? 0;
  return Array.from({ length: count }, (_, i) => {
    if (total === 0) return { status: 'empty', start: null, end: null, avgPing: null };

    const startIdx = Math.floor((i / count) * total);
    const endIdx   = Math.max(startIdx + 1, Math.floor(((i + 1) / count) * total));
    const slice    = history.slice(startIdx, endIdx);

    if (slice.length === 0) return { status: 'empty', start: null, end: null, avgPing: null };

    let status = 'empty';
    if      (slice.some(h => h.status === 'down'))     status = 'down';
    else if (slice.some(h => h.status === 'degraded')) status = 'degraded';
    else if (slice.some(h => h.status === 'up'))       status = 'up';

    const pings   = slice.map(h => h.ping).filter(p => p != null);
    const avgPing = pings.length
      ? Math.round(pings.reduce((s, v) => s + v, 0) / pings.length)
      : null;

    return { status, start: slice[0]?.timestamp ?? null, end: slice[slice.length - 1]?.timestamp ?? null, avgPing };
  });
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

function BlockTooltip({ bucket, x, y, t }) {
  if (!bucket || bucket.status === 'empty') return null;

  const fmt = ts => ts
    ? new Date(ts).toLocaleString('en-US', {
        hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : null;

  const fmtTime = ts => ts
    ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : null;

  const statusColor = bucket.status === 'down' ? '#f87171'
    : bucket.status === 'degraded'             ? '#fbbf24'
    : '#4ade80';

  return createPortal(
    <div style={{
      position: 'fixed', left: x, top: y,
      transform: 'translate(-50%, calc(-100% - 8px))',
      zIndex: 9999, pointerEvents: 'none',
    }}>
      <div className="rounded-lg text-xs font-mono shadow-xl border px-3 py-2"
        style={{ backgroundColor: t.tooltipBg, borderColor: t.tooltipBorder, minWidth: 130 }}>
        <div className="font-bold mb-1" style={{ color: statusColor }}>
          {bucket.status.toUpperCase()}
        </div>
        {bucket.avgPing != null && (
          <div style={{ color: t.textSecondary }}>avg {bucket.avgPing}ms</div>
        )}
        {bucket.start && (
          <div className="mt-1" style={{ color: t.textFaint }}>
            {fmt(bucket.start)}
            {bucket.end && bucket.end !== bucket.start && <> – {fmtTime(bucket.end)}</>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// UptimeBlocks
// ---------------------------------------------------------------------------

export function UptimeBlocks({ history, count = 40, blockHeight = 8 }) {
  const { t, isDark } = useTheme();
  const [tooltip, setTooltip] = useState(null);
  const colors  = isDark ? COLORS_DARK : COLORS_LIGHT;
  const buckets = bucketHistory(history, count);

  const onEnter = useCallback((e, bucket) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ bucket, x: r.left + r.width / 2, y: r.top });
  }, []);

  const onLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="flex gap-[1px] w-full" style={{ height: blockHeight }}>
      {buckets.map((bucket, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            backgroundColor: colors[bucket.status] ?? colors.empty,
            height:          blockHeight,
            opacity:         tooltip && tooltip.bucket !== bucket ? 0.65 : 1,
            transition:      'opacity 80ms ease',
          }}
          onMouseEnter={e => onEnter(e, bucket)}
          onMouseLeave={onLeave}
        />
      ))}
      {tooltip && <BlockTooltip bucket={tooltip.bucket} x={tooltip.x} y={tooltip.y} t={t} />}
    </div>
  );
}
