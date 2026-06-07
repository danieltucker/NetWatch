import React from 'react';
import { Server, ArrowUp, ArrowDown, Gauge } from 'lucide-react';

export function SummaryBar({ monitors }) {
  const total   = monitors.length;
  const up      = monitors.filter(m => m.status === 'up').length;
  const down    = monitors.filter(m => m.status === 'down').length;
  const pending = monitors.filter(m => m.status === 'pending').length;

  const pinging = monitors.filter(m => m.currentPing !== null);
  const avgPing = pinging.length
    ? Math.round(pinging.reduce((s, m) => s + m.currentPing, 0) / pinging.length)
    : null;

  const tiles = [
    { icon: <Server size={15} />,    label: 'Monitors', value: String(total),   tone: '',        valueCls: '' },
    { icon: <ArrowUp size={15} />,   label: 'Online',   value: String(up),      tone: 'wt-tile--up',   valueCls: 'wt-tile__value--up',
      sub: pending > 0 ? `${pending} pending` : null },
    { icon: <ArrowDown size={15} />, label: 'Offline',  value: String(down),    tone: 'wt-tile--down', valueCls: down > 0 ? 'wt-tile__value--down' : '' },
    { icon: <Gauge size={15} />,     label: 'Avg Ping', value: avgPing !== null ? avgPing : '—', unit: avgPing !== null ? 'ms' : '', tone: 'wt-tile--teal', valueCls: '' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 mb-5">
      {tiles.map(tt => (
        <div key={tt.label} className={`wt-tile ${tt.tone}`}>
          <div className="wt-tile__head">
            <span className="wt-tile__icon">{tt.icon}</span>
            <span className="wt-eyebrow">{tt.label}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`wt-tile__value ${tt.valueCls}`}>
              {tt.value}{tt.unit && <span className="wt-tile__unit">{tt.unit}</span>}
            </span>
            {tt.sub && <span className="wt-trend" style={{ color: 'var(--wt-warn-600)' }}>{tt.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
