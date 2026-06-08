import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Edit2, X, Check, AlertCircle, Wrench } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

// Purple maintenance token — used throughout this page and card indicators
export const MAINTENANCE_COLOR     = 'var(--wt-viz-5)';
export const MAINTENANCE_COLOR_BG  = 'color-mix(in oklch, var(--wt-viz-5) 12%, transparent)';

function formatDt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function eventStatus(event) {
  const now = new Date().toISOString();
  if (event.endAt < now)   return 'past';
  if (event.startAt > now) return 'upcoming';
  return 'active';
}

function StatusBadge({ status }) {
  if (status === 'active') return (
    <span className="wt-pill" style={{ backgroundColor: MAINTENANCE_COLOR_BG, color: MAINTENANCE_COLOR, borderColor: 'color-mix(in oklch, var(--wt-viz-5) 30%, transparent)' }}>
      <span className="wt-pill__dot" style={{ backgroundColor: MAINTENANCE_COLOR }} />Active
    </span>
  );
  if (status === 'upcoming') return (
    <span className="wt-pill wt-pill--muted">Upcoming</span>
  );
  return <span className="wt-pill wt-pill--muted" style={{ opacity: 0.6 }}>Past</span>;
}

// ── Event form ────────────────────────────────────────────────────────────────

function EventForm({ monitors, initial, onSave, onCancel, t }) {
  const toLocal = (iso) => iso ? iso.slice(0, 16) : '';
  const [name,       setName]       = useState(initial?.name     ?? '');
  const [startAt,    setStartAt]    = useState(toLocal(initial?.startAt));
  const [endAt,      setEndAt]      = useState(toLocal(initial?.endAt));
  const [note,       setNote]       = useState(initial?.note      ?? '');
  const [monitorIds, setMonitorIds] = useState(initial?.monitorIds ?? []);
  const [error,      setError]      = useState('');

  const toggleMonitor = (id) =>
    setMonitorIds(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);

  const handleSave = () => {
    if (!name.trim())  { setError('Name is required'); return; }
    if (!startAt)      { setError('Start time is required'); return; }
    if (!endAt)        { setError('End time is required'); return; }
    if (startAt >= endAt) { setError('End must be after start'); return; }
    setError('');
    onSave({
      name: name.trim(),
      note: note.trim(),
      startAt: new Date(startAt).toISOString(),
      endAt:   new Date(endAt).toISOString(),
      monitorIds,
    });
  };

  return (
    <div className="wt-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <span className="wt-eyebrow">{initial ? 'Edit Event' : 'New Maintenance Event'}</span>
        <button onClick={onCancel} className="wt-btn wt-btn--ghost wt-btn--sm"><X size={14} /></button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs wt-mono" style={{ color: 'var(--wt-down-600)' }}>
          <AlertCircle size={12} />{error}
        </div>
      )}

      <div className="wt-field">
        <label className="wt-label">Event name</label>
        <input className="wt-input wt-mono" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Database maintenance, Server restart" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="wt-field">
          <label className="wt-label">Start</label>
          <input type="datetime-local" className="wt-input wt-mono" value={startAt}
            onChange={e => setStartAt(e.target.value)} />
        </div>
        <div className="wt-field">
          <label className="wt-label">End</label>
          <input type="datetime-local" className="wt-input wt-mono" value={endAt}
            onChange={e => setEndAt(e.target.value)} />
        </div>
      </div>

      <div className="wt-field">
        <label className="wt-label">Note <span style={{ color: t.textFaint }}>(optional)</span></label>
        <textarea className="wt-input wt-mono" rows={2} value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Describe what's happening during this window…" />
      </div>

      <div className="wt-field">
        <label className="wt-label">Affected monitors</label>
        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
          {monitors.length === 0 ? (
            <p className="text-xs wt-mono" style={{ color: t.textFaint }}>No monitors configured</p>
          ) : monitors.map(m => (
            <label key={m.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-[var(--wt-surface-2)] transition-colors">
              <input type="checkbox" checked={monitorIds.includes(m.id)}
                onChange={() => toggleMonitor(m.id)}
                className="w-3.5 h-3.5 rounded accent-[var(--wt-brand-500)]" />
              <span className="text-sm" style={{ color: t.textPrimary }}>{m.label}</span>
              <span className="wt-mono text-xs ml-auto" style={{ color: t.textFaint }}>{m.target}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="wt-btn wt-btn--ghost wt-btn--sm">Cancel</button>
        <button onClick={handleSave} className="wt-btn wt-btn--primary wt-btn--sm">
          <Check size={13} />{initial ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </div>
  );
}

// ── MaintenancePage ───────────────────────────────────────────────────────────

export function MaintenancePage({ monitors }) {
  const { t } = useTheme();
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [editEvent, setEditEvent] = useState(null);
  const [filter,    setFilter]    = useState('all'); // 'all' | 'active' | 'upcoming' | 'past'

  const load = useCallback(() => {
    fetch('/api/maintenance')
      .then(r => r.json())
      .then(data => { setEvents(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async (payload) => {
    await fetch('/api/maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setShowForm(false);
    load();
  };

  const update = async (id, payload) => {
    await fetch(`/api/maintenance/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setEditEvent(null);
    load();
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this maintenance event?')) return;
    await fetch(`/api/maintenance/${id}`, { method: 'DELETE' });
    load();
  };

  const filtered = events.filter(e => {
    const s = eventStatus(e);
    if (filter === 'all') return true;
    return s === filter;
  });

  const userMonitors = monitors.filter(m => !m.tags?.includes('_ref'));

  return (
    <div>
      {/* Header */}
      <div className="section-head flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="wt-eyebrow">Maintenance</span>
          {events.filter(e => eventStatus(e) === 'active').length > 0 && (
            <span className="wt-mono text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ backgroundColor: MAINTENANCE_COLOR_BG, color: MAINTENANCE_COLOR }}>
              {events.filter(e => eventStatus(e) === 'active').length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="wt-seg">
            <button aria-selected={filter === 'all'}      onClick={() => setFilter('all')}>All</button>
            <button aria-selected={filter === 'upcoming'} onClick={() => setFilter('upcoming')}>Upcoming</button>
            <button aria-selected={filter === 'active'}   onClick={() => setFilter('active')}>Active</button>
            <button aria-selected={filter === 'past'}     onClick={() => setFilter('past')}>Past</button>
          </div>
          <button onClick={() => { setShowForm(true); setEditEvent(null); }}
            className="wt-btn wt-btn--primary wt-btn--sm">
            <Plus size={13} /> New event
          </button>
        </div>
      </div>

      {/* Form */}
      {(showForm || editEvent) && (
        <div className="mb-5">
          <EventForm
            monitors={userMonitors}
            initial={editEvent}
            onSave={editEvent ? (p) => update(editEvent.id, p) : create}
            onCancel={() => { setShowForm(false); setEditEvent(null); }}
            t={t}
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="py-16 text-center wt-mono text-xs" style={{ color: t.textFaint }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <Wrench size={36} style={{ color: t.textFaint, opacity: 0.4 }} />
          <p className="text-sm font-medium" style={{ color: t.textMuted }}>
            {filter === 'all' ? 'No maintenance events' : `No ${filter} events`}
          </p>
          {filter === 'all' && (
            <p className="text-xs" style={{ color: t.textFaint }}>
              Create an event to flag expected downtime on affected monitors
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(event => {
            const status      = eventStatus(event);
            const affectedMonitors = userMonitors.filter(m => event.monitorIds?.includes(m.id));
            return (
              <div key={event.id} className="wt-card p-4 space-y-3"
                style={status === 'active' ? { borderLeftWidth: 3, borderLeftColor: MAINTENANCE_COLOR } : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" style={{ color: t.textPrimary }}>{event.name}</span>
                      <StatusBadge status={status} />
                    </div>
                    <div className="wt-mono text-xs flex flex-wrap gap-x-4 gap-y-0.5" style={{ color: t.textMuted }}>
                      <span>{formatDt(event.startAt)}</span>
                      <span style={{ color: t.textFaint }}>→</span>
                      <span>{formatDt(event.endAt)}</span>
                    </div>
                    {event.note && (
                      <p className="text-xs leading-relaxed" style={{ color: t.textMuted }}>{event.note}</p>
                    )}
                  </div>
                  {status !== 'past' && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditEvent(event); setShowForm(false); }}
                        className="wt-btn wt-btn--ghost wt-btn--sm" title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => remove(event.id)}
                        className="wt-btn wt-btn--ghost wt-btn--sm" title="Delete"
                        style={{ color: 'var(--wt-down-500)' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
                {affectedMonitors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {affectedMonitors.map(m => (
                      <span key={m.id} className="wt-chip wt-chip--plain" style={{ fontSize: 11 }}>{m.label}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
