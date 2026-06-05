import React from 'react';

// ---------------------------------------------------------------------------
// Shared status components — extracted here to avoid module initialization
// order issues when both MonitorCard and MonitorDetailModal need them.
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
