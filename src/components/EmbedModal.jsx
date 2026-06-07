import React, { useState } from 'react';
import { X, Copy, Check, Monitor, LayoutGrid } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

export function EmbedModal({ monitor, onClose }) {
  const { t } = useTheme();
  const [tab,    setTab]    = useState(monitor ? 'widget' : 'page');
  const [copied, setCopied] = useState(false);

  const origin    = window.location.origin;
  const widgetSrc = `${origin}/embed/monitor/${monitor?.id}`;
  const pageSrc   = `${origin}/embed`;

  const widgetCode = monitor
    ? `<iframe\n  src="${widgetSrc}"\n  width="360"\n  height="230"\n  frameborder="0"\n  style="border-radius:8px;overflow:hidden"\n></iframe>`
    : null;
  const pageCode = `<iframe\n  src="${pageSrc}"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border-radius:8px;overflow:hidden"\n></iframe>`;
  const activeCode = tab === 'widget' ? widgetCode : pageCode;

  const copy = () => {
    navigator.clipboard.writeText(activeCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(2px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <div className="wt-card w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 2rem)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0"
          style={{ borderColor: t.metricGap }}>
          <h2 className="wt-eyebrow">Embed</h2>
          <button onClick={onClose} className="wt-btn wt-btn--ghost wt-btn--sm">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">

          {/* Tabs */}
          <div className="wt-seg">
            {monitor && (
              <button onClick={() => setTab('widget')} aria-selected={tab === 'widget'}>
                <Monitor size={11} style={{ display: 'inline', marginRight: 4 }} />
                This Monitor
              </button>
            )}
            <button onClick={() => setTab('page')} aria-selected={tab === 'page'}>
              <LayoutGrid size={11} style={{ display: 'inline', marginRight: 4 }} />
              Full Dashboard
            </button>
          </div>

          {/* Description */}
          <p className="text-xs" style={{ color: t.textMuted }}>
            {tab === 'widget'
              ? `Embeds just the ${monitor?.label} card. No edit or delete controls.`
              : 'Embeds the full read-only dashboard. No edit, delete, or settings controls.'}
          </p>

          {/* URL preview */}
          <div className="wt-mono rounded border px-3 py-2 text-xs truncate"
            style={{ backgroundColor: t.inputBg, borderColor: t.cardBorder, color: t.textFaint }}>
            {tab === 'widget' ? widgetSrc : pageSrc}
          </div>

          {/* Code block — wt-console style (stays dark) */}
          <div className="relative">
            <pre className="wt-mono rounded border px-4 py-3 text-xs overflow-x-auto leading-relaxed"
              style={{ backgroundColor: 'var(--wt-console-bg)', borderColor: 'var(--wt-console-border)', color: 'var(--wt-console-text)' }}>
              {activeCode}
            </pre>
            <button onClick={copy}
              className="wt-btn wt-btn--ghost wt-btn--sm absolute top-2 right-2"
              style={copied ? { color: 'var(--wt-up-600)' } : undefined}>
              {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
            </button>
          </div>

          <p className="text-xs" style={{ color: t.textFaint }}>
            {tab === 'widget'
              ? 'Recommended size: 360 x 230px. Adjust height if the monitor has many tags.'
              : 'Set height to match your content. Use 100% width for responsive layouts.'}
          </p>
        </div>
      </div>
    </div>
  );
}
