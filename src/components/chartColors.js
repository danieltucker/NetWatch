// Resolve Watchtower design tokens to concrete color strings for Recharts,
// which can't consume CSS custom properties in its color props. Call inside a
// useMemo keyed on `isDark` so chart colors always track the live theme.
export function resolveChartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v  = (name) => cs.getPropertyValue(name).trim();
  return {
    up:     v('--wt-up-500')   || '#22c55e',
    warn:   v('--wt-warn-500') || '#f59e0b',
    down:   v('--wt-down-500') || '#ef4444',
    brand:  v('--wt-brand-500')|| '#3b82f6',
    border: v('--wt-border')   || '#30363d',
    viz:    [1,2,3,4,5,6,7].map(i => v(`--wt-viz-${i}`)),
  };
}
