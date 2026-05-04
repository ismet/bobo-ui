import type { OptimizationParams, Trajectory } from './engine/types';

export type HorizonKey = 'week' | 'month' | 'quarter' | 'year';

/** Result bundle produced after one optimisation run (charts + table). */
export interface OptimizationRunResult {
  traj: Trajectory;
  params: OptimizationParams;
  pricePeriod: number[];
  windPeriod: number[];
  spotWindRescaleKey: string;
  ms: number;
  ipcOverheadMs: number;
  usedWorker: boolean;
  horizon: HorizonKey;
  dt: number;
}
