import { memo, useCallback, useMemo, type ReactNode } from 'react';
import {
  Area, Bar, BarChart, Brush, CartesianGrid, ComposedChart, Line,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { fmtMoney, fmtNumber, plotAll, tsLabel, DEFAULT_TS_EPOCH_MS } from '../formatUtils';
import { computeTariffBreakdown } from '../finance';
import { LegendChip, useIsolation, useZoom, ZoomBadge } from './chartInteractions';
import { KPI, Tip } from '../uiPrimitives';
import type { OptimizationRunResult } from '../optimizationTypes';

export function Header({ onLogout }: { onLogout?: () => void }) {
  return (
    <header className="border-b border-[color:var(--border)]">
      <div className="w-full px-6 py-4 flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
        <div className="flex items-center gap-3 min-w-0">
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
            <circle cx="16" cy="16" r="15" stroke="var(--accent-teal)" strokeWidth="1.5"/>
            <path d="M8 20 L14 14 L18 18 L24 10" stroke="var(--accent-teal)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
            <circle cx="24" cy="10" r="2" fill="var(--accent-amber)"/>
          </svg>
          <div className="min-w-0">
            <div className="font-display text-lg leading-none">Plant BESS studio</div>
            <div className="text-xs text-[color:var(--text-dim)] mt-1">
              Improve battery utilization at the power plant.
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs font-mono text-[color:var(--text-dim)]">
          <span className="chip border-[color:var(--accent-teal)]/35 bg-[color:var(--accent-teal)]/08">
            EPİAŞ market signals
          </span>
          <span className="hidden sm:inline chip">PTF / plant series</span>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="chip border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)] transition-colors"
            >
              Log out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--border)] mt-10">
      <div className="w-full px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[color:var(--text-faint)]">
        <div>Mathematical optimization is based on a deterministic approach.</div>
      </div>
    </footer>
  );
}

function FinancialBreakdownCell({ label, value, tone }: {
  label: string;
  value: string;
  tone: 'teal' | 'amber' | 'green' | 'rose' | 'faint';
}) {
  const toneClass = tone === 'teal' ? 'text-[color:var(--accent-teal)]'
                  : tone === 'amber' ? 'text-[color:var(--accent-amber)]'
                  : tone === 'green' ? 'text-[color:var(--accent-green)]'
                  : tone === 'rose' ? 'text-[color:var(--accent-rose)]'
                  : 'text-[color:var(--text-faint)]';
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-faint)] font-mono leading-none mb-0.5">{label}</div>
      <div className={`num text-xl font-display font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

export const KPIRow = memo(({ result, region }: {
  result: OptimizationRunResult;
  region: string | null;
}) => {
  const { traj, dt } = result;
  const stats = useMemo(() => {
    let totalRev = 0, windOnlyRev = 0;
    let exportEnergy = 0, importEnergy = 0;
    let exportRevenue = 0, importCost = 0;
    let chargeHours = 0, dischargeHours = 0, idleHours = 0;
    let batteryThroughputMWh = 0;
    let priceSum = 0;
    let windEnergyMWh = 0;
    let hybridExportMWh = 0;
    for (const r of traj) {
      totalRev += r.revenue;
      windOnlyRev += r.windOnlyRevenue;
      priceSum += r.price;
      // gridTotal is MW; energy this step = gridTotal * dt (MWh)
      const stepEnergy = r.gridTotal * dt;
      windEnergyMWh += r.wind * dt;
      if (stepEnergy > 0) {
        exportEnergy    += stepEnergy;
        exportRevenue   += stepEnergy * r.price;        // € received
        hybridExportMWh += stepEnergy;
      } else if (stepEnergy < 0) {
        importEnergy += -stepEnergy;
        importCost   += -stepEnergy * r.price;        // € paid (positive)
      }
      if (r.action > 0.001) {
        dischargeHours += dt;
        batteryThroughputMWh += r.action * dt;
      } else if (r.action < -0.001) {
        chargeHours += dt;
        batteryThroughputMWh += -r.action * dt;
      } else {
        idleHours += dt;
      }
    }
    const capacity = result.params.capacity;
    const cycles = batteryThroughputMWh / (2 * capacity);
    const uplift = totalRev - windOnlyRev;
    const upliftPct = windOnlyRev > 0 ? (uplift / windOnlyRev) * 100 : 0;

    // Energy-weighted average prices.
    // SELL: average price the system received per MWh exported to the grid.
    // BUY:  average price the system paid per MWh imported (charging).
    const avgSellPrice = exportEnergy > 0 ? exportRevenue / exportEnergy : null;
    const avgBuyPrice  = importEnergy > 0 ? importCost   / importEnergy : null;
    const avgPrice     = priceSum / Math.max(1, traj.length);
    const spread       = (avgSellPrice != null && avgBuyPrice != null)
                          ? avgSellPrice - avgBuyPrice : null;

    return { totalRev, windOnlyRev, uplift, upliftPct, cycles,
             chargeHours, dischargeHours, idleHours,
             exportEnergy, importEnergy,
             windEnergyMWh, hybridExportMWh,
             avgSellPrice, avgBuyPrice, avgPrice, spread };
  }, [traj, result.params.capacity, dt]);

  const breakdown = useMemo(() => {
    const gross = traj.reduce((s, r) => s + r.windOnlyRevenue, 0);
    const hybrid = traj.reduce((s, r) => s + r.revenue, 0);
    if (!region) {
      return {
        grossRevenueEUR: gross,
        oAndMEUR: null as number | null,
        transmissionEUR: null as number | null,
        netRevenueEUR: null as number | null,
        incrementalEUR: hybrid - gross,
      };
    }
    const b = computeTariffBreakdown({
      traj: result.traj,
      dt: result.dt,
      periodStartMs: result.chartEpochUtcMs ?? DEFAULT_TS_EPOCH_MS,
      region: Number(region),
      installedMW: result.params.installedCapacityMW
                    ?? Math.max(result.params.chargeMax, result.params.dischargeMax),
    });
    return {
      grossRevenueEUR: b.grossRevenueEUR,
      oAndMEUR: b.oAndMEUR,
      transmissionEUR: b.transmissionEUR,
      netRevenueEUR: b.netRevenueEUR,
      incrementalEUR: b.incrementalEUR,
    };
  }, [traj, result, region]);

  const incrValue = breakdown.incrementalEUR;
  let incrPct: number | null = null;
  let incrSub: ReactNode = result.dateRangeLabel;
  if (region && breakdown.netRevenueEUR != null && breakdown.netRevenueEUR > 0) {
    incrPct = (breakdown.incrementalEUR / breakdown.netRevenueEUR) * 100;
    incrSub  = `${incrPct >= 0 ? '+' : ''}${incrPct.toFixed(1)}% vs net plant`;
  } else if (!region && stats.windOnlyRev > 0) {
    incrPct = (breakdown.incrementalEUR / stats.windOnlyRev) * 100;
    incrSub  = `${incrPct >= 0 ? '+' : ''}${incrPct.toFixed(1)}% vs baseline`;
  }
  const incrDelta = incrPct ?? undefined;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      <KPI label="Hybrid revenue (optimized dispatch)"  value={fmtMoney(stats.totalRev)}
           sub={result.dateRangeLabel} tone="teal"/>
      <KPI
        label="Revenue"
        value={
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 -mt-2">
            <FinancialBreakdownCell label="Gross Revenue" tone="teal"
              value={fmtMoney(breakdown.grossRevenueEUR)} />
            <FinancialBreakdownCell label="NET Revenue"
              tone={breakdown.netRevenueEUR == null ? 'faint'
                  : breakdown.netRevenueEUR >= 0 ? 'green' : 'rose'}
              value={breakdown.netRevenueEUR == null ? '—' : fmtMoney(breakdown.netRevenueEUR)} />
          </div>
        }
      />
      <KPI
        label="Costs"
        value={
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 -mt-2">
            <FinancialBreakdownCell label="O&M Cost" tone="rose"
              value={breakdown.oAndMEUR == null ? '—' : fmtMoney(breakdown.oAndMEUR)} />
            <FinancialBreakdownCell label="Transmission Cost" tone="rose"
              value={breakdown.transmissionEUR == null ? '—' : fmtMoney(breakdown.transmissionEUR)} />
          </div>
        }
      />
      <KPI label="Incremental revenue from BESS" value={fmtMoney(incrValue)}
           sub={incrSub} tone="green" delta={incrDelta}/>
      <KPI label="Avg. selling price"
           value={stats.avgSellPrice != null ? `€${stats.avgSellPrice.toFixed(2)}` : '—'}
           sub={stats.avgSellPrice != null
                   ? `${stats.exportEnergy.toFixed(0)} MWh sold · ${(stats.avgSellPrice - stats.avgPrice >= 0 ? '+' : '')}€${(stats.avgSellPrice - stats.avgPrice).toFixed(2)} vs avg`
                   : 'no exports'}
           tone="teal"/>
      <KPI label="Equivalent full cycles" value={stats.cycles.toFixed(1)}
           sub={`${stats.chargeHours.toFixed(0)} h charge · ${stats.dischargeHours.toFixed(0)} h discharge · utilization`} tone="violet"/>
    </div>
  );
});

// Total generation summary — visible as soon as data is loaded, even before
// optimization. "Plant only" derives directly from the input wind series; the
// "With BESS" cell populates once an optimize run lands.
export const TotalGenerationCard = memo(({
  customData,
  appliedResult,
}: {
  customData: { wind: number[] } | null;
  appliedResult: OptimizationRunResult | null;
}) => {
  const { windEnergyMWh, hybridExportMWh } = useMemo(() => {
    const dt = 1.0;
    const wind = customData?.wind ?? [];
    let wMwh = 0;
    for (const w of wind) wMwh += w * dt;

    let hMwh = 0;
    if (appliedResult) {
      const tdt = appliedResult.dt;
      for (const r of appliedResult.traj) {
        const e = r.gridTotal * tdt;
        if (e > 0) hMwh += e;
      }
    }
    return { windEnergyMWh: wMwh, hybridExportMWh: hMwh };
  }, [customData, appliedResult]);

  if (!customData) return null;

  const battContributionMWh = hybridExportMWh - windEnergyMWh;
  const battContributionPct = windEnergyMWh > 0
    ? (battContributionMWh / windEnergyMWh) * 100
    : 0;
  const sign = battContributionMWh >= 0 ? '+' : '−';
  const absMwh = Math.round(Math.abs(battContributionMWh)).toLocaleString();
  const fmtMwh = (v: number) => Math.round(v).toLocaleString();

  return (
    <div className="mb-6">
      <KPI
        label="Total generation"
        value={
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 -mt-2">
            <FinancialBreakdownCell label="Plant only" tone="amber"
              value={`${fmtMwh(windEnergyMWh)} MWh`} />
            <FinancialBreakdownCell label="With BESS" tone="teal"
              value={appliedResult ? `${fmtMwh(hybridExportMWh)} MWh` : '—'} />
          </div>
        }
        sub={
          windEnergyMWh > 0
            ? appliedResult
              ? `${sign}${absMwh} MWh (${sign}${Math.abs(battContributionPct).toFixed(1)}%) from BESS`
              : 'Optimize to see BESS contribution'
            : 'no generation loaded'
        }
      />
    </div>
  );
});

// ---- CHART 1: Price + generation overlay ----
export type SpotWindChartProps = {
  price: number[];
  wind: number[];
  dt: number;
  chartEpochUtcMs?: number;
};

export const ChartsPanel = memo(({ price, wind, dt, chartEpochUtcMs }: SpotWindChartProps) => {
  const n = price.length;
  const data = useMemo(
    () => plotAll(price.map((p, i) => ({ t: i, price: p, wind: wind[i]! }))),
    [price, wind],
  );
  const showTime = dt < 1;
  const zoom = useZoom(data.length);
  const iso = useIsolation();
  const hourAt = useCallback((i: number) => Math.min(Number(i), n - 1) * dt, [n, dt]);
  const tsAt = useCallback(
    (i: number, withTime = showTime) => tsLabel(hourAt(i), withTime, chartEpochUtcMs),
    [hourAt, showTime, chartEpochUtcMs],
  );

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Plant &amp; market inputs</div>
          <div className="font-display text-lg">
            Spot price &amp; plant generation
            <ZoomBadge zoom={zoom} dataLength={data.length} dt={dt} hourAtIndex={hourAt} epochUtcMs={chartEpochUtcMs} />
          </div>
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-[color:var(--text-dim)]">
          <LegendChip iso={iso} isoKey="price" label="price €/MWh"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-teal)' }}></span>}/>
          <LegendChip iso={iso} isoKey="wind" label="generation MW"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-amber)' }}></span>}/>
        </div>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart key={zoom.resetKey} data={data} margin={{ top: 5, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="idx" tickFormatter={i => tsAt(Number(i))}
                   minTickGap={60} stroke="var(--text-faint)"/>
            <YAxis yAxisId="left" stroke="var(--text-faint)" width={44}
                   label={{ value: '€/MWh', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <YAxis yAxisId="right" orientation="right" stroke="var(--text-faint)" width={44}
                   label={{ value: 'MW', angle: 90, position: 'insideRight', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <Tooltip content={<Tip labelFormatter={i => tsAt(Number(i))}/>}/>
            <Area yAxisId="right" type="monotone" dataKey="wind" name="generation" hide={!iso.active('wind')}
                  fill="var(--accent-amber)" fillOpacity={0.25} stroke="var(--accent-amber)" strokeWidth={1.2}/>
            <Line yAxisId="left" type="monotone" dataKey="price" name="price" hide={!iso.active('price')}
                  stroke="var(--accent-teal)" dot={false} strokeWidth={1.4}/>
            <Brush dataKey="idx" height={26} stroke="var(--accent-teal)"
                   fill="var(--bg)" travellerWidth={8}
                   onChange={zoom.onChange}
                   tickFormatter={i => tsAt(Number(i), false)}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- PV reconstruction: measured vs reconstructed generation ----
export const PvGenerationCompareChart = memo(({ result }: { result: OptimizationRunResult }) => {
  const measured = result.windPeriodMeasured;
  const { windPeriod, traj, dt, pvReconstructStats } = result;
  const hasData = !!measured && measured.length === traj.length;

  const data = useMemo(() => {
    if (!hasData || !measured) return [];
    return plotAll(traj.map((r, i) => ({
      t: r.t,
      measured: measured[i],
      reconstructed: windPeriod[i] ?? r.wind,
    })));
  }, [hasData, traj, measured, windPeriod]);

  const showTime = dt < 1;
  const zoom = useZoom(data.length);
  const iso = useIsolation();

  const { diffMwh, measuredTotalMwh, reconstructedTotalMwh } = useMemo(() => {
    if (!hasData || !measured) return { diffMwh: 0, measuredTotalMwh: 0, reconstructedTotalMwh: 0 };
    let diff = 0;
    let measuredSum = 0;
    let reconSum = 0;
    for (let i = 0; i < traj.length; i++) {
      const recon = windPeriod[i] ?? traj[i].wind;
      diff += recon - measured[i];
      measuredSum += measured[i];
      reconSum += recon;
    }
    return {
      diffMwh: diff * dt,
      measuredTotalMwh: measuredSum * dt,
      reconstructedTotalMwh: reconSum * dt,
    };
  }, [hasData, traj, measured, windPeriod, dt]);

  const netPct = measuredTotalMwh > 0 ? (diffMwh / measuredTotalMwh) * 100 : null;
  const fmtMwh = (v: number) => Math.round(v).toLocaleString();
  const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}`;

  if (!hasData) return null;

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">PV clipping reconstruction</div>
          <div className="font-display text-lg">
            Measured vs reconstructed generation
            <ZoomBadge zoom={zoom} dataLength={data.length} dt={dt} traj={traj} epochUtcMs={result.chartEpochUtcMs} />
          </div>
          {pvReconstructStats && (
            <div className="text-[11px] font-mono text-[color:var(--text-dim)] mt-1">
              {fmtMwh(measuredTotalMwh)} MWh measured
              {' · '}
              {fmtMwh(reconstructedTotalMwh)} MWh reconstructed
              {' · '}
              {pvReconstructStats.clippedHours.toLocaleString()} h adjusted
              {' · '}
              {fmtMwh(pvReconstructStats.recoveredEnergyMWh)} MWh recovered (recon − measured)
              {' · '}
              net Δ {fmtPct(diffMwh)} MWh
              {netPct != null && (
                <> ({fmtPct(netPct)}%)</>
              )}
              {' '}over horizon
            </div>
          )}
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-[color:var(--text-dim)]">
          <LegendChip iso={iso} isoKey="measured" label="measured MW"
            swatch={<span className="inline-block w-2 h-2 rounded-full border border-[color:var(--text-faint)]" style={{ background: 'var(--text-dim)' }}></span>}/>
          <LegendChip iso={iso} isoKey="reconstructed" label="reconstructed MW"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-teal)' }}></span>}/>
        </div>
      </div>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart key={zoom.resetKey} data={data} margin={{ top: 5, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="idx" tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length - 1)].t * dt, showTime, result.chartEpochUtcMs)}
                   minTickGap={60} stroke="var(--text-faint)"/>
            <YAxis stroke="var(--text-faint)" width={48}
                   label={{ value: 'MW', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <Tooltip content={<Tip labelFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length - 1)].t * dt, true, result.chartEpochUtcMs)}/>}/>
            <Line type="monotone" dataKey="measured" name="measured" hide={!iso.active('measured')}
                  stroke="var(--text-dim)" dot={false} strokeWidth={1.2} strokeDasharray="4 3"/>
            <Line type="monotone" dataKey="reconstructed" name="reconstructed" hide={!iso.active('reconstructed')}
                  stroke="var(--accent-teal)" dot={false} strokeWidth={1.6}/>
            <Brush dataKey="idx" height={26} stroke="var(--accent-teal)"
                   fill="var(--bg)" travellerWidth={8}
                   onChange={zoom.onChange}
                   tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length - 1)].t * dt, false, result.chartEpochUtcMs)}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- CHART 2: Battery SOC + action ----
export const DispatchChart = memo(({ result }: { result: OptimizationRunResult }) => {
  const { traj, dt } = result;
  // Plot every trajectory point — SOC and dispatch values match the table.
  const data = useMemo(() => plotAll(traj.map(r => ({
    t: r.t, soc: r.soc,
    charge:    r.action < 0 ? r.action : 0,
    discharge: r.action > 0 ? r.action : 0,
  }))), [traj]);
  const showTime = dt < 1;
  const zoom = useZoom(data.length);
  const iso = useIsolation();

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between mb-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Dispatch &amp; state of charge</div>
          <div className="font-display text-lg">
            Stored energy &amp; charge / discharge power
            <ZoomBadge zoom={zoom} dataLength={data.length} dt={dt} traj={traj} epochUtcMs={result.chartEpochUtcMs} />
          </div>
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-[color:var(--text-dim)]">
          <LegendChip iso={iso} isoKey="soc" label="stored energy (MWh)"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-violet)' }}></span>}/>
          <LegendChip iso={iso} isoKey="discharge" label="discharge MW"
            swatch={<span className="inline-block w-2 h-2" style={{ background: 'var(--accent-teal)' }}></span>}/>
          <LegendChip iso={iso} isoKey="charge" label="charge MW"
            swatch={<span className="inline-block w-2 h-2" style={{ background: 'var(--accent-rose)' }}></span>}/>
        </div>
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer>
          <ComposedChart key={zoom.resetKey} data={data} margin={{ top: 5, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="idx" tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}
                   minTickGap={60} stroke="var(--text-faint)"/>
            <YAxis yAxisId="left" stroke="var(--text-faint)" width={44}
                   label={{ value: 'MWh', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <YAxis yAxisId="right" orientation="right" stroke="var(--text-faint)" width={44}
                   label={{ value: 'MW', angle: 90, position: 'insideRight', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <Tooltip content={<Tip labelFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}/>}/>
            <ReferenceLine y={0} yAxisId="right" stroke="var(--border-strong)" strokeDasharray="2 2"/>
            <Bar yAxisId="right" dataKey="discharge" name="discharge" hide={!iso.active('discharge')}
                 fill="var(--accent-teal)" fillOpacity={0.7}/>
            <Bar yAxisId="right" dataKey="charge" name="charge" hide={!iso.active('charge')}
                 fill="var(--accent-rose)" fillOpacity={0.85}/>
            <Line yAxisId="left" type="monotone" dataKey="soc" name="stored energy" hide={!iso.active('soc')}
                  stroke="var(--accent-violet)" dot={false} strokeWidth={1.6}/>
            <Brush dataKey="idx" height={26} stroke="var(--accent-violet)"
                   fill="var(--bg)" travellerWidth={8}
                   onChange={zoom.onChange}
                   tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, false, result.chartEpochUtcMs)}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- CHART 2b: Battery action overlaid with price (arbitrage view) ----
export const BatteryVsPriceChart = memo(({ result }: { result: OptimizationRunResult }) => {
  const { traj, dt } = result;
  // Plot every trajectory point — each bar / line dot is an exact trajectory
  // value that you can find verbatim in the operation table.
  const data = useMemo(() => plotAll(traj.map(r => ({
    t: r.t,
    price: r.price,
    charge:    r.action < 0 ? r.action : 0,
    discharge: r.action > 0 ? r.action : 0,
  }))), [traj]);
  const showTime = dt < 1;
  const zoom = useZoom(data.length);
  const iso = useIsolation();

  // Useful reference: average price for the horizon
  const avgPrice = useMemo(() => {
    let s = 0; for (const r of traj) s += r.price;
    return s / traj.length;
  }, [traj]);

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between mb-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Market-aligned dispatch</div>
          <div className="font-display text-lg">
            Battery action vs spot price
            <ZoomBadge zoom={zoom} dataLength={data.length} dt={dt} traj={traj} epochUtcMs={result.chartEpochUtcMs} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] font-mono text-[color:var(--text-dim)]">
          <LegendChip iso={iso} isoKey="price" label="price €/MWh"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-amber)' }}></span>}/>
          <LegendChip iso={iso} isoKey="discharge" label="discharge MW"
            swatch={<span className="inline-block w-2 h-2" style={{ background: 'var(--accent-teal)' }}></span>}/>
          <LegendChip iso={iso} isoKey="charge" label="charge MW"
            swatch={<span className="inline-block w-2 h-2" style={{ background: 'var(--accent-rose)' }}></span>}/>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-px" style={{ background: 'var(--text-faint)' }}></span> avg price €{avgPrice.toFixed(1)}</span>
        </div>
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer>
          <ComposedChart key={zoom.resetKey} data={data} margin={{ top: 5, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="idx" tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}
                   minTickGap={60} stroke="var(--text-faint)"/>
            <YAxis yAxisId="left" stroke="var(--text-faint)" width={48}
                   label={{ value: '€/MWh', angle: -90, position: 'insideLeft', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <YAxis yAxisId="right" orientation="right" stroke="var(--text-faint)" width={44}
                   label={{ value: 'MW', angle: 90, position: 'insideRight', fill: 'var(--text-faint)', fontSize: 10, fontFamily: 'JetBrains Mono' }}/>
            <Tooltip content={<Tip labelFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}/>}/>
            <ReferenceLine y={0} yAxisId="right" stroke="var(--border-strong)" strokeDasharray="2 2"/>
            <ReferenceLine y={avgPrice} yAxisId="left" stroke="var(--text-faint)" strokeDasharray="3 3" strokeWidth={1}/>
            <Bar yAxisId="right" dataKey="discharge" name="discharge" hide={!iso.active('discharge')}
                 fill="var(--accent-teal)" fillOpacity={0.75}/>
            <Bar yAxisId="right" dataKey="charge"    name="charge"    hide={!iso.active('charge')}
                 fill="var(--accent-rose)" fillOpacity={0.85}/>
            <Line yAxisId="left" type="monotone" dataKey="price" name="price" hide={!iso.active('price')}
                  stroke="var(--accent-amber)" dot={false} strokeWidth={1.6}/>
            <Brush dataKey="idx" height={26} stroke="var(--accent-amber)"
                   fill="var(--bg)" travellerWidth={8}
                   onChange={zoom.onChange}
                   tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, false, result.chartEpochUtcMs)}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- CHART 3: Cumulative revenue (with vs without battery) ----
export const UpliftChart = memo(({ result }: { result: OptimizationRunResult }) => {
  const { traj, dt } = result;
  const cumul = useMemo(() => {
    let cum = 0, cumWind = 0;
    return traj.map(r => {
      cum += r.revenue; cumWind += r.windOnlyRevenue;
      return { t: r.t, total: cum, windOnly: cumWind, uplift: cum - cumWind };
    });
  }, [traj]);
  const data = useMemo(() => plotAll(cumul), [cumul]);
  const showTime = dt < 1;
  const zoom = useZoom(data.length);
  const iso = useIsolation();

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between mb-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">BESS value stack</div>
          <div className="font-display text-lg">
            Plant-only vs hybrid revenue
            <ZoomBadge zoom={zoom} dataLength={data.length} dt={dt} traj={traj} epochUtcMs={result.chartEpochUtcMs} />
          </div>
        </div>
        <div className="flex gap-3 text-[11px] font-mono text-[color:var(--text-dim)]">
          <LegendChip iso={iso} isoKey="windOnly" label="gen only"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-amber)' }}></span>}/>
          <LegendChip iso={iso} isoKey="total" label="plant + battery"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-teal)' }}></span>}/>
          <LegendChip iso={iso} isoKey="uplift" label="marginal benefit"
            swatch={<span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-green)' }}></span>}/>
        </div>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart key={zoom.resetKey} data={data} margin={{ top: 5, right: 16, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="upliftGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-green)" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="var(--accent-green)" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="idx" tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}
                   minTickGap={60} stroke="var(--text-faint)"/>
            <YAxis stroke="var(--text-faint)" tickFormatter={v => fmtMoney(v)} width={60}/>
            <Tooltip content={<Tip labelFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, showTime, result.chartEpochUtcMs)}/>}/>
            <Area type="monotone" dataKey="uplift" name="marginal benefit (€)" hide={!iso.active('uplift')}
                  fill="url(#upliftGrad)" stroke="var(--accent-green)" strokeWidth={1}/>
            <Line type="monotone" dataKey="windOnly" name="generation-only (€)" hide={!iso.active('windOnly')}
                  stroke="var(--accent-amber)" dot={false} strokeWidth={1.4}/>
            <Line type="monotone" dataKey="total" name="hybrid (€)" hide={!iso.active('total')}
                  stroke="var(--accent-teal)" dot={false} strokeWidth={1.8}/>
            <Brush dataKey="idx" height={26} stroke="var(--accent-green)"
                   fill="var(--bg)" travellerWidth={8}
                   onChange={zoom.onChange}
                   tickFormatter={i => tsLabel(traj[Math.min(Number(i), traj.length-1)].t * dt, false, result.chartEpochUtcMs)}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- CHART 4: Action histogram by price bucket ----
export const ActionHistogram = memo(({ result }: { result: OptimizationRunResult }) => {
  const { traj } = result;
  const bins = useMemo(() => {
    // Bucket prices into N bins, count action direction
    const maxP = Math.max(...traj.map(r => r.price));
    const nBins = 10;
    const dP = maxP / nBins;
    const b = Array.from({length: nBins}, (_, i) => ({
      range: `${(i*dP).toFixed(0)}-${((i+1)*dP).toFixed(0)}`,
      midPrice: (i + 0.5) * dP,
      charge: 0, discharge: 0, idle: 0
    }));
    for (const r of traj) {
      const i = Math.min(nBins - 1, Math.floor(r.price / dP));
      if (r.action > 0.001) b[i].discharge++;
      else if (r.action < -0.001) b[i].charge++;
      else b[i].idle++;
    }
    return b;
  }, [traj]);

  return (
    <div className="card p-5 h-full">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">BESS operation vs price band</div>
        <div className="font-display text-lg">Charge / idle / discharge hours by €/MWh</div>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <BarChart data={bins} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="range" stroke="var(--text-faint)" tick={{ fontSize: 9 }}/>
            <YAxis stroke="var(--text-faint)"/>
            <Tooltip content={<Tip/>}/>
            <Bar dataKey="charge" name="charge" stackId="a" fill="var(--accent-rose)" fillOpacity={0.85}/>
            <Bar dataKey="idle" name="idle" stackId="a" fill="var(--border-strong)" fillOpacity={0.6}/>
            <Bar dataKey="discharge" name="discharge" stackId="a" fill="var(--accent-teal)" fillOpacity={0.85}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

// ---- CHART 5: Price duration curve ----
export const PriceDurationCurve = memo(({ result }: { result: OptimizationRunResult }) => {
  const { traj } = result;
  const data = useMemo(() => {
    const sorted = [...traj].sort((a, b) => b.price - a.price);
    const maxPts = 300;
    const step = Math.max(1, Math.floor(sorted.length / maxPts));
    return sorted.filter((_, i) => i % step === 0).map((r, i) => ({
      rank: i * step, price: r.price,
      wind: r.wind, dispatch: r.gridTotal
    }));
  }, [traj]);

  return (
    <div className="card p-5 h-full">
      <div className="mb-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Wholesale capture window</div>
        <div className="font-display text-lg">Price duration curve</div>
      </div>
      <div style={{ width: '100%', height: 260 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-teal)" stopOpacity={0.5}/>
                <stop offset="100%" stopColor="var(--accent-teal)" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="rank" stroke="var(--text-faint)"
                   label={{ value: 'hour rank', position: 'insideBottom', fill: 'var(--text-faint)', fontSize: 10, offset: -4 }}/>
            <YAxis stroke="var(--text-faint)"/>
            <Tooltip content={<Tip/>}/>
            <Area type="monotone" dataKey="price" name="€/MWh"
                  fill="url(#priceGrad)" stroke="var(--accent-teal)" strokeWidth={1.4}/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
