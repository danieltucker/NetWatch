import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const CMDS = {
  help:      { usage: 'help [cmd]',          desc: 'List commands or show help for a command' },
  clear:     { usage: 'clear',               desc: 'Clear console output' },
  monitors:  { usage: 'monitors',            desc: 'List all monitors with current status' },
  ls:        { usage: 'ls',                  desc: 'Alias for monitors' },
  down:      { usage: 'down',                desc: 'List monitors that are currently down or degraded' },
  summary:   { usage: 'summary',             desc: 'Overall health: counts by status and average uptime' },
  status:    { usage: 'status <name>',       desc: 'Show details for a named monitor' },
  check:     { usage: 'check <name>',        desc: 'Trigger an immediate check' },
  refresh:   { usage: 'refresh',             desc: 'Re-fetch all monitor data' },
  ping:      { usage: 'ping <target>',       desc: 'ICMP ping a host' },
  dns:       { usage: 'dns <domain>',        desc: 'Look up DNS records (A, AAAA, MX, TXT, NS)' },
  traceroute:{ usage: 'traceroute <target>', desc: 'Trace network path to a host' },
  trace:     { usage: 'trace <target>',      desc: 'Alias for traceroute' },
  uptime:    { usage: 'uptime <name>',       desc: 'Show uptime % for a monitor' },
  history:   { usage: 'history <name>',      desc: 'Show recent check history for a monitor' },
  incidents: { usage: 'incidents <name>',    desc: 'Show recent down-state transitions for a monitor' },
  ssl:       { usage: 'ssl <name>',          desc: 'Show SSL certificate status for a monitor' },
  open:      { usage: 'open <name>',         desc: 'Open monitor target URL in browser' },
  tags:      { usage: 'tags',                desc: 'List all tags and which monitors use each' },
  debug:     { usage: 'debug',               desc: 'Show history window and point counts for all monitors' },
  version:   { usage: 'version',             desc: 'Show NetWatch version' },
};

const MAX_USAGE = Math.max(...Object.values(CMDS).map(c => c.usage.length));

// ---------------------------------------------------------------------------
// Output line renderer
// ---------------------------------------------------------------------------

const LINE_COLORS = {
  command: 'var(--wt-console-text)',
  output:  'var(--wt-console-muted)',
  success: 'var(--wt-up-500)',
  error:   'var(--wt-down-500)',
  info:    'var(--wt-console-accent)',
  warn:    'var(--wt-warn-500)',
};

function ConsoleLine({ type, text }) {
  if (type === 'divider') {
    return <div style={{ borderTop: '1px solid var(--wt-console-border)', margin: '3px 0' }} />;
  }
  return (
    <div style={{
      color:      LINE_COLORS[type] ?? LINE_COLORS.output,
      lineHeight: 1.65,
      whiteSpace: 'pre-wrap',
      wordBreak:  'break-all',
      display:    'flex',
      gap:         8,
    }}>
      {type === 'command' && (
        <span style={{ color: 'var(--wt-console-prompt)', userSelect: 'none', flexShrink: 0 }}>$</span>
      )}
      <span>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMonitor(monitors, query) {
  const q = query.toLowerCase();
  return (
    monitors.find(m => m.label?.toLowerCase() === q) ??
    monitors.find(m => m.target?.toLowerCase() === q) ??
    monitors.find(m => m.label?.toLowerCase().includes(q)) ??
    monitors.find(m => m.target?.toLowerCase().includes(q))
  );
}

function pad(str, len) {
  return String(str).padEnd(len);
}

// Walk history chronologically and extract down→up incident transitions.
function extractIncidents(history) {
  const incidents = [];
  let start = null, startIdx = null;
  for (let i = 0; i < history.length; i++) {
    const isDown = history[i].status === 'down';
    if (isDown && start === null) { start = history[i].timestamp; startIdx = i; }
    else if (!isDown && start !== null) {
      const durationMin = Math.max(1, Math.round(
        (new Date(history[i].timestamp) - new Date(start)) / 60000
      ));
      incidents.push({ start, end: history[i].timestamp, durationMin, error: history[startIdx]?.error ?? null });
      start = null; startIdx = null;
    }
  }
  if (start !== null) {
    incidents.push({ start, end: null, durationMin: null, error: history[startIdx]?.error ?? null });
  }
  return incidents.reverse();
}

// ---------------------------------------------------------------------------
// Console alert row — always on dark surface, uses console tokens
// ---------------------------------------------------------------------------

function ConsoleAlertRow({ alert }) {
  const isActive  = !alert.resolvedAt;
  const isOutage  = alert.type === 'outage';
  const dotColor  = isActive
    ? (isOutage ? 'var(--wt-down-500)' : 'var(--wt-warn-500)')
    : 'var(--wt-up-500)';
  const typeLabel = isOutage ? 'OUTAGE' : alert.type === 'degraded' ? 'DEGRADED' : 'RECOVERED';
  const ts        = alert.lastOccurredAt ?? alert.startedAt;
  const timeStr   = ts
    ? new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <div style={{
      display:    'flex',
      alignItems: 'center',
      gap:         8,
      padding:    '3px 16px',
      fontSize:    12,
      fontFamily: 'var(--wt-font-mono)',
      lineHeight:  1.5,
    }}>
      <span style={{
        width:           6,
        height:          6,
        borderRadius:   '50%',
        backgroundColor: dotColor,
        flexShrink:      0,
      }} />
      <span style={{
        color:         dotColor,
        fontSize:       10,
        fontWeight:     700,
        letterSpacing: '0.06em',
        width:          72,
        flexShrink:     0,
      }}>
        {typeLabel}
      </span>
      <span style={{
        color:        'var(--wt-console-text)',
        flex:          1,
        overflow:     'hidden',
        textOverflow: 'ellipsis',
        whiteSpace:   'nowrap',
      }}>
        {alert.monitorLabel}
      </span>
      <span style={{ color: 'var(--wt-console-muted)', fontSize: 11, flexShrink: 0 }}>
        {timeStr}
      </span>
      <span style={{
        color:         isActive ? dotColor : 'var(--wt-console-muted)',
        fontSize:       10,
        letterSpacing: '0.04em',
        flexShrink:     0,
        width:          60,
        textAlign:     'right',
      }}>
        {isActive ? 'ONGOING' : 'RESOLVED'}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsolePanel
// ---------------------------------------------------------------------------

export function ConsolePanel({ monitors = [], onRefresh, alerts = [], isOpen, onIsOpenChange }) {
  const [input,       setInput]       = useState('');
  const [cmdHist,     setCmdHist]     = useState([]);
  const [histIdx,     setHistIdx]     = useState(-1);
  const [lines,       setLines]       = useState([
    { type: 'info', text: 'NetWatch Console  —  type "help" for available commands' },
  ]);
  const [alertFilter, setAlertFilter] = useState('');
  const [clearedAt,   setClearedAt]   = useState(null);

  const outputRef      = useRef(null);
  const inputRef       = useRef(null);
  const alertFilterRef = useRef(null);

  // ── Derived: filtered + sorted visible alerts ────────────────────────────
  const visibleAlerts = useMemo(() => {
    let list = clearedAt
      ? alerts.filter(a => {
          const activity = a.lastOccurredAt ?? a.startedAt;
          return new Date(activity) > new Date(clearedAt);
        })
      : alerts.slice();

    if (alertFilter.trim()) {
      const q = alertFilter.toLowerCase();
      list = list.filter(a =>
        a.monitorLabel?.toLowerCase().includes(q) ||
        a.type?.toLowerCase().includes(q) ||
        (a.resolvedAt ? 'recovered' : '').includes(q)
      );
    }

    return list
      .sort((a, b) => {
        if (!a.resolvedAt && b.resolvedAt)  return -1;
        if (a.resolvedAt  && !b.resolvedAt) return  1;
        if (!a.resolvedAt && !b.resolvedAt) {
          const rank = { outage: 0, degraded: 1 };
          return (rank[a.type] ?? 2) - (rank[b.type] ?? 2);
        }
        return new Date(b.resolvedAt) - new Date(a.resolvedAt);
      })
      .slice(0, 200);
  }, [alerts, alertFilter, clearedAt]);

  const activeAlertCount = alerts.filter(a => !a.resolvedAt).length;

  // ── Global keyboard handler ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '`') {
        const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
        if (!isOpen && inField) return;
        e.preventDefault();
        onIsOpenChange(!isOpen);
      }
      if (e.key === 'Escape' && isOpen) onIsOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onIsOpenChange]);

  // ── Focus + body scroll lock ─────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const emit = useCallback((newLines) => {
    setLines(prev => [...prev, ...(Array.isArray(newLines) ? newLines : [newLines])]);
  }, []);

  // ── Tab completion ───────────────────────────────────────────────────────
  const handleTab = useCallback(() => {
    const parts = input.split(/\s+/);
    if (parts.length < 2) return;
    const partial = parts[parts.length - 1].toLowerCase();
    if (!partial) return;
    const matches = monitors.map(m => m.label).filter(l => l.toLowerCase().startsWith(partial));
    if (matches.length === 1) {
      parts[parts.length - 1] = matches[0];
      setInput(parts.join(' '));
    } else if (matches.length > 1) {
      emit({ type: 'info', text: matches.join('   ') });
    }
  }, [input, monitors, emit]);

  // ── Input key handler ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const val = input.trim();
      setInput('');
      setHistIdx(-1);
      if (val) {
        setCmdHist(prev => [val, ...prev].slice(0, 100));
        runCommand(val);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(histIdx + 1, cmdHist.length - 1);
      setHistIdx(next);
      setInput(cmdHist[next] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? '' : cmdHist[next]);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      handleTab();
    }
  }, [input, histIdx, cmdHist, handleTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Command executor ─────────────────────────────────────────────────────
  const runCommand = useCallback(async (raw) => {
    emit({ type: 'command', text: raw });

    const [cmd, ...argParts] = raw.trim().split(/\s+/);
    const arg = argParts.join(' ');

    try {
      switch (cmd.toLowerCase()) {

        // ── clear ────────────────────────────────────────────────────────
        case 'clear':
          setLines([]);
          break;

        // ── version ──────────────────────────────────────────────────────
        case 'version':
          emit({ type: 'output', text: 'NetWatch v6.16.2 — https://github.com/danieltucker/NetWatch/releases/tag/v6.16.2' });
          break;

        // ── help ─────────────────────────────────────────────────────────
        case 'help': {
          const target = arg ? CMDS[arg.toLowerCase()] : null;
          if (arg && !target) { emit({ type: 'error', text: `Unknown command: ${arg}` }); break; }
          if (target) {
            emit([
              { type: 'output', text: `Usage:  ${target.usage}` },
              { type: 'info',   text: `        ${target.desc}` },
            ]);
          } else {
            emit([
              { type: 'info', text: 'Commands:' },
              ...Object.values(CMDS).map(c => ({
                type: 'output',
                text: `  ${pad(c.usage, MAX_USAGE + 3)}${c.desc}`,
              })),
            ]);
          }
          break;
        }

        // ── monitors / ls ────────────────────────────────────────────────
        case 'monitors':
        case 'ls': {
          if (!monitors.length) { emit({ type: 'warn', text: 'No monitors configured' }); break; }
          const typeMap = { up: 'success', down: 'error', degraded: 'warn', pending: 'info' };
          emit([
            { type: 'divider' },
            ...monitors.map(m => ({
              type: typeMap[m.status] ?? 'output',
              text: `  [${pad((m.status ?? 'pending').toUpperCase(), 8)}]  ${pad(m.label, 24)}  ${m.target}`,
            })),
            { type: 'divider' },
            { type: 'info', text: `${monitors.length} monitor(s)` },
          ]);
          break;
        }

        // ── down ─────────────────────────────────────────────────────────
        case 'down': {
          const affected = monitors.filter(m => m.status === 'down' || m.status === 'degraded');
          if (!affected.length) {
            emit({ type: 'success', text: 'All monitors healthy' });
            break;
          }
          emit([
            { type: 'divider' },
            ...affected.map(m => ({
              type: m.status === 'down' ? 'error' : 'warn',
              text: `  [${pad(m.status.toUpperCase(), 8)}]  ${pad(m.label, 24)}  ${m.target}`,
            })),
            { type: 'divider' },
            { type: 'warn', text: `${affected.length} monitor(s) need attention` },
          ]);
          break;
        }

        // ── summary ──────────────────────────────────────────────────────
        case 'summary': {
          if (!monitors.length) { emit({ type: 'warn', text: 'No monitors configured' }); break; }
          const upCount       = monitors.filter(m => m.status === 'up').length;
          const downCount     = monitors.filter(m => m.status === 'down').length;
          const degradedCount = monitors.filter(m => m.status === 'degraded').length;
          const withHistory   = monitors.filter(m => m.history?.length > 0);
          const avgUptime     = withHistory.length
            ? (withHistory.reduce((s, m) => s + (m.uptimePercent ?? 0), 0) / withHistory.length).toFixed(1)
            : null;
          const upPct = monitors.length ? Math.round((upCount / monitors.length) * 100) : 0;
          emit([
            { type: 'divider' },
            { type: 'output',  text: `  Monitors   ${monitors.length} total` },
            { type: 'success', text: `  Up         ${upCount}  (${upPct}%)` },
            ...(degradedCount > 0 ? [{ type: 'warn',  text: `  Degraded   ${degradedCount}` }] : []),
            ...(downCount > 0     ? [{ type: 'error', text: `  Down       ${downCount}` }]     : []),
            { type: avgUptime && parseFloat(avgUptime) >= 99 ? 'success' : 'output',
              text: `  Avg uptime ${avgUptime != null ? `${avgUptime}%` : '—'}` },
            { type: 'divider' },
          ]);
          break;
        }

        // ── status ───────────────────────────────────────────────────────
        case 'status': {
          if (!arg) { emit({ type: 'error', text: 'Usage: status <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const tags      = m.tags?.filter(t => t !== '_ref') ?? [];
          const certDays  = m.latest?.certDays;
          const alertList = (m.alertTypes ?? []).filter(a => a !== 'None');
          emit([
            { type: 'divider' },
            { type: 'output', text: `  Label     ${m.label}` },
            { type: 'output', text: `  Target    ${m.target}${m.port ? `:${m.port}` : ''}` },
            { type: 'output', text: `  Type      ${m.checkType}` },
            { type: 'output', text: `  Status    ${(m.status ?? 'pending').toUpperCase()}` },
            { type: 'output', text: `  Ping      ${m.currentPing != null ? `${m.currentPing}ms` : '—'}` },
            { type: 'output', text: `  Uptime    ${m.history?.length > 0 ? `${m.uptimePercent}%` : '—'}  (${m.historyWindow ?? '1h'} window)` },
            ...(certDays != null ? [{
              type: 'output',
              text: `  Cert      ${certDays}d remaining`,
            }] : []),
            ...(alertList.length > 0 ? [{
              type: 'info',
              text: `  Alerts    ${alertList.join(', ')}`,
            }] : []),
            { type: 'output', text: `  Interval  every ${m.interval}s` },
            { type: 'output', text: `  Checked   ${m.lastChecked ?? 'never'}` },
            ...(tags.length > 0 ? [{ type: 'info', text: `  Tags      ${tags.join(', ')}` }] : []),
            { type: 'divider' },
          ]);
          break;
        }

        // ── uptime ───────────────────────────────────────────────────────
        case 'uptime': {
          if (!arg) { emit({ type: 'error', text: 'Usage: uptime <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const pct = m.history?.length > 0 ? `${m.uptimePercent}%` : '—';
          emit({ type: 'output', text: `${m.label}  ${pct}  (${m.historyWindow ?? '1h'} window)` });
          break;
        }

        // ── history ──────────────────────────────────────────────────────
        case 'history': {
          if (!arg) { emit({ type: 'error', text: 'Usage: history <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const entries = (m.history ?? []).slice(-20);
          if (!entries.length) { emit({ type: 'warn', text: 'No history available' }); break; }
          emit([
            { type: 'divider' },
            ...entries.map(h => {
              const ts   = h.timestamp
                ? new Date(h.timestamp).toLocaleTimeString('en-US', { hour12: false })
                : '—';
              const ping = h.ping != null ? `${h.ping}ms` : '—';
              const http = h.httpStatus != null ? `HTTP ${h.httpStatus}` : '—';
              const httpColor = h.httpStatus != null && h.httpStatus < 400 ? 'success' : 'error';
              return {
                type: h.status === 'up' ? 'success' : h.httpStatus != null ? httpColor : 'error',
                text: `  ${ts}  ${pad(h.status?.toUpperCase() ?? '?', 4)}  ${pad(ping, 8)}  ${http}`,
              };
            }),
            { type: 'divider' },
          ]);
          break;
        }

        // ── incidents ────────────────────────────────────────────────────
        case 'incidents': {
          if (!arg) { emit({ type: 'error', text: 'Usage: incidents <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const all = extractIncidents(m.history ?? []).slice(0, 10);
          if (!all.length) {
            emit({ type: 'success', text: `No incidents in the current window for "${m.label}"` });
            break;
          }
          const fmtTs = ts => ts
            ? new Date(ts).toLocaleString('en-US', {
                hour12: false, month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })
            : '—';
          const lines = [];
          lines.push({ type: 'divider' });
          for (const inc of all) {
            lines.push({ type: 'error',  text: `  Down at   ${fmtTs(inc.start)}` });
            if (inc.end) {
              lines.push({ type: 'success', text: `  Recovered ${fmtTs(inc.end)}  (${inc.durationMin} min)` });
            } else {
              lines.push({ type: 'warn', text: `  Ongoing` });
            }
            if (inc.error) lines.push({ type: 'output', text: `  Error     ${inc.error}` });
            lines.push({ type: 'divider' });
          }
          lines.push({ type: 'info', text: `${all.length} incident(s)` });
          emit(lines);
          break;
        }

        // ── ssl ──────────────────────────────────────────────────────────
        case 'ssl': {
          if (!arg) { emit({ type: 'error', text: 'Usage: ssl <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const days = m.latest?.certDays;
          if (days == null) {
            emit({ type: 'warn', text: 'No SSL data available (HTTP/API monitor only, requires at least one check)' });
            break;
          }
          emit([
            { type: 'divider' },
            { type: days > 30 ? 'success' : days > 7 ? 'warn' : 'error',
              text: `  Cert expires in   ${days}d` },
            { type: 'output', text: `  Last checked      ${m.lastChecked ?? 'never'}` },
            { type: 'divider' },
          ]);
          break;
        }

        // ── open ─────────────────────────────────────────────────────────
        case 'open': {
          if (!arg) { emit({ type: 'error', text: 'Usage: open <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          if (m.checkType !== 'http' && m.checkType !== 'api') {
            emit({ type: 'warn', text: 'open only works for HTTP and API monitors' });
            break;
          }
          const href = m.target.startsWith('http') ? m.target : `https://${m.target}`;
          window.open(href, '_blank', 'noopener,noreferrer');
          emit({ type: 'success', text: `Opened ${href}` });
          break;
        }

        // ── tags ─────────────────────────────────────────────────────────
        case 'tags': {
          const tagMap = new Map();
          for (const m of monitors) {
            for (const tag of (m.tags ?? []).filter(t => t !== '_ref')) {
              if (!tagMap.has(tag)) tagMap.set(tag, []);
              tagMap.get(tag).push(m.label);
            }
          }
          if (!tagMap.size) { emit({ type: 'warn', text: 'No tags configured' }); break; }
          const maxTag = Math.max(...[...tagMap.keys()].map(t => t.length));
          emit([
            { type: 'divider' },
            ...[...tagMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, labels]) => ({
              type: 'output',
              text: `  ${pad(tag, maxTag + 2)}→  ${labels.join(', ')}`,
            })),
            { type: 'divider' },
          ]);
          break;
        }

        // ── check ────────────────────────────────────────────────────────
        case 'check': {
          if (!arg) { emit({ type: 'error', text: 'Usage: check <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          emit({ type: 'info', text: `Checking "${m.label}"…` });
          const res  = await fetch(`/api/monitors/${m.id}/check`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
          });
          const data = await res.json();
          if (data.status === 'up') {
            const lines = [{ type: 'success', text: `UP  ${data.totalMs != null ? `${data.totalMs}ms` : ''}` }];
            if (data.dnsMs  != null) lines.push({ type: 'output', text: `  DNS   ${data.dnsMs}ms` });
            if (data.tcpMs  != null) lines.push({ type: 'output', text: `  TCP   ${data.tcpMs}ms` });
            if (data.tlsMs  != null) lines.push({ type: 'output', text: `  TLS   ${data.tlsMs}ms` });
            if (data.ttfbMs != null) lines.push({ type: 'output', text: `  TTFB  ${data.ttfbMs}ms` });
            if (data.httpStatus != null) lines.push({ type: data.httpStatus < 400 ? 'success' : 'error', text: `  HTTP ${data.httpStatus}` });
            emit(lines);
          } else {
            emit({ type: 'error', text: `DOWN  ${data.error ?? 'Unreachable'}` });
          }
          break;
        }

        // ── refresh ──────────────────────────────────────────────────────
        case 'refresh': {
          emit({ type: 'info', text: 'Refreshing…' });
          await (onRefresh?.() ?? Promise.resolve());
          emit({ type: 'success', text: 'Done' });
          break;
        }

        // ── ping ─────────────────────────────────────────────────────────
        case 'ping': {
          if (!arg) { emit({ type: 'error', text: 'Usage: ping <target>' }); break; }
          emit({ type: 'info', text: `Pinging ${arg}…` });
          const res  = await fetch('/api/tools/ping', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: arg }),
          });
          const data = await res.json();
          emit(data.status === 'up'
            ? { type: 'success', text: `Reply from ${arg}: time=${data.totalMs ?? '?'}ms` }
            : { type: 'error',   text: `${arg}: ${data.error ?? 'Host unreachable'}` }
          );
          break;
        }

        // ── dns ──────────────────────────────────────────────────────────
        case 'dns': {
          if (!arg) { emit({ type: 'error', text: 'Usage: dns <domain>' }); break; }
          emit({ type: 'info', text: `Looking up ${arg}…` });
          const res  = await fetch('/api/tools/dns', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain: arg }),
          });
          const data = await res.json();
          if (data.error) { emit({ type: 'error', text: data.error }); break; }
          const out = [];
          (data.A     ?? []).forEach(r => out.push({ type: 'output', text: `  A       ${r}` }));
          (data.AAAA  ?? []).forEach(r => out.push({ type: 'output', text: `  AAAA    ${r}` }));
          (data.CNAME ?? []).forEach(r => out.push({ type: 'output', text: `  CNAME   ${r}` }));
          (data.MX    ?? []).forEach(r => out.push({ type: 'output', text: `  MX      ${r.priority}  ${r.exchange}` }));
          (data.NS    ?? []).forEach(r => out.push({ type: 'output', text: `  NS      ${r}` }));
          (data.TXT   ?? []).forEach(r => out.push({ type: 'output', text: `  TXT     "${r.join(' ')}"` }));
          emit(out.length ? [{ type: 'divider' }, ...out, { type: 'divider' }]
                          : [{ type: 'warn', text: 'No records found' }]);
          break;
        }

        // ── traceroute / trace ────────────────────────────────────────────
        case 'traceroute':
        case 'trace': {
          if (!arg) { emit({ type: 'error', text: `Usage: ${cmd} <target>` }); break; }
          emit({ type: 'info', text: `Tracing route to ${arg}…` });
          const res  = await fetch('/api/tools/traceroute', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: arg }),
          });
          const data = await res.json();
          if (data.error && !data.hops?.length) { emit({ type: 'error', text: data.error }); break; }
          const hopLines = (data.hops ?? []).map(h => ({
            type: 'output',
            text: `  ${pad(h.hop, 3)}  ${h.address ?? '*          '}  ${
              h.times ? h.times.map(t => pad(`${t}ms`, 7)).join('  ') : '*        *        *'
            }`,
          }));
          emit([
            { type: 'divider' },
            ...hopLines,
            { type: 'divider' },
            { type: 'info', text: `${data.hops?.length ?? 0} hop(s)` },
          ]);
          break;
        }

        // ── debug ────────────────────────────────────────────────────────
        case 'debug': {
          if (!monitors.length) { emit({ type: 'warn', text: 'No monitors loaded' }); break; }
          emit([
            { type: 'divider' },
            { type: 'info', text: `${monitors.length} monitor(s) — history window debug` },
            ...monitors.slice(0, 15).map(m => {
              const fmt = ts => ts
                ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                : '?';
              const oldest = fmt(m.history?.[0]?.timestamp);
              const newest = fmt(m.history?.[m.history.length - 1]?.timestamp);
              return {
                type: 'output',
                text: `  ${pad(m.label, 24)}  window=${pad(m.historyWindow ?? '?', 5)}  pts=${pad(String(m.history?.length ?? 0), 4)}  ${oldest} → ${newest}`,
              };
            }),
            { type: 'divider' },
          ]);
          break;
        }

        // ── unknown ───────────────────────────────────────────────────────
        default:
          emit({ type: 'error', text: `Unknown command: ${cmd}  (type "help" to list commands)` });
      }
    } catch (err) {
      emit({ type: 'error', text: `Error: ${err.message}` });
    }
  }, [monitors, onRefresh, emit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position:        'fixed',
      top:              0,
      left:             0,
      right:            0,
      zIndex:           9999,
      height:           '55vh',
      display:          'flex',
      flexDirection:    'column',
      fontFamily:       'var(--wt-font-mono)',
      fontSize:          13,
      backgroundColor: 'var(--wt-console-bg)',
      borderBottom:    '1px solid var(--wt-console-border)',
      boxShadow:        isOpen ? '0 8px 40px rgba(0,0,0,0.7)' : 'none',
      transform:        isOpen ? 'translateY(0)' : 'translateY(-100%)',
      transition:       'transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
      pointerEvents:    isOpen ? 'all' : 'none',
    }}>

      {/* Header bar */}
      <div style={{
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'space-between',
        padding:         '5px 16px',
        backgroundColor: 'var(--wt-console-bg-2)',
        borderBottom:    '1px solid var(--wt-console-border)',
        flexShrink:       0,
      }}>
        <span style={{ color: 'var(--wt-console-accent)', fontWeight: 'bold', letterSpacing: '0.12em', fontSize: 11 }}>
          NETWATCH CONSOLE
        </span>
        <span style={{ color: 'var(--wt-console-muted)', fontSize: 11 }}>
          ` to close  ·  tab to complete  ·  ↑↓ history
        </span>
      </div>

      {/* Alert section — only rendered when alerts exist */}
      {alerts.length > 0 && (
        <div style={{
          borderBottom:    '1px solid var(--wt-console-border)',
          flexShrink:       0,
          maxHeight:       '38%',
          display:         'flex',
          flexDirection:   'column',
          backgroundColor: 'var(--wt-console-bg)',
        }}>
          {/* Alert section header */}
          <div style={{
            display:         'flex',
            alignItems:      'center',
            gap:              8,
            padding:         '4px 16px',
            backgroundColor: 'var(--wt-console-bg-2)',
            borderBottom:    visibleAlerts.length > 0 ? '1px solid var(--wt-console-border)' : 'none',
            flexShrink:       0,
          }}>
            <span style={{ color: 'var(--wt-console-accent)', fontWeight: 700, letterSpacing: '0.12em', fontSize: 10 }}>
              ALERTS
            </span>
            {activeAlertCount > 0 && (
              <span style={{
                fontFamily:      'var(--wt-font-mono)',
                fontSize:         10,
                color:           'var(--wt-console-muted)',
                backgroundColor: 'color-mix(in oklch, var(--wt-console-accent) 12%, transparent)',
                padding:         '1px 5px',
                borderRadius:     999,
              }}>
                {activeAlertCount} active
              </span>
            )}
            <div style={{ flex: 1 }} />
            {/* Inline filter input */}
            <input
              ref={alertFilterRef}
              value={alertFilter}
              onChange={e => setAlertFilter(e.target.value)}
              placeholder="filter…"
              style={{
                background:   'transparent',
                border:       'none',
                borderBottom: `1px solid ${alertFilter ? 'var(--wt-console-accent)' : 'var(--wt-console-border)'}`,
                outline:      'none',
                color:        'var(--wt-console-text)',
                fontFamily:   'var(--wt-font-mono)',
                fontSize:      11,
                width:         alertFilter ? 120 : 56,
                transition:   `width var(--wt-dur) var(--wt-ease), border-color var(--wt-dur) var(--wt-ease)`,
                padding:      '1px 4px',
                caretColor:   'var(--wt-console-prompt)',
              }}
            />
            {/* Clear history button */}
            <button
              onClick={() => { setClearedAt(Date.now()); setAlertFilter(''); }}
              style={{
                color:         'var(--wt-console-muted)',
                background:    'none',
                border:        'none',
                cursor:        'pointer',
                fontFamily:    'var(--wt-font-mono)',
                fontSize:       10,
                padding:       '1px 6px',
                borderRadius:   3,
                letterSpacing: '0.04em',
                transition:    `color var(--wt-dur)`,
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--wt-console-text)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--wt-console-muted)'}
              title="Clear visible alert history"
            >
              clear
            </button>
          </div>

          {/* Alert rows or cleared message */}
          {visibleAlerts.length > 0 ? (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {visibleAlerts.map(a => (
                <ConsoleAlertRow key={a.id} alert={a} />
              ))}
            </div>
          ) : (
            <div style={{
              padding:    '5px 16px',
              color:      'var(--wt-console-muted)',
              fontSize:    11,
              fontFamily: 'var(--wt-font-mono)',
            }}>
              — cleared · new alerts will appear here
            </div>
          )}
        </div>
      )}

      {/* Output area */}
      <div ref={outputRef} style={{
        flex:          1,
        overflowY:     'auto',
        padding:       '10px 16px 6px',
        display:       'flex',
        flexDirection: 'column',
        gap:            1,
      }}>
        {lines.map((line, i) => (
          <ConsoleLine key={i} type={line.type} text={line.text} />
        ))}
      </div>

      {/* Input row */}
      <div style={{
        display:         'flex',
        alignItems:      'center',
        gap:              8,
        padding:         '8px 16px',
        borderTop:       '1px solid var(--wt-console-border)',
        backgroundColor: 'var(--wt-console-bg)',
        flexShrink:       0,
      }}>
        <span style={{ color: 'var(--wt-console-prompt)', userSelect: 'none', flexShrink: 0 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex:       1,
            background: 'transparent',
            border:     'none',
            outline:    'none',
            color:      'var(--wt-console-text)',
            fontFamily: 'inherit',
            fontSize:   'inherit',
            caretColor: 'var(--wt-console-prompt)',
          }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}
