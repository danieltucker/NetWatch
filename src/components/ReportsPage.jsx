import React, { useState, useEffect } from 'react';
import { Download, FileText, Loader, BarChart2, AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

const RANGES = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  if (mins < 1)   return '< 1m';
  if (mins < 60)  return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatDateLocal(iso) {
  try { return new Date(iso).toLocaleString(); }
  catch { return iso; }
}

function formatDateShort(iso) {
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

function uptimePill(pct) {
  if (pct === null) return <span className="wt-mono text-xs" style={{ color: 'var(--wt-text-faint)' }}>—</span>;
  const color = pct >= 99 ? 'var(--wt-up-600)' : pct >= 95 ? 'var(--wt-warn-600)' : 'var(--wt-down-600)';
  return <span className="wt-mono text-sm font-bold" style={{ color }}>{pct.toFixed(2)}%</span>;
}

function exportCsv(report) {
  const header = ['Monitor', 'Target', 'Type', 'Uptime %', 'Total Checks', 'Up', 'Degraded', 'Down', 'Avg Ping (ms)', 'Outages', 'Degraded Events', 'Total Downtime'];
  const rows = report.monitors.map(m => [
    m.label, m.target, m.checkType,
    m.uptimePct ?? '', m.totalChecks, m.upChecks, m.degradedChecks, m.downChecks,
    m.avgPingMs ?? '', m.outageCount, m.degradedCount,
    m.totalDowntimeMs ? Math.round(m.totalDowntimeMs / 60000) + 'm' : '0m',
  ]);
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `netwatch-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `netwatch-report-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
}

export function ReportsPage() {
  const { t } = useTheme();
  const [rangeIdx,    setRangeIdx]    = useState(1);
  const [customFrom,  setCustomFrom]  = useState('');
  const [customTo,    setCustomTo]    = useState('');
  const [useCustom,   setUseCustom]   = useState(false);
  const [report,      setReport]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [history,     setHistory]     = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const res  = await fetch('/api/reports/history');
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {
      setHistory([]);
    } finally {
      setHistLoading(false);
    }
  };

  useEffect(() => { loadHistory(); }, []);

  const generate = async () => {
    setLoading(true); setError(''); setReport(null);
    try {
      let from, to;
      if (useCustom) {
        if (!customFrom || !customTo) throw new Error('Enter both a start and end date');
        from = new Date(customFrom).toISOString();
        to   = new Date(customTo + 'T23:59:59').toISOString();
      } else {
        to   = new Date().toISOString();
        from = new Date(Date.now() - RANGES[rangeIdx].days * 86400000).toISOString();
      }
      const res  = await fetch(`/api/reports/generate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate report');
      setReport(data);
      loadHistory();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistoryItem = async (id) => {
    setLoading(true); setError(''); setReport(null);
    try {
      const res  = await fetch(`/api/reports/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load report');
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const summary = report ? (() => {
    const mons  = report.monitors.filter(m => m.totalChecks > 0);
    const avgUp = mons.length
      ? Math.round(mons.reduce((s, m) => s + (m.uptimePct ?? 0), 0) / mons.length * 100) / 100
      : null;
    const totalOutages  = report.monitors.reduce((s, m) => s + m.outageCount, 0);
    const affected      = report.monitors.filter(m => m.outageCount > 0 || m.degradedCount > 0).length;
    return { avgUp, totalOutages, affected, monitorCount: mons.length };
  })() : null;

  return (
    <div>
      {/* Controls */}
      <div className="wt-card mb-5 p-5 space-y-4">
        <div>
          <div className="wt-eyebrow mb-2">Time range</div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="wt-seg">
              {RANGES.map((r, i) => (
                <button key={r.label}
                  aria-selected={!useCustom && rangeIdx === i}
                  onClick={() => { setRangeIdx(i); setUseCustom(false); }}>
                  {r.label}
                </button>
              ))}
              <button aria-selected={useCustom} onClick={() => setUseCustom(true)}>Custom</button>
            </div>
            {useCustom && (
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="wt-input wt-mono" style={{ width: 150 }} />
                <span className="wt-mono text-xs" style={{ color: t.textFaint }}>to</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="wt-input wt-mono" style={{ width: 150 }} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={generate} disabled={loading}
            className="wt-btn wt-btn--primary disabled:opacity-60">
            {loading
              ? <><Loader size={13} className="animate-spin" /> Generating…</>
              : <><BarChart2 size={13} /> Generate report</>}
          </button>
          {report && (
            <>
              <button onClick={() => exportCsv(report)} className="wt-btn wt-btn--secondary">
                <Download size={13} /> CSV
              </button>
              <button onClick={() => exportJson(report)} className="wt-btn wt-btn--secondary">
                <FileText size={13} /> JSON
              </button>
            </>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-xs wt-mono" style={{ color: 'var(--wt-down-600)' }}>
            <AlertTriangle size={12} className="shrink-0" /> {error}
          </div>
        )}
      </div>

      {/* Summary tiles */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <SummaryTile
            eyebrow="Avg uptime"
            value={summary.avgUp !== null ? `${summary.avgUp.toFixed(2)}%` : '—'}
            color={summary.avgUp === null ? t.textFaint : summary.avgUp >= 99 ? 'var(--wt-up-600)' : summary.avgUp >= 95 ? 'var(--wt-warn-600)' : 'var(--wt-down-600)'}
            t={t}
          />
          <SummaryTile eyebrow="Monitors" value={summary.monitorCount} t={t} />
          <SummaryTile
            eyebrow="Outages"
            value={summary.totalOutages}
            color={summary.totalOutages > 0 ? 'var(--wt-down-600)' : t.textPrimary}
            t={t}
          />
          <SummaryTile
            eyebrow="Affected"
            value={summary.affected}
            color={summary.affected > 0 ? 'var(--wt-warn-600)' : t.textPrimary}
            t={t}
          />
        </div>
      )}

      {/* Report range label */}
      {report && (
        <div className="wt-eyebrow mb-3">
          {formatDateLocal(report.from)} — {formatDateLocal(report.to)}
        </div>
      )}

      {/* Results table */}
      {report && report.monitors.length === 0 && (
        <div className="wt-card py-16 text-center text-sm wt-mono mb-5" style={{ color: t.textFaint }}>
          No monitors found
        </div>
      )}

      {report && report.monitors.length > 0 && (
        <div className="wt-card overflow-x-auto mb-5">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--wt-border)', backgroundColor: 'var(--wt-surface-2)' }}>
                <th className="px-4 py-2.5 text-left"><span className="wt-eyebrow">Monitor</span></th>
                <th className="px-4 py-2.5 text-right"><span className="wt-eyebrow">Uptime</span></th>
                <th className="px-4 py-2.5 text-right"><span className="wt-eyebrow">Checks</span></th>
                <th className="px-4 py-2.5 text-right"><span className="wt-eyebrow">Avg ping</span></th>
                <th className="px-4 py-2.5 text-right"><span className="wt-eyebrow">Outages</span></th>
                <th className="px-4 py-2.5 text-right"><span className="wt-eyebrow">Downtime</span></th>
              </tr>
            </thead>
            <tbody>
              {report.monitors.map((m, i) => (
                <tr key={m.id} className="border-b"
                  style={{
                    borderColor:       'var(--wt-border)',
                    borderBottomWidth: i === report.monitors.length - 1 ? 0 : 1,
                  }}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium" style={{ color: t.textPrimary }}>{m.label}</div>
                    <div className="wt-mono text-xs mt-0.5" style={{ color: t.textFaint }}>{m.target}</div>
                  </td>
                  <td className="px-4 py-3 text-right">{uptimePill(m.uptimePct)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className="wt-mono text-xs" style={{ color: t.textMuted }}>
                      {m.totalChecks > 0 ? m.totalChecks.toLocaleString() : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="wt-mono text-xs" style={{ color: t.textMuted }}>
                      {m.avgPingMs !== null ? `${Math.round(m.avgPingMs)}ms` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="wt-mono text-xs"
                      style={{ color: m.outageCount > 0 ? 'var(--wt-down-600)' : t.textFaint }}>
                      {m.outageCount}
                      {m.degradedCount > 0 && (
                        <span style={{ color: 'var(--wt-warn-600)' }}> +{m.degradedCount}d</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="wt-mono text-xs" style={{ color: t.textFaint }}>
                      {formatDuration(m.totalDowntimeMs)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!report && !loading && (
        <div className="wt-card py-16 flex flex-col items-center gap-3 mb-5">
          <BarChart2 size={36} style={{ color: 'var(--wt-text-faint)', opacity: 0.4 }} />
          <p className="text-sm wt-mono" style={{ color: t.textMuted }}>
            Select a time range and click Generate report
          </p>
        </div>
      )}

      {/* Past reports history */}
      <div>
        <div className="wt-eyebrow mb-3">Past reports <span className="normal-case font-normal" style={{ color: t.textFaint }}>(last 30 days)</span></div>
        {histLoading ? (
          <div className="wt-card py-8 flex items-center justify-center gap-2 text-xs wt-mono"
            style={{ color: t.textFaint }}>
            <Loader size={13} className="animate-spin" /> Loading…
          </div>
        ) : history.length === 0 ? (
          <div className="wt-card py-8 text-center text-xs wt-mono" style={{ color: t.textFaint }}>
            No saved reports yet — generate one above
          </div>
        ) : (
          <div className="wt-card overflow-hidden">
            {history.map((item, i) => (
              <button
                key={item.id}
                onClick={() => loadHistoryItem(item.id)}
                className="w-full flex items-center gap-4 px-4 py-3 text-left transition-colors"
                style={{
                  borderBottom: i < history.length - 1 ? `1px solid var(--wt-border)` : 'none',
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--wt-surface-2)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                <Clock size={13} style={{ color: t.textFaint, flexShrink: 0 }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: t.textPrimary }}>
                    {formatDateShort(item.from)} — {formatDateShort(item.to)}
                  </div>
                  <div className="wt-mono text-xs mt-0.5" style={{ color: t.textFaint }}>
                    Generated {formatDateLocal(item.generatedAt)}
                  </div>
                </div>
                <ChevronRight size={13} style={{ color: t.textFaint, flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryTile({ eyebrow, value, color, t }) {
  return (
    <div className="wt-card p-4">
      <div className="wt-eyebrow mb-1">{eyebrow}</div>
      <div className="wt-mono text-2xl font-bold" style={{ color: color ?? t.textPrimary, letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  );
}
