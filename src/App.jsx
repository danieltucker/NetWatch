import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Radio, Activity, AlertTriangle, Bell, Tag as TagIcon, Settings, Code, X, Menu, Search, Zap } from 'lucide-react';
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
import { ModuleCard }          from './components/ModuleCard';
import { MonitorForm }         from './components/MonitorForm';
import { ModuleInstanceForm }  from './components/ModuleInstanceForm';
import { AlertsPanel }         from './components/AlertsPanel';
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

const STATUS_FILTER_OPTS = [
  { label: 'All',      value: 'all',      dot: null      },
  { label: 'Down',     value: 'down',     dot: '#ef4444' },
  { label: 'Degraded', value: 'degraded', dot: '#f59e0b' },
  { label: 'Up',       value: 'up',       dot: '#4ade80' },
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
    setShowAlerts(true);
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
  const [showAlerts,     setShowAlerts]     = useState(false);
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

  // ── Incident dot click — open modal on Incidents tab at that timestamp ──────
  const handleIncidentClick = useCallback((mon, timestamp) => {
    setIncidentTimestamp(timestamp);
    openDetail(mon, 'incidents');
  }, [openDetail]);

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
    <div className="min-h-screen" style={{ backgroundColor: t.pageBg, color: t.textPrimary }}>

      {/* ── Console (always mounted, toggled with `) ─────────────────────────── */}
      <ConsolePanel monitors={monitors} onRefresh={refresh} />

      {/* ── Page-level error toast ───────────────────────────────────────────── */}
      {pageError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl border text-xs font-mono text-red-400 shadow-lg"
          style={{ backgroundColor: '#1e0a0a', borderColor: '#7f1d1d', maxWidth: '480px' }}>
          <AlertTriangle size={13} className="shrink-0" />
          <span className="flex-1">{pageError}</span>
          <button onClick={() => setPageError('')} className="opacity-60 hover:opacity-100 ml-1">
            <X size={13} />
          </button>
        </div>
      )}

      {/* ── Top nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b"
        style={{ backgroundColor: t.headerBg, borderColor: t.cardBorder }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <Radio size={18} className="text-green-400" />
            <span className="font-mono font-bold tracking-[0.12em]" style={{ color: t.textPrimary }}>
              NETWATCH
            </span>
            <span className="hidden sm:inline text-xs font-mono px-2 py-0.5 rounded border"
              style={{ color: t.textFaint, borderColor: t.cardBorder }}>
              netwatch · v6.4.3
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-3">

            {/* SSE live indicator — desktop only */}
            <div className="hidden sm:flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-50" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              <span className="text-xs font-mono" style={{ color: t.textFaint }}>live</span>
            </div>

            {/* Desktop icon buttons */}
            <div className="hidden sm:flex items-center gap-3">
              {/* Alerts bell */}
              <button onClick={() => setShowAlerts(p => !p)}
                className="relative p-1.5 rounded transition-colors"
                style={{ color: ongoingCount > 0 ? '#f87171' : t.textMuted }}
                title="Alerts">
                <Bell size={16} />
                {ongoingCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 flex items-center justify-center text-white font-bold"
                    style={{ fontSize: 9 }}>
                    {ongoingCount}
                  </span>
                )}
              </button>

              {/* Embed full dashboard */}
              <button onClick={() => setEmbedMonitor(undefined)}
                className="p-1.5 rounded transition-colors"
                style={{ color: t.textMuted }}
                title="Embed dashboard">
                <Code size={16} />
              </button>

              {/* Settings */}
              <button onClick={() => setShowSettings(true)}
                className="p-1.5 rounded transition-colors"
                style={{ color: t.textMuted }}
                title="Settings">
                <Settings size={16} />
              </button>

              {/* Add monitor / module */}
              <button onClick={openAdd}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold rounded transition-colors">
                <Plus size={14} />
                Add
              </button>
            </div>

            {/* Mobile: alerts badge + hamburger */}
            <div className="flex sm:hidden items-center gap-2">
              {/* Alerts bell visible on mobile so badge is always accessible */}
              <button onClick={() => setShowAlerts(p => !p)}
                className="relative p-1.5 rounded transition-colors"
                style={{ color: ongoingCount > 0 ? '#f87171' : t.textMuted }}
                title="Alerts">
                <Bell size={16} />
                {ongoingCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-red-500 flex items-center justify-center text-white font-bold"
                    style={{ fontSize: 9 }}>
                    {ongoingCount}
                  </span>
                )}
              </button>

              <button onClick={() => setMobileMenuOpen(p => !p)}
                className="p-1.5 rounded transition-colors"
                style={{ color: t.textMuted }}
                title="Menu">
                {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t px-4 py-3 space-y-3"
            style={{ borderColor: t.cardBorder, backgroundColor: t.headerBg }}>

            {/* Action buttons row */}
            <div className="flex items-center gap-2">
              <button onClick={() => { setEmbedMonitor(undefined); setMobileMenuOpen(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors"
                style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: t.inputBg }}>
                <Code size={13} />
                Embed
              </button>

              <button onClick={() => { setShowSettings(true); setMobileMenuOpen(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors"
                style={{ color: t.textMuted, borderColor: t.cardBorder, backgroundColor: t.inputBg }}>
                <Settings size={13} />
                Settings
              </button>

              <button onClick={() => { openAdd(); setMobileMenuOpen(false); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono font-bold rounded transition-colors ml-auto">
                <Plus size={13} />
                Add
              </button>
            </div>
          </div>
        )}
      </header>

      {/* ── Summary strip ───────────────────────────────────────────────────── */}
      {!loading && !error && userMonitors.length > 0 && (
        <SummaryBar monitors={userMonitors} />
      )}

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Alerts panel */}
        {showAlerts && (
          <AlertsPanel
            alerts={alerts}
            onDismiss={dismissAlert}
            onDismissAll={dismissAll}
            onClose={() => setShowAlerts(false)}
          />
        )}

        {loading && <LoadingState t={t} />}
        {error   && <ErrorState  message={error} t={t} />}

        {!loading && !error && (
          <>

            {/* ── Tag filter row (only shown when tags exist) ──────────────── */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono uppercase tracking-wider"
                  style={{ color: t.textMuted }}>
                  Filter
                </span>
                {allTags.map(tag => (
                  <button key={tag} onClick={() => toggleTag(tag)}
                    className="flex items-center gap-0.5 text-xs font-mono px-2 py-0.5 rounded border transition-colors"
                    style={tagFilter.includes(tag)
                      ? { color: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.15)', borderColor: 'rgba(96,165,250,0.4)' }
                      : { color: t.textMuted, backgroundColor: t.tagBg, borderColor: t.tagBorder }
                    }>
                    <TagIcon size={9} />
                    {tag}
                  </button>
                ))}
                {tagFilter.length > 0 && (
                  <button onClick={() => setTagFilter([])}
                    className="text-xs font-mono transition-opacity opacity-50 hover:opacity-100"
                    style={{ color: t.textSecondary }}>
                    clear
                  </button>
                )}
              </div>
            )}

            {/* ── Controls row ─────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">

              {/* Text search */}
              <MonitorSearch value={searchQuery} onChange={setSearchQuery} t={t} />

              {/* Status quick-filter */}
              <StatusFilterGroup value={statusFilter} onChange={setStatusFilter} t={t} isDark={isDark} />

              {/* Divider */}
              <div className="w-px h-3 shrink-0 hidden sm:block" style={{ backgroundColor: t.cardBorder }} />

              {/* History range (pills or active-range badge) */}
              <HistoryRangeControl
                historyRange={historyRange}
                onChange={setHistoryRange}
                t={t}
                isDark={isDark}
              />

              {/* Sort — pushed to the right on wide screens */}
              <div className="flex items-center gap-1 ml-auto">
                <span className="text-xs font-mono" style={{ color: t.textFaint }}>Sort</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value)}
                  className="text-xs font-mono rounded border px-1.5 py-0.5 appearance-none cursor-pointer focus:outline-none"
                  style={{ backgroundColor: t.inputBg, color: t.textSecondary, borderColor: t.cardBorder }}>
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Monitor grid */}
            {userMonitors.length === 0 ? (
              <EmptyState onAdd={openAdd} t={t} />
            ) : filteredMonitors.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono" style={{ color: t.textMuted }}>
                No monitors match the selected tags
              </div>
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

            {/* ── Module instances ──────────────────────────────────────── */}
            {instances.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1" style={{ backgroundColor: t.cardBorder }} />
                  <span className="text-xs font-mono uppercase tracking-widest px-1"
                    style={{ color: t.textFaint }}>
                    Modules
                  </span>
                  <div className="h-px flex-1" style={{ backgroundColor: t.cardBorder }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {instances.filter(i => i.enabled).map(inst => (
                    <ModuleCard
                      key={inst.id}
                      instance={inst}
                      onEdit={setEditingInstance}
                      onDelete={deleteInstance}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Network Reference section ──────────────────────────────── */}
            {refMonitors.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-px flex-1" style={{ backgroundColor: t.cardBorder }} />
                  <span className="text-xs font-mono uppercase tracking-widest px-1"
                    style={{ color: t.textFaint }}>
                    Network Reference
                  </span>
                  <div className="h-px flex-1" style={{ backgroundColor: t.cardBorder }} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {refMonitors.map(m => (
                    <MonitorCard
                      key={m.id}
                      monitor={m}
                      compact
                    />
                  ))}
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

// ── Toolbar sub-components ────────────────────────────────────────────────────

function MonitorSearch({ value, onChange, t }) {
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
    <div className="relative flex items-center shrink-0">
      <Search size={11} className="absolute left-2 pointer-events-none"
        style={{ color: t.textFaint }} />
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search monitors…"
        className="pl-6 py-0.5 text-xs font-mono rounded border focus:outline-none
                   focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500/50 transition-all"
        style={{
          width:           value ? 160 : 140,
          paddingRight:    value ? '1.25rem' : '0.5rem',
          backgroundColor: t.inputBg,
          color:           t.textPrimary,
          borderColor:     value ? 'rgba(96,165,250,0.5)' : t.cardBorder,
          transition:      'width 0.15s, border-color 0.15s',
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-1.5 opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: t.textMuted }}
          title="Clear (Esc)">
          <X size={10} />
        </button>
      )}
    </div>
  );
}

function StatusFilterGroup({ value, onChange, t, isDark }) {
  return (
    <div className="flex items-center shrink-0">
      {STATUS_FILTER_OPTS.map((opt, i) => {
        const isActive = value === opt.value;
        const isFirst  = i === 0;
        const isLast   = i === STATUS_FILTER_OPTS.length - 1;
        const color    = opt.dot ?? '#60a5fa';
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono border transition-all"
            style={{
              borderRadius:    isFirst ? '0.375rem 0 0 0.375rem'
                             : isLast  ? '0 0.375rem 0.375rem 0' : '0',
              marginLeft:      i > 0 ? '-1px' : 0,
              position:        'relative',
              zIndex:          isActive ? 1 : 0,
              backgroundColor: isActive
                ? `${color}18`
                : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              borderColor:     isActive ? color : t.cardBorder,
              color:           isActive ? color : t.textMuted,
            }}>
            {opt.dot && (
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: opt.dot, opacity: isActive ? 1 : 0.45 }} />
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function HistoryRangeControl({ historyRange, onChange, t, isDark }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftFrom,  setDraftFrom]  = useState('');
  const [draftTo,    setDraftTo]    = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const isCustomActive = historyRange.type === 'custom' || historyRange.type === 'zoom';

  const clearRange = () => onChange({ type: 'preset', value: '1h' });

  const applyCustom = () => {
    if (!draftFrom || !draftTo) return;
    onChange({
      type: 'custom',
      from: new Date(draftFrom).toISOString(),
      to:   new Date(draftTo).toISOString(),
    });
    setPickerOpen(false);
  };

  const formatActiveLabel = () => {
    if (historyRange.type === 'zoom') {
      const d = new Date(historyRange.incidentAt);
      const s = d.toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      return { isZoom: true, text: `${s} ±30m` };
    }
    const from = new Date(historyRange.from);
    const to   = new Date(historyRange.to);
    const sameDay = from.toDateString() === to.toDateString();
    const fStr = from.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const tStr = sameDay
      ? to.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
      : to.toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        });
    return { isZoom: false, text: `${fStr} – ${tStr}` };
  };

  return (
    <div className="relative flex items-center gap-1 shrink-0" ref={wrapRef}>
      <span className="text-xs font-mono" style={{ color: t.textFaint }}>History</span>

      {isCustomActive ? (
        // Active range badge
        (() => {
          const { isZoom, text } = formatActiveLabel();
          const color = isZoom ? '#f59e0b' : '#60a5fa';
          const bg    = isZoom ? 'rgba(245,158,11,0.12)' : 'rgba(96,165,250,0.12)';
          const border = isZoom ? 'rgba(245,158,11,0.35)' : 'rgba(96,165,250,0.35)';
          return (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-mono"
              style={{ color, backgroundColor: bg, borderColor: border }}>
              {isZoom && <Zap size={10} />}
              <span>{text}</span>
              <button
                onClick={clearRange}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                title="Clear range">
                <X size={10} />
              </button>
            </div>
          );
        })()
      ) : (
        // Preset pill group + Custom button
        <div className="flex items-center">
          {HISTORY_PRESETS.map((o, i) => {
            const isActive = historyRange.type === 'preset' && historyRange.value === o.value;
            const isFirst  = i === 0;
            return (
              <button
                key={o.value}
                onClick={() => { onChange({ type: 'preset', value: o.value }); setPickerOpen(false); }}
                className="px-2 py-0.5 text-xs font-mono border transition-all"
                style={{
                  borderRadius:    isFirst ? '0.375rem 0 0 0.375rem' : '0',
                  marginLeft:      i > 0 ? '-1px' : 0,
                  position:        'relative',
                  zIndex:          isActive ? 1 : 0,
                  backgroundColor: isActive
                    ? isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)'
                    : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                  borderColor: isActive ? '#60a5fa' : t.cardBorder,
                  color:       isActive ? '#60a5fa' : t.textMuted,
                }}>
                {o.label}
              </button>
            );
          })}
          <button
            onClick={() => setPickerOpen(p => !p)}
            className="px-2 py-0.5 text-xs font-mono border transition-all"
            style={{
              borderRadius:    '0 0.375rem 0.375rem 0',
              marginLeft:      '-1px',
              position:        'relative',
              zIndex:          pickerOpen ? 2 : 0,
              backgroundColor: pickerOpen
                ? isDark ? 'rgba(96,165,250,0.15)' : 'rgba(59,130,246,0.1)'
                : isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
              borderColor: pickerOpen ? '#60a5fa' : t.cardBorder,
              color:       pickerOpen ? '#60a5fa' : t.textMuted,
            }}>
            Custom
          </button>
        </div>
      )}

      {/* Date range picker panel */}
      {pickerOpen && (
        <div
          className="absolute top-full mt-1.5 z-30 rounded-lg border shadow-2xl p-3 space-y-2.5"
          style={{
            right:           0,
            backgroundColor: t.cardBg,
            borderColor:     t.cardBorder,
            minWidth:        268,
            boxShadow: isDark
              ? '0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)'
              : '0 16px 48px rgba(0,0,0,0.15)',
          }}>
          <div className="text-xs font-mono uppercase tracking-wider pb-0.5"
            style={{ color: t.textFaint }}>
            Custom range
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: t.textMuted }}>
                From
              </label>
              <input
                type="datetime-local"
                value={draftFrom}
                onChange={e => setDraftFrom(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs font-mono
                           focus:outline-none focus:ring-2 focus:ring-blue-500/20
                           focus:border-blue-500/50 transition-all"
                style={{ backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder }}
              />
            </div>
            <div>
              <label className="block text-xs font-mono mb-1" style={{ color: t.textMuted }}>
                To
              </label>
              <input
                type="datetime-local"
                value={draftTo}
                onChange={e => setDraftTo(e.target.value)}
                className="w-full rounded border px-2 py-1.5 text-xs font-mono
                           focus:outline-none focus:ring-2 focus:ring-blue-500/20
                           focus:border-blue-500/50 transition-all"
                style={{ backgroundColor: t.inputBg, color: t.textPrimary, borderColor: t.cardBorder }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1 border-t"
            style={{ borderColor: t.cardBorder }}>
            <button
              onClick={() => setPickerOpen(false)}
              className="text-xs font-mono opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: t.textMuted }}>
              Cancel
            </button>
            <button
              onClick={applyCustom}
              disabled={!draftFrom || !draftTo}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono
                         font-bold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color:      '#fff',
                boxShadow:  '0 2px 8px rgba(59,130,246,0.35)',
              }}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── State screens ─────────────────────────────────────────────────────────────

function LoadingState({ t }) {
  return (
    <div className="flex items-center justify-center py-36 gap-3 font-mono text-sm"
      style={{ color: t.textMuted }}>
      <span className="animate-spin">⟳</span> Connecting to server…
    </div>
  );
}

function ErrorState({ message, t }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={36} className="text-red-500/60" />
      <p className="font-mono text-sm text-red-400">Cannot reach the NetWatch server</p>
      <p className="font-mono text-xs" style={{ color: t.textMuted }}>{message}</p>
      <p className="font-mono text-xs mt-2" style={{ color: t.textFaint }}>
        Run <span style={{ color: t.textSecondary }}>npm run dev</span> inside{' '}
        <span style={{ color: t.textSecondary }}>server/</span> to start the backend.
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
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-40" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-600" />
        </span>
      </div>
      <p className="font-mono text-sm mb-1" style={{ color: t.textMuted }}>No monitors configured</p>
      <p className="font-mono text-xs" style={{ color: t.textFaint }}>
        Add an IP or domain to start tracking uptime
      </p>
      <button onClick={onAdd}
        className="mt-8 flex items-center gap-2 px-4 py-2.5 text-sm font-mono rounded border transition-colors hover:opacity-80"
        style={{ backgroundColor: t.tagBg, color: t.textSecondary, borderColor: t.tagBorder }}>
        <Plus size={15} />
        Add your first monitor
      </button>
    </div>
  );
}
