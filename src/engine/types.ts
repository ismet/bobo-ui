/** Parameters passed to the DP optimiser (browser + worker). */
export interface OptimizationParams {
  capacity: number;
  chargeMax: number;
  dischargeMax: number;
  chargeEff: number;
  dischargeEff: number;
  initialSOCFrac: number;
  socSteps: number;
  dt: number;
  targetDsoc: number | null;
  chargeFromGrid?: boolean;
  wearCost?: number;
  /** Wind/solar installed capacity (MW). When set, this is the hard grid export
   *  limit for the hybrid plant — the connection is sized to the generator, not
   *  the battery inverter. Used as the sweep's fixed export ceiling. */
  installedCapacityMW?: number;
}

export interface TrajectoryStep {
  t: number;
  soc: number;
  socFrac: number;
  action: number;
  gridEnergy: number;
  wind: number;
  gridTotal: number;
  price: number;
  revenue: number;
  windOnlyRevenue: number;
  throughput: number;
  wearStepCost: number;
  spillE: number;
}

export type Trajectory = TrajectoryStep[] & {
  _dSOC?: number;
  _socSteps?: number;
  _gridLimit?: number;
  _curtailedHours?: number;
  _curtailedEnergy?: number;
};
