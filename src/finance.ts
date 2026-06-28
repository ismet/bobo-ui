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
}): {
  grossRevenueEUR: number;
  hybridRevenueEUR: number;
  oAndMEUR: number;
  transmissionEUR: number;
  netRevenueEUR: number;
  incrementalEUR: number;
  monthsBilled: number;
  monthsTotal: number;
  yearLabel: string;
} {
  const { traj, dt, periodStartMs, region, installedMW } = args;

  const buckets = new Map<string, { year: number; exportedMWh: number }>();
  let monthsTouched = 0;
  for (let i = 0; i < traj.length; i++) {
    const e = Math.min(traj[i].wind, installedMW) * dt;
    if (e <= 0) continue;
    const d = new Date(periodStartMs + i * dt * 3_600_000);
    const y = d.getUTCFullYear();
    const ym = `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    let b = buckets.get(ym);
    if (!b) { b = { year: y, exportedMWh: 0 }; buckets.set(ym, b); monthsTouched++; }
    b.exportedMWh += e;
  }

  let oAndMEUR = 0, transmissionEUR = 0, monthsBilled = 0;
  const years = new Set<number>();
  for (const [ym, { year, exportedMWh }] of buckets) {
    const cell = tariffs[String(year)]?.regions[String(region)];
    const rate = fx[ym]?.rate;
    if (!cell || !rate) continue;
    const capacityTL = cell.u_cap * installedMW * (1 / 12);
    const energyTL   = cell.u_use * exportedMWh;
    const opsTL      = cell.u_ops  * exportedMWh;
    oAndMEUR        += opsTL / rate;
    transmissionEUR += (capacityTL + energyTL) / rate;
    monthsBilled++;
    years.add(year);
  }

  const grossRevenueEUR = traj.reduce((s, r) => s + r.windOnlyRevenue, 0);
  const hybridRevenueEUR = traj.reduce((s, r) => s + r.revenue, 0);
  const netRevenueEUR   = grossRevenueEUR - oAndMEUR - transmissionEUR;
  const incrementalEUR  = hybridRevenueEUR - netRevenueEUR;

  const sortedYears = [...years].sort();
  const yearLabel =
    sortedYears.length === 0 ? 'no data' :
    sortedYears.length === 1 ? String(sortedYears[0]) :
    `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`;

  return { grossRevenueEUR, hybridRevenueEUR, oAndMEUR, transmissionEUR, netRevenueEUR, incrementalEUR,
           monthsBilled, monthsTotal: monthsTouched, yearLabel };
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
