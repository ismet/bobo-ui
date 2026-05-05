// ============================================================================
// UI SUB-COMPONENTS
// ============================================================================
import { memo, type ReactNode } from 'react';

export const SectionHeader = memo(({ eyebrow, title, kicker, action }: {
  eyebrow: string;
  title: string;
  kicker?: string;
  action?: ReactNode;
}) => {
  return (
    <div className="mb-5">
      <div className="chip mb-3">{eyebrow}</div>
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-display text-3xl md:text-4xl leading-tight min-w-0">{title}</h2>
        {action}
      </div>
      {kicker && <p className="text-sm text-[color:var(--text-dim)] mt-2 max-w-2xl">{kicker}</p>}
    </div>
  );
});

export const Slider = memo(({ label, unit, value, setValue, min, max, step, hint }: {
  label: string;
  unit: string;
  value: number;
  setValue: (v: number) => void;
  min: number;
  max: number;
  step: number;
  hint?: string;
}) => {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">{label}</label>
        <span className="num text-sm text-[color:var(--accent-teal)]">
          {Number(value).toFixed(step < 1 ? 2 : 0)} <span className="text-[color:var(--text-faint)] text-[10px]">{unit}</span>
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => setValue(parseFloat(e.target.value))}
      />
      {hint && <div className="text-[10px] text-[color:var(--text-faint)] mt-1 font-mono">{hint}</div>}
    </div>
  );
});

export function KPI({ label, value, sub, delta, tone }: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number;
  tone?: string;
}) {
  const toneClass = tone === 'teal' ? 'text-[color:var(--accent-teal)]'
                  : tone === 'amber' ? 'text-[color:var(--accent-amber)]'
                  : tone === 'violet' ? 'text-[color:var(--accent-violet)]'
                  : tone === 'green' ? 'text-[color:var(--accent-green)]'
                  : tone === 'rose' ? 'text-[color:var(--accent-rose)]'
                  : 'text-[color:var(--text)]';
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-2">{label}</div>
      <div className={`num text-3xl font-display font-semibold ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-[color:var(--text-dim)] mt-1 font-mono">{sub}</div>}
      {delta !== undefined && (
        <div className={`text-xs mt-2 font-mono ${delta >= 0 ? 'kpi-delta-up' : 'kpi-delta-down'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

export type TipProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ name?: string; value?: unknown; color?: string }>;
  label?: unknown;
  labelFormatter?: (label: unknown) => ReactNode;
};

export function Tip(props: TipProps) {
  const { active, payload, label } = props;
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      background: 'rgba(10,14,26,0.96)', border: '1px solid var(--border-strong)',
      borderRadius: 4, padding: '8px 12px', fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11, boxShadow: '0 12px 32px rgba(0,0,0,0.5)'
    }}>
      <div style={{ color: 'var(--text-dim)', marginBottom: 6, fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        {props.labelFormatter ? props.labelFormatter(label) : `t = ${label}`}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: p.color }}>
          <span>{p.name}</span>
          <span style={{ color: 'var(--text)' }}>{typeof p.value === 'number' ? p.value.toFixed(2) : String(p.value ?? '')}</span>
        </div>
      ))}
    </div>
  );
}
