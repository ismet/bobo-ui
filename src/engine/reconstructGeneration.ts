export interface ReconstructOptions {
  dayThr?: number;
  wideGap?: number;
  peakFactor?: number;
}

export interface ReconstructStats {
  clippedHours: number;
  recoveredEnergyMWh: number;
}

export interface ReconstructResult {
  cleaned: number[];
  stats: ReconstructStats;
  /** Length of the input series passed in (equals cleaned.length on success). */
  usedLength: number;
}

const CAP_TOL = 0.0005;

function sum(arr: number[]): number {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s;
}

function fitQuadratic(x: number[], y: number[]): { a: number; b: number; c: number } {
  const n = x.length;
  const sx = sum(x);
  const sx2 = sum(x.map(v => v * v));
  const sx3 = sum(x.map(v => v * v * v));
  const sx4 = sum(x.map(v => v * v * v * v));
  const sy = sum(y);
  const sxy = sum(x.map((v, i) => v * y[i]));
  const sx2y = sum(x.map((v, i) => v * v * y[i]));

  const Sxx = sx2 - sx * sx / n;
  const Sxy = sxy - sx * sy / n;
  const Sxx2 = sx3 - sx * sx2 / n;
  const Sx2x2 = sx4 - sx2 * sx2 / n;
  const Sx2y = sx2y - sx2 * sy / n;

  const denom = Sxx * Sx2x2 - Sxx2 * Sxx2;
  if (Math.abs(denom) < 1e-15) {
    return { a: 0, b: 0, c: sy / n };
  }

  const a = (Sx2y * Sxx - Sxy * Sxx2) / denom;
  const b = (Sxy * Sx2x2 - Sx2y * Sxx2) / denom;
  const c = (sy - a * sx2 - b * sx) / n;
  return { a, b, c };
}

function maxConsecutive(mask: boolean[]): number {
  let best = 0;
  let cur = 0;
  for (const m of mask) {
    cur = m ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

export function detectClippingLimitMW(generation: number[]): number | null {
  const tol = 0.001;
  const counts = new Map<number, number>();
  const minCount = Math.max(3, Math.floor(generation.length * 0.001));

  for (const v of generation) {
    if (v <= 0) continue;
    const key = Math.round(v / tol) * tol;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count >= minCount && (best === null || val > best)) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

export function reconstructGeneration(
  generation: number[],
  clippingLimitMW: number,
  options?: ReconstructOptions,
): ReconstructResult {
  const { dayThr = 0.05, wideGap = 4, peakFactor = 1.25 } = options ?? {};
  const inputLength = generation.length;

  if (clippingLimitMW <= 0) {
    return {
      cleaned: generation.slice(),
      stats: { clippedHours: 0, recoveredEnergyMWh: 0 },
      usedLength: inputLength,
    };
  }

  const cap = clippingLimitMW;
  const n = generation.length;
  if (n % 24 !== 0) {
    const trailing = n % 24;
    throw new Error(
      `PV reconstruction requires whole calendar days (24 h); got ${n} hourly values `
      + `(${trailing} trailing hour${trailing === 1 ? '' : 's'}). `
      + 'Trim price and generation together before reconstructing.',
    );
  }

  const v = generation;

  const hours = new Array<number>(n);
  const days = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    hours[i] = i % 24;
    days[i] = Math.floor(i / 24);
  }

  const clipped = new Array<boolean>(n);
  for (let i = 0; i < n; i++) clipped[i] = v[i] >= cap - CAP_TOL;

  const raw = v.slice();
  const numDays = Math.floor(n / 24);

  for (let d = 0; d < numDays; d++) {
    const offset = d * 24;
    const dayClipped = clipped.slice(offset, offset + 24);
    if (!dayClipped.some(Boolean)) continue;

    const hd = hours.slice(offset, offset + 24);
    const vd = v.slice(offset, offset + 24);

    const anchor: number[] = [];
    for (let j = 0; j < 24; j++) {
      if (!dayClipped[j] && vd[j] > dayThr) anchor.push(j);
    }

    if (anchor.length >= 3) {
      const ax = anchor.map(j => hd[j]);
      const ay = anchor.map(j => vd[j]);
      const { a, b, c } = fitQuadratic(ax, ay);
      const pred = hd.map(h => a * h * h + b * h + c);

      const run = maxConsecutive(dayClipped);
      const peakFloor = run >= wideGap ? peakFactor * cap : cap;

      let pk = -Infinity;
      for (let j = 0; j < 24; j++) {
        if (dayClipped[j] && pred[j] > pk) pk = pred[j];
      }
      if (pk < 0) pk = cap;

      if (pk < peakFloor && pk > 0) {
        const scale = peakFloor / pk;
        for (let j = 0; j < 24; j++) pred[j] *= scale;
      }

      for (let j = 0; j < 24; j++) {
        if (dayClipped[j]) {
          raw[offset + j] = Math.max(pred[j], cap);
        }
      }
    } else {
      for (let j = 0; j < 24; j++) {
        if (dayClipped[j]) raw[offset + j] = cap;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (clipped[i]) raw[i] = Math.max(raw[i], v[i]);
  }

  let changedCount = 0;
  let recoveredSum = 0;
  for (let i = 0; i < n; i++) {
    if (raw[i] !== v[i]) {
      changedCount++;
      recoveredSum += Math.max(0, raw[i] - v[i]);
    }
  }

  return {
    cleaned: raw,
    stats: { clippedHours: changedCount, recoveredEnergyMWh: recoveredSum },
    usedLength: n,
  };
}
