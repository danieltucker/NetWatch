import React, { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, RefreshCw, AlertCircle } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { moduleRegistry } from '../modules/index.js';

function ModuleCardInner({ instance, onEdit, onDelete }) {
  const { t, isDark } = useTheme();
  const { moduleId, label, tags = [], interval = 3600 } = instance;
  const moduleDef = moduleRegistry.get(moduleId);

  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);

  const fetchData = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const params = new URLSearchParams({ instanceId: instance.id });
      // Pass any instance config values as query params
      for (const [k, v] of Object.entries(instance.config ?? {})) {
        params.set(k, v);
      }
      const res  = await fetch(`/api/modules/${moduleId}/data?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch data');
      setData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastFetched(new Date());
    }
  }, [moduleId, instance.id, instance.config]);

  // Initial fetch + interval polling
  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData(), interval * 1_000);
    return () => clearInterval(timer);
  }, [fetchData, interval]);

  const handleDelete = () => {
    if (window.confirm(`Remove "${label}"? This cannot be undone.`)) onDelete?.(instance.id);
  };

  if (!moduleDef) {
    return (
      <div className="wt-card p-4 flex items-center gap-2 wt-mono text-xs"
        style={{ color: 'var(--wt-down-600)' }}>
        <AlertCircle size={13} /> Unknown module: {moduleId}
      </div>
    );
  }

  const IconComponent = moduleDef.icon;
  const CardComponent = moduleDef.Card;

  return (
    <div className="wt-card flex flex-col">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: t.metricGap }}>
        <div className="flex items-center gap-2 min-w-0">
          {IconComponent && (
            <IconComponent size={13} style={{ color: t.textMuted, flexShrink: 0 }} />
          )}
          <span className="text-sm wt-mono font-semibold truncate"
            style={{ color: t.textPrimary }}>
            {label}
          </span>
          <span
            className="shrink-0 text-xs wt-mono px-1.5 py-0.5 rounded border"
            style={{
              color: t.textFaint, borderColor: t.cardBorder,
              fontSize: 10, backgroundColor: t.tagBg,
            }}>
            {moduleDef.name}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="p-1.5 rounded opacity-40 hover:opacity-100 transition-opacity disabled:opacity-20"
            style={{ color: t.textSecondary }}
            title="Refresh now">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
          {onEdit && (
            <button
              onClick={() => onEdit(instance)}
              className="p-1.5 rounded opacity-40 hover:opacity-100 transition-opacity"
              style={{ color: t.textSecondary }}
              title="Edit">
              <Pencil size={12} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded opacity-40 hover:opacity-100 transition-opacity"
              style={{ color: t.textSecondary }}
              title="Remove">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* ── Module content ───────────────────────────────────────────────────── */}
      <div className="flex-1 px-4 py-4">
        <CardComponent
          data={data}
          loading={loading}
          error={error}
          instance={instance}
          t={t}
          isDark={isDark}
        />
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      {(tags.length > 0 || lastFetched) && (
        <div
          className="flex items-center justify-between px-4 py-2 border-t"
          style={{ borderColor: t.metricGap }}>
          <div className="flex items-center gap-1 flex-wrap">
            {tags.map(tag => (
              <span
                key={tag}
                className="wt-mono px-1.5 py-0.5 rounded"
                style={{
                  fontSize: 10,
                  backgroundColor: t.tagBg,
                  color: t.textFaint,
                }}>
                {tag}
              </span>
            ))}
          </div>
          {lastFetched && (
            <span className="wt-mono" style={{ fontSize: 10, color: t.textFaint }}>
              {lastFetched.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Re-render only when the instance record itself changes (label, config, tags, etc.)
export const ModuleCard = React.memo(ModuleCardInner, (prev, next) =>
  prev.instance === next.instance
);
