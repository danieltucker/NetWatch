import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Radio, Activity, AlertTriangle, Bell, Tag as TagIcon, Settings, Code, X, Menu, Search, Zap, Calendar, LayoutGrid, List, AlertCircle as IncidentIcon } from 'lucide-react';
import {
  DndContext, closestCenter,
  KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates,
  rectSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useMonitors }         from './hooks/useMonitors';
import { useAlerts }           from './hooks/useAlerts';
import { useTheme }            from './hooks/useTheme';
import { useCardLayout }       from './hooks/useCardLayout';
import { useModuleInstances }  from './hooks/useModuleInstances';
import { SummaryBar }          from './components/SummaryBar';
import { ConsolePanel }        from './components/ConsolePanel';
import { MonitorCard }         from './components/MonitorCard';
import { StatusDot }           from './components/StatusIndicators';
import { ModuleCard }          from './components/ModuleCard';
import { MonitorForm }         from './components/MonitorForm';
import { ModuleInstanceForm }  from './components/ModuleInstanceForm';
import { AlertsBanner }        from './components/AlertsBanner';
import { IncidentsPage }       from './components/IncidentsPage';
import { SettingsPanel }       from './components/SettingsPanel';
import { EmbedModal }          from './components/EmbedModal';
import { MonitorDetailModal }  from './components/MonitorDetailModal';
import { moduleRegistry }      from './modules/index.js';

// ── Sortable card wrapper ─────────────────────────────────────────────────────

function SortableMonitorCard({ monitor, onEdit, onCardClick, onIncidentClick, width, sortEnabled, chartYMax }) {
  const id = String(monitor.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortEnabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={width === 2 ? 'md:col-span-2' : ''}>
      <MonitorCard
        monitor={monitor}
        onEdit={onEdit}
        onCardClick={onCardClick}
        onIncidentClick={onIncidentClick}
        dragHandleProps={sortEnabled ? { ...attributes, ...listeners } : undefined}
        isDragging={isDragging}
        chartYMax={chartYMax}
      />
    </div>
  );
}

const HISTORY_PRESETS = [
  { label: '15m', value: '15m' },
  { label: '1h',  value: '1h'  },
  { label: '6h',  value: '6h'  },
  { label: '12h', value: '12h' },
  { label: '1d',  value: '1d'  },
  { label: '1w',  value: '1w'  },
  { label: '30d', value: '30d' },
];

const SORT_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'Status',  value: 'status'  },
  { label: 'Uptime',  value: 'uptime'  },
  { label: 'Name',    value: 'name'    },
  { label: 'Slowest', value: 'ping'    },
];

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const { isDark, t } = useTheme();

  // One-time migration: move wt- prefixed keys to nw- on first load
  useEffect(() => {
    try {
      const oldWindow = localStorage.getItem('wt-history-window');
      if (oldWindow && !localStorage.getItem('nw-history-window')) {
        localStorage.setItem('nw-history-window', oldWindow);
        localStorage.removeItem('wt-history-window');
      }
      const oldYMax = localStorage.getItem('wt-chart-y-max');
      if (oldYMax && !localStorage.getItem('nw-chart-y-max')) {
        localStorage.setItem('nw-chart-y-max', oldYMax);
        localStorage.removeItem('wt-chart-y-max');
      }
    } catch {}
  }, []);

  // historyRange: { type:'preset', value:'1h' }
  //             | { type:'custom', from:ISO, to:ISO }
  //             | { type:'zoom',   from:ISO, to:ISO, incidentAt:ISO }
  const [historyRange, setHistoryRange] = useState(() => {
    try {
      const saved = localStorage.getItem('nw-history-range');
      if (saved) { const p = JSON.parse(saved); if (p.type === 'preset') return p; }
      // Fall back to migrated window key
      const w = localStorage.getItem('nw-history-window') || localStorage.getItem('wt-history-window');
      if (w) return { type: 'preset', value: w };
    } catch {}
    return { type: 'preset', value: '1h' };
  });

  // Derive a plain window string for cases that still need it (SSE comparison etc.)
  const historyWindow = historyRange.type === 'preset' ? historyRange.value : 'custom';

  const { monitors, loading, error, addMonitor, updateMonitor, deleteMonitor, refresh } =
    useMonitors(historyWindow, historyRange);

  const [alertsAutoOpen, setAlertsAutoOpen] = useState(() => {
    try { return localStorage.getItem('nw-alerts-auto-open') || 'outage'; }
    catch { return 'outage'; }
  });

  const { alerts, dismiss: dismissAlert, dismissAll } = useAlerts((alert) => {
    if (alertsAutoOpen === 'never') return;
    if (alertsAutoOpen === 'outage' && alert.type !== 'outage') return;
    setAlertsExpanded(true);
  });
  const { instances, addInstance, updateInstance, deleteInstance } = useModuleInstances();

  const [showForm,       setShowForm]       = useState(false);
  const [submitting,     setSubmitting]     = useState(false);
  const [formError,      setFormError]      = useState('');
  const [pageError,      setPageError]      = useState('');
  const [detailMonitor,    setDetailMonitor]    = useState(null);
  const [detailTab,        setDetailTab]        = useState('history');
  const [incidentTimestamp, setIncidentTimestamp] = useState(null);
  const [addingFor,      setAddingFor]      = useState(null); // moduleId for new instance form
  const [instanceSubmitting, setInstanceSubmitting] = useState(false);
  const [instanceError,  setInstanceError]  = useState('');
  const [tagFilter,      setTagFilter]      = useState([]);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [statusFilter,   setStatusFilter]   = useState('all');
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [view,           setView]           = useState('monitors'); // 'monitors' | 'incidents'
  const [viewMode,       setViewMode]       = useState('grid');     // 'grid' | 'list'
  const [sortBy,         setSortBy]         = useState('default');
  const [showSettings,    setShowSettings]    = useState(false);
  const [embedMonitor,    setEmbedMonitor]    = useState(null);
  const [editingInstance, setEditingInstance] = useState(null);  // module instance being edited
  const [mobileMenuOpen,  setMobileMenuOpen]  = useState(false);
  const [chartYMax, setChartYMax] = useState(() => {
    try { return localStorage.getItem('nw-chart-y-max') || localStorage.getItem('wt-chart-y-max') || 'auto'; }
    catch { return 'auto'; }
  });

  const { moveCard, sortMonitors, getWidth, setWidth } = useCardLayout();

  const handleChartYMaxChange = (val) => {
    setChartYMax(val);
    try { localStorage.setItem('nw-chart-y-max', val); }
    catch {}
  };

  // ── Persist preset history range choice ──────────────────────────────────
  useEffect(() => {
    if (historyRange.type === 'preset') {
      try { localStorage.setItem('nw-history-range', JSON.stringify(historyRange)); } catch {}
    }
  }, [historyRange]);


  // ── Derived data ──────────────────────────────────────────────────────────
  const userMonitors = monitors.filter(m => !m.tags?.includes('_ref'));
  const refMonitors  = monitors.filter(m =>  m.tags?.includes('_ref'));

  // All unique tags from user monitors (never includes _ref)
  const allTags = [...new Set(userMonitors.flatMap(m => m.tags ?? []))].sort();

  const baseFiltered = tagFilter.length === 0
    ? userMonitors
    : userMonitors.filter(m => tagFilter.some(tag => m.tags?.includes(tag)));

  const filteredMonitors = (() => {
    let list = baseFiltered;

    // Text search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(m =>
        m.label.toLowerCase().includes(q) ||
        m.target.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (statusFilter === 'down') {
      list = list.filter(m => m.status === 'down');
    } else if (statusFilter === 'degraded') {
      list = list.filter(m =>
        m.status === 'degraded' ||
        (m.status === 'up' && m.degradedThreshold != null &&
         m.currentPing != null && m.currentPing > m.degradedThreshold)
      );
    } else if (statusFilter === 'up') {
      list = list.filter(m => m.status === 'up');
    } else if (statusFilter === 'pending') {
      list = list.filter(m => m.status === 'pending');
    }

    // Sort
    if (sortBy === 'status') {
      const rank = { down: 0, degraded: 1, pending: 2, up: 3 };
      return list.slice().sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2));
    }
    if (sortBy === 'uptime') {
      return list.slice().sort((a, b) => (a.uptimePercent ?? 100) - (b.uptimePercent ?? 100));
    }
    if (sortBy === 'name') {
      return list.slice().sort((a, b) => a.label.localeCompare(b.label));
    }
    if (sortBy === 'ping') {
      return list.slice().sort((a, b) => {
        if (a.currentPing == null && b.currentPing == null) return 0;
        if (a.currentPing == null) return 1;
        if (b.currentPing == null) return -1;
        return b.currentPing - a.currentPing;
      });
    }
    // 'default': apply saved manual order
    return sortMonitors(list);
  })();

  // Drag-and-drop — only active in default sort mode
  const sortEnabled = sortBy === 'default';
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }) => {
    if (over && active.id !== over.id) {
      moveCard(active.id, over.id, filteredMonitors.map(m => m.id));
    }
  };

  // Active = unresolved and not dismissed
  const ongoingCount = alerts.filter(a => !a.resolvedAt && !a.dismissedAt).length;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openAdd    = () => { setFormError(''); setShowForm(true); };
  const closeForm  = () => { setShowForm(false); setFormError(''); };
  const openDetail = useCallback((m, tab = 'history') => {
    setDetailMonitor(m);
    setDetailTab(tab);
  }, []);

  // Defined after openDetail to avoid temporal dead zone — openDetail is a
  // const so referencing it before this line would cause a ReferenceError.
  const handleIncidentClick = useCallback((mon, timestamp) => {
    setIncidentTimestamp(timestamp);
    openDetail(mon, 'incidents');
  }, [openDetail]);

  const handleAddModule = (moduleId) => {
    closeForm();
    setInstanceError('');
    setAddingFor(moduleId);
  };

  const handleAddInstance = async (payload) => {
    setInstanceSubmitting(true);
    setInstanceError('');
    try {
      await addInstance(payload);
      setAddingFor(null);
    } catch (err) {
      setInstanceError(err.message);
    } finally {
      setInstanceSubmitting(false);
    }
  };

  const handleFormSubmit = async (data) => {
    setSubmitting(true);
    setFormError('');
    try {
      await addMonitor(data);
      closeForm();
    } catch (err) {
      console.error('[netwatch] save failed:', err);
      setFormError(`Failed to save monitor: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTag = (tag) =>
    setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Sidebar status rows with live counts from user monitors
  const statusRows = [
    { label: 'All',      value: 'all',      status: null,       count: userMonitors.length },
    { label: 'Up',       value: 'up',       status: 'up',       count: userMonitors.filter(m => m.status === 'up').length },
    { label: 'Degraded', value: 'degraded', status: 'degraded', count: userMonitors.filter(m => m.status === 'degraded' || (m.status === 'up' && m.degradedThreshold != null && m.currentPing != null && m.currentPing > m.degradedThreshold)).length },
    { label: 'Down',     value: 'down',     status: 'down',     count: userMonitors.filter(m => m.status === 'down').length },
    { label: 'Paused',   value: 'pending',  status: 'pending',  count: userMonitors.filter(m => m.status === 'pending').length },
  ];

  return (
    <div className="app">

      {/* ── Console (always mounted, toggled with `) ─────────────────────────── */}
      <ConsolePanel monitors={monitors} onRefresh={refresh} />

      {/* ── Page-level error toast ───────────────────────────────────────────── */}
      {pageError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border text-xs wt-mono shadow-lg"
          style={{ backgroundColor: 'var(--wt-down-50)', borderColor: 'color-mix(in oklch, var(--wt-down-500) 40%, transparent)', color: 'var(--wt-down-600)', maxWidth: '480px' }}>
          <AlertTriangle size={13} className="shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError('')} className="opacity-60 hover:opacity-100 ml-1">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Topbar ── */}
      <div className="app__top">
        <span className="wt-appicon" style={{ '--ai-size': '30px', '--ai-from': 'var(--nw-from)', '--ai-to': 'var(--nw-to)' }}>
          <Radio />
        </span>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em', color: 'var(--wt-text)' }}>
          Net<span style={{ color: 'var(--nw-ink)' }}>Watch</span>
        </span>
        <span className="wt-chip wt-chip--plain">v6.7.0</span>

        <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
          {/* live indicator */}
          <div className="hidden wide:flex items-center gap-1.5 mr-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: 'var(--wt-up-500)', opacity: 0.5 }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'var(--wt-up-500)' }} />
            </span>
            <span className="wt-mono text-xs" style={{ color: 'var(--wt-text-faint)' }}>live</span>
          </div>

          {/* search — desktop */}
          <div className="hidden wide:block"><MonitorSearch value={searchQuery} onChange={setSearchQuery} t={t} /></div>

          {/* ghost icon buttons — desktop */}
          <div className="hidden wide:flex items-center gap-1">
            <button onClick={() => setAlertsExpanded(p => !p)} className="wt-btn wt-btn--ghost wt-btn--sm relative" title="Alerts"
              style={ongoingCount > 0 ? { color: 'var(--wt-down-600)' } : undefined}>
              <Bell size={16} />
              {ongoingCount > 0 && (
                <span className="wt-mono absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--wt-down-500)', color: '#fff', fontSize: 9, fontWeight: 700 }}>{ongoingCount}</span>
              )}
            </button>
            <button onClick={() => setEmbedMonitor(undefined)} className="wt-btn wt-btn--ghost wt-btn--sm" title="Embed dashboard"><Code size={16} /></button>
            <button onClick={() => setShowSettings(true)} className="wt-btn wt-btn--ghost wt-btn--sm" title="Settings"><Settings size={16} /></button>
          </div>

          <button onClick={openAdd} className="hidden wide:inline-flex wt-btn wt-btn--primary"><Plus size={15} />Add monitor</button>

          {/* mobile: alerts + hamburger */}
          <button onClick={() => setAlertsExpanded(p => !p)} className="wide:hidden wt-btn wt-btn--ghost wt-btn--sm relative" title="Alerts"
            style={ongoingCount > 0 ? { color: 'var(--wt-down-600)' } : undefined}>
            <Bell size={16} />
            {ongoingCount > 0 && (
              <span className="wt-mono absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center"
                style={{ backgroundColor: 'var(--wt-down-500)', color: '#fff', fontSize: 9, fontWeight: 700 }}>{ongoingCount}</span>
            )}
          </button>
          <button onClick={() => setMobileMenuOpen(p => !p)} className="wide:hidden wt-btn wt-btn--ghost wt-btn--sm" title="Menu">
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* ── Sidebar ── */}
      <aside className={`app__side ${mobileMenuOpen ? 'is-open' : ''}`}>
        {/* mobile-only quick actions */}
        <div className="wide:hidden flex items-center gap-2 mb-3">
          <button onClick={() => { openAdd(); setMobileMenuOpen(false); }} className="wt-btn wt-btn--primary wt-btn--sm"><Plus size={14} />Add</button>
          <button onClick={() => { setEmbedMonitor(undefined); setMobileMenuOpen(false); }} className="wt-btn wt-btn--ghost wt-btn--sm" title="Embed"><Code size={14} /></button>
          <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }} className="wt-btn wt-btn--ghost wt-btn--sm" title="Settings"><Settings size={14} /></button>
        </div>

        {/* STATUS */}
        <div className="side__group">Status</div>
        {statusRows.map(row => (
          <button key={row.value} className={`side__item ${statusFilter === row.value ? 'is-active' : ''}`}
            onClick={() => { setStatusFilter(row.value); setMobileMenuOpen(false); }}>
            {row.status ? <StatusDot status={row.status} /> : <span style={{ width: 7, height: 7 }} />}
            <span>{row.label}</span>
            <span className="side__item__count">{row.count}</span>
          </button>
        ))}

        {/* VIEWS */}
        <div className="side__group">Views</div>
        <button className={`side__item ${view === 'monitors' ? 'is-active' : ''}`}
          onClick={() => { setView('monitors'); setMobileMenuOpen(false); }}>
          <Activity size={12} style={{ flexShrink: 0 }} />
          <span>Monitors</span>
          <span className="side__item__count">{userMonitors.length}</span>
        </button>
        <button className={`side__item ${view === 'incidents' ? 'is-active' : ''}`}
          onClick={() => { setView('incidents'); setMobileMenuOpen(false); }}>
          <IncidentIcon size={12} style={{ flexShrink: 0 }} />
          <span>Incidents</span>
          {alerts.filter(a => !a.resolvedAt).length > 0 && (
            <span className="side__item__count" style={{ color: 'var(--wt-down-500)' }}>
              {alerts.filter(a => !a.resolvedAt).length}
            </span>
          )}
        </button>

        {/* TAGS */}
        {allTags.length > 0 && (
          <>
            <div className="side__group flex items-center justify-between">
              <span>Tags</span>
              {tagFilter.length > 0 && (
                <button onClick={() => setTagFilter([])} className="wt-btn wt-btn--ghost wt-btn--sm" style={{ padding: '0 4px' }}>clear</button>
              )}
            </div>
            {allTags.map(tag => (
              <button key={tag} className={`side__item ${tagFilter.includes(tag) ? 'is-active' : ''}`} onClick={() => toggleTag(tag)}>
                <TagIcon size={12} />
                <span className="truncate">{tag}</span>
                <span className="side__item__count">{userMonitors.filter(m => m.tags?.includes(tag)).length}</span>
              </button>
            ))}
          </>
        )}

        {/* SORT */}
        <div className="side__group">Sort</div>
        <select className="wt-select" value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ fontSize: 13 }}>
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* HISTORY */}
        <div className="side__group">History</div>
        <HistoryRangeControl historyRange={historyRange} onChange={setHistoryRange} t={t} isDark={isDark} />
      </aside>

      {/* ── Main ── */}
      <main className="app__main">

        {/* Alerts banner — persistent, self-hides when no alerts */}
        <AlertsBanner
          alerts={alerts}
          onDismiss={dismissAlert}
          onDismissAll={dismissAll}
          expanded={alertsExpanded}
          onToggle={() => setAlertsExpanded(p => !p)}
        />

        {loading && <LoadingState t={t} />}
        {error   && <ErrorState  message={error} t={t} />}

        {!loading && !error && view === 'incidents' && (
          <IncidentsPage
            monitors={userMonitors}
            onOpenDetail={(mon, tab, ts) => {
              setIncidentTimestamp(ts ?? null);
              openDetail(mon, tab);
            }}
          />
        )}

        {!loading && !error && view === 'monitors' && (
          <>
            {userMonitors.length > 0 && <SummaryBar monitors={userMonitors} />}

            {/* ── Monitors ── */}
            <section>
              <div className="section-head flex items-center justify-between">
                <span className="wt-eyebrow">Monitors</span>
                {userMonitors.length > 0 && (
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => setViewMode('grid')}
                      className="wt-btn wt-btn--ghost wt-btn--sm"
                      title="Card view"
                      style={viewMode === 'grid' ? { color: 'var(--nw-ink)', background: 'color-mix(in oklch, var(--nw-ink) 12%, transparent)' } : undefined}>
                      <LayoutGrid size={14} />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className="wt-btn wt-btn--ghost wt-btn--sm"
                      title="List view"
                      style={viewMode === 'list' ? { color: 'var(--nw-ink)', background: 'color-mix(in oklch, var(--nw-ink) 12%, transparent)' } : undefined}>
                      <List size={14} />
                    </button>
                  </div>
                )}
              </div>

            {/* Monitor grid or list */}
            {userMonitors.length === 0 ? (
              <EmptyState onAdd={openAdd} t={t} />
            ) : filteredMonitors.length === 0 ? (
              <div className="py-12 text-center text-xs" style={{ color: t.textMuted }}>
                No monitors match the selected filters
              </div>
            ) : viewMode === 'list' ? (
              <MonitorListView
                monitors={filteredMonitors}
                onCardClick={mon => openDetail(mon, 'history')}
                onEdit={mon => openDetail(mon, 'configure')}
                t={t}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}>
                <SortableContext
                  items={filteredMonitors.map(m => String(m.id))}
                  strategy={rectSortingStrategy}>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredMonitors.map(m => (
                      <SortableMonitorCard
                        key={m.id}
                        monitor={m}
                        onEdit={mon => openDetail(mon, 'configure')}
                        onCardClick={mon => openDetail(mon, 'history')}
                        onIncidentClick={handleIncidentClick}
                        width={getWidth(m.id)}
                        sortEnabled={sortEnabled}
                        chartYMax={chartYMax}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            </section>

            {/* ── Module instances ── */}
            {instances.length > 0 && (
              <section className="mt-6">
                <div className="section-head"><span className="wt-eyebrow">Modules</span></div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {instances.filter(i => i.enabled).map(inst => (
                    <ModuleCard key={inst.id} instance={inst} onEdit={setEditingInstance} onDelete={deleteInstance} />
                  ))}
                </div>
              </section>
            )}

            {/* ── Network Reference ── */}
            {refMonitors.length > 0 && (
              <section className="mt-6">
                <div className="section-head"><span className="wt-eyebrow">Reference</span></div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {refMonitors.map(m => <MonitorCard key={m.id} monitor={m} compact />)}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* ── Modals / panels ─────────────────────────────────────────────────── */}
      {showForm && (
        <MonitorForm
          editingMonitor={null}
          onSubmit={handleFormSubmit}
          onCancel={closeForm}
          submitting={submitting}
          allTags={allTags}
          error={formError}
          availableModules={[...moduleRegistry.values()]}
          onAddModule={handleAddModule}
        />
      )}

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          chartYMax={chartYMax}
          onChartYMaxChange={handleChartYMaxChange}
          alertsAutoOpen={alertsAutoOpen}
          onAlertsAutoOpenChange={(val) => {
            setAlertsAutoOpen(val);
            try { localStorage.setItem('nw-alerts-auto-open', val); } catch {}
          }}
        />
      )}

      {addingFor && (
        <ModuleInstanceForm
          moduleDef={moduleRegistry.get(addingFor)}
          instance={null}
          onSubmit={handleAddInstance}
          onCancel={() => { setAddingFor(null); setInstanceError(''); }}
          submitting={instanceSubmitting}
          error={instanceError}
        />
      )}

      {editingInstance && (
        <ModuleInstanceForm
          moduleDef={moduleRegistry.get(editingInstance.moduleId)}
          instance={editingInstance}
          onSubmit={async (data) => {
            await updateInstance(editingInstance.id, data);
            setEditingInstance(null);
          }}
          onCancel={() => setEditingInstance(null)}
          submitting={false}
        />
      )}

      {embedMonitor !== null && (
        <EmbedModal
          monitor={embedMonitor}
          onClose={() => setEmbedMonitor(null)}
        />
      )}

      {detailMonitor && (
        <MonitorDetailModal
          monitor={monitors.find(m => m.id === detailMonitor.id) ?? detailMonitor}
          initialTab={detailTab}
          initialIncidentTimestamp={incidentTimestamp}
          onClose={() => { setDetailMonitor(null); setIncidentTimestamp(null); }}
          onSave={updateMonitor}
          onDelete={deleteMonitor}
          width={getWidth(detailMonitor.id)}
          onSetWidth={(w) => setWidth(detailMonitor.id, w)}
          allTags={allTags}
        />
      )}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

const CHECK_LABELS = { http: 'HTTP', api: 'API', tcp: 'TCP', icmp: 'ICMP' };

function MonitorListView({ monitors, onCardClick, onEdit, t }) {
  return (
    <div className="wt-card overflow-hidden">
      {monitors.map((m, i) => {
        const isLast = i === monitors.length - 1;
        const uptimeColor = m.uptimePercent == null ? t.textFaint
          : m.uptimePercent >= 99  ? 'var(--wt-up-600)'
          : m.uptimePercent >= 95  ? 'var(--wt-warn-600)'
          : 'var(--wt-down-600)';
        const pingColor = m.status === 'down' ? 'var(--wt-down-600)'
          : m.status === 'degraded' ? 'var(--wt-warn-600)'
          : t.textPrimary;

        return (
          <div
            key={m.id}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
            style={{
              borderBottom: isLast ? 'none' : `1px solid var(--wt-border)`,
            }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--wt-surface-2)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
            onClick={() => onCardClick(m)}>

            {/* Status dot */}
            <StatusDot status={m.status} />

            {/* Name */}
            <span className="flex-1 min-w-0 text-sm font-medium truncate" style={{ color: t.textPrimary }}>
              {m.label}
            </span>

            {/* Check type chip */}
            <span className="wt-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0"
              style={{ color: t.textFaint, borderColor: 'var(--wt-border)', fontSize: 10 }}>
              {CHECK_LABELS[m.checkType] ?? (m.checkType ?? 'HTTP').toUpperCase()}
            </span>

            {/* Ping */}
            <span className="wt-mono text-xs w-16 text-right shrink-0" style={{ color: pingColor }}>
              {m.currentPing != null ? `${m.currentPing}ms` : '—'}
            </span>

            {/* Uptime */}
            <span className="wt-mono text-xs w-14 text-right shrink-0" style={{ color: uptimeColor }}>
              {m.uptimePercent != null ? `${m.uptimePercent.toFixed(1)}%` : '—'}
            </span>

            {/* Last checked */}
            <span className="wt-mono text-xs w-24 text-right shrink-0 hidden md:block" style={{ color: t.textFaint }}>
              {m.lastChecked
                ? new Date(m.lastChecked).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
                : '—'}
            </span>

            {/* Tags */}
            {m.tags?.filter(tag => tag !== '_ref').length > 0 && (
              <div className="hidden lg:flex items-center gap-1 shrink-0">
                {m.tags.filter(tag => tag !== '_ref').slice(0, 2).map(tag => (
                  <span key={tag} className="wt-chip wt-chip--plain" style={{ fontSize: 10 }}>{tag}</span>
                ))}
                {m.tags.filter(tag => tag !== '_ref').length > 2 && (
                  <span className="wt-mono text-xs" style={{ color: t.textFaint }}>
                    +{m.tags.filter(tag => tag !== '_ref').length - 2}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Toolbar sub-components ────────────────────────────────────────────────────

function MonitorSearch({ value, onChange }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape' && document.activeElement === ref.current) {
        onChange('');
        ref.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onChange]);

  return (
    <div className="relative flex items-center" style={{ width: 240 }}>
      <Search size={13} className="absolute left-2.5 pointer-events-none" style={{ color: 'var(--wt-text-faint)' }} />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search monitors…"
        className="wt-input"
        style={{ paddingLeft: 30, paddingRight: value ? 28 : 12, height: 32 }}
      />
      {value && (
        <button onClick={() => onChange('')}
          className="absolute right-2 opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--wt-text-muted)' }} title="Clear (Esc)">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// History windows surfaced as a 5-option segmented control (+ custom range).
const SEG_WINDOWS = [
  { label: '1H',  value: '1h'  },
  { label: '6H',  value: '6h'  },
  { label: '24H', value: '1d'  },
  { label: '7D',  value: '1w'  },
  { label: '30D', value: '30d' },
];

function HistoryRangeControl({ historyRange, onChange, t, isDark }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom,  setDraftFrom]  = useState('');
  const [draftTo,    setDraftTo]    = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouse = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setPickerOpen(false); };
    const onKey   = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onMouse); document.removeEventListener('keydown', onKey); };
  }, [pickerOpen]);

  const isRangeActive = historyRange.type === 'custom' || historyRange.type === 'zoom';
  const isZoom        = historyRange.type === 'zoom';
  const activeValue   = historyRange.type === 'preset' ? historyRange.value : null;

  const selectPreset = (value) => { onChange({ type: 'preset', value }); setPickerOpen(false); };
  const clearRange   = () => { onChange({ type: 'preset', value: '1h' }); setPickerOpen(false); };
  const applyCustom  = () => {
    if (!draftFrom || !draftTo) return;
    onChange({ type: 'custom', from: new Date(draftFrom).toISOString(), to: new Date(draftTo).toISOString() });
    setPickerOpen(false);
  };

  const rangeSummary = () => {
    if (isZoom) {
      const s = new Date(historyRange.incidentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
      return `${s} ±30m`;
    }
    const from = new Date(historyRange.from), to = new Date(historyRange.to);
    const f = from.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const tt = from.toDateString() === to.toDateString()
      ? to.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : to.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${f} – ${tt}`;
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div className="flex items-center gap-1">
        <div className="wt-seg" style={{ flex: 1 }}>
          {SEG_WINDOWS.map(w => (
            <button key={w.value} aria-selected={activeValue === w.value} onClick={() => selectPreset(w.value)}>
              {w.label}
            </button>
          ))}
        </div>
        <button onClick={() => setPickerOpen(p => !p)} className="wt-btn wt-btn--ghost wt-btn--sm" title="Custom range"
          style={isRangeActive ? { color: 'var(--nw-ink)', background: 'color-mix(in oklch, var(--nw-ink) 12%, transparent)' } : undefined}>
          <Calendar size={14} />
        </button>
      </div>

      {isRangeActive && (
        <div className="mt-1.5 flex items-center gap-1.5 wt-mono text-xs" style={{ color: isZoom ? 'var(--wt-warn-600)' : 'var(--nw-ink)' }}>
          {isZoom && <Zap size={10} />}
          <span className="truncate">{rangeSummary()}</span>
          <button onClick={clearRange} className="opacity-60 hover:opacity-100 shrink-0" title="Clear range"><X size={10} /></button>
        </div>
      )}

      {pickerOpen && (
        <div className="absolute top-full left-0 mt-1.5 z-30 rounded-lg border shadow-2xl p-3 space-y-2"
          style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder, minWidth: 240,
            boxShadow: isDark ? '0 16px 48px rgba(0,0,0,0.6)' : '0 16px 48px rgba(0,0,0,0.15)' }}>
          <div className="wt-eyebrow">Custom range</div>
          <div className="wt-field">
            <label className="wt-label" style={{ fontSize: 11 }}>From</label>
            <input type="datetime-local" className="wt-input wt-input--mono" value={draftFrom} onChange={e => setDraftFrom(e.target.value)} />
          </div>
          <div className="wt-field">
            <label className="wt-label" style={{ fontSize: 11 }}>To</label>
            <input type="datetime-local" className="wt-input wt-input--mono" value={draftTo} onChange={e => setDraftTo(e.target.value)} />
          </div>
          <button onClick={applyCustom} disabled={!draftFrom || !draftTo} className="wt-btn wt-btn--primary"
            style={{ width: '100%', justifyContent: 'center', opacity: (!draftFrom || !draftTo) ? 0.4 : 1 }}>
            Apply range
          </button>
        </div>
      )}
    </div>
  );
}

// ── State screens ─────────────────────────────────────────────────────────────

function LoadingState({ t }) {
  return (
    <div className="flex items-center justify-center py-36 gap-3 text-sm"
      style={{ color: t.textMuted }}>
      <span className="animate-spin">⟳</span> Connecting to server…
    </div>
  );
}

function ErrorState({ message, t }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={36} style={{ color: 'color-mix(in oklch, var(--wt-down-500) 60%, transparent)' }} />
      <p className="text-sm font-semibold" style={{ color: 'var(--wt-down-600)' }}>Cannot reach the NetWatch server</p>
      <p className="wt-mono text-xs" style={{ color: t.textMuted }}>{message}</p>
      <p className="text-xs mt-2" style={{ color: t.textFaint }}>
        Run <span className="wt-mono" style={{ color: t.textSecondary }}>npm run dev</span> inside{' '}
        <span className="wt-mono" style={{ color: t.textSecondary }}>server/</span> to start the backend.
      </p>
    </div>
  );
}

function EmptyState({ onAdd, t }) {
  return (
    <div className="flex flex-col items-center justify-center py-36 text-center">
      <div className="relative mb-6">
        <Activity size={52} style={{ color: t.textFaint }} />
        <span className="absolute -top-1 -right-1 flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: 'var(--wt-up-500)', opacity: 0.4 }} />
          <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: 'var(--wt-up-600)' }} />
        </span>
      </div>
      <p className="text-sm mb-1" style={{ color: t.textMuted }}>No monitors configured</p>
      <p className="text-xs" style={{ color: t.textFaint }}>
        Add an IP or domain to start tracking uptime
      </p>
      <button onClick={onAdd} className="wt-btn wt-btn--primary mt-8">
        <Plus size={15} />
        Add your first monitor
      </button>
    </div>
  );
}
