import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fingerprintSeriesSample, fmtMoney, fmtNumber } from '../formatUtils';
import { buildFadeCurve } from '../panels/economicsDegradation';
import { FullScreenJobOverlay } from '../fullScreenJobOverlay';
import { runOptimizationDelegated } from '../engine/optimizationRunner';
import type { OptimizationParams, Trajectory } from '../engine/types';
import type { OptimizationRunResult } from '../optimizationTypes';

function buildSweepGrid(capacity: number, maxCapacityX: number, pointCount: number): number[] {
  const top = capacity * maxCapacityX;
  const grid: number[] = [];
  for (let i = 0; i <= pointCount; i++) {
    grid.push((i / pointCount) * top);
  }
  const capacityTol = Math.max(1e-9, Math.abs(capacity) * 1e-9);
  if (capacity > 0 && !grid.some(x => Math.abs(x - capacity) <= capacityTol)) {
    grid.push(capacity);
    grid.sort((a, b) => a - b);
  }
  return grid;
}

function plantOnlyRevenue(price: number[], wind: number[], params: OptimizationParams, dt: number): number {
  const gridLimit = params.installedCapacityMW != null && params.installedCapacityMW > 0
    ? params.installedCapacityMW
    : Math.max(params.chargeMax, params.dischargeMax);
  const capE = gridLimit * dt;
  let total = 0;
  for (let t = 0; t < price.length; t++) {
    total += Math.min(wind[t]! * dt, capE) * price[t]!;
  }
  return total;
}

function makeSweepInputKey(
  price: number[],
  wind: number[],
  params: OptimizationParams,
  dt: number,
  maxCapacityX: number,
  pointCount: number,
  scalePower: boolean,
): string {
  return [
    price.length,
    wind.length,
    fingerprintSeriesSample(price, wind),
    dt,
    params.capacity,
    params.chargeMax,
    params.dischargeMax,
    params.chargeEff,
    params.dischargeEff,
    params.initialSOCFrac,
    params.socSteps,
    params.targetDsoc ?? 'auto',
    params.chargeFromGrid === false ? 'plant-only' : 'grid-ok',
    params.wearCost ?? 0,
    params.installedCapacityMW ?? 'fallback-grid-limit',
    maxCapacityX,
    pointCount,
    scalePower ? 'scale-power' : 'fixed-power',
  ].join('|');
}

// ============================================================================
// CAPACITY SWEEP CHART — re-runs the optimiser at multiple battery capacities
// to show the marginal value of storage (revenue uplift vs MWh installed).
// User-triggered (not automatic) because each point is a full DP run.
// Each DP run uses runOptimizationDelegated (Web Worker) when available so
// the UI stays responsive; file:// falls back to sync runOptimization.
// ============================================================================
function sweepTrajTotalRevenue(traj: Trajectory): number {
  let totalRev = 0;
  for (const r of traj) totalRev += r.revenue;
  return totalRev;
}

type SweepPoint = {
  capacity: number;
  revenue: number;
  baseline: number;
  uplift: number;
  upliftPct: number;
};

type SweepResults = { points: SweepPoint[]; scalePower: boolean; inputKey: string; periodToAnnual: number };

export const CapacitySweepChart = memo(({ basePrice, baseWind, baseParams, dt,
  batteryCostPerKWh, crf, interestRatePct, lifetimeYears,
  yearOneFadePct, longTermFadePct,
  runOptimizeBeforeSweep,
  onSweepComplete }: {
    basePrice: number[];
    baseWind: number[];
    baseParams: OptimizationParams;
    dt: number;
    batteryCostPerKWh: number;
    crf: number;
    interestRatePct: number;
    lifetimeYears: number;
    yearOneFadePct: number;
    longTermFadePct: number;
    /** When set, clicking "Run sizing sweep" runs full dispatch optimization first, then the sweep. */
    runOptimizeBeforeSweep?: () => Promise<OptimizationRunResult | null>;
    /**
     * Fires once the sweep finishes (or is cleared). Receives the dispatch
     * result bundle for the financially optimal sweep point, or null when no
     * profitable optimum exists. Used to anchor downstream tables/charts to
     * the optimal battery size.
     */
    onSweepComplete?: (result: OptimizationRunResult | null) => void;
  }) => {
  const [results, setResults] = useState<SweepResults | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);          // 0..1
  const [scalePower, setScalePower] = useState(false);  // 1C scaling toggle
  const [maxCapacityX, setMaxCapacityX] = useState(4);  // sweep up to N× current cap
  const [pointCount, setPointCount] = useState(10);
  const sweepGenRef = useRef(0);

  useEffect(() => () => { sweepGenRef.current++; }, []);

  const currentInputKey = useMemo(
    () => makeSweepInputKey(basePrice, baseWind, baseParams, dt, maxCapacityX, pointCount, scalePower),
    [basePrice, baseWind, baseParams, dt, maxCapacityX, pointCount, scalePower],
  );
  const currentSweepPointCount = useMemo(
    () => buildSweepGrid(baseParams.capacity, maxCapacityX, pointCount).length,
    [baseParams.capacity, maxCapacityX, pointCount],
  );

  useEffect(() => {
    setResults(prev => {
      if (prev && prev.inputKey !== currentInputKey) {
        onSweepComplete?.(null);
        return null;
      }
      return prev;
    });
  }, [currentInputKey, onSweepComplete]);

  const runSweep = useCallback(async (fresh?: OptimizationRunResult | null) => {
    const bp = fresh?.pricePeriod ?? basePrice;
    const bw = fresh?.windPeriod ?? baseWind;
    const bpars = fresh?.params ?? baseParams;
    const sweepDt = fresh?.dt ?? dt;
    const grid = buildSweepGrid(bpars.capacity, maxCapacityX, pointCount);
    const inputKey = makeSweepInputKey(bp, bw, bpars, sweepDt, maxCapacityX, pointCount, scalePower);
    const periodToAnnual = 8760 / Math.max(1, bp.length * sweepDt);

    const gen = ++sweepGenRef.current;
    setRunning(true); setProgress(0); setResults(null);
    try {
      await new Promise(r => setTimeout(r, 20));
      if (sweepGenRef.current !== gen) return;

      const out: SweepPoint[] = [];
      // Retain the trajectory produced at each non-zero sweep point. The
      // optimum is only known after the loop + marginal-value pass, so we
      // keep all of them and pick the matching one when building the
      // callback payload. Max pointCount is 20 → bounded memory.
      const trajByCap = new Map<number, Trajectory>();
      // Use the same plant-only baseline as the optimiser so the current-size
      // sweep point matches the KPI uplift exactly.
      const baseRevenue = plantOnlyRevenue(bp, bw, bpars, sweepDt);

      for (let i = 0; i < grid.length; i++) {
        if (sweepGenRef.current !== gen) return;
        const cap = grid[i]!;
        let totalRev;
        if (cap < 1e-6) {
          totalRev = baseRevenue;
        } else {
          // Scale charge/discharge limits proportionally if the user wants
          // 1C-style sizing (more MWh ⇒ more MW). Otherwise hold them at the
          // sidebar values, answering "given my inverter, how many MWh?"
          const cMax = scalePower ? cap * (bpars.chargeMax / bpars.capacity)
            : bpars.chargeMax;
          const dMax = scalePower ? cap * (bpars.dischargeMax / bpars.capacity)
            : bpars.dischargeMax;
          const params = { ...bpars, capacity: cap, chargeMax: cMax, dischargeMax: dMax };
          const { traj } = await runOptimizationDelegated(bp, bw, params);
          if (sweepGenRef.current !== gen) return;
          totalRev = sweepTrajTotalRevenue(traj);
          trajByCap.set(cap, traj);
        }
        out.push({
          capacity: cap,
          revenue: totalRev,
          baseline: baseRevenue,
          uplift: totalRev - baseRevenue,
          upliftPct: baseRevenue > 0 ? ((totalRev - baseRevenue) / baseRevenue) * 100 : 0,
        });
        setProgress((i + 1) / grid.length);
      }

      if (sweepGenRef.current !== gen) return;



      setResults({ points: out, scalePower, inputKey, periodToAnnual });

      // Build the optimal-size dispatch bundle for the callback. The optimum
      // is the sweep point with the highest positive net annual benefit; if
      // none qualifies we hand back null so downstream views can revert to
      // the applied (sidebar-size) result.
      let optimalResult: OptimizationRunResult | null = null;
      let bestNet = -Infinity;
      let bestIdx = -1;
      for (let i = 1; i < out.length; i++) {
        const cap = out[i]!.capacity;
        // CAPEX-aware net: same formula as the finance layer below.
        const yearOneUplift = out[i]!.uplift * periodToAnnual;
        const capex = cap * 1000 * batteryCostPerKWh;
        const netAnnual = (yearOneUplift * crf) - (capex * crf);
        if (netAnnual > bestNet) { bestNet = netAnnual; bestIdx = i; }
      }
      if (bestIdx > 0 && bestNet > 0) {
        const optCap = out[bestIdx]!.capacity;
        const optTraj = trajByCap.get(optCap);
        if (optTraj) {
          const optCMax = scalePower ? optCap * (bpars.chargeMax / bpars.capacity)
            : bpars.chargeMax;
          const optDMax = scalePower ? optCap * (bpars.dischargeMax / bpars.capacity)
            : bpars.dischargeMax;
          const optParams: OptimizationParams = {
            ...bpars,
            capacity: optCap,
            chargeMax: optCMax,
            dischargeMax: optDMax,
          };
          optimalResult = {
            traj: optTraj,
            params: optParams,
            pricePeriod: bp,
            windPeriod: bw,
            spotWindRescaleKey: fresh?.spotWindRescaleKey ?? '',
            ms: 0,
            ipcOverheadMs: 0,
            usedWorker: false,
            dateRangeLabel: fresh?.dateRangeLabel ?? '',
            chartEpochUtcMs: fresh?.chartEpochUtcMs,
            dt: sweepDt,
            windPeriodMeasured: fresh?.windPeriodMeasured,
            pvReconstructStats: fresh?.pvReconstructStats,
            horizonTrim: fresh?.horizonTrim,
          };
        }
      }
      onSweepComplete?.(optimalResult);
    } catch (e) {
      if (sweepGenRef.current === gen) console.error('Sweep failed:', e);
      onSweepComplete?.(null);
    } finally {
      if (sweepGenRef.current === gen) setRunning(false);
    }
  }, [basePrice, baseWind, baseParams, dt, maxCapacityX, pointCount, scalePower, batteryCostPerKWh, crf, onSweepComplete]);

  const onRunSizingSweep = useCallback(async () => {
    if (runOptimizeBeforeSweep) {
      const fresh = await runOptimizeBeforeSweep();
      if (!fresh) return;
      await runSweep(fresh);
    } else {
      await runSweep();
    }
  }, [runOptimizeBeforeSweep, runSweep]);

  // Capacity fade curve & multi-year NPV factor for Option B.
  // fadeNpvFactor multiplies a "year-1 uplift" to give the levelised annual
  // uplift over the lifetime, accounting for both fade and time discounting.
  // With no fade (all retention = 1) this collapses to 1 (CRF × annuity = 1).
  const { fadeNpvFactor, fadeCurve } = useMemo(() => {
    const curve = buildFadeCurve(lifetimeYears, yearOneFadePct, longTermFadePct);
    const i = interestRatePct / 100;
    let npvWeight = 0;
    for (let y = 1; y <= lifetimeYears; y++) {
      // retention at the start of year y → average over the year
      const ret = (curve[y - 1] + curve[y]) / 2;
      npvWeight += ret / Math.pow(1 + i, y);
    }
    return { fadeNpvFactor: npvWeight * crf, fadeCurve: curve };
  }, [lifetimeYears, yearOneFadePct, longTermFadePct, interestRatePct, crf]);

  // Finance-augmented sweep points: derived without re-running the DP.
  // This means the user can drag battery cost / interest rate / lifetime / fade
  // and the net benefit chart updates instantly.
  const financePoints = useMemo(() => {
    if (!results) return null;
    return results.points.map(p => {
      // Year-1 uplift, extrapolated from the simulated horizon.
      // (With Option A active, p.uplift is already net of wear cost.)
      const annualRevenue = p.revenue * results.periodToAnnual;
      const yearOneUplift = p.uplift * results.periodToAnnual;
      // Levelised annual uplift over the lifetime, with capacity fade & NPV.
      const annualUplift = yearOneUplift * fadeNpvFactor;
      // CAPEX in € (cost is in €/kWh, capacity in MWh)
      const capex = p.capacity * 1000 * batteryCostPerKWh;
      const annualCapex = capex * crf;
      const netAnnual = annualUplift - annualCapex;
      // Simple payback uses levelised annual uplift (with fade & NPV).
      const simplePayback = annualUplift > 0 ? capex / annualUplift : Infinity;
      return {
        ...p,
        annualRevenue, yearOneUplift, annualUplift,
        capex, annualCapex, netAnnual, simplePayback,
      };
    });
  }, [results, batteryCostPerKWh, crf, fadeNpvFactor]);

  // Optimal capacity = where net annual benefit peaks. This is the
  // financially meaningful sizing answer (different from sweetSpot which
  // looks at gross uplift / MWh installed).
  const netOptimum = useMemo(() => {
    if (!financePoints) return null;
    let best = null;
    for (const p of financePoints) {
      if (p.capacity < 1e-6) continue;
      if (!best || p.netAnnual > best.netAnnual) best = p;
    }
    // Only flag as "the optimum" if it's positive; otherwise no investment makes sense.
    return best && best.netAnnual > 0 ? best : null;
  }, [financePoints]);

  // Anchor point for the lifetime breakdown panel.
  // Default = the financially optimal sweep point (netOptimum), so the NPV
  // table and related graphs are organized around the optimal battery size.
  // Fallback = the sweep point closest to the user's current sidebar size
  // when no profitable optimum exists in the swept range.
  // A small toggle (breakdownAnchorMode) lets the user flip back to the
  // current-size view even when an optimum is present.
  const [breakdownAnchorMode, setBreakdownAnchorMode] = useState<'optimal' | 'current'>('optimal');
  const breakdownAnchor = useMemo(() => {
    if (!financePoints) return null;
    const useOptimal = breakdownAnchorMode === 'optimal' && netOptimum;
    if (useOptimal) {
      return financePoints.find(p => Math.abs(p.capacity - netOptimum.capacity) < 1e-9) ?? netOptimum;
    }
    const target = baseParams.capacity;
    let best = financePoints[0];
    let bestDist = Math.abs(best.capacity - target);
    for (const p of financePoints) {
      const d = Math.abs(p.capacity - target);
      if (d < bestDist) { best = p; bestDist = d; }
    }
    return best;
  }, [financePoints, baseParams.capacity, netOptimum, breakdownAnchorMode]);
  const breakdownIsOptimal = !!(netOptimum && breakdownAnchorMode === 'optimal'
    && breakdownAnchor
    && Math.abs(breakdownAnchor.capacity - netOptimum.capacity) < 1e-9);

  // Build the year-by-year breakdown table for the anchor point. Done outside
  // the render so it can be reused (table + downloadable CSV if needed later).
  const breakdownRows = useMemo(() => {
    if (!breakdownAnchor || !fadeCurve) return null;
    const i = interestRatePct / 100;
    const rows = [];
    let cumDiscRev = 0;
    for (let y = 1; y <= lifetimeYears; y++) {
      const retStart = fadeCurve[y - 1];
      const retEnd = fadeCurve[y];
      const retAvg = (retStart + retEnd) / 2;
      const yearRev = breakdownAnchor.yearOneUplift * retAvg;       // €/yr at year y
      const discFac = 1 / Math.pow(1 + i, y);                       // 1/(1+i)^y
      const discRev = yearRev * discFac;                            // PV of year y revenue
      cumDiscRev += discRev;
      rows.push({
        year: y,
        retStart, retEnd, retAvg,
        yearRev, discFac, discRev, cumDiscRev,
      });
    }
    return rows;
  }, [breakdownAnchor, fadeCurve, interestRatePct, lifetimeYears]);

  return (
    <>
      <FullScreenJobOverlay
        open={running}
        eyebrow="Sizing & dispatch sweep"
        title="Running sizing sweep"
        progress={progress}
      />
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Sizing &amp; dispatch sweep</div>
          <div className="font-display text-lg">Revenue marginal benefit vs installed MWh</div>
          <div className="text-xs font-mono text-[color:var(--text-dim)] mt-1">
            {currentSweepPointCount} points from 0 to {(baseParams.capacity * maxCapacityX).toFixed(0)} MWh
          </div>
        </div>
        <button onClick={() => { void onRunSizingSweep(); }} disabled={running}
          className="btn-primary"
          style={{ padding: '10px 18px', fontSize: 13 }}>
          {running ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="spinner"></span>
            sweeping dispatch… {(progress * 100).toFixed(0)}%
          </span>
            : <>Run sizing sweep ↗</>}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4 text-xs font-mono">
        <label className="flex items-center gap-2 text-[color:var(--text-dim)]"
          style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={scalePower}
            onChange={e => setScalePower(e.target.checked)}
            style={{ accentColor: 'var(--accent-teal)' }} />
          <span>scale power with storage size</span>
          <span className="text-[color:var(--text-faint)]">·
            {scalePower
              ? ` charge & discharge power grow with MWh (same ratio as today)`
              : ` charge & discharge limits fixed at ${baseParams.chargeMax} / ${baseParams.dischargeMax} MW`}
          </span>
        </label>
        <div className="flex items-center gap-2 text-[color:var(--text-dim)]" style={{ marginLeft: 'auto' }}>
          <span className="text-[color:var(--text-faint)]">max range ×</span>
          <select value={maxCapacityX} onChange={e => setMaxCapacityX(Number(e.target.value))}>
            <option value="2">2×</option>
            <option value="4">4×</option>
            <option value="6">6×</option>
            <option value="10">10×</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-[color:var(--text-dim)]">
          <span className="text-[color:var(--text-faint)]">points</span>
          <select value={pointCount} onChange={e => setPointCount(Number(e.target.value))}>
            <option value="6">6</option>
            <option value="10">10</option>
            <option value="15">15</option>
            <option value="20">20</option>
          </select>
        </div>
      </div>

      {!results && !running && (
        <div className="card-flush" style={{
          padding: '40px 20px', textAlign: 'center',
          border: '1px dashed var(--border)',
          borderRadius: 4
        }}>
          <div className="text-sm text-[color:var(--text-dim)] mb-2">
            Run {currentSweepPointCount} dispatch optimizations (by MWh size)
          </div>
          <div className="text-[10px] text-[color:var(--text-faint)]">
            Rough runtime ~{(currentSweepPointCount * Math.max(0.05, (basePrice.length * dt) / 8000)).toFixed(1)}s
          </div>
        </div>
      )}

      {financePoints && (
            <div style={{ marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
              <div className="flex flex-wrap items-baseline justify-between mb-3 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Customer ROI view</div>
                  <div className="font-display text-lg">Net annual benefit vs installed MWh</div>
                  <div className="text-[10px] font-mono text-[color:var(--text-faint)] mt-2">
                    Financing spread {(crf * 100).toFixed(2)}% of CAPEX · life {lifetimeYears} yr · fade weight {(fadeNpvFactor * 100).toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Investment KPIs */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="card-flush p-4" style={{ borderRadius: 4 }}>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-faint)] font-mono mb-1">Cost per MWh</div>
                  <div className="num text-lg font-display text-[color:var(--accent-amber)]">
                    {fmtMoney(batteryCostPerKWh * 1000)}
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--text-dim)] mt-1">
                    {batteryCostPerKWh} €/kWh
                  </div>
                </div>
                {netOptimum ? (
                  <>
                    <div className="card-flush p-4" style={{ borderRadius: 4 }}>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-faint)] font-mono mb-1">Optimal capacity</div>
                      <div className="num text-lg font-display text-[color:var(--accent-green)]">
                        {netOptimum.capacity.toFixed(1)} MWh
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="card-flush p-4" style={{
                    borderRadius: 4, gridColumn: 'span 2',
                    borderLeft: '3px solid var(--accent-rose)'
                  }}>
                    <div className="text-[10px] uppercase tracking-[0.15em] font-mono mb-1"
                      style={{ color: 'var(--accent-rose)' }}>
                      No profitable size in this range
                    </div>
                    <div className="text-xs font-mono text-[color:var(--text-dim)]" style={{ lineHeight: 1.5 }}>
                      At {batteryCostPerKWh} €/kWh and {interestRatePct}% interest, annualised CAPEX
                      exceeds optimized marginal benefit at every swept capacity. Try reducing battery
                      cost, lengthening lifetime, or extending the horizon to a full year.
                    </div>
                  </div>
                )}
              </div>

              {/* Chart */}
              <div style={{ width: '100%', height: 380 }}>
                <ResponsiveContainer>
                  <ComposedChart data={financePoints} margin={{ top: 5, right: 16, left: 10, bottom: 16 }}>
                    <defs>
                      <linearGradient id="netBenefitPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-green)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--accent-green)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                    <XAxis type="number" dataKey="capacity"
                      domain={[0, 'dataMax']}
                      tickFormatter={v => `${v.toFixed(0)}`}
                      stroke="var(--text-faint)"
                      label={{
                        value: 'battery capacity (MWh)', position: 'insideBottom',
                        offset: -8, fill: 'var(--text-faint)', fontSize: 10,
                        fontFamily: 'JetBrains Mono'
                      }} />
                    <YAxis stroke="var(--text-faint)" width={70}
                      tickFormatter={v => fmtMoney(v)}
                      label={{
                        value: '€ / year', angle: -90, position: 'insideLeft',
                        fill: 'var(--text-faint)', fontSize: 10,
                        fontFamily: 'JetBrains Mono'
                      }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const p = payload[0].payload;
                        return (
                          <div style={{
                            background: 'rgba(10,14,26,0.96)', border: '1px solid var(--border-strong)',
                            borderRadius: 4, padding: '10px 14px',
                            fontFamily: 'JetBrains Mono, monospace', fontSize: 11
                          }}>
                            <div style={{
                              color: 'var(--text-dim)', marginBottom: 6,
                              fontSize: 10, letterSpacing: '0.05em',
                              textTransform: 'uppercase'
                            }}>
                              {p.capacity.toFixed(1)} MWh
                            </div>
                            <div style={{
                              display: 'grid', gridTemplateColumns: 'auto auto',
                              gap: '2px 16px'
                            }}>
                              <span style={{ color: 'var(--accent-teal)' }}>annual marginal benefit</span>
                              <span style={{ textAlign: 'right' }}>{fmtMoney(p.annualUplift)}</span>
                              <span style={{ color: 'var(--accent-amber)' }}>annual capex</span>
                              <span style={{ textAlign: 'right' }}>−{fmtMoney(p.annualCapex)}</span>
                              <span style={{ color: p.netAnnual >= 0 ? 'var(--accent-green)' : 'var(--accent-rose)' }}>net annual</span>
                              <span style={{
                                textAlign: 'right',
                                color: p.netAnnual >= 0 ? 'var(--accent-green)' : 'var(--accent-rose)'
                              }}>
                                {fmtMoney(p.netAnnual)}
                              </span>
                              <span style={{ color: 'var(--text-faint)' }}>capex (total)</span>
                              <span style={{ textAlign: 'right' }}>{fmtMoney(p.capex)}</span>
                              <span style={{ color: 'var(--text-faint)' }}>simple payback</span>
                              <span style={{ textAlign: 'right' }}>
                                {isFinite(p.simplePayback) ? p.simplePayback.toFixed(1) + ' yr' : '—'}
                              </span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="3 3" />
                    <Line type="monotone" dataKey="annualUplift" name="annual marginal benefit"
                      stroke="var(--accent-teal)" strokeWidth={1.5}
                      strokeDasharray="4 4"
                      dot={{ fill: 'var(--accent-teal)', r: 2, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="annualCapex" name="annual capex (cost)"
                      stroke="var(--accent-amber)" strokeWidth={1.5}
                      strokeDasharray="2 4"
                      dot={false} />
                    <Area type="monotone" dataKey="netAnnual" name="net annual benefit"
                      fill="url(#netBenefitPos)"
                      stroke="var(--accent-green)" strokeWidth={2.4}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        if (!payload || payload.capacity < 1e-6) return <g />;
                        return (
                          <circle cx={cx} cy={cy} r={3.5}
                            fill={payload.netAnnual >= 0 ? 'var(--accent-green)' : 'var(--accent-rose)'}
                            stroke="none" />
                        );
                      }} />
                    {netOptimum && (
                      <ReferenceLine x={netOptimum.capacity}
                        stroke="var(--accent-green)" strokeDasharray="2 4"
                        strokeWidth={1.5}
                        label={{
                          value: `optimum ${netOptimum.capacity.toFixed(0)} MWh`,
                          position: 'top', fill: 'var(--accent-green)',
                          fontSize: 10, fontFamily: 'JetBrains Mono'
                        }} />
                    )}
                    <ReferenceLine x={baseParams.capacity}
                      stroke="var(--text-faint)" strokeDasharray="2 4"
                      strokeWidth={1}
                      label={{
                        value: 'current',
                        position: 'top', fill: 'var(--text-faint)',
                        fontSize: 10, fontFamily: 'JetBrains Mono'
                      }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="flex flex-wrap gap-4 mt-3 text-[10px] font-mono text-[color:var(--text-dim)]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3" style={{
                    height: 1.5, background: 'var(--accent-teal)',
                    backgroundImage: 'repeating-linear-gradient(90deg, var(--accent-teal) 0 4px, transparent 4px 8px)'
                  }}></span>
                  annual marginal benefit (revenue)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3" style={{
                    height: 1.5, background: 'var(--accent-amber)',
                    backgroundImage: 'repeating-linear-gradient(90deg, var(--accent-amber) 0 2px, transparent 2px 6px)'
                  }}></span>
                  annual capex (cost)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3" style={{ height: 2.5, background: 'var(--accent-green)' }}></span>
                  net annual benefit
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-3 h-px" style={{ background: 'var(--accent-green)' }}></span>
                  optimum
                </span>
              </div>

            </div>
          )}

          {/* ====================================================== */}
          {/* THIRD CHART/PANEL: HOW FADE & NPV WERE APPLIED          */}
          {/* ====================================================== */}
          {breakdownAnchor && breakdownRows && (
            <div style={{ marginTop: 36, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
              <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Lifetime cash bridge</div>
                  <div className="font-display text-lg">
                    Fade &amp; discount ·{' '}
                    <span style={{ color: breakdownIsOptimal ? 'var(--accent-green)' : 'var(--text)' }}>
                      {breakdownAnchor.capacity.toFixed(1)} MWh
                    </span>
                    {' '}
                    <span className="text-xs font-mono" style={{
                      color: breakdownIsOptimal ? 'var(--accent-green)' : 'var(--text-faint)',
                      letterSpacing: '0.05em', textTransform: 'uppercase'
                    }}>
                      {breakdownIsOptimal ? '◆ optimal size' : '◆ current size'}
                    </span>
                  </div>
                </div>
                {netOptimum && (
                  <div className="flex items-center gap-1 text-[10px] font-mono"
                    style={{ border: '1px solid var(--border)', borderRadius: 4, padding: 2 }}>
                    <button
                      onClick={() => setBreakdownAnchorMode('optimal')}
                      style={{
                        padding: '4px 10px', borderRadius: 3,
                        background: breakdownAnchorMode === 'optimal' ? 'var(--accent-green)' : 'transparent',
                        color: breakdownAnchorMode === 'optimal' ? 'var(--bg)' : 'var(--text-dim)',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        cursor: 'pointer', border: 'none',
                      }}
                      title="Show the NPV table for the financially optimal sweep point"
                    >
                      optimal ({netOptimum.capacity.toFixed(0)} MWh)
                    </button>
                    <button
                      onClick={() => setBreakdownAnchorMode('current')}
                      style={{
                        padding: '4px 10px', borderRadius: 3,
                        background: breakdownAnchorMode === 'current' ? 'var(--surface-2)' : 'transparent',
                        color: breakdownAnchorMode === 'current' ? 'var(--text)' : 'var(--text-dim)',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        cursor: 'pointer', border: 'none',
                      }}
                      title="Show the NPV table for the sweep point closest to the current sidebar capacity"
                    >
                      current ({baseParams.capacity.toFixed(0)} MWh)
                    </button>
                  </div>
                )}
              </div>

              {/* ---- The fade-curve chart proper ---- */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                <div className="card-flush p-4" style={{ borderRadius: 4 }}>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-faint)] font-mono mb-2">Capacity retained each year</div>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={breakdownRows} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="year" stroke="var(--text-faint)"
                          label={{
                            value: 'year', position: 'insideBottom', offset: -2,
                            fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono'
                          }} />
                        <YAxis stroke="var(--text-faint)" domain={[0.5, 1]}
                          tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const p = payload[0].payload;
                          return (
                            <div style={{
                              background: 'rgba(10,14,26,0.96)', border: '1px solid var(--border-strong)',
                              borderRadius: 4, padding: '8px 12px',
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 11
                            }}>
                              <div style={{
                                color: 'var(--text-dim)', fontSize: 10, marginBottom: 4,
                                textTransform: 'uppercase', letterSpacing: '0.05em'
                              }}>year {p.year}</div>
                              <div>retention: <span style={{ color: 'var(--accent-rose)' }}>{(p.retAvg * 100).toFixed(2)}%</span></div>
                              <div>year revenue: <span style={{ color: 'var(--text)' }}>{fmtMoney(p.yearRev)}</span></div>
                            </div>
                          );
                        }} />
                        <Area type="monotone" dataKey="retAvg" name="retention"
                          fill="var(--accent-rose)" fillOpacity={0.18}
                          stroke="var(--accent-rose)" strokeWidth={1.6} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="card-flush p-4" style={{ borderRadius: 4 }}>
                  <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-faint)] font-mono mb-2">Yearly marginal benefit (nominal vs discounted)</div>
                  <div style={{ width: '100%', height: 220 }}>
                    <ResponsiveContainer>
                      <ComposedChart data={breakdownRows} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="year" stroke="var(--text-faint)"
                          label={{
                            value: 'year', position: 'insideBottom', offset: -2,
                            fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono'
                          }} />
                        <YAxis stroke="var(--text-faint)" tickFormatter={v => fmtMoney(v)} width={48} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const p = payload[0].payload;
                          return (
                            <div style={{
                              background: 'rgba(10,14,26,0.96)', border: '1px solid var(--border-strong)',
                              borderRadius: 4, padding: '8px 12px',
                              fontFamily: 'JetBrains Mono, monospace', fontSize: 11
                            }}>
                              <div style={{
                                color: 'var(--text-dim)', fontSize: 10, marginBottom: 4,
                                textTransform: 'uppercase', letterSpacing: '0.05em'
                              }}>year {p.year}</div>
                              <div>nominal: <span style={{ color: 'var(--accent-amber)' }}>{fmtMoney(p.yearRev)}</span></div>
                              <div>discount factor: <span style={{ color: 'var(--accent-violet)' }}>{p.discFac.toFixed(4)}</span></div>
                              <div>present value: <span style={{ color: 'var(--accent-green)' }}>{fmtMoney(p.discRev)}</span></div>
                            </div>
                          );
                        }} />
                        <Bar dataKey="yearRev" name="nominal €" fill="var(--accent-amber)" fillOpacity={0.35} />
                        <Bar dataKey="discRev" name="discounted €" fill="var(--accent-green)" fillOpacity={0.85} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-[color:var(--text-faint)] mt-2" style={{ lineHeight: 1.5 }}>
                    Amber: cash marginal benefit before discount · Green: contribution after discounting at {interestRatePct}%
                  </div>
                </div>
              </div>

              {/* ---- The detailed table ---- */}
              <details className="card-flush" style={{ borderRadius: 4 }}>
                <summary className="p-4 text-xs text-[color:var(--text-dim)]" style={{ userSelect: 'none' }}>
                  <span style={{ color: 'var(--accent-teal)' }}>▸</span>
                  {' '}Year-by-year detail ({breakdownRows.length} rows)
                </summary>
                <div style={{
                  overflowX: 'auto', overflowY: 'auto', maxHeight: 420,
                  borderTop: '1px solid var(--border)'
                }}>
                  <table style={{
                    width: '100%', borderCollapse: 'collapse',
                    fontFamily: 'JetBrains Mono, monospace', fontSize: 11
                  }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
                      <tr>
                        {[
                          ['year', 'Year'],
                          ['retention', 'Retention'],
                          ['year-rev', 'Year revenue'],
                          ['disc-fac', 'Discount'],
                          ['pv', 'Present value'],
                          ['cum-pv', 'Cumulative PV'],
                        ].map(([_, lbl]) => (
                          <th key={lbl} style={{
                            padding: '8px 12px', textAlign: 'right',
                            fontSize: 10, fontWeight: 500, letterSpacing: '0.05em',
                            textTransform: 'uppercase', color: 'var(--text-faint)',
                            borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap'
                          }}>{lbl}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownRows.map((r, idx) => (
                        <tr key={r.year} style={{ background: idx % 2 ? 'var(--surface)' : 'transparent' }}>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--text-faint)'
                          }}>{r.year}</td>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--accent-rose)'
                          }}>{(r.retAvg * 100).toFixed(2)}%</td>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--accent-amber)'
                          }}>{fmtMoney(r.yearRev)}</td>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--accent-violet)'
                          }}>{r.discFac.toFixed(4)}</td>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--accent-green)'
                          }}>{fmtMoney(r.discRev)}</td>
                          <td style={{
                            padding: '6px 12px', textAlign: 'right', borderBottom: '1px solid var(--border)',
                            color: 'var(--text)'
                          }}>{fmtMoney(r.cumDiscRev)}</td>
                        </tr>
                      ))}
                      {/* Total row */}
                      <tr style={{ background: 'var(--surface-2)', fontWeight: 600 }}>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-dim)' }}>Σ</td>
                        <td colSpan={3} style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-faint)' }}>
                          Present value of marginal benefit stream:
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--accent-green)' }}>
                          {fmtMoney(breakdownRows[breakdownRows.length - 1].cumDiscRev)}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-faint)' }}>
                          × annual charge {(crf * 100).toFixed(2)}%
                        </td>
                      </tr>
                      <tr style={{ background: 'var(--surface-2)', fontWeight: 600 }}>
                        <td colSpan={5} style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--text-dim)' }}>
                          → equivalent yearly uplift:
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--accent-teal)' }}>
                          {fmtMoney(breakdownAnchor.annualUplift)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>

            </div>
          )}
    </div>
    </>
  );
});
