import React, { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../hooks/useTheme';

// ---------------------------------------------------------------------------
// Bucketing (unchanged from original)
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
    const avgPing = pings.length ? Math.round(pings.reduce((s, v) => s + v, 0) / pings.length) : null;
    return { status, start: slice[0]?.timestamp ?? null, end: slice[slice.length - 1]?.timestamp ?? null, avgPing };
  });
}

// ---------------------------------------------------------------------------
// Tooltip — uses wt-card token style (always light-readable, matches theme)
// ---------------------------------------------------------------------------

function BlockTooltip({ bucket, x, y, t }) {
  if (!bucket || bucket.status === 'empty') return null;
  const fmt = ts => ts
    ? new Date(ts).toLocaleString('en-US', { hour12: false, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const fmtTime = ts => ts
    ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    : null;
  const statusColor = bucket.status === 'down' ? 'var(--wt-down-600)' : bucket.status === 'degraded' ? 'var(--wt-warn-600)' : 'var(--wt-up-600)';
  return createPortal(
    <div style={{ position: 'fixed', left: x, top: y, transform: 'translate(-50%, calc(-100% - 8px))', zIndex: 9999, pointerEvents: 'none' }}>
      <div className="wt-card rounded-lg text-xs wt-mono shadow-xl px-3 py-2" style={{ minWidth: 130 }}>
        <div className="font-bold mb-1" style={{ color: statusColor }}>{bucket.status.toUpperCase()}</div>
        {bucket.avgPing != null && <div style={{ color: t.textSecondary }}>avg {bucket.avgPing}ms</div>}
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
// UptimeBlocks — renders as wt-history strip
// Status mapping: up → (no class), down → is-down, degraded → is-warn, empty → is-none
// ---------------------------------------------------------------------------

export function UptimeBlocks({ history, count = 40, blockHeight = 8 }) {
  const { t } = useTheme();
  const [tooltip, setTooltip] = useState(null);
  const buckets = bucketHistory(history, count);

  const onEnter = useCallback((e, bucket) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTooltip({ bucket, x: r.left + r.width / 2, y: r.top });
  }, []);
  const onLeave = useCallback(() => setTooltip(null), []);

  return (
    <div className="wt-history" style={{ height: blockHeight, gap: 1 }}>
      {buckets.map((bucket, i) => {
        const cls = bucket.status === 'down' ? 'is-down'
          : bucket.status === 'degraded' ? 'is-warn'
          : bucket.status === 'empty'    ? 'is-none'
          : '';
        return (
          <span
            key={i}
            className={cls}
            style={{
              height: blockHeight,
              opacity: tooltip && tooltip.bucket !== bucket ? 0.65 : 1,
              transition: 'opacity 80ms ease',
              borderRadius: 2,
            }}
            onMouseEnter={e => onEnter(e, bucket)}
            onMouseLeave={onLeave}
          />
        );
      })}
      {tooltip && <BlockTooltip bucket={tooltip.bucket} x={tooltip.x} y={tooltip.y} t={t} />}
    </div>
  );
}
