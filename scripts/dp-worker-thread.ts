/**
 * worker_threads shim: runs runOptimization in isolation (benchmark only).
 */
import { performance } from 'node:perf_hooks';
import { parentPort } from 'node:worker_threads';
import { runOptimization } from '../src/engine/runOptimization.ts';
import type { OptimizationParams } from '../src/engine/types';

type WorkerMsg = { price: number[]; wind: number[]; params: OptimizationParams };

if (!parentPort) throw new Error('dp-worker-thread must be started as a Worker');

parentPort.on('message', (msg: WorkerMsg) => {
  const { price, wind, params } = msg;
  const t0 = performance.now();
  try {
    const traj = runOptimization(price, wind, params);
    const innerMs = performance.now() - t0;
    parentPort!.postMessage({ innerMs, trajLen: traj.length });
  } catch (e: unknown) {
    parentPort!.postMessage({
      error: String(e instanceof Error ? e.message : e),
    });
  }
});
