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
