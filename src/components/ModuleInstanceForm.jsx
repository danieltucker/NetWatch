import React, { useState } from 'react';
import { X, Loader, AlertCircle } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

// Shown when adding or editing a module instance (card).
// moduleDef — the frontend module definition (id, name, instanceConfigSchema)
// instance  — existing instance when editing, null when adding
export function ModuleInstanceForm({ moduleDef, instance, onSubmit, onCancel, submitting, error = '' }) {
  const { t } = useTheme();

  const [label,       setLabel]       = useState(instance?.label       ?? '');
  const [description, setDescription] = useState(instance?.description ?? '');
  const [interval,    setInterval]    = useState(instance?.interval    ?? 3600);
  const [tagsInput,   setTagsInput]   = useState((instance?.tags ?? []).join(', '));
  const [config,      setConfig]      = useState(instance?.config      ?? {});

  const setConfigKey = (key, val) => setConfig(prev => ({ ...prev, [key]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    onSubmit({ moduleId: moduleDef.id, label, description, interval: Number(interval), tags, config });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onCancel()}>

      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: t.cardBg, borderColor: t.cardBorder }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: t.cardBorder }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: t.textPrimary, letterSpacing: '-0.01em' }}>
              {instance ? 'Edit' : 'Add'} {moduleDef.name}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: t.textMuted }}>
              {moduleDef.description}
            </p>
          </div>
          <button onClick={onCancel} className="wt-btn wt-btn--ghost wt-btn--sm" style={{ color: t.textSecondary }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">

            {/* Label */}
            <div className="wt-field">
              <label className="wt-label">Label *</label>
              <input className="wt-input" value={label} onChange={e => setLabel(e.target.value)}
                placeholder={`My ${moduleDef.name}`} required />
            </div>

            {/* Description */}
            <div className="wt-field">
              <label className="wt-label">Description</label>
              <input className="wt-input" value={description} onChange={e => setDescription(e.target.value)}
                placeholder="Optional notes" />
            </div>

            {/* Refresh interval */}
            <div className="wt-field">
              <label className="wt-label">Refresh interval (seconds)</label>
              <input className="wt-input wt-input--mono" type="number" value={interval}
                onChange={e => setInterval(e.target.value)} min={60} />
            </div>

            {/* Tags */}
            <div className="wt-field">
              <label className="wt-label">Tags</label>
              <input className="wt-input" value={tagsInput} onChange={e => setTagsInput(e.target.value)}
                placeholder="production, api (comma separated)" />
            </div>

            {/* Module-specific instance config */}
            {moduleDef.instanceConfigSchema?.length > 0 && (
              <div className="pt-3 border-t space-y-4" style={{ borderColor: t.cardBorder }}>
                <p className="wt-eyebrow">{moduleDef.name} settings</p>
                {moduleDef.instanceConfigSchema.map(field => (
                  <div key={field.key} className="wt-field">
                    <label className="wt-label">{field.label}{field.required ? ' *' : ''}</label>
                    <input
                      className="wt-input wt-input--mono"
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={config[field.key] ?? ''}
                      onChange={e => setConfigKey(field.key, e.target.value)}
                      placeholder={field.placeholder ?? ''}
                      required={field.required}
                    />
                    {field.hint && <p className="wt-hint">{field.hint}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-2 px-6 py-4 border-t" style={{ borderColor: t.cardBorder }}>
            {error && (
              <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--wt-down-600)' }}>
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={onCancel} className="wt-btn wt-btn--ghost">Cancel</button>
              <button type="submit" disabled={submitting} className="wt-btn wt-btn--primary" style={{ opacity: submitting ? 0.6 : 1 }}>
                {submitting
                  ? <><Loader size={12} className="animate-spin" /> Saving…</>
                  : instance ? 'Save changes' : 'Add to dashboard'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
