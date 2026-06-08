// ============================================================================
// ECONOMICS CARD — battery cost, interest rate, lifetime → CRF / annualisation
// ============================================================================
import { memo, useMemo } from 'react';
import { fmtMoney } from '../formatUtils';

export const EconomicsCard = memo(({
  batteryCostPerKWh, setBatteryCostPerKWh,
  interestRatePct, setInterestRatePct,
  lifetimeYears, setLifetimeYears,
  crf, capacity
}: {
  batteryCostPerKWh: number;
  setBatteryCostPerKWh: (v: number) => void;
  interestRatePct: number;
  setInterestRatePct: (v: number) => void;
  lifetimeYears: number;
  setLifetimeYears: (v: number) => void;
  crf: number;
  capacity: number;
}) => {
  const capexK    = batteryCostPerKWh * capacity;       // €/MWh × MWh = € (since €/kWh × MWh × 1000 / 1000 = €/kWh × MWh? no)
  // Actually: cost is €/kWh, capacity is MWh. CAPEX [€] = cost [€/kWh] × capacity [MWh] × 1000 [kWh/MWh]
  const capex     = batteryCostPerKWh * capacity * 1000;
  const annualised = capex * crf;

  return (
    <div className="mt-6 card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">Project economics</div>
          <div className="font-display text-base mt-1">Customer capex &amp; financing</div>
        </div>
        <span className="chip">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-amber)' }}></span>
          Annual charge · {(crf * 100).toFixed(2)}% of CAPEX
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
          Battery cost <span className="text-[color:var(--text-faint)]">€/kWh</span>
        </label>
        <input type="number" value={batteryCostPerKWh} min={0} max={2000} step={10}
               onChange={e => setBatteryCostPerKWh(Math.max(0, Number(e.target.value) || 0))}
               className="num-input"/>

        <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
          Interest rate <span className="text-[color:var(--text-faint)]">% / yr</span>
        </label>
        <input type="number" value={interestRatePct} min={0} max={30} step={0.1}
               onChange={e => setInterestRatePct(Math.max(0, Number(e.target.value) || 0))}
               className="num-input"/>

        <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
          Lifetime <span className="text-[color:var(--text-faint)]">years</span>
        </label>
        <input type="number" value={lifetimeYears} min={1} max={50} step={1}
               onChange={e => setLifetimeYears(Math.max(1, Math.round(Number(e.target.value) || 1)))}
               className="num-input"/>
      </div>

      <div className="hairline my-4"></div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>
        <span className="text-[color:var(--text-dim)]">CAPEX (current size)</span>
        <span className="num text-[color:var(--accent-amber)]">{fmtMoney(capex)}</span>

        <span className="text-[color:var(--text-dim)]">Annualised cost</span>
        <span className="num text-[color:var(--accent-amber)]">{fmtMoney(annualised)}/yr</span>


      </div>
    </div>
  );
});

// ============================================================================
// DEGRADATION CARD — Option A (per-MWh wear cost) + Option B (capacity fade)
//
// Option A applies during DP solve: the optimiser sees wear cost as a per-MWh
// throughput penalty and naturally avoids unprofitable cycling.
//
// Option B is shown here as a fade curve (informational); the multi-year NPV
// using these fade params is computed in the Economics card extension below.
// ============================================================================

// Compute capacity retention as a function of year (1-indexed from year 1 → N).
// Two-rate exponential model:
//   fade_rate(y) = LT + (Y1 − LT) · exp(−(y−1)/τ)        // %/year
// where τ (FADE_TAU_YEARS) is the SEI-relaxation time over which the high
// year-1 fade rate decays toward the long-term linear rate. τ ≈ 3–5 years is
// typical for utility-scale Li-ion based on published cell-level data; we use
// τ = 4 years.
//
// Retention[y] = 1 − Σ_{k=1..y} fade_rate(k) / 100
// End-of-life retention = retention[lifetime], reported as a derived quantity.
export const FADE_TAU_YEARS = 4;
export function buildFadeCurve(
  lifetime: number,
  yearOneFadePct: number,
  longTermFadePct: number,
  tau = FADE_TAU_YEARS
): number[] {
  const retention = [1.0];
  let cum = 0;
  for (let y = 1; y <= lifetime; y++) {
    cum += longTermFadePct + (yearOneFadePct - longTermFadePct) * Math.exp(-(y - 1) / tau);
    retention.push(Math.max(0, 1 - cum / 100));
  }
  return retention;
}

export const DegradationCard = memo(({
  wearCost, setWearCost,
  yearOneFadePct, setYearOneFadePct,
  longTermFadePct, setLongTermFadePct,
  lifetimeYears,
  capacity, batteryCostPerKWh
}: {
  wearCost: number;
  setWearCost: (v: number) => void;
  yearOneFadePct: number;
  setYearOneFadePct: (v: number) => void;
  longTermFadePct: number;
  setLongTermFadePct: (v: number) => void;
  lifetimeYears: number;
  capacity: number;
  batteryCostPerKWh: number;
}) => {
  const fadeCurve = useMemo(
    () => buildFadeCurve(lifetimeYears, yearOneFadePct, longTermFadePct),
    [lifetimeYears, yearOneFadePct, longTermFadePct]
  );
  // End-of-life retention is now a *derived* quantity: the last value of the
  // fade curve. Displayed read-only so the user sees the consequence of their
  // Y1 / LT / lifetime choices instead of having to guess a target.
  const endOfLifeFrac = fadeCurve[lifetimeYears];
  const endOfLifePct  = endOfLifeFrac * 100;
  // CAPEX-implied wear cost benchmark for context: distribute total CAPEX over
  // typical lifetime throughput (cycles × capacity × 2 × avg_eff). Helps the
  // user calibrate `wearCost` if they're unsure.
  const capex = batteryCostPerKWh * capacity * 1000;
  const assumedCycles = 6000;        // typical Li-ion at 80% retention
  const lifetimeThroughputMWh = assumedCycles * capacity * 2 * 0.9;
  const benchmarkWear = lifetimeThroughputMWh > 0 ? capex / lifetimeThroughputMWh : 0;

  // Mini sparkline of the fade curve (drawn inline as SVG)
  const W = 240, H = 60, PAD_L = 28, PAD_R = 8, PAD_T = 8, PAD_B = 16;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const xAt = (y: number) => PAD_L + (y / lifetimeYears) * innerW;
  const yAt = (ret: number) => PAD_T + (1 - (ret - 0.5) / 0.5) * innerH; // map 0.5..1.0 to bottom..top
  const linePts = fadeCurve.map((r, i) => `${xAt(i)},${yAt(Math.max(0.5, r))}`).join(' ');

  return (
    <div className="mt-6 card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">Lifetime &amp; throughput</div>
          <div className="font-display text-base mt-1">Cycling cost &amp; capacity fade</div>
        </div>
        <span className="chip">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-rose)' }}></span>
          {(fadeCurve[lifetimeYears] * 100).toFixed(0)}% at EoL
        </span>
      </div>

      <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">
        Throughput cost (per MWh cycled)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
          Wear cost <span className="text-[color:var(--text-faint)]">€/MWh through cells</span>
        </label>
        <input type="number" value={wearCost} min={0} max={200} step={1}
               onChange={e => setWearCost(Math.max(0, Number(e.target.value) || 0))}
               className="num-input"/>
      </div>
      <div className="text-[10px] text-[color:var(--text-faint)] mb-4" style={{ lineHeight: 1.5 }}>
        Aligns dispatch economics with cell stress: each MWh through the pack carries this €/MWh charge.
        Benchmark from CAPEX ÷ ~{assumedCycles} equivalent full cycles ≈ <span className="text-[color:var(--text-dim)]">€{benchmarkWear.toFixed(1)}/MWh</span>.
      </div>

      <div className="hairline my-3"></div>

      <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">
        Capacity retention over time
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
          Year-1 fade <span className="text-[color:var(--text-faint)]">% / yr</span>
        </label>
        <input type="number" value={yearOneFadePct} min={0} max={20} step={0.1}
               onChange={e => setYearOneFadePct(Math.max(0, Number(e.target.value) || 0))}
               className="num-input"/>

        <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
          Long-term fade <span className="text-[color:var(--text-faint)]">% / yr</span>
        </label>
        <input type="number" value={longTermFadePct} min={0} max={10} step={0.1}
               onChange={e => setLongTermFadePct(Math.max(0, Number(e.target.value) || 0))}
               className="num-input"/>

        <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
          End-of-life retention <span className="text-[color:var(--text-faint)]">% nameplate · derived</span>
        </label>
        <div style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--accent-rose)',
          padding: '6px 10px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 13,
          width: 90,
          textAlign: 'right',
          fontWeight: 500,
          cursor: 'default',
          userSelect: 'none',
        }}
        title={`Computed from Y1=${yearOneFadePct}%, LT=${longTermFadePct}%, lifetime=${lifetimeYears}y, τ=${FADE_TAU_YEARS}y`}>
          {endOfLifePct.toFixed(1)}
        </div>
      </div>

      {/* Fade sparkline */}
      <div className="mt-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)',
                                       borderRadius: 4, padding: '6px 4px' }}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
          {/* Y axis labels */}
          <text x={4} y={PAD_T + 4} className="axis-label">100%</text>
          <text x={4} y={PAD_T + innerH/2 + 3} className="axis-label">75%</text>
          <text x={4} y={PAD_T + innerH + 4} className="axis-label">50%</text>
          {/* Grid line at EoL retention */}
          <line x1={PAD_L} x2={W - PAD_R}
                y1={yAt(fadeCurve[lifetimeYears])}
                y2={yAt(fadeCurve[lifetimeYears])}
                stroke="var(--border)" strokeDasharray="2 3"/>
          {/* The fade curve */}
          <polyline points={linePts}
                    fill="none" stroke="var(--accent-rose)" strokeWidth="1.6"/>
          {/* Endpoint dot */}
          <circle cx={xAt(lifetimeYears)} cy={yAt(fadeCurve[lifetimeYears])}
                  r="3" fill="var(--accent-rose)"/>
          {/* X axis labels */}
          <text x={PAD_L} y={H - 3} className="axis-label">0</text>
          <text x={(PAD_L + W - PAD_R)/2 - 6} y={H - 3} className="axis-label">{Math.round(lifetimeYears/2)}y</text>
          <text x={W - PAD_R - 16} y={H - 3} className="axis-label">{lifetimeYears}y</text>
        </svg>
      </div>

    </div>
  );
});
