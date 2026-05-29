import { runOptimization } from './runOptimization';
import type { OptimizationParams, Trajectory } from './types';

let worker: Worker | null = null;
let seq = 0;
type WorkerPayload = { traj: Trajectory; workerMs: number };

const pending = new Map<number, { resolve: (v: WorkerPayload) => void; reject: (e: Error) => void }>();

function ensureWorker(): void {
  if (worker) return;
  worker = new Worker(new URL('./optimizationWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; traj?: Trajectory; workerMs?: number; err?: string }>) => {
    const d = e.data;
    const id = d.id;
    const slot = pending.get(id);
    if (!slot) return;
    pending.delete(id);
    if (d.err != null && d.err !== undefined) slot.reject(new Error(d.err));
    else slot.resolve({ traj: d.traj!, workerMs: d.workerMs! });
  };
  worker.onerror = (err) => {
    pending.forEach((slot) => { slot.reject(err instanceof ErrorEvent ? new Error(err.message) : new Error(String(err))); });
    pending.clear();
    worker = null;
  };
}

export interface DelegatedResult {
  traj: Trajectory;
  workerMs: number;
  usedWorker: boolean;
}

/**
 * Runs optimisation off the main thread when Workers are available and the page is not file://.
 */
export function runOptimizationDelegated(
  price: number[],
  wind: number[],
  params: OptimizationParams
): Promise<DelegatedResult> {
  const fileProto = typeof location !== 'undefined' && location.protocol === 'file:';
  if (typeof Worker === 'undefined' || fileProto) {
    const t0 = performance.now();
    const trajSync = runOptimization(price, wind, params);
    return Promise.resolve({
      traj: trajSync,
      workerMs: performance.now() - t0,
      usedWorker: false,
    });
  }

  ensureWorker();
  const id = ++seq;
  return new Promise<WorkerPayload>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      worker!.postMessage({ id, price, wind, params });
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  }).then((r) => ({
    traj: r.traj,
    workerMs: r.workerMs,
    usedWorker: true,
  }));
}
