import React from 'react';
import { useTheme } from '../hooks/useTheme';

// Timing segments use --wt-viz-* (categorical ramp), NOT status colors.
const VIZ = {
  dns:  'var(--wt-viz-1)',
  tcp:  'var(--wt-viz-2)',
  tls:  'var(--wt-viz-4)',
  ttfb: 'var(--wt-viz-6)',
};

export function TimingChip({ label, value, color, t }) {
  if (value == null) return null;
  return (
    <span className="wt-mono text-xs flex items-center gap-0.5">
      <span style={{ color: t.textFaint }}>{label} </span>
      <span style={{ color }}>{value}</span>
      <span style={{ color: t.textFaint }}>ms</span>
    </span>
  );
}

export function TimingRow({ latest }) {
  const { t } = useTheme();
  if (!latest || latest.dnsMs == null) return null;
  return (
    <div className="px-3 pb-2 flex items-center gap-3 flex-wrap">
      <TimingChip label="DNS"  value={latest.dnsMs}  color={VIZ.dns}  t={t} />
      <TimingChip label="TCP"  value={latest.tcpMs}  color={VIZ.tcp}  t={t} />
      {latest.tlsMs != null && <TimingChip label="TLS" value={latest.tlsMs} color={VIZ.tls} t={t} />}
      <TimingChip label="TTFB" value={latest.ttfbMs} color={VIZ.ttfb} t={t} />
      {latest.httpStatus != null && (
        <span className="wt-mono text-xs ml-auto"
          style={{ color: latest.httpStatus < 400 ? 'var(--wt-up-600)' : 'var(--wt-down-600)' }}>
          HTTP {latest.httpStatus}
        </span>
      )}
    </div>
  );
}
