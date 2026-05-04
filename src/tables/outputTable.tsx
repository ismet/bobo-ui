import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { OptimizationRunResult } from '../optimizationTypes';
import type { Trajectory } from '../engine/types';

// ============================================================================
// OUTPUT TABLE — operation table with physical quantities tied to system design
// Columns reflect the parameters defined in the System Design panel:
//   capacity (MWh), chargeMax/dischargeMax (MW), chargeEff/dischargeEff (frac),
//   dt (h), wearCost (€/MWh), initialSOC (frac), chargeFromGrid, windScale.
//
//   date · number_of_hours · current_soc_mwh · soc_pct ·
//   net_power_to_be_sold_or_buy · current_release · battery_grid_power_mw ·
//   uncontrolled_power · next_soc_mwh · surplus · throughput_mwh · wear_cost ·
//   current_benefit · net_benefit · cumulative_net_benefit · cumulative_benefit ·
//   wind_only_revenue · uplift_vs_wind_only · price
// ============================================================================
type OpRow = Record<string, string | number>;

function buildOperationTable(result: OptimizationRunResult): OpRow[] {
  const { traj, dt, params } = result;
  const { capacity, chargeEff, dischargeEff, wearCost = 0 } = params;

  // dSOC is the energy granularity the DP actually ran with; needed only to
  // recover the battery-side power flow consistently with the optimizer.
  const tr = traj as Trajectory;
  const dSOC = (tr._dSOC !== undefined)
    ? tr._dSOC
    : capacity / (tr._socSteps !== undefined ? tr._socSteps : params.socSteps);

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

    // Wind-only counterfactual: revenue if wind were sold directly with no battery
    const windOnlyRevenue = +((r.windOnlyRevenue ?? r.wind * dt * r.price).toFixed(4));
    const upliftVsWindOnly = +(currentBenefit - windOnlyRevenue).toFixed(4);

    rows.push({
      date: i,
      number_of_hours: +(i * dt).toFixed(4),
      current_soc_mwh: currentSocMwh,
      soc_pct: socPct,
      net_power_to_be_sold_or_buy: netPower,
      current_release: currentRelease,
      battery_grid_power_mw: batteryGridPowerMw,
      uncontrolled_power: +r.wind.toFixed(4),
      next_soc_mwh: nextSocMwh,
      surplus: surplusMw,
      throughput_mwh: throughputMwh,
      wear_cost: wearCostEur,
      current_benefit: currentBenefit,
      net_benefit: netBenefit,
      cumulative_net_benefit: +cumNetBenefit.toFixed(4),
      cumulative_benefit: +cumBenefit.toFixed(4),
      wind_only_revenue: windOnlyRevenue,
      uplift_vs_wind_only: upliftVsWindOnly,
      price: r.price,
    });
  }
  return rows;
}

const OPERATION_COLS = [
  'date', 'number_of_hours',
  'current_soc_mwh', 'soc_pct',
  'net_power_to_be_sold_or_buy', 'current_release', 'battery_grid_power_mw',
  'uncontrolled_power', 'next_soc_mwh', 'surplus',
  'throughput_mwh', 'wear_cost',
  'current_benefit', 'net_benefit',
  'cumulative_net_benefit', 'cumulative_benefit',
  'wind_only_revenue', 'uplift_vs_wind_only',
  'price'
];

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

export function OutputTable({ result }: { result: OptimizationRunResult }) {
  const rows = useMemo(() => buildOperationTable(result), [result]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [copyMsg, setCopyMsg] = useState('');

  const nPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize);

  const handleDownload = () => {
    const csv = rowsToCSV(rows, OPERATION_COLS);
    downloadCSV(`res_operation_table_${rows.length}rows.csv`, csv);
  };

  const handleCopyAll = async () => {
    const tsv = [
      OPERATION_COLS.join('\t'),
      ...rows.map(r => OPERATION_COLS.map(c => r[c]).join('\t'))
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
        col === 'uplift_vs_wind_only') return v.toFixed(2);
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
  // System Design panel, so the user can see the inputs alongside the outputs.
  const p = result.params || {};
  const gridLimitMw = result.traj?._gridLimit ?? Math.max(p.chargeMax ?? 0, p.dischargeMax ?? 0);
  const curtailedHours  = result.traj?._curtailedHours  ?? 0;
  const curtailedEnergy = result.traj?._curtailedEnergy ?? 0;
  const designChips = [
    { k: 'Capacity',            v: `${p.capacity ?? '?'} MWh` },
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
          <div className="font-display text-lg">Hour-by-hour plant &amp; BESS operation</div>
          <div className="text-xs text-[color:var(--text-dim)] mt-1">
            {rows.length.toLocaleString()} intervals · throughput &amp; revenue columns · matches dispatch run inputs
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
        border: '1px solid var(--border)', borderRadius: 4,
        padding: '10px 12px', marginBottom: 14,
        background: 'var(--bg)'
      }}>
        <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-faint)] font-mono mb-2">
          System design parameters used for this run
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
              {OPERATION_COLS.map(c => (
                <th key={c} style={thStyle}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => (
              <tr key={page * pageSize + idx}
                  style={{ background: idx % 2 ? 'var(--surface)' : 'transparent' }}>
                <td style={{...tdStyle, color: 'var(--text-faint)'}}>{page * pageSize + idx + 1}</td>
                {OPERATION_COLS.map(c => {
                  const v = row[c]!;
                  const n = typeof v === 'number' ? v : NaN;
                  let color = 'var(--text)';
                  if (c === 'cumulative_benefit' || c === 'cumulative_net_benefit')
                    color = 'var(--accent-teal)';
                  else if ((c === 'current_release' || c === 'battery_grid_power_mw') && n > 0)
                    color = 'var(--accent-teal)';
                  else if ((c === 'current_release' || c === 'battery_grid_power_mw') && n < 0)
                    color = 'var(--accent-rose)';
                  else if (c === 'price') color = 'var(--accent-amber)';
                  else if (c === 'wear_cost' && n > 0) color = 'var(--accent-rose)';
                  else if (c === 'uplift_vs_wind_only' && n > 0) color = 'var(--accent-teal)';
                  else if (c === 'uplift_vs_wind_only' && n < 0) color = 'var(--accent-rose)';
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
}
