import React from 'react';
import { useTheme } from '../hooks/useTheme';

export function TimingChip({ label, value, color, t }) {
  if (value == null) return null;
  return (
    <span className="text-xs font-mono flex items-center gap-0.5">
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
      <TimingChip label="DNS"  value={latest.dnsMs}  color="#3b82f6" t={t} />
      <TimingChip label="TCP"  value={latest.tcpMs}  color="#22c55e" t={t} />
      {latest.tlsMs  != null && <TimingChip label="TLS"  value={latest.tlsMs}  color="#f59e0b" t={t} />}
      <TimingChip label="TTFB" value={latest.ttfbMs} color="#a78bfa" t={t} />
      {latest.httpStatus != null && (
        <span className={`text-xs font-mono ml-auto ${latest.httpStatus < 400 ? 'text-green-400/70' : 'text-red-400'}`}>
          HTTP {latest.httpStatus}
        </span>
      )}
    </div>
  );
}
