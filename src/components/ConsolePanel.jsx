import React, { useState, useEffect, useRef, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const CMDS = {
  help:       { usage: 'help [cmd]',          desc: 'List commands or show help for a command' },
  clear:      { usage: 'clear',               desc: 'Clear console output' },
  monitors:   { usage: 'monitors',            desc: 'List all monitors with current status' },
  ls:         { usage: 'ls',                  desc: 'Alias for monitors' },
  status:     { usage: 'status <name>',       desc: 'Show details for a named monitor' },
  check:      { usage: 'check <name>',        desc: 'Trigger an immediate check' },
  refresh:    { usage: 'refresh',             desc: 'Re-fetch all monitor data' },
  ping:       { usage: 'ping <target>',       desc: 'ICMP ping a host' },
  dns:        { usage: 'dns <domain>',        desc: 'Look up DNS records (A, AAAA, MX, TXT, NS)' },
  traceroute: { usage: 'traceroute <target>', desc: 'Trace network path to a host' },
  trace:      { usage: 'trace <target>',      desc: 'Alias for traceroute' },
  uptime:     { usage: 'uptime <name>',       desc: 'Show uptime % for a monitor' },
  history:    { usage: 'history <name>',      desc: 'Show recent check history for a monitor' },
  version:    { usage: 'version',             desc: 'Show WatchTower version' },
};

const MAX_USAGE = Math.max(...Object.values(CMDS).map(c => c.usage.length));

// ---------------------------------------------------------------------------
// Output line renderer
// ---------------------------------------------------------------------------

const LINE_COLORS = {
  command: '#e6edf3',
  output:  '#8d96a0',
  success: '#4ade80',
  error:   '#f87171',
  info:    '#60a5fa',
  warn:    '#fbbf24',
};

function ConsoleLine({ type, text }) {
  if (type === 'divider') {
    return <div style={{ borderTop: '1px solid #21262d', margin: '3px 0' }} />;
  }
  return (
    <div style={{
      color:         LINE_COLORS[type] ?? LINE_COLORS.output,
      lineHeight:    1.65,
      whiteSpace:    'pre-wrap',
      wordBreak:     'break-all',
      display:       'flex',
      gap:           8,
    }}>
      {type === 'command' && (
        <span style={{ color: '#4ade80', userSelect: 'none', flexShrink: 0 }}>$</span>
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

// ---------------------------------------------------------------------------
// ConsolePanel
// ---------------------------------------------------------------------------

export function ConsolePanel({ monitors = [], onRefresh }) {
  const [isOpen,  setIsOpen]  = useState(false);
  const [input,   setInput]   = useState('');
  const [cmdHist, setCmdHist] = useState([]);   // saved commands, newest first
  const [histIdx, setHistIdx] = useState(-1);   // -1 = current draft
  const [lines,   setLines]   = useState([
    { type: 'info', text: 'WatchTower Console  —  type "help" for available commands' },
  ]);

  const outputRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Global keyboard handler ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '`') {
        const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName);
        if (!isOpen && inField) return; // don't intercept form typing
        e.preventDefault();
        setIsOpen(v => !v);
      }
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // ── Focus input when opened, lock body scroll ───────────────────────────────
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // ── Auto-scroll output to bottom ────────────────────────────────────────────
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // ── Append lines helper ─────────────────────────────────────────────────────
  const emit = useCallback((newLines) => {
    setLines(prev => [...prev, ...(Array.isArray(newLines) ? newLines : [newLines])]);
  }, []);

  // ── Tab completion ──────────────────────────────────────────────────────────
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

  // ── Input key handler ───────────────────────────────────────────────────────
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

  // ── Command executor ────────────────────────────────────────────────────────
  const runCommand = useCallback(async (raw) => {
    emit({ type: 'command', text: raw });

    const [cmd, ...argParts] = raw.trim().split(/\s+/);
    const arg = argParts.join(' ');

    try {
      switch (cmd.toLowerCase()) {

        // ── clear ──────────────────────────────────────────────────────────
        case 'clear':
          setLines([]);
          break;

        // ── version ────────────────────────────────────────────────────────
        case 'version':
          emit({ type: 'output', text: 'NetWatch v6.3.0' });
          break;

        // ── help ───────────────────────────────────────────────────────────
        case 'help': {
          const target = arg ? CMDS[arg.toLowerCase()] : null;
          if (arg && !target) {
            emit({ type: 'error', text: `Unknown command: ${arg}` });
            break;
          }
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

        // ── monitors / ls ──────────────────────────────────────────────────
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

        // ── status ─────────────────────────────────────────────────────────
        case 'status': {
          if (!arg) { emit({ type: 'error', text: 'Usage: status <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const tags = m.tags?.filter(t => t !== '_ref') ?? [];
          emit([
            { type: 'divider' },
            { type: 'output', text: `  Label     ${m.label}` },
            { type: 'output', text: `  Target    ${m.target}${m.port ? `:${m.port}` : ''}` },
            { type: 'output', text: `  Type      ${m.checkType}` },
            { type: 'output', text: `  Status    ${(m.status ?? 'pending').toUpperCase()}` },
            { type: 'output', text: `  Ping      ${m.currentPing != null ? `${m.currentPing}ms` : '—'}` },
            { type: 'output', text: `  Uptime    ${m.history?.length > 0 ? `${m.uptimePercent}%` : '—'}  (${m.historyWindow ?? '1h'} window)` },
            { type: 'output', text: `  Interval  every ${m.interval}s` },
            { type: 'output', text: `  Checked   ${m.lastChecked ?? 'never'}` },
            ...(tags.length > 0 ? [{ type: 'info', text: `  Tags      ${tags.join(', ')}` }] : []),
            { type: 'divider' },
          ]);
          break;
        }

        // ── uptime ─────────────────────────────────────────────────────────
        case 'uptime': {
          if (!arg) { emit({ type: 'error', text: 'Usage: uptime <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const pct = m.history?.length > 0 ? `${m.uptimePercent}%` : '—';
          emit({ type: 'output', text: `${m.label}  ${pct}  (${m.historyWindow ?? '1h'} window)` });
          break;
        }

        // ── history ────────────────────────────────────────────────────────
        case 'history': {
          if (!arg) { emit({ type: 'error', text: 'Usage: history <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          const entries = (m.history ?? []).slice(-20);
          if (!entries.length) { emit({ type: 'warn', text: 'No history available' }); break; }
          emit([
            { type: 'divider' },
            ...entries.map(h => {
              const ts = h.timestamp
                ? new Date(h.timestamp).toLocaleTimeString('en-US', { hour12: false })
                : '—';
              const ping = h.ping != null ? `${h.ping}ms` : '—';
              return {
                type: h.status === 'up' ? 'success' : 'error',
                text: `  ${ts}  ${pad(h.status?.toUpperCase() ?? '?', 4)}  ${ping}`,
              };
            }),
            { type: 'divider' },
          ]);
          break;
        }

        // ── check ──────────────────────────────────────────────────────────
        case 'check': {
          if (!arg) { emit({ type: 'error', text: 'Usage: check <name>' }); break; }
          const m = findMonitor(monitors, arg);
          if (!m) { emit({ type: 'error', text: `No monitor matching "${arg}"` }); break; }
          emit({ type: 'info', text: `Checking "${m.label}"…` });
          const res = await fetch(`/api/monitors/${m.id}/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          const data = await res.json();
          if (data.status === 'up') {
            emit({ type: 'success', text: `UP  ${data.totalMs != null ? `${data.totalMs}ms` : ''}` });
          } else {
            emit({ type: 'error', text: `DOWN  ${data.error ?? 'Unreachable'}` });
          }
          break;
        }

        // ── refresh ────────────────────────────────────────────────────────
        case 'refresh': {
          emit({ type: 'info', text: 'Refreshing…' });
          await (onRefresh?.() ?? Promise.resolve());
          emit({ type: 'success', text: 'Done' });
          break;
        }

        // ── ping ───────────────────────────────────────────────────────────
        case 'ping': {
          if (!arg) { emit({ type: 'error', text: 'Usage: ping <target>' }); break; }
          emit({ type: 'info', text: `Pinging ${arg}…` });
          const res = await fetch('/api/tools/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: arg }),
          });
          const data = await res.json();
          emit(data.status === 'up'
            ? { type: 'success', text: `Reply from ${arg}: time=${data.totalMs ?? '?'}ms` }
            : { type: 'error',   text: `${arg}: ${data.error ?? 'Host unreachable'}` }
          );
          break;
        }

        // ── dns ────────────────────────────────────────────────────────────
        case 'dns': {
          if (!arg) { emit({ type: 'error', text: 'Usage: dns <domain>' }); break; }
          emit({ type: 'info', text: `Looking up ${arg}…` });
          const res = await fetch('/api/tools/dns', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

        // ── traceroute / trace ─────────────────────────────────────────────
        case 'traceroute':
        case 'trace': {
          if (!arg) { emit({ type: 'error', text: `Usage: ${cmd} <target>` }); break; }
          emit({ type: 'info', text: `Tracing route to ${arg}…` });
          const res = await fetch('/api/tools/traceroute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target: arg }),
          });
          const data = await res.json();
          if (data.error && !data.hops?.length) {
            emit({ type: 'error', text: data.error });
            break;
          }
          const hopLines = (data.hops ?? []).map(h => ({
            type: 'output',
            text: `  ${pad(h.hop, 3)}  ${
              h.address ?? '*          '
            }  ${
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

        // ── unknown ────────────────────────────────────────────────────────
        default:
          emit({ type: 'error', text: `Unknown command: ${cmd}  (type "help" to list commands)` });
      }
    } catch (err) {
      emit({ type: 'error', text: `Error: ${err.message}` });
    }
  }, [monitors, onRefresh, emit]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ──────────────────────────────────────────────────────────────────
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
      fontFamily:       '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace',
      fontSize:          13,
      backgroundColor: '#0a0c0f',
      borderBottom:    '1px solid #21262d',
      boxShadow:       '0 8px 40px rgba(0,0,0,0.7)',
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
        backgroundColor: '#111318',
        borderBottom:    '1px solid #21262d',
        flexShrink:       0,
      }}>
        <span style={{ color: '#4ade80', fontWeight: 'bold', letterSpacing: '0.12em', fontSize: 11 }}>
          WATCHTOWER CONSOLE
        </span>
        <span style={{ color: '#30363d', fontSize: 11 }}>
          ` to close  ·  tab to complete  ·  ↑↓ history
        </span>
      </div>

      {/* Output area */}
      <div ref={outputRef} style={{
        flex:       1,
        overflowY:  'auto',
        padding:    '10px 16px 6px',
        display:    'flex',
        flexDirection: 'column',
        gap:        1,
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
        borderTop:       '1px solid #21262d',
        backgroundColor: '#0d1117',
        flexShrink:       0,
      }}>
        <span style={{ color: '#4ade80', userSelect: 'none', flexShrink: 0 }}>$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            flex:           1,
            background:    'transparent',
            border:        'none',
            outline:       'none',
            color:         '#e6edf3',
            fontFamily:    'inherit',
            fontSize:      'inherit',
            caretColor:    '#4ade80',
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
