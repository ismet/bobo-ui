#!/usr/bin/env node
/**
 * Measures runOptimization timing (baseline vs worker-thread), same inputs both runs.
 */
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { runOptimization } from '../src/engine/runOptimization.ts';
import type { OptimizationParams } from '../src/engine/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

function syntheticMarketData(n: number): { price: number[]; wind: number[] } {
  const price: number[] = [];
  const wind: number[] = [];
  for (let i = 0; i < n; i++) {
    const hour = i % 24;
    price.push(40 + hour * 2 + (i % 7) * 0.5);
    wind.push(Math.min(12, 2 + hour * 0.35 + (i % 5) * 0.1));
  }
  return { price, wind };
}

function sliceLen(arr: number[], steps: number): number[] {
  return arr.slice(0, Math.min(steps, arr.length));
}

function benchSync(
  price: number[],
  wind: number[],
  params: OptimizationParams,
  warmup: number,
  reps: number
) {
  for (let i = 0; i < warmup; i++) runOptimization(price, wind, params);
  const times: number[] = [];
  for (let i = 0; i < reps; i++) {
    const t0 = performance.now();
    runOptimization(price, wind, params);
    times.push(performance.now() - t0);
  }
  return summarize(times);
}

function summarize(times: number[]) {
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  return {
    n: times.length,
    meanMs: mean,
    minMs: sorted[0]!,
    p50Ms: sorted[Math.floor(sorted.length / 2)]!,
    maxMs: sorted[sorted.length - 1]!,
  };
}

function workerExecArgv(): string[] {
  const argv = [...process.execArgv];
  const hasTsx = argv.some(
    (v, i) => (v === '--import' || v === '--loader') && String(argv[i + 1]).includes('tsx')
  );
  if (!hasTsx) argv.push('--import', 'tsx');
  return argv;
}

async function benchWorker(
  workerPath: string,
  price: number[],
  wind: number[],
  params: OptimizationParams,
  warmup: number,
  reps: number
) {
  const w = new Worker(workerPath, { execArgv: workerExecArgv() });
  const runOnce = () =>
    new Promise<{ innerMs?: number; error?: string }>((resolve, reject) => {
      const onMsg = (msg: { innerMs?: number; error?: string }) => {
        w.off('error', onErr);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg);
      };
      const onErr = reject;
      w.once('message', onMsg);
      w.once('error', onErr);
      w.postMessage({ price, wind, params });
    });

  const inner: number[] = [];
  const wall: number[] = [];
  try {
    for (let i = 0; i < warmup; i++) await runOnce();
    for (let i = 0; i < reps; i++) {
      const outer0 = performance.now();
      const msg = await runOnce();
      wall.push(performance.now() - outer0);
      if (typeof msg.innerMs === 'number') inner.push(msg.innerMs);
    }
  } finally {
    await w.terminate();
  }
  return {
    workerInnerMs: summarize(inner),
    mainWallMs: summarize(wall),
  };
}

const WARMUP = 2;
const REPS = 15;
const WIND_SCALE = 1;
const horizons: [string, number][] = [
  ['week', 168],
  ['year', 8760],
];

const defaultParams = (steps: number): OptimizationParams => ({
  capacity: 11,
  chargeMax: 6,
  dischargeMax: 11,
  chargeEff: 0.93,
  dischargeEff: 0.95,
  initialSOCFrac: 0.5,
  socSteps: 20,
  dt: 1.0,
  targetDsoc: 1.0,
  chargeFromGrid: true,
  wearCost: 20,
});

console.log('# DP benchmark (node, same machine as Cursor)\n');

const { price: fullP, wind: fullW } = syntheticMarketData(8760);

const workerBenchPath = join(__dirname, 'dp-worker-thread.ts');

for (const [label, steps] of horizons) {
  const price = sliceLen(fullP, steps).map(Number);
  const wind = sliceLen(fullW, steps).map((w) => w * WIND_SCALE);
  const params = defaultParams(steps);

  console.log(`## Horizon: ${label} (${steps} steps)\n`);

  const syncStats = benchSync(price, wind, params, WARMUP, REPS);
  console.log('baseline (sync main thread, direct import):');
  console.log(formatStats(syncStats));

  const ww = await benchWorker(workerBenchPath, price, wind, params, WARMUP, REPS);

  console.log('worker-thread (inner CPU ms, measured inside worker):');
  console.log(formatStats(ww.workerInnerMs));
  console.log('worker-thread (main-thread wall ms, incl. IPC + serialization):');
  console.log(formatStats(ww.mainWallMs));
  console.log(
    `ratio worker_inner_mean / sync_mean = ${(ww.workerInnerMs.meanMs / syncStats.meanMs).toFixed(3)}`
  );
  console.log('');
}

function formatStats(s: ReturnType<typeof summarize>) {
  return `  n=${s.n}  mean=${s.meanMs.toFixed(2)}ms  min=${s.minMs.toFixed(2)}  p50=${s.p50Ms.toFixed(2)}  max=${s.maxMs.toFixed(2)}`;
}
