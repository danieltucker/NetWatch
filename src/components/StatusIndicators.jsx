import React from 'react';

// ---------------------------------------------------------------------------
// Shared status components — Watchtower wt-pill, kept on the same exported API
// so every caller (cards, modal, tables) works unchanged.
//
// NetWatch status vocabulary → the four shared design-language states:
//   up → up · degraded → warn · down → down · pending → muted
// ---------------------------------------------------------------------------

const STATUS_MAP = {
  up:       { cls: 'wt-pill--up',    text: 'UP',       dot: 'var(--wt-up-500)' },
  degraded: { cls: 'wt-pill--warn',  text: 'DEGRADED', dot: 'var(--wt-warn-500)' },
  down:     { cls: 'wt-pill--down',  text: 'DOWN',     dot: 'var(--wt-down-500)' },
  pending:  { cls: 'wt-pill--muted', text: 'PENDING',  dot: 'var(--wt-n-400)' },
};

export function StatusPill({ status, size = 'sm' }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const lg = size === 'lg';
  return (
    <span
      className={`wt-pill ${s.cls}`}
      style={lg ? { fontSize: 12, padding: '4px 12px 4px 10px' } : undefined}>
      <span className="wt-pill__dot" />
      {s.text}
    </span>
  );
}

export function StatusDot({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.pending;
  return (
    <span
      className="wt-pill__dot"
      style={{
        backgroundColor: s.dot,
        ...(status === 'down' ? { boxShadow: '0 0 0 3px color-mix(in oklch, var(--wt-down-500) 18%, transparent)' } : {}),
      }}
    />
  );
}
