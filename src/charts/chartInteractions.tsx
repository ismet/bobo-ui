import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { tsLabel } from '../formatUtils';
import type { TrajectoryStep } from '../engine/types';

// ============================================================================
// useZoom: shared brush-zoom state for time-series charts.
// Returns: brushIndices, handleBrushChange, resetKey (bump to clear brush),
//          reset()  — also clears the brush on the chart that owns this hook.
// ============================================================================
export function useZoom(dataLength: number) {
  const [range, setRange] = useState({ start: 0, end: Math.max(0, dataLength - 1) });
  const [resetKey, setResetKey] = useState(0);

  // Re-clamp when data length changes (new optimisation result, horizon switch, etc.)
  useEffect(() => {
    setRange({ start: 0, end: Math.max(0, dataLength - 1) });
    setResetKey(k => k + 1);
  }, [dataLength]);

  const onChange = useCallback((e: { startIndex?: number; endIndex?: number } | null) => {
    if (!e || e.startIndex === undefined || e.endIndex === undefined) return;
    setRange({ start: e.startIndex, end: e.endIndex });
  }, []);
  const reset = useCallback(() => {
    setRange({ start: 0, end: Math.max(0, dataLength - 1) });
    setResetKey(k => k + 1);
  }, [dataLength]);

  const isZoomed = range.start !== 0 || range.end !== dataLength - 1;
  return { range, onChange, reset, resetKey, isZoomed };
}

// ============================================================================
// useIsolation: click-a-legend-to-isolate-it behaviour for charts.
//
// Behaviour matches what most data-viz tools do (Plotly, Tableau, etc.):
//   - first click on a series  →  isolate (hide everyone else)
//   - click same series again  →  show all (clear isolation)
//   - click a different series →  switch isolation to that one
// Returns:
//   active(key)  : true if this series should be drawn
//   click(key)   : click handler for the legend chip
//   isolated     : the currently isolated key, or null
// ============================================================================
export function useIsolation() {
  const [isolated, setIsolated] = useState<string | null>(null);
  const click = useCallback((key: string) => {
    setIsolated(prev => prev === key ? null : key);
  }, []);
  const active = useCallback((key: string) => isolated == null || isolated === key, [isolated]);
  return { active, click, isolated };
}

// Clickable legend chip — paired with useIsolation. Looks identical to the
// existing inline legends; adds hover, "isolated" highlight, and dimming
// for non-active series.
export function LegendChip({ swatch, label, isoKey, iso }: {
  swatch: ReactNode;
  label: string;
  isoKey: string;
  iso: ReturnType<typeof useIsolation>;
}) {
  const isActive = iso.active(isoKey);
  const isIsolated = iso.isolated === isoKey;
  return (
    <span
      onClick={() => iso.click(isoKey)}
      title={isIsolated ? 'click to show all' : 'click to isolate'}
      className="flex items-center gap-1.5"
      style={{
        cursor: 'pointer',
        opacity: isActive ? 1 : 0.35,
        textDecoration: isIsolated ? 'underline' : 'none',
        textDecorationColor: 'var(--accent-teal)',
        textUnderlineOffset: 3,
        userSelect: 'none',
        transition: 'opacity .12s',
      }}
    >
      {swatch}
      <span>{label}</span>
    </span>
  );
}

export function ZoomBadge({ zoom, dataLength, dt, traj }: {
  zoom: ReturnType<typeof useZoom>;
  dataLength: number;
  dt: number;
  traj: TrajectoryStep[];
}) {
  if (!zoom.isZoomed) {
    return (
      <span className="text-[10px] font-mono text-[color:var(--text-faint)]"
            style={{ marginLeft: 8 }}>
        use the timeline strip below to zoom
      </span>
    );
  }
  const a = traj[Math.min(zoom.range.start, traj.length - 1)];
  const b = traj[Math.min(zoom.range.end,   traj.length - 1)];
  const span = (zoom.range.end - zoom.range.start + 1) * dt;
  return (
    <span style={{ marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span className="text-[10px] font-mono" style={{ color: 'var(--accent-teal)' }}>
        zoom {tsLabel(a.t * dt, dt < 1)} → {tsLabel(b.t * dt, dt < 1)} · {span.toFixed(1)}h
      </span>
      <button onClick={zoom.reset}
              style={{ padding: '2px 8px', border: '1px solid var(--border)',
                       borderRadius: 3, color: 'var(--text-dim)', fontSize: 10,
                       fontFamily: 'JetBrains Mono', cursor: 'pointer' }}>
        reset
      </button>
    </span>
  );
}
