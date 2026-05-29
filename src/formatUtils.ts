// ============================================================================
// Helpers (formatting & paste parsing)
// ============================================================================

export function fmtNumber(x: number, digits = 0): string {
  if (!isFinite(x)) return '—';
  const sign = x < 0 ? '-' : '';
  const ax = Math.abs(x);
  if (ax >= 1e6) return sign + (ax / 1e6).toFixed(digits >= 2 ? 2 : 2) + 'M';
  if (ax >= 1e3) return sign + (ax / 1e3).toFixed(digits >= 1 ? 1 : 1) + 'k';
  return sign + ax.toFixed(digits);
}

export function fmtMoney(x: number): string {
  if (!isFinite(x)) return '—';
  const sign = x < 0 ? '-' : '';
  const ax = Math.abs(x);
  if (ax >= 1e6) return sign + '€' + (ax / 1e6).toFixed(2) + 'M';
  if (ax >= 1e3) return sign + '€' + (ax / 1e3).toFixed(1) + 'k';
  return sign + '€' + ax.toFixed(0);
}

export function plotAll<T extends Record<string, unknown>>(arr: T[]): Array<T & { idx: number }> {
  return arr.map((d, i) => ({ ...d, idx: i }));
}

export function fingerprintSeriesSample(pricePeriod: number[], windPeriod: number[]): string {
  const n = pricePeriod.length;
  if (n <= 0 || windPeriod.length !== n) return '0';
  const idxs = [0, Math.floor(n / 2), n - 1];
  return idxs.map((i) => `${pricePeriod[i]},${windPeriod[i]}`).join('|');
}

/** Hourly charts default to bundled sample horizon (2024); EPİAŞ plant loads override via `chartEpochUtcMs`. */
export const DEFAULT_TS_EPOCH_MS = Date.UTC(2024, 0, 1);

export function ymdToUtcMidnightMs(ymd: string): number {
  const parts = ymd.split('-').map(Number);
  const y = parts[0]!;
  const m = parts[1]!;
  const d = parts[2]!;
  return Date.UTC(y, m - 1, d);
}

export function tsLabel(hourOffset: number, showTime = false, epochUtcMs: number = DEFAULT_TS_EPOCH_MS): string {
  const ms = hourOffset * 3600 * 1000;
  const d = new Date(epochUtcMs + ms);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]!;
  const dd = d.getUTCDate().toString().padStart(2,'0');
  if (showTime) {
    const hh = d.getUTCHours().toString().padStart(2,'0');
    const mm = d.getUTCMinutes().toString().padStart(2,'0');
    return `${mon} ${dd} ${hh}:${mm}`;
  }
  return `${mon} ${dd}`;
}

export type ParsePasteResult =
  | { kind: 'two'; price: number[]; wind: number[] }
  | { kind: 'single'; values: number[] }
  | { kind: 'error'; message: string };

export function parsePaste(raw: string): ParsePasteResult {
  if (!raw || !raw.trim()) return { kind: 'error', message: 'empty' };
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const splitLine = (l: string) => l.split(/[,;\s\t]+/).filter(Boolean);

  let twoColRows = 0, oneColRows = 0;
  for (const l of lines) {
    const toks = splitLine(l);
    const nums = toks.map(Number).filter(n => !isNaN(n));
    if (nums.length >= 2) twoColRows++;
    else if (nums.length === 1) oneColRows++;
  }

  if (twoColRows >= 5 && twoColRows >= 0.75 * lines.length) {
    const price: number[] = [], wind: number[] = [];
    for (const l of lines) {
      const toks = splitLine(l).map(Number);
      if (toks.length >= 2 && !isNaN(toks[0]!) && !isNaN(toks[1]!)) {
        price.push(toks[0]!);
        wind.push(toks[1]!);
      }
    }
    if (price.length < 24) return { kind: 'error', message: `only ${price.length} valid rows parsed` };
    return { kind: 'two', price, wind };
  }

  const values: number[] = [];
  for (const l of lines) {
    for (const t of splitLine(l)) {
      const n = Number(t);
      if (!isNaN(n)) values.push(n);
    }
  }
  if (values.length < 24) return { kind: 'error', message: `only ${values.length} numeric values found` };
  return { kind: 'single', values };
}

export function formatLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function boboDefaultDateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - 7);
  return { startDate: formatLocalYMD(start), endDate: formatLocalYMD(end) };
}

export type HorizonTrimInfo = {
  originalHours: number;
  usedHours: number;
  droppedHours: number;
};

/**
 * Trim price and wind to the same length. When fullDaysOnly, drop trailing
 * partial-day hours so both arrays are a multiple of 24 (needed for PV recon).
 */
export function alignPriceWindSeries(
  price: number[],
  wind: number[],
  opts?: { fullDaysOnly?: boolean },
): { price: number[]; wind: number[]; droppedHours: number; trim?: HorizonTrimInfo } {
  const originalHours = Math.min(price.length, wind.length);
  let usedHours = originalHours;
  if (opts?.fullDaysOnly) usedHours = Math.floor(usedHours / 24) * 24;
  const droppedHours = originalHours - usedHours;
  const trim = droppedHours > 0
    ? { originalHours, usedHours, droppedHours }
    : undefined;
  return {
    price: price.slice(0, usedHours),
    wind: wind.slice(0, usedHours),
    droppedHours,
    trim,
  };
}

export function normalizePowerPlantsPayload(j: unknown): unknown[] {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') {
    const o = j as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.power_plants)) return o.power_plants;
    if (Array.isArray(o.plants)) return o.plants;
  }
  return [];
}
