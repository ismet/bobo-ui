import { runOptimization } from './runOptimization';
import type { OptimizationParams } from './types';

self.onmessage = (e: MessageEvent<{ id: number; price: number[]; wind: number[]; params: OptimizationParams }>) => {
  const d = e.data;
  const id = d.id;
  try {
    const t0 = self.performance.now();
    const traj = runOptimization(d.price, d.wind, d.params);
    const workerMs = self.performance.now() - t0;
    self.postMessage({ id, traj, workerMs });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, err: msg });
  }
};

export {};
