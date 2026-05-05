// ============================================================================
// DP OPTIMIZER (re-implementation of the Python core)
// ============================================================================
import type { OptimizationParams, Trajectory, TrajectoryStep } from './types';

export function runOptimization(
  price: number[],
  wind: number[],
  params: OptimizationParams
): Trajectory {
  const T = price.length;
  const {
    capacity, chargeMax, dischargeMax,
    chargeEff, dischargeEff, initialSOCFrac, socSteps: socStepsHint, dt,
    targetDsoc,
    chargeFromGrid = true,
    wearCost = 0,
    installedCapacityMW,
  } = params;

  // Grid export ceiling: installed wind/solar capacity when provided (the
  // connection is sized to the generator), otherwise the larger inverter limit.
  const gridLimit = installedCapacityMW != null && installedCapacityMW > 0
    ? installedCapacityMW
    : Math.max(chargeMax, dischargeMax);
  const GRID_TOL = 1e-6;

  const MAX_STEPS = 600;
  const FIT_TOL = 1e-4;
  const eAct = [chargeMax * dt, dischargeMax * dt].filter(x => x > 0);
  let dSOC: number, socSteps: number;
  if (eAct.length === 0 || capacity <= 0) {
    socSteps = Math.max(1, socStepsHint);
    dSOC = capacity / socSteps;
  } else {
    let bestN = -1, bestCost = Infinity;
    for (let N = 1; N <= MAX_STEPS; N++) {
      const cand = capacity / N;
      if (targetDsoc != null && cand > targetDsoc + FIT_TOL) continue;
      let ok = true;
      for (const e of eAct) {
        const r = e / cand;
        if (Math.abs(r - Math.round(r)) > FIT_TOL) { ok = false; break; }
      }
      if (!ok) continue;
      let cost: number;
      if (targetDsoc != null) cost = N;
      else cost = Math.abs(N - socStepsHint);
      if (cost < bestCost) { bestCost = cost; bestN = N; }
    }
    if (bestN > 0) {
      socSteps = bestN;
      dSOC = capacity / bestN;
    } else {
      if (targetDsoc != null) {
        socSteps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(capacity / targetDsoc)));
      } else {
        socSteps = Math.max(1, socStepsHint);
      }
      dSOC = capacity / socSteps;
    }
  }
  const aMaxUp = Math.max(1, Math.round(dischargeMax * dt / dSOC));
  const aMaxDown = Math.max(1, Math.round(chargeMax * dt / dSOC));

  const V: (Float64Array | undefined)[] = new Array(T + 1);
  const policy: (Int16Array | undefined)[] = new Array(T);
  V[T] = new Float64Array(socSteps + 1);

  for (let t = T - 1; t >= 0; t--) {
    const Vt = new Float64Array(socSteps + 1);
    const pt = new Int16Array(socSteps + 1);
    const Vnext = V[t + 1] as Float64Array;
    const pr = price[t]!;
    const wt = wind[t]!;
    const windE = wt * dt;

    const aMaxDownStep = chargeFromGrid
      ? aMaxDown
      : Math.min(aMaxDown, Math.floor(windE * chargeEff / dSOC + 1e-9));

    for (let s = 0; s <= socSteps; s++) {
      let bestVal = -Infinity;
      let bestA = 0;
      const aLow = Math.max(-aMaxDownStep, s - socSteps);
      const aHigh = Math.min(aMaxUp, s);
      const capE = gridLimit * dt;

      for (let a = aLow; a <= aHigh; a++) {
        const sNext = s - a;
        let gridE: number;
        if (a > 0) gridE = a * dSOC * dischargeEff;
        else if (a < 0) gridE = a * dSOC / chargeEff;
        else gridE = 0;

        let netE = gridE + windE;
        if (netE < -capE - GRID_TOL) continue;
        if (netE > capE) netE = capE;

        const throughputE = Math.abs(a) * dSOC;
        const reward = netE * pr - throughputE * wearCost;
        const total = reward + Vnext[sNext]!;
        if (total > bestVal) { bestVal = total; bestA = a; }
      }
      Vt[s] = bestVal;
      pt[s] = bestA;
    }
    V[t] = Vt;
    policy[t] = pt;
  }

  const traj: TrajectoryStep[] = new Array(T);
  let s = Math.round(initialSOCFrac * socSteps);
  s = Math.max(0, Math.min(socSteps, s));
  let curtailedHours = 0;
  let curtailedEnergy = 0;

  for (let t = 0; t < T; t++) {
    const a = policy[t]![s]!;
    let gridE: number;
    if (a > 0) gridE = a * dSOC * dischargeEff;
    else if (a < 0) gridE = a * dSOC / chargeEff;
    else gridE = 0;
    const wt = wind[t]!;
    const pr = price[t]!;
    const windE = wt * dt;
    let gridTotalE = gridE + windE;
    let spillE = 0;
    const cap = gridLimit * dt;
    if (gridTotalE > cap + GRID_TOL) {
      spillE = gridTotalE - cap;
      gridTotalE = cap;
      curtailedHours += 1;
      curtailedEnergy += spillE;
    }
    if (gridTotalE < -cap - GRID_TOL) gridTotalE = -cap;
    const throughputE = Math.abs(a) * dSOC;
    const wearStepCost = throughputE * wearCost;
    traj[t] = {
      t,
      soc: s * dSOC,
      socFrac: s / socSteps,
      action: (a * dSOC) / dt,
      gridEnergy: gridE / dt,
      wind: wt,
      gridTotal: gridTotalE / dt,
      price: pr,
      revenue: gridTotalE * pr,
      windOnlyRevenue: Math.min(windE, cap) * pr,
      throughput: throughputE,
      wearStepCost,
      spillE,
    };
    s = s - a;
  }

  const out = traj as Trajectory;
  out._dSOC = dSOC;
  out._socSteps = socSteps;
  out._gridLimit = gridLimit;
  out._curtailedHours = curtailedHours;
  out._curtailedEnergy = curtailedEnergy;
  return out;
}
