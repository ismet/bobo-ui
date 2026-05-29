import type { OptimizationParams, Trajectory } from './engine/types';
import type { HorizonTrimInfo } from './formatUtils';

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
  dateRangeLabel: string;
  /** UTC midnight of first calendar day in plant date range; omit for bundled/pasted series (uses default chart epoch). */
  chartEpochUtcMs?: number;
  dt: number;
  /** Stats from PV clipping reconstruction, present only when reconstruction was applied. */
  pvReconstructStats?: {
    clippedHours: number;
    recoveredEnergyMWh: number;
  };
  /** Present when trailing partial-day hours were dropped so price/wind stay aligned for PV recon. */
  horizonTrim?: HorizonTrimInfo;
}
