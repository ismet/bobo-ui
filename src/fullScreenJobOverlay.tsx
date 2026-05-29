// ============================================================================
// Full-screen loading overlay — portaled to document.body (above all panels).
// ============================================================================
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export type FullScreenJobOverlayProps = {
  open: boolean;
  eyebrow: string;
  title: string;
  /** 0–1 determinate; omit / null = indeterminate bar */
  progress?: number | null;
  /** Indeterminate-only copy; defaults to dispatch-optimization message */
  hint?: string;
  /** Indeterminate bar: sliding segment (default) or full-track looping shimmer */
  indeterminateStyle?: 'slide' | 'shimmer';
};

const DEFAULT_INDETERMINATE_HINT =
  'Solving dynamic program over your horizon — UI stays responsive via worker.';

export function FullScreenJobOverlay({
  open,
  eyebrow,
  title,
  progress,
  hint,
  indeterminateStyle = 'slide',
}: FullScreenJobOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const determinate = typeof progress === 'number' && Number.isFinite(progress);
  const pct = determinate ? Math.min(100, Math.max(0, progress * 100)) : null;

  return createPortal(
    <div
      className="job-overlay-root grid-bg"
      role="alertdialog"
      aria-busy="true"
      aria-live="polite"
      aria-labelledby="job-overlay-title"
    >
      <div className="job-overlay-panel card">
        <div className="chip mb-3">{eyebrow}</div>
        <h2 id="job-overlay-title" className="font-display text-2xl md:text-3xl leading-tight mb-2">
          {title}
        </h2>
        <p className="text-xs font-mono text-[color:var(--text-dim)] mb-6 leading-relaxed">
          {determinate
            ? `${Math.round(pct!)}% · repeated dispatch solves`
            : (hint ?? DEFAULT_INDETERMINATE_HINT)}
        </p>
        <div className="loading-bar-track job-overlay-track">
          {determinate ? (
            <div className="job-overlay-fill" style={{ width: `${pct}%` }} />
          ) : indeterminateStyle === 'shimmer' ? (
            <div className="job-overlay-stream" />
          ) : (
            <div className="loading-bar-indeterminate job-overlay-indeterminate" />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
