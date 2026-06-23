import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Radio, Activity, AlertTriangle, Bell, Tag as TagIcon, Settings, Code, X, Menu, Search, Zap, Calendar, LayoutGrid, List, AlertCircle as IncidentIcon, Wrench, Layers, RefreshCw, ChevronDown, ChevronRight, ArrowUp, ArrowDown, BarChart2 } from 'lucide-react';
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
import { MaintenancePage }     from './components/MaintenancePage';
import { ReportsPage }         from './components/ReportsPage';
import { SettingsPanel }       from './components/SettingsPanel';
import { EmbedModal }          from './components/EmbedModal';
import { MonitorDetailModal }  from './components/MonitorDetailModal';
import { moduleRegistry }      from './modules/index.js';

// ── Sortable card wrapper ─────────────────────────────────────────────────────

function SortableMonitorCard({ monitor, onEdit, onCardClick, onIncidentClick, width, sortEnabled, chartYMax, inMaintenance }) {
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
        inMaintenance={inMaintenance}
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

  const { monitors, loading, error, sseConnected, addMonitor, updateMonitor, deleteMonitor, refresh } =
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
  const [alertsExpanded,          setAlertsExpanded]          = useState(false);
  const [view,                    setView]                    = useState('monitors'); // 'monitors' | 'incidents' | 'maintenance'
  const [viewMode,                setViewMode]                = useState('grid');     // 'grid' | 'list'
  const [groupByEnabled,          setGroupByEnabled]          = useState(() => {
    try { return localStorage.getItem('nw-group-by') === 'true'; } catch { return false; }
  });
  const [groups,                  setGroups]                  = useState([]);
  const [maintenanceMonitorIds,   setMaintenanceMonitorIds]   = useState(new Set());
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

  // ── Fetch groups — on mount and whenever settings panel closes ───────────
  useEffect(() => {
    if (!showSettings) {
      fetch('/api/groups').then(r => r.json()).then(setGroups).catch(() => {});
    }
  }, [showSettings]);

  const handleMoveGroup = async (groupId, direction) => {
    const sorted = [...groups].sort((a, b) => a.displayOrder - b.displayOrder);
    const idx = sorted.findIndex(g => g.id === groupId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[swapIdx];
    setGroups(prev => prev.map(g => {
      if (g.id === a.id) return { ...g, displayOrder: b.displayOrder };
      if (g.id === b.id) return { ...g, displayOrder: a.displayOrder };
      return g;
    }));
    await Promise.all([
      fetch(`/api/groups/${a.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayOrder: b.displayOrder }) }),
      fetch(`/api/groups/${b.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayOrder: a.displayOrder }) }),
    ]);
  };

  // ── Poll active maintenance windows every minute ──────────────────────────
  useEffect(() => {
    const load = () => {
      fetch('/api/maintenance/active')
        .then(r => r.json())
        .then(events => {
          const ids = new Set(events.flatMap(e => e.monitorIds ?? []));
          setMaintenanceMonitorIds(ids);
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, []);


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
        <a href="https://github.com/danieltucker/NetWatch/releases/tag/v6.15.0" target="_blank" rel="noopener noreferrer" className="wt-chip wt-chip--plain" style={{ textDecoration: 'none' }}>v6.15.0</a>

        <div className="flex items-center gap-2" style={{ marginLeft: 'auto' }}>
          {/* live / offline indicator */}
          <div className="hidden wide:flex items-center gap-1.5 mr-1">
            {(error || sseConnected === false) ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'var(--wt-down-500)' }} />
                </span>
                <span className="wt-mono text-xs" style={{ color: 'var(--wt-down-600)' }}>offline</span>
              </>
            ) : (loading || sseConnected === null) ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-pulse relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'var(--wt-n-400)' }} />
                </span>
                <span className="wt-mono text-xs" style={{ color: 'var(--wt-text-faint)' }}>connecting</span>
              </>
            ) : (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: 'var(--wt-up-500)', opacity: 0.5 }} />
                  <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: 'var(--wt-up-500)' }} />
                </span>
                <span className="wt-mono text-xs" style={{ color: 'var(--wt-text-faint)' }}>live</span>
              </>
            )}
          </div>

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
      <aside
        className={`app__side ${mobileMenuOpen ? 'is-open' : ''}`}>
        {/* ── Scrollable content area ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }}>

        {/* Single rendering path — CSS drives collapsed vs expanded appearance.
            Items stay at identical Y positions in both states so nothing jumps on hover. */}

        {/* mobile-only quick actions */}
        <div className="wide:hidden flex items-center gap-2 mb-3">
          <button onClick={() => { openAdd(); setMobileMenuOpen(false); }} className="wt-btn wt-btn--primary wt-btn--sm"><Plus size={14} />Add</button>
          <button onClick={() => { setEmbedMonitor(undefined); setMobileMenuOpen(false); }} className="wt-btn wt-btn--ghost wt-btn--sm" title="Embed"><Code size={14} /></button>
          <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }} className="wt-btn wt-btn--ghost wt-btn--sm" title="Settings"><Settings size={14} /></button>
        </div>

        {/* VIEWS */}
        <div className="side__group">Views</div>
        <button className={`side__item ${view === 'monitors' ? 'is-active' : ''}`}
          onClick={() => { setView('monitors'); setMobileMenuOpen(false); }}>
          <Activity size={12} style={{ flexShrink: 0 }} />
          <span className="side__item__label">Monitors</span>
          <span className="side__item__count">{userMonitors.length}</span>
        </button>
        <button className={`side__item ${view === 'incidents' ? 'is-active' : ''}`}
          onClick={() => { setView('incidents'); setMobileMenuOpen(false); }}>
          <IncidentIcon size={12} style={{ flexShrink: 0 }} />
          <span className="side__item__label">Incidents</span>
          {alerts.filter(a => !a.resolvedAt).length > 0 && (
            <span className="side__item__count" style={{ color: 'var(--wt-down-500)' }}>
              {alerts.filter(a => !a.resolvedAt).length}
            </span>
          )}
        </button>
        <button className={`side__item ${view === 'maintenance' ? 'is-active' : ''}`}
          onClick={() => { setView('maintenance'); setMobileMenuOpen(false); }}>
          <Wrench size={12} style={{ flexShrink: 0 }} />
          <span className="side__item__label">Maintenance</span>
          {maintenanceMonitorIds.size > 0 && (
            <span className="side__item__count" style={{ color: 'var(--wt-viz-5)' }}>
              {maintenanceMonitorIds.size}
            </span>
          )}
        </button>
        <button className={`side__item ${view === 'reports' ? 'is-active' : ''}`}
          onClick={() => { setView('reports'); setMobileMenuOpen(false); }}>
          <BarChart2 size={12} style={{ flexShrink: 0 }} />
          <span className="side__item__label">Reports</span>
        </button>

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
                <span className="side__item__label truncate">{tag}</span>
                <span className="side__item__count">{userMonitors.filter(m => m.tags?.includes(tag)).length}</span>
              </button>
            ))}
          </>
        )}

        </div>{/* end scrollable content */}

      </aside>

      {/* ── Main ── */}
      <main className="app__main">

        {loading && <LoadingState t={t} />}
        {error   && <ErrorState  message={error} t={t} />}

        {!loading && !error && view === 'incidents' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-header__title">Incidents</div>
                <div className="page-header__subtitle">
                  {alerts.filter(a => !a.resolvedAt).length > 0
                    ? `${alerts.filter(a => !a.resolvedAt).length} active`
                    : 'All clear'}
                </div>
              </div>
            </div>
            <div className="px-6 pt-5">
              <AlertsBanner
                alerts={alerts}
                onDismiss={dismissAlert}
                onDismissAll={dismissAll}
                expanded={alertsExpanded}
                onToggle={() => setAlertsExpanded(p => !p)}
              />
            </div>
            <div className="px-6 py-5">
              <IncidentsPage
                alerts={alerts}
                monitors={userMonitors}
                onOpenDetail={(mon, tab, ts) => {
                  setIncidentTimestamp(ts ?? null);
                  openDetail(mon, tab);
                }}
              />
            </div>
          </>
        )}

        {!loading && !error && view === 'maintenance' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-header__title">Maintenance</div>
                <div className="page-header__subtitle">
                  {maintenanceMonitorIds.size > 0
                    ? `${maintenanceMonitorIds.size} monitor${maintenanceMonitorIds.size !== 1 ? 's' : ''} in maintenance`
                    : 'No active windows'}
                </div>
              </div>
            </div>
            <div className="px-6 pt-5">
              <AlertsBanner
                alerts={alerts}
                onDismiss={dismissAlert}
                onDismissAll={dismissAll}
                expanded={alertsExpanded}
                onToggle={() => setAlertsExpanded(p => !p)}
              />
            </div>
            <div className="px-6 py-5">
              <MaintenancePage monitors={monitors} />
            </div>
          </>
        )}

        {!loading && !error && view === 'reports' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-header__title">Reports</div>
                <div className="page-header__subtitle">Generate and export uptime reports</div>
              </div>
            </div>
            <div className="px-6 py-5">
              <ReportsPage />
            </div>
          </>
        )}

        {!loading && !error && view === 'monitors' && (
          <>
            {/* Page header */}
            <div className="page-header">
              <div>
                <div className="page-header__title">Monitors</div>
                <div className="page-header__subtitle">
                  {userMonitors.length} monitor{userMonitors.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden sm:block">
                  <HistoryRangeControl historyRange={historyRange} onChange={setHistoryRange} t={t} isDark={isDark} />
                </div>
                <button onClick={refresh} className="wt-btn wt-btn--ghost wt-btn--sm" title="Refresh">
                  <RefreshCw size={14} />
                </button>
              </div>
            </div>
            <div className="px-6 pt-5">
              <AlertsBanner
                alerts={alerts}
                onDismiss={dismissAlert}
                onDismissAll={dismissAll}
                expanded={alertsExpanded}
                onToggle={() => setAlertsExpanded(p => !p)}
              />
            </div>

            {/* Summary tiles */}
            {userMonitors.length > 0 && (
              <div className="px-6 pt-5 pb-2">
                <SummaryBar monitors={userMonitors} />
              </div>
            )}

            {/* Monitors toolbar */}
            {userMonitors.length > 0 && (
              <MonitorsToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                sortBy={sortBy}
                onSortBy={setSortBy}
                viewMode={viewMode}
                onViewMode={setViewMode}
                groupByEnabled={groupByEnabled}
                onToggleGroupBy={() => setGroupByEnabled(p => {
                  const n = !p;
                  try { localStorage.setItem('nw-group-by', String(n)); } catch {}
                  return n;
                })}
              />
            )}

            {/* Monitor grid or list */}
            <div className="px-6 py-5">
              {userMonitors.length === 0 ? (
                <EmptyState onAdd={openAdd} t={t} />
              ) : filteredMonitors.length === 0 ? (
                <div className="py-12 text-center text-xs" style={{ color: t.textMuted }}>
                  No monitors match the selected filters
                </div>
              ) : viewMode === 'list' ? (
                <MonitorListView
                  monitors={filteredMonitors}
                  groups={groupByEnabled ? groups : null}
                  onCardClick={mon => openDetail(mon, 'history')}
                  onEdit={mon => openDetail(mon, 'configure')}
                  t={t}
                />
              ) : groupByEnabled ? (
                <GroupedMonitorView
                  monitors={filteredMonitors}
                  groups={groups}
                  maintenanceMonitorIds={maintenanceMonitorIds}
                  onEdit={mon => openDetail(mon, 'configure')}
                  onCardClick={mon => openDetail(mon, 'history')}
                  onIncidentClick={handleIncidentClick}
                  getWidth={getWidth}
                  chartYMax={chartYMax}
                  onMoveGroup={handleMoveGroup}
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
                          inMaintenance={maintenanceMonitorIds.has(m.id)}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}

              {/* Module instances */}
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

              {/* Network Reference */}
              {refMonitors.length > 0 && (
                <section className="mt-6">
                  <div className="section-head"><span className="wt-eyebrow">Reference</span></div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {refMonitors.map(m => <MonitorCard key={m.id} monitor={m} compact />)}
                  </div>
                </section>
              )}
            </div>
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
          onImportSuccess={refresh}
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

function ListRow({ m, isLast, onCardClick, t }) {
  const uptimeColor = m.uptimePercent == null ? t.textFaint
    : m.uptimePercent >= 99  ? 'var(--wt-up-600)'
    : m.uptimePercent >= 95  ? 'var(--wt-warn-600)'
    : 'var(--wt-down-600)';
  const pingColor = m.status === 'down'     ? 'var(--wt-down-600)'
    : m.status === 'degraded' ? 'var(--wt-warn-600)'
    : t.textPrimary;
  const visibleTags = m.tags?.filter(tag => tag !== '_ref') ?? [];

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
      style={{ borderBottom: isLast ? 'none' : `1px solid var(--wt-border)` }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--wt-surface-2)'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
      onClick={() => onCardClick(m)}>

      {/* Status dot */}
      <StatusDot status={m.status} />

      {/* Name */}
      <span className="text-sm font-medium truncate min-w-0" style={{ color: t.textPrimary, flex: '1 1 0' }}>
        {m.label}
      </span>

      {/* Tags */}
      {visibleTags.length > 0 && (
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {visibleTags.slice(0, 2).map(tag => (
            <span key={tag} className="wt-chip wt-chip--plain" style={{ fontSize: 10 }}>{tag}</span>
          ))}
          {visibleTags.length > 2 && (
            <span className="wt-mono text-xs" style={{ color: t.textFaint }}>+{visibleTags.length - 2}</span>
          )}
        </div>
      )}

      {/* Check type */}
      <span className="wt-mono text-[10px] px-1.5 py-0.5 rounded border shrink-0"
        style={{ color: t.textFaint, borderColor: 'var(--wt-border)' }}>
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
    </div>
  );
}

function MonitorListView({ monitors, groups, onCardClick, onEdit, t }) {
  // Flat list (no grouping)
  if (!groups?.length) {
    return (
      <div className="wt-card overflow-hidden">
        {monitors.map((m, i) => (
          <ListRow key={m.id} m={m} isLast={i === monitors.length - 1} onCardClick={onCardClick} t={t} />
        ))}
      </div>
    );
  }

  // Grouped list
  const groupedIds   = new Set(groups.flatMap(g => g.monitorIds ?? []));
  const sorted       = [...groups].sort((a, b) => a.displayOrder - b.displayOrder);
  const ungrouped    = monitors.filter(m => !groupedIds.has(m.id));

  const renderSection = (label, items) => {
    if (!items.length) return null;
    return (
      <div key={label}>
        <div className="px-1 pb-2 pt-1">
          <span className="wt-eyebrow">{label}</span>
        </div>
        <div className="wt-card overflow-hidden">
          {items.map((m, i) => (
            <ListRow key={m.id} m={m} isLast={i === items.length - 1} onCardClick={onCardClick} t={t} />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {sorted.map(g => {
        const gMonitors = monitors.filter(m => g.monitorIds?.includes(m.id));
        return renderSection(g.name, gMonitors);
      })}
      {renderSection('Ungrouped', ungrouped)}
    </div>
  );
}

// ── Grouped monitor view ──────────────────────────────────────────────────────

function GroupedMonitorView({ monitors, groups, maintenanceMonitorIds, onEdit, onCardClick, onIncidentClick, getWidth, chartYMax, onMoveGroup }) {
  const [collapsedGroups, setCollapsedGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('nw-collapsed-groups') || '[]'); } catch { return []; }
  });

  const toggleCollapse = (id) => {
    setCollapsedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      try { localStorage.setItem('nw-collapsed-groups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Sort by displayOrder so optimistic reorder updates are reflected immediately
  const sorted = [...groups].sort((a, b) => a.displayOrder - b.displayOrder);
  const grouped = sorted.map(g => ({
    ...g,
    monitors: monitors.filter(m => g.monitorIds?.includes(m.id)),
  })).filter(g => g.monitors.length > 0);

  const groupedIds = new Set(groups.flatMap(g => g.monitorIds ?? []));
  const ungrouped  = monitors.filter(m => !groupedIds.has(m.id));

  const renderGrid = (items) => (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
      {items.map(m => (
        <MonitorCard
          key={m.id}
          monitor={m}
          onEdit={onEdit}
          onCardClick={onCardClick}
          onIncidentClick={onIncidentClick}
          width={getWidth(m.id)}
          chartYMax={chartYMax}
          inMaintenance={maintenanceMonitorIds.has(m.id)}
        />
      ))}
    </div>
  );

  return (
    <div>
      {grouped.map((g, idx) => {
        const isCollapsed = collapsedGroups.includes(g.id);
        return (
          <div key={g.id}>
            <div className="flex items-center gap-2 mb-3 mt-2">
              <button
                onClick={() => toggleCollapse(g.id)}
                className="flex items-center gap-1.5 hover:opacity-70 transition-opacity"
                title={isCollapsed ? 'Expand group' : 'Collapse group'}>
                {isCollapsed
                  ? <ChevronRight size={11} style={{ color: 'var(--wt-text-faint)', flexShrink: 0 }} />
                  : <ChevronDown  size={11} style={{ color: 'var(--wt-text-faint)', flexShrink: 0 }} />}
                <span className="wt-eyebrow">{g.name}</span>
              </button>
              <span className="wt-mono text-[11px]" style={{ color: 'var(--wt-text-faint)' }}>{g.monitors.length}</span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--wt-border)' }} />
              {onMoveGroup && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => onMoveGroup(g.id, 'up')}
                    disabled={idx === 0}
                    className="p-0.5 rounded transition-opacity opacity-30 hover:opacity-80 disabled:opacity-10"
                    style={{ color: 'var(--wt-text-muted)' }}
                    title="Move group up">
                    <ArrowUp size={11} />
                  </button>
                  <button
                    onClick={() => onMoveGroup(g.id, 'down')}
                    disabled={idx === grouped.length - 1}
                    className="p-0.5 rounded transition-opacity opacity-30 hover:opacity-80 disabled:opacity-10"
                    style={{ color: 'var(--wt-text-muted)' }}
                    title="Move group down">
                    <ArrowDown size={11} />
                  </button>
                </div>
              )}
            </div>
            {!isCollapsed && renderGrid(g.monitors)}
          </div>
        );
      })}
      {ungrouped.length > 0 && (
        <div>
          {grouped.length > 0 && (
            <div className="flex items-center gap-2 mb-3 mt-2">
              <span className="wt-eyebrow">Ungrouped</span>
              <span className="wt-mono text-[11px]" style={{ color: 'var(--wt-text-faint)' }}>{ungrouped.length}</span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--wt-border)' }} />
            </div>
          )}
          {renderGrid(ungrouped)}
        </div>
      )}
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
    <div className="relative flex items-center" style={{ flex: '1 1 0', minWidth: 120, maxWidth: 240 }}>
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

function MonitorsToolbar({ searchQuery, onSearchChange, statusFilter, onStatusFilter, sortBy, onSortBy, viewMode, onViewMode, groupByEnabled, onToggleGroupBy }) {
  const STATUS_FILTERS = [
    { value: 'all',      label: 'All' },
    { value: 'down',     label: 'Down' },
    { value: 'degraded', label: 'Degraded' },
    { value: 'up',       label: 'Up' },
  ];
  return (
    <div className="monitors-toolbar">
      <div className="monitors-toolbar__left">
        <MonitorSearch value={searchQuery} onChange={onSearchChange} />
        <div className="wt-seg">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button key={value} aria-selected={statusFilter === value} onClick={() => onStatusFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="monitors-toolbar__right">
        <div className="flex items-center gap-1.5">
          <span className="wt-mono text-[11px] uppercase tracking-wide" style={{ color: 'var(--wt-text-faint)' }}>Sort</span>
          <select className="wt-select" value={sortBy} onChange={e => onSortBy(e.target.value)} style={{ fontSize: 12 }}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="wt-seg">
          <button aria-selected={viewMode === 'grid'} onClick={() => onViewMode('grid')} title="Card view">
            <LayoutGrid size={13} />
          </button>
          <button aria-selected={viewMode === 'list'} onClick={() => onViewMode('list')} title="List view">
            <List size={13} />
          </button>
        </div>
        <div style={{ width: 1, height: 18, background: 'var(--wt-border)', margin: '0 2px' }} />
        <button
          onClick={onToggleGroupBy}
          className="wt-btn wt-btn--ghost wt-btn--sm"
          title="Group by"
          style={groupByEnabled ? { color: 'var(--wt-brand-500)', background: 'color-mix(in oklch, var(--wt-brand-500) 10%, transparent)' } : undefined}>
          <Layers size={13} />
          <span className="wt-mono" style={{ fontSize: 11 }}>Group</span>
        </button>
      </div>
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
  const [pickerOpen,  setPickerOpen]  = useState(false);
  const [draftFrom,   setDraftFrom]   = useState('');
  const [draftTo,     setDraftTo]     = useState('');
  const [pickerPos,   setPickerPos]   = useState({ top: 0, right: 0 });
  const wrapRef    = useRef(null);
  const calBtnRef  = useRef(null);
  const pickerRef  = useRef(null);

  // Position picker below the calendar button, right-aligned to the button so
  // it never overflows the right edge of the viewport.
  const openPicker = () => {
    if (calBtnRef.current) {
      const r = calBtnRef.current.getBoundingClientRect();
      setPickerPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    }
    setPickerOpen(true);
  };

  useEffect(() => {
    if (!pickerOpen) return;
    const onMouse = (e) => {
      const inWrap   = wrapRef.current?.contains(e.target);
      const inPicker = pickerRef.current?.contains(e.target);
      if (!inWrap && !inPicker) setPickerOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setPickerOpen(false); };
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
        <button ref={calBtnRef} onClick={() => pickerOpen ? setPickerOpen(false) : openPicker()}
          className="wt-btn wt-btn--ghost wt-btn--sm" title="Custom range"
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

      {pickerOpen && createPortal(
        <div ref={pickerRef} className="rounded-lg border p-3 space-y-2"
          style={{
            position: 'fixed', top: pickerPos.top, right: pickerPos.right,
            zIndex: 9999, minWidth: 260,
            backgroundColor: t.cardBg, borderColor: t.cardBorder,
            boxShadow: isDark ? '0 16px 48px rgba(0,0,0,0.6)' : '0 16px 48px rgba(0,0,0,0.15)',
          }}>
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
        </div>,
        document.body
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
