import tariffsJson from '../teias_tariff_dataset.json';
import fxJson from '../eur_try.json';
import type { TrajectoryStep } from './engine/types';

type TariffCell = { u_cap: number; u_use: number; u_ops: number };
type TariffData = { [year: string]: { regions: { [region: string]: TariffCell } } };
type FxData    = { [ym: string]: { rate: number; date: string } };

const tariffs: TariffData = (tariffsJson as any).tariffs_by_year_and_region;
const fx: FxData = fxJson as any;

export function computeTariffBreakdown(args: {
  traj: TrajectoryStep[];
  dt: number;
  periodStartMs: number;
  region: number;
  installedMW: number;
  opexPctPlantOnly: number;
}): {
  grossRevenueEUR: number;
  hybridRevenueEUR: number;
  oAndMEUR: number;
  transmissionEUR: number;
  netRevenueEUR: number;
  grossRevenueEUR_plant: number;
  grossRevenueEUR_bess: number;
  oAndMEUR_plant: number;
  oAndMEUR_bess: number;
  transmissionEUR_plant: number;
  transmissionEUR_bess: number;
  netRevenueEUR_plant: number;
  netRevenueEUR_bess: number;
  incrementalEUR: number;
  monthsBilled: number;
  monthsTotal: number;
  yearLabel: string;
} {
  const { traj, dt, periodStartMs, region, installedMW, opexPctPlantOnly } = args;

  const { perMonth, monthsTouched, monthsBilled, years } = computePerMonthNetDiff(
    traj, dt, periodStartMs, region, installedMW, opexPctPlantOnly,
  );

  let oAndMEUR_plant = 0, oAndMEUR_bess = 0;
  let transmissionEUR_plant = 0, transmissionEUR_bess = 0;
  for (const [, b] of perMonth) {
    oAndMEUR_plant += b.oAndMPlantEUR;
    oAndMEUR_bess  += b.oAndMBessEUR;
    transmissionEUR_plant += b.transPlantEUR;
    transmissionEUR_bess  += b.transBessEUR;
  }

  const grossRevenueEUR_plant = traj.reduce((s, r) => s + r.windOnlyRevenue, 0);
  const grossRevenueEUR_bess  = traj.reduce((s, r) => s + r.revenue, 0);
  const netRevenueEUR_plant   = grossRevenueEUR_plant - oAndMEUR_plant - transmissionEUR_plant;
  const netRevenueEUR_bess    = grossRevenueEUR_bess  - oAndMEUR_bess  - transmissionEUR_bess;
  const incrementalEUR        = netRevenueEUR_bess - netRevenueEUR_plant;

  const sortedYears = [...years].sort();
  const yearLabel =
    sortedYears.length === 0 ? 'no data' :
    sortedYears.length === 1 ? String(sortedYears[0]) :
    `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`;

  return {
    grossRevenueEUR: grossRevenueEUR_plant,
    hybridRevenueEUR: grossRevenueEUR_bess,
    oAndMEUR: oAndMEUR_plant,
    transmissionEUR: transmissionEUR_plant,
    netRevenueEUR: netRevenueEUR_plant,
    grossRevenueEUR_plant,
    grossRevenueEUR_bess,
    oAndMEUR_plant,
    oAndMEUR_bess,
    transmissionEUR_plant,
    transmissionEUR_bess,
    netRevenueEUR_plant,
    netRevenueEUR_bess,
    incrementalEUR,
    monthsBilled,
    monthsTotal: monthsTouched,
    yearLabel,
  };
}

// ============================================================================
// PER-MONTH BUCKETING + COST (shared by computeTariffBreakdown and
// buildNetIncrementalBreakdown so the math lives in exactly one place).
// ============================================================================
type MonthBucket = {
  year: number;
  plantExportMWh: number;
  bessExportMWh: number;
  plantGrossEUR: number;
  bessGrossEUR: number;
  oAndMPlantEUR: number;
  oAndMBessEUR: number;
  transPlantEUR: number;
  transBessEUR: number;
  stepIndices: number[];
  billed: boolean;
};

function computePerMonthNetDiff(
  traj: TrajectoryStep[],
  dt: number,
  periodStartMs: number,
  region: number,
  installedMW: number,
  opexPctPlantOnly: number,
): { perMonth: Map<string, MonthBucket>; monthsTouched: number; monthsBilled: number; years: Set<number> } {
  const perMonth = new Map<string, MonthBucket>();
  let monthsTouched = 0;
  for (let i = 0; i < traj.length; i++) {
    const r = traj[i];
    const plantE = Math.max(0, Math.min(r.wind, installedMW)) * dt;
    const bessE  = Math.max(0, Math.min(r.gridTotal, installedMW)) * dt;
    if (plantE <= 0 && bessE <= 0 && r.windOnlyRevenue === 0 && r.revenue === 0) continue;
    const d = new Date(periodStartMs + i * dt * 3_600_000);
    const y = d.getUTCFullYear();
    const ym = `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    let b = perMonth.get(ym);
    if (!b) {
      b = {
        year: y,
        plantExportMWh: 0, bessExportMWh: 0,
        plantGrossEUR: 0, bessGrossEUR: 0,
        oAndMPlantEUR: 0, oAndMBessEUR: 0,
        transPlantEUR: 0, transBessEUR: 0,
        stepIndices: [],
        billed: false,
      };
      perMonth.set(ym, b);
      monthsTouched++;
    }
    b.plantExportMWh += plantE;
    b.bessExportMWh  += bessE;
    b.plantGrossEUR  += r.windOnlyRevenue;
    b.bessGrossEUR   += r.revenue;
    b.oAndMPlantEUR  += (opexPctPlantOnly / 100) * r.windOnlyRevenue;
    b.oAndMBessEUR   += (opexPctPlantOnly / 100) * r.windOnlyRevenue;
    b.stepIndices.push(i);
  }

  const years = new Set<number>();
  let monthsBilled = 0;
  for (const [ym, b] of perMonth) {
    const cell = tariffs[String(b.year)]?.regions[String(region)];
    const rate = fx[ym]?.rate;
    if (!cell || !rate) continue;
    b.billed = true;
    monthsBilled++;
    const capacityTL = cell.u_cap * installedMW * (1 / 12);
    const energyTL_plant = (cell.u_use + cell.u_ops) * b.plantExportMWh;
    const energyTL_bess  = (cell.u_use + cell.u_ops) * b.bessExportMWh;
    b.transPlantEUR += (capacityTL + energyTL_plant) / rate;
    b.transBessEUR  += (capacityTL + energyTL_bess)  / rate;
    years.add(b.year);
  }
  return { perMonth, monthsTouched, monthsBilled, years };
}

// ============================================================================
// PER-STEP NET INCREMENTAL BREAKDOWN
// Returns per-step O&M and transmission arrays for the plant and BESS sides,
// plus totalIncrementalEUR which equals computeTariffBreakdown(args).incrementalEUR
// — the KPI "Incremental revenue from BESS" value. When region is null the
// helper short-circuits to all-zero per-step arrays and totalIncrementalEUR=0,
// so consumers can call it unconditionally.
// ============================================================================
export type NetIncrementalBreakdown = {
  perStepOAndMPlant: number[];
  perStepOAndMBess: number[];
  perStepTransPlant: number[];
  perStepTransBess: number[];
  totalIncrementalEUR: number;
};

export function buildNetIncrementalBreakdown(args: {
  traj: TrajectoryStep[];
  dt: number;
  periodStartMs: number;
  region: number | null;
  installedMW: number;
  opexPctPlantOnly: number;
}): NetIncrementalBreakdown {
  const { traj, dt, region } = args;
  const n = traj.length;

  if (region == null) {
    return {
      perStepOAndMPlant: new Array(n).fill(0),
      perStepOAndMBess: new Array(n).fill(0),
      perStepTransPlant: new Array(n).fill(0),
      perStepTransBess: new Array(n).fill(0),
      totalIncrementalEUR: 0,
    };
  }

  const { perMonth } = computePerMonthNetDiff(
    traj, dt, args.periodStartMs, region, args.installedMW,
    args.opexPctPlantOnly,
  );

  const perStepOAndMPlant = new Array(n).fill(0);
  const perStepOAndMBess  = new Array(n).fill(0);
  const perStepTransPlant = new Array(n).fill(0);
  const perStepTransBess  = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    const r = traj[i];
    const oAndMStep = (args.opexPctPlantOnly / 100) * r.windOnlyRevenue;
    perStepOAndMPlant[i] = oAndMStep;
    perStepOAndMBess[i]  = oAndMStep;
  }

  for (const [, b] of perMonth) {
    if (!b.billed) continue;
    const count = b.stepIndices.length;
    if (count === 0) continue;
    const transBessPerStep  = b.transBessEUR  / count;
    const transPlantPerStep = b.transPlantEUR / count;
    for (const i of b.stepIndices) {
      perStepTransBess[i]  += transBessPerStep;
      perStepTransPlant[i] += transPlantPerStep;
    }
  }

  const totalIncrementalEUR = computeTariffBreakdown({
    traj, dt, periodStartMs: args.periodStartMs, region,
    installedMW: args.installedMW,
    opexPctPlantOnly: args.opexPctPlantOnly,
  }).incrementalEUR;

  if (import.meta.env.DEV) {
    let sumNetUplift = 0;
    for (let i = 0; i < n; i++) {
      const r = traj[i];
      sumNetUplift += (r.revenue - r.windOnlyRevenue)
        - (perStepOAndMBess[i]  - perStepOAndMPlant[i])
        - (perStepTransBess[i]  - perStepTransPlant[i]);
    }
    if (Math.abs(sumNetUplift - totalIncrementalEUR) > 1e-6) {
      console.error(
        '[buildNetIncrementalBreakdown] per-step sum does not match totalIncrementalEUR',
        { sumNetUplift, totalIncrementalEUR, diff: sumNetUplift - totalIncrementalEUR },
      );
    }
  }

  return {
    perStepOAndMPlant,
    perStepOAndMBess,
    perStepTransPlant,
    perStepTransBess,
    totalIncrementalEUR,
  };
}

export type TariffRateRow = {
  year: number;
  u_cap: number;
  u_use: number;
  u_ops: number;
  months: number;
  available: boolean;
};

export function getTariffRatesForRange(args: {
  startYmd: string;
  endYmd: string;
  region: number | null;
}): TariffRateRow[] {
  const { startYmd, endYmd, region } = args;
  if (region == null) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return [];
  if (startYmd > endYmd) return [];

  const start = new Date(startYmd + 'T00:00:00Z');
  const end = new Date(endYmd + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

  const yearMonths = new Map<number, number>();
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    const y = cursor.getUTCFullYear();
    yearMonths.set(y, (yearMonths.get(y) ?? 0) + 1);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return [...yearMonths.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, months]) => {
      const cell = tariffs[String(year)]?.regions[String(region)];
      return cell
        ? { year, u_cap: cell.u_cap, u_use: cell.u_use, u_ops: cell.u_ops, months, available: true }
        : { year, u_cap: 0, u_use: 0, u_ops: 0, months, available: false };
    });
}

export type FxRateRow = {
  ym: string;
  year: number;
  month: number;
  rate: number;
  date: string;
  available: boolean;
};

export function getFxRatesForRange(args: {
  startYmd: string;
  endYmd: string;
}): FxRateRow[] {
  const { startYmd, endYmd } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return [];
  if (startYmd > endYmd) return [];

  const start = new Date(startYmd + 'T00:00:00Z');
  const end = new Date(endYmd + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];

  const out: FxRateRow[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cursor <= last) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth() + 1;
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const entry = fx[ym];
    out.push(entry
      ? { ym, year: y, month: m, rate: entry.rate, date: entry.date, available: true }
      : { ym, year: y, month: m, rate: 0, date: '', available: false }
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}
