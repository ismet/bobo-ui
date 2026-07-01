import { memo, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OptimizationRunResult } from '../optimizationTypes';
import type { Trajectory } from '../engine/types';
import { buildNetIncrementalBreakdown } from '../finance';
import { DEFAULT_TS_EPOCH_MS } from '../formatUtils';

// ============================================================================
// OUTPUT TABLE — operation table with physical quantities tied to system design
// Columns reflect the parameters defined in the System Design panel:
//   capacity (MWh), chargeMax/dischargeMax (MW), chargeEff/dischargeEff (frac),
//   dt (h), wearCost (€/MWh), initialSOC (frac), chargeFromGrid.
//
//   date · number_of_hours · current_soc_mwh · soc_pct ·
//   net_power_to_be_sold_or_buy · current_release · battery_grid_power_mw ·
//   uncontrolled_power · generation_measured_mw · generation_reconstructed_mw (PV recon only) ·
//   next_soc_mwh · surplus · throughput_mwh · wear_cost ·
//   current_benefit · net_benefit · cumulative_net_benefit · cumulative_benefit ·
//   wind_only_revenue · marginal_benefit_vs_wind_only · price
// ============================================================================
type OpRow = Record<string, string | number>;

const BASE_OPERATION_COLS = [
  'date', 'number_of_hours',
  'current_soc_mwh', 'soc_pct',
  'net_power_to_be_sold_or_buy', 'current_release', 'battery_grid_power_mw',
  'uncontrolled_power',
  'next_soc_mwh', 'surplus',
  'throughput_mwh', 'wear_cost',
  'current_benefit', 'net_benefit',
  'cumulative_net_benefit', 'cumulative_benefit',
  'wind_only_revenue', 'marginal_benefit_vs_wind_only',
  'price',
] as const;

const PV_GENERATION_COLS = [
  'generation_measured_mw',
  'generation_reconstructed_mw',
] as const;

function operationColsFor(result: OptimizationRunResult): string[] {
  if (!result.windPeriodMeasured) return [...BASE_OPERATION_COLS];
  const cols: string[] = [...BASE_OPERATION_COLS];
  const idx = cols.indexOf('uncontrolled_power');
  cols.splice(idx + 1, 0, ...PV_GENERATION_COLS);
  return cols;
}

function buildOperationTable(result: OptimizationRunResult, opts: {
  region: string | null;
  opexPctPlantOnly: number;
} = { region: null, opexPctPlantOnly: 0 }): OpRow[] {
  const { traj, dt, params, windPeriodMeasured } = result;
  const { capacity, chargeEff, dischargeEff, wearCost = 0 } = params;
  const showPvGeneration = windPeriodMeasured != null
    && windPeriodMeasured.length === traj.length;

  // dSOC is the energy granularity the DP actually ran with; needed only to
  // recover the battery-side power flow consistently with the optimizer.
  const tr = traj as Trajectory;
  const dSOC = (tr._dSOC !== undefined)
    ? tr._dSOC
    : capacity / (tr._socSteps !== undefined ? tr._socSteps : params.socSteps);

  // Per-step net (post-OPEX, post-transmission) O&M and transmission for the
  // plant and BESS sides. When region is null the helper returns zeros, so
  // the per-step "marginal_benefit_vs_wind_only" column collapses to the
  // original gross (r.revenue - r.windOnlyRevenue) — unchanged from today.
  const installedMW = result.params.installedCapacityMW != null
    ? result.params.installedCapacityMW
    : Math.max(result.params.chargeMax, result.params.dischargeMax);
  const net = buildNetIncrementalBreakdown({
    traj, dt,
    periodStartMs: result.chartEpochUtcMs ?? DEFAULT_TS_EPOCH_MS,
    region: opts.region != null ? Number(opts.region) : null,
    installedMW,
    opexPctPlantOnly: opts.opexPctPlantOnly,
  });

  const rows: OpRow[] = [];
  let cumBenefit = 0;        // gross arbitrage € (revenue from grid sales)
  let cumNetBenefit = 0;     // arbitrage € minus wear cost
  for (let i = 0; i < traj.length; i++) {
    const r = traj[i];

    // SOC in physical MWh — directly proportional to the capacity parameter
    const currentSocMwh = +r.soc.toFixed(4);
    const nextSocMwh    = +(r.soc - r.action * dt).toFixed(4);
    const socPct        = capacity > 0 ? +((r.soc / capacity) * 100).toFixed(2) : 0;

    // Battery-internal SOC change rate (MW) — positive = discharge, neg = charge
    const currentRelease = +r.action.toFixed(4);

    // Battery → grid power (MW), already net of charge/discharge efficiency.
    // For positive action a (discharge): gridE = a*dSOC*dischargeEff
    // For negative action a (charge):    gridE = a*dSOC/chargeEff
    // Both translate to currentRelease scaled by the appropriate efficiency.
    const batteryGridPowerMw = +(r.gridEnergy ?? (
      r.action > 0 ? r.action * dischargeEff
                   : r.action / chargeEff
    )).toFixed(4);

    // Net grid flow (MW) = wind + battery_grid_power
    const netPower = +r.gridTotal.toFixed(4);

    // Energy through cells this step (MWh) and resulting wear (€)
    const throughputMwh = +((r.throughput ?? Math.abs(r.action) * dt).toFixed(4));
    const wearCostEur   = +((r.wearStepCost ?? throughputMwh * wearCost).toFixed(4));

    // Wind curtailment this step (MWh) — non-zero only when wind+battery
    // exceeded the grid cap and the safety valve triggered. Reported as MW
    // for consistency with other power columns.
    const surplusMw = +(((r.spillE ?? 0) / dt).toFixed(4));

    // Step-level revenue (€). Hybrid system revenue = net power × price × dt.
    const currentBenefit = +r.revenue.toFixed(4);
    cumBenefit += currentBenefit;

    // Net benefit after wear penalty — this is what the DP actually maximises
    const netBenefit = +(currentBenefit - wearCostEur).toFixed(4);
    cumNetBenefit += netBenefit;

    // Plant generation (MW): uncontrolled_power is what the DP used (reconstructed when PV recon ran).
    const windMw = r.wind ?? 0;
    const measuredMw = showPvGeneration ? windPeriodMeasured[i]! : undefined;
    const windOnlyRevenue = +((r.windOnlyRevenue ?? windMw * dt * r.price).toFixed(4));
    // Subtract per-step O&M and transmission diffs (bess - plant) so the
    // column reads the net marginal benefit vs plant-only when a region is
    // set. When region is null these arrays are zero and the value matches
    // the original gross (r.revenue - r.windOnlyRevenue).
    const grossUplift = currentBenefit - windOnlyRevenue;
    const stepOAndMDiff = (net.perStepOAndMBess[i]  ?? 0) - (net.perStepOAndMPlant[i] ?? 0);
    const stepTransDiff = (net.perStepTransBess[i]  ?? 0) - (net.perStepTransPlant[i] ?? 0);
    const upliftVsWindOnly = +(grossUplift - stepOAndMDiff - stepTransDiff).toFixed(4);

    const row: OpRow = {
      date: i,
      number_of_hours: +(i * dt).toFixed(4),
      current_soc_mwh: currentSocMwh,
      soc_pct: socPct,
      net_power_to_be_sold_or_buy: netPower,
      current_release: currentRelease,
      battery_grid_power_mw: batteryGridPowerMw,
      uncontrolled_power: +windMw.toFixed(4),
      next_soc_mwh: nextSocMwh,
      surplus: surplusMw,
      throughput_mwh: throughputMwh,
      wear_cost: wearCostEur,
      current_benefit: currentBenefit,
      net_benefit: netBenefit,
      cumulative_net_benefit: +cumNetBenefit.toFixed(4),
      cumulative_benefit: +cumBenefit.toFixed(4),
      wind_only_revenue: windOnlyRevenue,
      marginal_benefit_vs_wind_only: upliftVsWindOnly,
      price: r.price,
    };
    if (showPvGeneration) {
      row.generation_measured_mw = +measuredMw!.toFixed(4);
      row.generation_reconstructed_mw = +windMw.toFixed(4);
    }
    rows.push(row);
  }
  return rows;
}

function rowsToCSV(rows: OpRow[], cols: string[]): string {
  const lines = [cols.join(',')];
  for (const r of rows) {
    lines.push(cols.map(c => {
      const v = r[c]!;
      if (typeof v === 'string') {
        // quote if needed
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }
      return v;
    }).join(','));
  }
  return lines.join('\n');
}

function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

const thStyle: CSSProperties = {
  padding: '8px 10px', textAlign: 'left',
  fontSize: 10, fontWeight: 500, letterSpacing: '0.05em',
  textTransform: 'uppercase', color: 'var(--text-faint)',
  borderBottom: '1px solid var(--border)',
  whiteSpace: 'nowrap'
};
const tdStyle = {
  padding: '6px 10px', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
  fontVariantNumeric: 'tabular-nums'
};
const pageBtnStyle = (disabled: boolean) => ({
  padding: '4px 8px', border: '1px solid var(--border)',
  borderRadius: 3, color: disabled ? 'var(--text-faint)' : 'var(--text-dim)',
  fontSize: 11, opacity: disabled ? 0.4 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer'
});

export const OutputTable = memo(({ result, sweepResult, region, opexPctPlantOnly }: {
  result: OptimizationRunResult;
  /**
   * When provided, the table is built from this dispatch instead of
   * `result` — typically the financially optimal sweep point, so the
   * downloadable hour-by-hour table is organized around the optimal
   * battery size. The original sidebar-size dispatch is still available
   * as `result` for the title-bar / system-design banner context.
   */
  sweepResult?: OptimizationRunResult | null;
  /** When set, the 'marginal_benefit_vs_wind_only' column shows net (post-OPEX, post-transmission). */
  region: string | null;
  opexPctPlantOnly: number;
}) => {
  // Effective result drives all table data. When the sweep provides a
  // non-null optimal-size dispatch we use that; otherwise we fall back to
  // the latest applied (sidebar-size) optimize commit.
  const effective = sweepResult ?? result;
  const onOptimal = !!sweepResult;
  const operationCols = useMemo(() => operationColsFor(effective), [effective]);
  // CSV/clipboard key for the marginal-benefit column. Renamed to
  // *_net when region is set so downstream spreadsheet users can tell the
  // semantics. The in-table row key stays the same; the "(net)" suffix is
  // added in the header render below.
  const csvCols = useMemo(() => operationCols.map(c =>
    (c === 'marginal_benefit_vs_wind_only' && region != null)
      ? 'marginal_benefit_vs_wind_only_net'
      : c
  ), [operationCols, region]);
  const rows = useMemo(() => buildOperationTable(effective, { region, opexPctPlantOnly }),
    [effective, region, opexPctPlantOnly]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [copyMsg, setCopyMsg] = useState('');

  const nPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  const handleDownload = () => {
    const csv = rowsToCSV(rows, csvCols);
    const stem = onOptimal ? 'res_operation_table_optimal' : 'res_operation_table';
    downloadCSV(`${stem}_${rows.length}rows.csv`, csv);
  };

  const handleCopyAll = async () => {
    const tsv = [
      csvCols.join('\t'),
      ...rows.map(r => csvCols.map(c => r[c]).join('\t'))
    ].join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      setCopyMsg(`Copied ${rows.length.toLocaleString()} rows to clipboard.`);
    } catch (e) {
      setCopyMsg('Clipboard blocked — use Download CSV instead.');
    }
    setTimeout(() => setCopyMsg(''), 3000);
  };

  // numeric formatting per column — physical quantities get sensible decimals
  const fmt = (col: string, v: string | number) => {
    if (v === null || v === undefined) return '';
    if (col === 'date') return v;
    if (typeof v !== 'number') return v;
    // € amounts: 2 decimals
    if (col === 'cumulative_benefit' || col === 'cumulative_net_benefit' ||
        col === 'current_benefit' || col === 'net_benefit' ||
        col === 'wear_cost' || col === 'wind_only_revenue' ||
        col === 'marginal_benefit_vs_wind_only') return v.toFixed(2);
    // €/MWh: 2 decimals
    if (col === 'price') return v.toFixed(2);
    // SOC %: 2 decimals (already rounded)
    if (col === 'soc_pct') return v.toFixed(2);
    // SOC MWh & energy MWh: 3 decimals
    if (col === 'current_soc_mwh' || col === 'next_soc_mwh' ||
        col === 'throughput_mwh') return v.toFixed(3);
    return Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(3);
  };

  // Pull the parameters that produced this table — these come straight from the
  // System Design panel (or, when the sweep is in effect, from the optimal
  // sweep point), so the user can see the inputs alongside the outputs.
  const p = effective.params || {};
  const gridLimitMw = effective.traj?._gridLimit ?? Math.max(p.chargeMax ?? 0, p.dischargeMax ?? 0);
  const curtailedHours  = effective.traj?._curtailedHours  ?? 0;
  const curtailedEnergy = effective.traj?._curtailedEnergy ?? 0;
  const pvRecon = effective.pvReconstructStats;
  const designChips = [
    { k: 'Capacity',            v: `${p.capacity ?? '?'} MWh${onOptimal ? ' · optimal' : ''}`,
      hi: onOptimal },
    { k: 'Max charge',          v: `${p.chargeMax ?? '?'} MW` },
    { k: 'Max discharge',       v: `${p.dischargeMax ?? '?'} MW` },
    { k: 'Connection limit',    v: `± ${gridLimitMw} MW`, hi: true },
    { k: 'Charge efficiency',   v: `${((p.chargeEff ?? 0) * 100).toFixed(1)} %` },
    { k: 'Discharge efficiency', v: `${((p.dischargeEff ?? 0) * 100).toFixed(1)} %` },
    { k: 'Round-trip',          v: `${(((p.chargeEff ?? 0) * (p.dischargeEff ?? 0)) * 100).toFixed(1)} %` },
    { k: 'Time step',           v: `${p.dt ?? '?'} h` },
    { k: 'Starting charge',     v: `${(((p.initialSOCFrac ?? 0) * 100)).toFixed(0)} %` },
    { k: 'Wear cost',           v: `${p.wearCost ?? 0} €/MWh` },
    { k: 'Grid charging',       v: p.chargeFromGrid ? 'allowed' : 'on-site only' },
  ];

  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-1">Dispatch export</div>
          <div className="font-display text-lg">
            Hour-by-hour plant &amp; BESS operation
            {onOptimal && (
              <span className="ml-2 text-xs font-mono" style={{
                color: 'var(--accent-green)',
                letterSpacing: '0.05em', textTransform: 'uppercase',
                verticalAlign: 'middle',
              }}>
                ◆ at optimal size
              </span>
            )}
          </div>
          <div className="text-xs text-[color:var(--text-dim)] mt-1">
            {rows.length.toLocaleString()} intervals · throughput &amp; revenue columns
            {onOptimal
              ? ` · optimal size ${(effective.params.capacity ?? 0).toFixed(1)} MWh from sizing sweep`
              : ' · matches dispatch run inputs'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopyAll}
                  style={{ padding: '8px 14px', border: '1px solid var(--border)',
                           borderRadius: 4, color: 'var(--text-dim)', fontSize: 12,
                           fontFamily: 'DM Sans', fontWeight: 500 }}>
            Copy for Excel
          </button>
          <button onClick={handleDownload} className="btn-primary"
                  style={{ padding: '8px 16px', fontSize: 13 }}>
            Download CSV ↓
          </button>
        </div>
      </div>

      {/* System design banner — surfaces the parameters that produced the table */}
      <div style={{
        border: onOptimal ? '1px solid var(--accent-green)' : '1px solid var(--border)',
        borderRadius: 4,
        padding: '10px 12px', marginBottom: 14,
        background: 'var(--bg)'
      }}>
        <div className="text-[10px] uppercase tracking-[0.15em] font-mono mb-2"
          style={{ color: onOptimal ? 'var(--accent-green)' : 'var(--text-faint)' }}>
          {onOptimal
            ? `System design parameters for optimal size (${(effective.params.capacity ?? 0).toFixed(1)} MWh from sizing sweep)`
            : 'System design parameters used for this run'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          {designChips.map(c => (
            <div key={c.k} style={{
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              color: 'var(--text-dim)', whiteSpace: 'nowrap'
            }}>
              <span style={{ color: 'var(--text-faint)' }}>{c.k}</span>
              <span style={{
                color: c.hi ? 'var(--accent-teal)' : 'var(--text)',
                marginLeft: 6,
                fontWeight: c.hi ? 500 : 400
              }}>{c.v}</span>
            </div>
          ))}
        </div>
        {pvRecon && (
          <div className="mt-2 text-[10px] font-mono" style={{
            color: 'var(--accent-teal)', lineHeight: 1.5
          }}>
            PV clipping reconstruction applied
            &nbsp;· {pvRecon.clippedHours.toLocaleString()} hour{pvRecon.clippedHours === 1 ? '' : 's'} adjusted
            &nbsp;· {pvRecon.recoveredEnergyMWh.toFixed(1)} MWh recovered vs measured
            &nbsp;<span style={{ color: 'var(--text-faint)' }}>
              (generation_measured_mw = clipped input;
              generation_reconstructed_mw and uncontrolled_power = reconstructed estimate used in dispatch.)
            </span>
          </div>
        )}
        {curtailedHours > 0 && (
          <div className="mt-2 text-[10px] font-mono" style={{
            color: 'var(--accent-amber)', lineHeight: 1.5
          }}>
            ⚠ Export curtailment in {curtailedHours.toLocaleString()} hour{curtailedHours === 1 ? '' : 's'}
            &nbsp;· {curtailedEnergy.toFixed(1)} MWh spilled
            &nbsp;<span style={{ color: 'var(--text-faint)' }}>
              (combined export exceeded the ±{gridLimitMw} MW connection limit —
              see the surplus column for spilled energy each period.)
            </span>
          </div>
        )}
      </div>

      {copyMsg && (
        <div className="mb-3 text-xs font-mono"
             style={{ color: copyMsg.startsWith('Copied') ? 'var(--accent-green)' : 'var(--accent-rose)' }}>
          {copyMsg}
        </div>
      )}

      <div style={{
        overflowX: 'auto', overflowY: 'auto', maxHeight: 480,
        border: '1px solid var(--border)', borderRadius: 4,
        background: 'var(--bg)'
      }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11
        }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1 }}>
            <tr>
              <th style={thStyle}>#</th>
              {operationCols.map(c => (
                <th key={c} style={thStyle}>
                  {c + ((c === 'marginal_benefit_vs_wind_only' && region != null) ? ' (net)' : '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => (
              <tr key={page * pageSize + idx}
                  style={{ background: idx % 2 ? 'var(--surface)' : 'transparent' }}>
                <td style={{...tdStyle, color: 'var(--text-faint)'}}>{page * pageSize + idx + 1}</td>
                {operationCols.map(c => {
                  const v = row[c]!;
                  const n = typeof v === 'number' ? v : NaN;
                  let color = 'var(--text)';
                  if (c === 'generation_reconstructed_mw' && n !== 0) color = 'var(--accent-teal)';
                  else if (c === 'generation_measured_mw' && n !== 0) color = 'var(--text-dim)';
                  if (c === 'cumulative_benefit' || c === 'cumulative_net_benefit')
                    color = 'var(--accent-teal)';
                  else if ((c === 'current_release' || c === 'battery_grid_power_mw') && n > 0)
                    color = 'var(--accent-teal)';
                  else if ((c === 'current_release' || c === 'battery_grid_power_mw') && n < 0)
                    color = 'var(--accent-rose)';
                  else if (c === 'price') color = 'var(--accent-amber)';
                  else if (c === 'wear_cost' && n > 0) color = 'var(--accent-rose)';
                  else if (c === 'marginal_benefit_vs_wind_only' && n > 0) color = 'var(--accent-teal)';
                  else if (c === 'marginal_benefit_vs_wind_only' && n < 0) color = 'var(--accent-rose)';
                  else if (c === 'soc_pct') color = 'var(--accent-violet)';
                  else if (c === 'surplus' && n > 0) color = 'var(--accent-amber)';
                  return (
                    <td key={c} style={{
                      ...tdStyle, color,
                      textAlign: typeof v === 'number' ? 'right' : 'left',
                    }}>
                      {fmt(c, v as string | number)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between mt-4 gap-2 text-xs font-mono">
        <div className="text-[color:var(--text-dim)]">
          Showing {(page * pageSize + 1).toLocaleString()}–
          {Math.min((page + 1) * pageSize, rows.length).toLocaleString()} of {rows.length.toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[color:var(--text-faint)]">rows/page:</span>
          <select value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="250">250</option>
          </select>
          <button onClick={() => setPage(0)} disabled={page === 0} style={pageBtnStyle(page === 0)}>« first</button>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={pageBtnStyle(page === 0)}>‹ prev</button>
          <span className="text-[color:var(--text-dim)]">
            page {page + 1} / {nPages}
          </span>
          <button onClick={() => setPage(Math.min(nPages - 1, page + 1))} disabled={page >= nPages - 1} style={pageBtnStyle(page >= nPages - 1)}>next ›</button>
          <button onClick={() => setPage(nPages - 1)} disabled={page >= nPages - 1} style={pageBtnStyle(page >= nPages - 1)}>last »</button>
        </div>
      </div>
    </div>
  );
});
