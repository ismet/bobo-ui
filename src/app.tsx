// ============================================================================
// MAIN APP
// ============================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CapacitySweepChart } from './charts/capacitySweepChart';
import {
  BatteryVsPriceChart,
  ChartsPanel,
  DispatchChart,
  Footer,
  Header,
  KPIRow,
  PriceDurationCurve,
  ActionHistogram,
  PvGenerationCompareChart,
  UpliftChart,
} from './charts/resultCharts';
import { DataInputCard, type PowerPlantRow } from './panels/dataInputPanels';
import { DegradationCard, EconomicsCard } from './panels/economicsDegradation';
import { PvReconstructCard } from './panels/pvReconstructCard';
import { OutputTable } from './tables/outputTable';
import { boboApiUrl } from './data/api';
import {
  boboDefaultDateRange,
  formatLocalYMD,
  alignPriceWindSeries,
  fingerprintSeriesSample,
  normalizePowerPlantsPayload,
  peakGenerationMW,
  ymdToUtcMidnightMs,
  type PredefinedDateRange,
} from './formatUtils';
import { runOptimizationDelegated } from './engine/optimizationRunner';
import { reconstructGeneration, detectClippingLimitMW } from './engine/reconstructGeneration';
import type { ReconstructStats } from './engine/reconstructGeneration';
import type { OptimizationParams } from './engine/types';
import type { OptimizationRunResult } from './optimizationTypes';
import { FullScreenJobOverlay } from './fullScreenJobOverlay';
import { SectionHeader, NumberInput } from './uiPrimitives';

export default function App({ onLogout }: { onLogout?: () => void }) {
  // Parameters (capacity / power limits auto-synced from input data peak — see useEffect below)
  const [capacity, setCapacity] = useState(1);   // MWh (draft)
  const [chargeMax, setChargeMax] = useState(1);    // MW (draft)
  const [dischargeMax, setDischargeMax] = useState(1);   // MW (draft)
  const [cRate, setCRate] = useState<'1C' | '0.5C'>('1C'); // (draft) — UI helper that derives chargeMax/dischargeMax from capacity
  const [chargeEff, setChargeEff] = useState(0.93); // frac (draft)
  const [dischargeEff, setDischargeEff] = useState(0.95); // frac (draft)
  const [initialSOC, setInitialSOC] = useState(0.5); // (draft)
  // Wind/solar installed capacity (MW) — sets the hard grid export ceiling.
  // null = use max(chargeMax, dischargeMax) as before.
  const [installedCapacityMW, setInstalledCapacityMW] = useState(1); // (draft)
  const [systemDesignOpen, setSystemDesignOpen] = useState(true);

  // Time step in hours (fixed): each row in data = 1 hour.
  const dt = 1.0;

  // Solution grid resolution (max MWh per SOC step). null = auto.
  const [targetDsoc, setTargetDsoc] = useState<number | null>(0.25); // (draft)

  // Whether the battery may import energy from the grid to charge.
  // false = on-site generation only for charging (no grid imports).
  const [chargeFromGrid, setChargeFromGrid] = useState(false); // (draft) — default: plant only

  // ---- Degradation parameters -----------------------------------------------
  // OPTION A: per-MWh wear cost charged against battery throughput in the DP.
  //   Pulls the optimiser toward economically rational cycling. €20/MWh is a
  //   reasonable default for utility-scale Li-ion at 250 €/kWh CAPEX.
  const [wearCost, setWearCost] = useState(5);                 // €/MWh (draft)
  // OPTION B: capacity fade applied year-over-year as the asset ages.
  //   Year-1 fade is highest (SEI growth), declining toward an asymptote.
  //   Defaults match typical Li-ion: ~2.5%/yr year-1 trending to ~0.7%/yr.
  //   End-of-life retention is *derived* from these rates + lifetime — see
  //   buildFadeCurve. With the defaults (2.5%/0.7%/20y, τ=4y) EoL ≈ 78%.
  const [yearOneFadePct, setYearOneFadePct] = useState(1.0);    // % year 1 (draft)
  const [longTermFadePct, setLongTermFadePct] = useState(1.0);  // % long term (draft)
  // ---------------------------------------------------------------------------

  // ---- PV clipping reconstruction -------------------------------------------
  const [pvReconstructEnabled, setPvReconstructEnabled] = useState(false);   // (draft)
  const [clippingLimitMW, setClippingLimitMW] = useState<number | null>(null); // (draft) null = not yet detected
  const [pvDayThr, setPvDayThr] = useState(0.05);                             // (draft)
  const [pvWideGap, setPvWideGap] = useState(4);                              // (draft)
  const [pvPeakFactor, setPvPeakFactor] = useState(1.25);                     // (draft)
  // ---------------------------------------------------------------------------

  // ---- Financial parameters --------------------------------------------------
  // Battery cost: € per kWh of energy capacity (industry-standard quoting).
  //   2024 typical Li-ion utility-scale cost: ~250–350 €/kWh (BNEF, NREL).
  const [batteryCostPerKWh, setBatteryCostPerKWh] = useState(155); // €/kWh (draft)
  const [interestRatePct, setInterestRatePct] = useState(9.5); // % (draft)
  const [lifetimeYears, setLifetimeYears] = useState(20);  // years (draft)

  // Capital recovery factor: CRF = i(1+i)^n / ((1+i)^n - 1)
  // For i = 9.5%, n = 20 → CRF ≈ 0.1142 (each € of CAPEX costs €0.1142/yr).
  const crf = useMemo(() => {
    const i = interestRatePct / 100;
    if (i <= 0) return 1 / lifetimeYears;
    const f = Math.pow(1 + i, lifetimeYears);
    return (i * f) / (f - 1);
  }, [interestRatePct, lifetimeYears]);
  // ---------------------------------------------------------------------------

  type SeriesData = { price: number[]; wind: number[] };

  // Loaded price & generation series (null = no data loaded) (draft)
  const [customData, setCustomData] = useState<SeriesData | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null); // (draft)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null); // (draft)
  const initialBoboDateRange = useMemo(() => boboDefaultDateRange(), []);
  const [boboStartDate, setBoboStartDate] = useState(initialBoboDateRange.startDate); // (draft)
  const [boboEndDate, setBoboEndDate] = useState(initialBoboDateRange.endDate); // (draft)
  const [selectedDateRange, setSelectedDateRange] = useState<PredefinedDateRange | null>('1w');
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(true);

  const [powerPlants, setPowerPlants] = useState<PowerPlantRow[]>([]);
  const [plantsLoading, setPlantsLoading] = useState(true);
  const [plantsError, setPlantsError] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [boboSeriesError, setBoboSeriesError] = useState<string | null>(null);

  const seriesAbortRef = useRef<AbortController | null>(null);
  const seriesFetchGenRef = useRef(0);
  const optimGenRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Applied (committed) snapshot — used by all charts/results.
  // Nothing updates until the user presses Optimize.
  // ---------------------------------------------------------------------------
  const [appliedScenarioKey, setAppliedScenarioKey] = useState<string | null>(null);
  const [appliedResult, setAppliedResult] = useState<OptimizationRunResult | null>(null);
  const [appliedBatteryCostPerKWh, setAppliedBatteryCostPerKWh] = useState<number | null>(null);
  const [appliedInterestRatePct, setAppliedInterestRatePct] = useState<number | null>(null);
  const [appliedLifetimeYears, setAppliedLifetimeYears] = useState<number | null>(null);
  const [appliedYearOneFadePct, setAppliedYearOneFadePct] = useState<number | null>(null);
  const [appliedLongTermFadePct, setAppliedLongTermFadePct] = useState<number | null>(null);
  const [appliedRegion, setAppliedRegion] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /** Bumped only after a successful optimize commit; drives deferred overlay dismiss after charts paint. */
  const [optimizeOverlayDismissTick, setOptimizeOverlayDismissTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  /**
   * Dispatch result for the financially optimal sweep point. Set by
   * CapacitySweepChart when a sweep completes; cleared whenever the input
   * data or sidebar parameters change (so the OutputTable reverts to
   * appliedResult and downstream views never show a stale optimum).
   */
  const [sweepOptimalResult, setSweepOptimalResult] = useState<OptimizationRunResult | null>(null);

  const appliedCrf = useMemo(() => {
    const iPct = appliedInterestRatePct ?? interestRatePct;
    const nY = appliedLifetimeYears ?? lifetimeYears;
    const i = iPct / 100;
    if (i <= 0) return 1 / nY;
    const f = Math.pow(1 + i, nY);
    return (i * f) / (f - 1);
  }, [appliedInterestRatePct, appliedLifetimeYears, interestRatePct, lifetimeYears]);

  const draftScenarioKey = useMemo(() => {
    const seriesKey = customData
      ? `${customData.price.length}:${fingerprintSeriesSample(customData.price, customData.wind)}`
      : '0:none';
    // Keep key stable + cheap to compare; stringify primitives only.
    return [
      'v1',
      seriesKey,
      selectedPlantId ?? '',
      selectedRegion ?? '',
      boboStartDate,
      boboEndDate,
      capacity,
      chargeMax,
      dischargeMax,
      cRate,
      chargeEff,
      dischargeEff,

      initialSOC,
      installedCapacityMW ?? '',
      targetDsoc ?? 'auto',
      chargeFromGrid ? 1 : 0,
      wearCost,
      batteryCostPerKWh,
      interestRatePct,
      lifetimeYears,
      yearOneFadePct,
      longTermFadePct,
      pvReconstructEnabled ? 1 : 0,
      clippingLimitMW ?? 'auto',
      pvDayThr,
      pvWideGap,
      pvPeakFactor,
    ].join('|');
  }, [
    customData,
    selectedPlantId,
    selectedRegion,
    boboStartDate,
    boboEndDate,
    capacity,
    chargeMax,
    dischargeMax,
    cRate,
    chargeEff,
    dischargeEff,
    initialSOC,
    installedCapacityMW,
    targetDsoc,
    chargeFromGrid,
    wearCost,
    batteryCostPerKWh,
    interestRatePct,
    lifetimeYears,
    yearOneFadePct,
    longTermFadePct,
    pvReconstructEnabled,
    clippingLimitMW,
    pvDayThr,
    pvWideGap,
    pvPeakFactor,
  ]);

  const hasPendingChanges = appliedScenarioKey == null || appliedScenarioKey !== draftScenarioKey;

  useLayoutEffect(() => {
    if (optimizeOverlayDismissTick === 0 || appliedResult == null) return;

    const dismissDelayMs = 500;

    let cancelled = false;
    /** Idle vs immediate fallback */
    let idleOrTimerId: number | undefined;
    let usedIdleCallback = false;
    /** Extra hold so the optimize overlay stays visible after charts settle */
    let dismissDelayId: number | undefined;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const scheduleDismiss = () => {
          if (cancelled) return;
          dismissDelayId = window.setTimeout(() => {
            dismissDelayId = undefined;
            if (!cancelled) setRunning(false);
          }, dismissDelayMs);
        };
        if (typeof requestIdleCallback === 'function') {
          usedIdleCallback = true;
          idleOrTimerId = requestIdleCallback(scheduleDismiss, { timeout: 2000 }) as unknown as number;
        } else {
          idleOrTimerId = window.setTimeout(scheduleDismiss, 200);
        }
      });
    });

    return () => {
      cancelled = true;
      if (idleOrTimerId !== undefined) {
        if (usedIdleCallback && typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(idleOrTimerId);
        } else {
          window.clearTimeout(idleOrTimerId);
        }
      }
      if (dismissDelayId !== undefined) {
        window.clearTimeout(dismissDelayId);
      }
    };
  }, [optimizeOverlayDismissTick, appliedResult]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPlantsLoading(true);
      setPlantsError(null);
      try {
        const r = await fetch(boboApiUrl('/power-plants'));
        if (!r.ok) throw new Error(`power-plants ${r.status}`);
        const j = await r.json();
        const list = normalizePowerPlantsPayload(j);
        if (!cancelled) setPowerPlants(list as PowerPlantRow[]);
      } catch (e) {
        if (!cancelled) setPlantsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPlantsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const clearBoboInflight = useCallback(() => {
    seriesAbortRef.current?.abort();
    seriesAbortRef.current = null;
    setSeriesLoading(false);
    setBoboSeriesError(null);
  }, []);

  const clearAppliedSnapshot = useCallback(() => {
    setAppliedScenarioKey(null);
    setAppliedResult(null);
    setAppliedBatteryCostPerKWh(null);
    setAppliedInterestRatePct(null);
    setAppliedLifetimeYears(null);
    setAppliedYearOneFadePct(null);
    setAppliedLongTermFadePct(null);
    setAppliedRegion(null);
    setSweepOptimalResult(null);
  }, []);

  const setCustomDataWithSource = useCallback((data: SeriesData | null, fromBobo = false) => {
    if (data === null) {
      setSelectedPlantId(null);
      seriesFetchGenRef.current++;
      optimGenRef.current++;
      clearBoboInflight();
      clearAppliedSnapshot();
      setHasUnappliedChanges(true);
      setErr(null);
      setRunning(false);
      setClippingLimitMW(null);
      setCustomData(null);
      return;
    }

    if (!fromBobo) setSelectedPlantId(null);
    setErr(null);
    const newKey = `${data.price.length}:${fingerprintSeriesSample(data.price, data.wind)}`;
    if (appliedResult && appliedResult.spotWindRescaleKey !== newKey) {
      clearAppliedSnapshot();
    }
    setCustomData(data);
  }, [clearBoboInflight, clearAppliedSnapshot, appliedResult]);

  useEffect(() => () => { seriesAbortRef.current?.abort(); }, []);

  const handlePvReconstructEnabled = useCallback((enabled: boolean) => {
    setPvReconstructEnabled(enabled);
    if (!enabled) setClippingLimitMW(null);
    setHasUnappliedChanges(true);
  }, []);

  const handleCRateChange = useCallback((next: '1C' | '0.5C') => {
    setCRate(next);
    const mult = next === '1C' ? 1 : 0.5;
    setChargeMax(capacity * mult);
    setDischargeMax(capacity * mult);
    setHasUnappliedChanges(true);
  }, [capacity]);

  const inputWindForSizing = customData?.wind ?? [];
  const inputSeriesSizingKey = useMemo(() => {
    const price = customData?.price ?? [];
    return `${inputWindForSizing.length}:${fingerprintSeriesSample(price, inputWindForSizing)}`;
  }, [customData, inputWindForSizing]);

  useEffect(() => {
    const peak = peakGenerationMW(inputWindForSizing);
    setCapacity(peak);
    setChargeMax(peak);
    setDischargeMax(peak);
    setInstalledCapacityMW(peak);
    setHasUnappliedChanges(true);
  }, [inputSeriesSizingKey, inputWindForSizing]);

  const fetchPlantSeries = useCallback(async (id: string | number, startDate: string, endDate: string): Promise<SeriesData | null> => {
    const gen = ++seriesFetchGenRef.current;
    seriesAbortRef.current?.abort();
    const ac = new AbortController();
    seriesAbortRef.current = ac;
    setSeriesLoading(true);
    setBoboSeriesError(null);
    const url = boboApiUrl(
      '/power-plants/' + encodeURIComponent(id)
      + '/prices-and-generation?start_date=' + encodeURIComponent(startDate)
      + '&end_date=' + encodeURIComponent(endDate),
    );
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error('prices-and-generation ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.prices) || !Array.isArray(j.powers)) {
        throw new Error('Response missing prices[] or powers[]');
      }
      if (j.prices.length !== j.powers.length) {
        throw new Error('Length mismatch: ' + j.prices.length + ' prices vs ' + j.powers.length + ' powers');
      }
      const price = j.prices.map(Number);
      const wind = j.powers.map(Number);
      if (price.some((n: number) => !isFinite(n)) || wind.some((n: number) => !isFinite(n))) {
        throw new Error('Non-finite values in series');
      }
      const data: SeriesData = { price, wind };
      if (seriesFetchGenRef.current !== gen) return null;
      setCustomDataWithSource(data, true);
      setHasUnappliedChanges(false);
      return data;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return null;
      setBoboSeriesError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      if (seriesFetchGenRef.current === gen) {
        seriesAbortRef.current = null;
        setSeriesLoading(false);
      }
    }
  }, [setCustomDataWithSource]);

  const handlePickPlant = useCallback((id: string | number) => {
    setSelectedPlantId(String(id));
    setBoboSeriesError(null);
    setHasUnappliedChanges(true);
  }, []);

  // Draft data source (for labels/hints only)
  const draftActivePrice = useMemo(() => customData?.price ?? [], [customData]);
  const draftActiveWind = useMemo(() => customData?.wind ?? [], [customData]);
  const draftPeakMW = useMemo(() => peakGenerationMW(draftActiveWind), [draftActiveWind]);
  const powerSliderMax = Math.max(100, Math.ceil(draftPeakMW * 1.25));
  const installedSliderMax = Math.max(200, Math.ceil(draftPeakMW * 1.25));
  const availableHours = draftActivePrice.length * dt;          // total hours covered by dataset
  const availableSteps = draftActivePrice.length;               // raw point count
  const horizonHours = availableHours;
  const horizonSteps = availableSteps;

  const spotWindChartProps = useMemo(() => {
    if (customData && (appliedResult == null || hasPendingChanges)) {
      return {
        price: customData.price,
        wind: customData.wind,
        dt,
        chartEpochUtcMs: selectedPlantId ? ymdToUtcMidnightMs(boboStartDate) : undefined,
      };
    }
    if (appliedResult) {
      return {
        price: appliedResult.pricePeriod,
        wind: appliedResult.windPeriod,
        dt: appliedResult.dt,
        chartEpochUtcMs: appliedResult.chartEpochUtcMs,
      };
    }
    return null;
  }, [customData, appliedResult, hasPendingChanges, dt, selectedPlantId, boboStartDate]);

  const optimize = useCallback(async (): Promise<OptimizationRunResult | null> => {
    if (running) return null;
    // Snapshot draft at click-time (no partial updates).
    const snapCustomData = customData;
    const snapSelectedPlantId = selectedPlantId;
    const snapBoboStartDate = boboStartDate;
    const snapBoboEndDate = boboEndDate;

    const snapCapacity = capacity;
    const snapChargeMax = chargeMax;
    const snapDischargeMax = dischargeMax;
    const snapChargeEff = chargeEff;
    const snapDischargeEff = dischargeEff;
    const snapInitialSOC = initialSOC;
    const snapInstalledCapacityMW = installedCapacityMW;
    const snapTargetDsoc = targetDsoc;
    const snapChargeFromGrid = chargeFromGrid;
    const snapWearCost = wearCost;

    const snapBatteryCostPerKWh = batteryCostPerKWh;
    const snapInterestRatePct = interestRatePct;
    const snapLifetimeYears = lifetimeYears;
    const snapYearOneFadePct = yearOneFadePct;
    const snapLongTermFadePct = longTermFadePct;
    const snapSelectedRegion = selectedRegion;

    const snapPvReconstructEnabled = pvReconstructEnabled;
    const snapClippingLimitMW = clippingLimitMW;
    const snapPvDayThr = pvDayThr;
    const snapPvWideGap = pvWideGap;
    const snapPvPeakFactor = pvPeakFactor;

    const snapKey = draftScenarioKey;

    if (!snapCustomData?.price?.length || snapCustomData.price.length < 24) {
      setErr('Load at least 24 hours of price and generation data before optimizing.');
      return null;
    }

    const snapPrice = snapCustomData.price;
    const snapWind = snapCustomData.wind;
    const aligned = alignPriceWindSeries(
      snapPrice,
      snapWind,
      { fullDaysOnly: snapPvReconstructEnabled },
    );
    let pricePeriod = aligned.price;
    let finalWind = aligned.wind;
    const horizonTrim = aligned.trim;

    // PV clipping reconstruction (if enabled)
    let pvStats: ReconstructStats | undefined;
    let windPeriodMeasured: number[] | undefined;
    if (snapPvReconstructEnabled) {
      windPeriodMeasured = finalWind.slice();
      let effectiveLimit = snapClippingLimitMW;
      if (effectiveLimit === null) {
        const detected = detectClippingLimitMW(finalWind);
        effectiveLimit = detected ?? Math.max(...finalWind);
        setClippingLimitMW(effectiveLimit);
      }
      const result = reconstructGeneration(finalWind, effectiveLimit, {
        dayThr: snapPvDayThr,
        wideGap: snapPvWideGap,
        peakFactor: snapPvPeakFactor,
      });
      finalWind = result.cleaned;
      pvStats = result.stats;
      setClippingLimitMW(effectiveLimit);
    }
    const windPeriod = finalWind;
    const dateRangeLabel = snapSelectedPlantId ? `${snapBoboStartDate} -> ${snapBoboEndDate}` : 'Loaded dataset';

    setRunning(true); setErr(null);
    await new Promise(r => setTimeout(r, 20));
    const gen = ++optimGenRef.current;
    let completedOk = false;
    let result: OptimizationRunResult | null = null;
    try {
      const socSteps = 20;
      const params: OptimizationParams = {
        capacity: snapCapacity,
        chargeMax: snapChargeMax,
        dischargeMax: snapDischargeMax,
        chargeEff: snapChargeEff,
        dischargeEff: snapDischargeEff,
        initialSOCFrac: snapInitialSOC,
        socSteps,
        dt,
        targetDsoc: snapTargetDsoc,
        chargeFromGrid: snapChargeFromGrid,
        wearCost: snapWearCost,
        installedCapacityMW: snapInstalledCapacityMW,
      };
      const tWall0 = performance.now();
      const { traj, workerMs, usedWorker } = await runOptimizationDelegated(pricePeriod, windPeriod, params);
      if (optimGenRef.current !== gen) return null;
      const wallMs = performance.now() - tWall0;
      const n = pricePeriod.length;
      const ph = fingerprintSeriesSample(pricePeriod, windPeriod);
      const spotWindRescaleKey = `${n}:${ph}`;

      const chartEpochUtcMs = snapSelectedPlantId ? ymdToUtcMidnightMs(snapBoboStartDate) : undefined;

      const applied: OptimizationRunResult = {
        traj,
        params,
        pricePeriod,
        windPeriod,
        spotWindRescaleKey,
        ms: workerMs,
        ipcOverheadMs: Math.max(0, wallMs - workerMs),
        usedWorker,
        dateRangeLabel,
        chartEpochUtcMs,
        dt,
        windPeriodMeasured,
        pvReconstructStats: pvStats,
        horizonTrim,
      };
      setAppliedScenarioKey(snapKey);
      setAppliedBatteryCostPerKWh(snapBatteryCostPerKWh);
      setAppliedInterestRatePct(snapInterestRatePct);
      setAppliedLifetimeYears(snapLifetimeYears);
      setAppliedYearOneFadePct(snapYearOneFadePct);
      setAppliedLongTermFadePct(snapLongTermFadePct);
      setAppliedRegion(snapSelectedRegion);
      setAppliedResult(applied);
      // New optimize commit invalidates any cached sweep optimum.
      setSweepOptimalResult(null);
      result = applied;
      completedOk = true;
      setOptimizeOverlayDismissTick(t => t + 1);
    } catch (e) {
      if (optimGenRef.current !== gen) return null;
      setErr(String(e));
    }
    if (optimGenRef.current !== gen) return null;
    if (!completedOk) setRunning(false);
    return result;
  }, [
    running,
    customData,
    selectedPlantId,
    boboStartDate,
    boboEndDate,
    capacity,
    chargeMax,
    dischargeMax,
    chargeEff,
    dischargeEff,
    initialSOC,
    installedCapacityMW,
    targetDsoc,
    chargeFromGrid,
    wearCost,
    batteryCostPerKWh,
    interestRatePct,
    lifetimeYears,
    yearOneFadePct,
    longTermFadePct,
    pvReconstructEnabled,
    clippingLimitMW,
    pvDayThr,
    pvWideGap,
    pvPeakFactor,
    draftScenarioKey,
  ]);

  /** Dismiss optimize overlay immediately so the sizing-sweep overlay can show; sweep uses returned series/params. */
  const runOptimizeBeforeSizingSweep = useCallback(async (): Promise<OptimizationRunResult | null> => {
    const r = await optimize();
    if (r) setRunning(false);
    return r;
  }, [optimize]);

  const handleApplyPlantRange = useCallback(async () => {
    if (seriesLoading) return;
    if (!selectedPlantId) {
      setBoboSeriesError('Select a power plant before applying date range.');
      return;
    }
    const yesterday = new Date();
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    const maxDate = formatLocalYMD(yesterday);
    if (boboStartDate > boboEndDate) {
      setBoboSeriesError('Start date must be before or equal to end date.');
      return;
    }
    if (boboStartDate > maxDate || boboEndDate > maxDate) {
      setBoboSeriesError('Date range cannot include today or future dates.');
      return;
    }
    await fetchPlantSeries(selectedPlantId, boboStartDate, boboEndDate);
  }, [seriesLoading, selectedPlantId, boboStartDate, boboEndDate, fetchPlantSeries]);

  return (
    <div className="min-h-screen">
      <Header onLogout={onLogout} />
      <main className="w-full px-6 pb-24">


        {/* Controls + KPIs — flex (not grid) so when aside unmounts the main panel actually grows to full width */}
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start mb-10">
          {/* Parameters */}
          {systemDesignOpen && (
            <aside className="w-full min-w-0 shrink-0 lg:basis-sys-design">
              <SectionHeader
                eyebrow="01 · plant &amp; BESS"
                title="System design"
                action={
                  <button
                    type="button"
                    onClick={() => setSystemDesignOpen(false)}
                    className="inline-flex items-center justify-center shrink-0 h-10 w-10 rounded border border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--accent-teal)] transition-colors font-mono text-xl leading-none"
                    aria-label="Collapse system design sidebar"
                    title="Collapse sidebar"
                  >
                    «
                  </button>
                }
              />
              <DataInputCard
                customData={customData}
                powerPlants={powerPlants}
                plantsLoading={plantsLoading}
                plantsError={plantsError}
                seriesLoading={seriesLoading}
                selectedPlantId={selectedPlantId}
                onPickPlant={handlePickPlant}
                boboStartDate={boboStartDate}
                boboEndDate={boboEndDate}
                onBoboStartDateChange={(v: string) => { setBoboStartDate(v); setHasUnappliedChanges(true); setBoboSeriesError(null); }}
                onBoboEndDateChange={(v: string) => { setBoboEndDate(v); setHasUnappliedChanges(true); setBoboSeriesError(null); }}
                selectedDateRange={selectedDateRange}
                setSelectedDateRange={setSelectedDateRange}
                onApplyPlantRange={handleApplyPlantRange}
                canApplyPlantRange={hasUnappliedChanges}
                boboSeriesError={boboSeriesError}
                selectedRegion={selectedRegion}
                onPickRegion={setSelectedRegion}
              />
              <div className="mt-6 card p-5">
                <div>
                  <NumberInput label="Battery capacity" unit="MWh" min={1} max={powerSliderMax}
                    value={capacity} setValue={setCapacity}
                    hint={`auto from data peak (${draftPeakMW.toFixed(1)} MW)`} />
                  <div className="mb-4">
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">
                      C-Rate
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button type="button" onClick={() => handleCRateChange('1C')}
                        className={`py-2 text-xs font-mono border transition-colors ${cRate === '1C'
                          ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                          : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                        }`}>1C</button>
                      <button type="button" onClick={() => handleCRateChange('0.5C')}
                        className={`py-2 text-xs font-mono border transition-colors ${cRate === '0.5C'
                          ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                          : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                        }`}>0.5C</button>
                    </div>
                    <div className="text-[10px] text-[color:var(--text-faint)] mt-1 font-mono">
                      {cRate === '1C' ? '1-hour battery · max power = capacity' : '2-hour battery · max power = capacity ÷ 2'}
                    </div>
                  </div>
                  <NumberInput label="Max charge power" unit="MW" min={1} max={powerSliderMax}
                    value={chargeMax} setValue={setChargeMax}
                    hint={`auto from data peak (${draftPeakMW.toFixed(1)} MW)`} />
                  <NumberInput label="Max discharge power" unit="MW" min={1} max={powerSliderMax}
                    value={dischargeMax} setValue={setDischargeMax}
                    hint={`auto from data peak (${draftPeakMW.toFixed(1)} MW)`} />
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <NumberInput label="Charge efficiency" unit="" min={0.7} max={0.99}
                    value={chargeEff} setValue={setChargeEff}
                    hint={`round-trip ≈ ${(chargeEff * dischargeEff * 100).toFixed(1)}%`} />
                  <NumberInput label="Discharge efficiency" unit="" min={0.7} max={0.99}
                    value={dischargeEff} setValue={setDischargeEff} />
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <NumberInput label="Installed capacity (wind/solar)" unit="MW" min={1} max={installedSliderMax}
                    value={installedCapacityMW} setValue={setInstalledCapacityMW}
                    hint={`auto from data peak (${draftPeakMW.toFixed(1)} MW) · grid export ceiling`} />
                  <NumberInput label="Starting charge level" unit="" min={0} max={1}
                    value={initialSOC} setValue={setInitialSOC}
                    hint={`≈ ${(initialSOC * capacity).toFixed(1)} MWh stored`} />
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">Charge source</div>
                    <div className="text-[10px] font-mono text-[color:var(--text-faint)]">
                      {chargeFromGrid ? 'grid + plant' : 'plant only'}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1 mb-2">
                    <button onClick={() => setChargeFromGrid(true)}
                      className={`py-2 text-xs font-mono border transition-colors ${chargeFromGrid
                          ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                          : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                        }`}>grid + plant</button>
                    <button onClick={() => setChargeFromGrid(false)}
                      className={`py-2 text-xs font-mono border transition-colors ${!chargeFromGrid
                          ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                          : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                        }`}>plant only</button>
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--text-faint)]" style={{ lineHeight: 1.5 }}>
                    {chargeFromGrid
                      ? 'BESS may charge from the grid — full market-side flexibility'
                      : 'BESS charges only from on-site generation — no grid imports'}
                  </div>
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">Optimization resolution</div>
                    <div className="text-[10px] font-mono text-[color:var(--text-faint)]">
                      {targetDsoc == null
                        ? `auto · ≈ ${(capacity / 20).toFixed(2)} MWh`
                        : `≤ ${targetDsoc} MWh per step`}
                    </div>
                  </div>
                  <div className="grid grid-cols-5 gap-1 mb-2">
                    {([
                      [2.0, '2'],
                      [1.0, '1'],
                      [0.5, '0.5'],
                      [0.25, '0.25'],
                      [null, 'auto'],
                    ] as const).map(([v, lbl]) => {
                      const active = v === null ? targetDsoc == null : (targetDsoc != null && Math.abs(targetDsoc - v) < 1e-9);
                      return (
                        <button key={String(v)} onClick={() => setTargetDsoc(v)}
                          className={`py-2 text-xs font-mono border transition-colors ${active
                              ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                              : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                            }`}>{lbl}</button>
                      );
                    })}
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--text-faint)]" style={{ lineHeight: 1.5 }}>
                    Finer steps refine stored-energy resolution in the dispatch model (more accurate, longer run time).
                  </div>
                </div>
                <PvReconstructCard
                  customData={customData}
                  pvReconstructEnabled={pvReconstructEnabled}
                  onPvReconstructEnabled={handlePvReconstructEnabled}
                  clippingLimitMW={clippingLimitMW}
                  setClippingLimitMW={setClippingLimitMW}
                  pvDayThr={pvDayThr}
                  setPvDayThr={setPvDayThr}
                  pvWideGap={pvWideGap}
                  setPvWideGap={setPvWideGap}
                  pvPeakFactor={pvPeakFactor}
                  setPvPeakFactor={setPvPeakFactor}
                  pvReconstructStats={appliedResult?.pvReconstructStats ?? null}
                  horizonTrim={appliedResult?.horizonTrim ?? null}
                />
                <div className="hairline my-4"></div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">Loaded horizon</div>
                    <div className="text-[10px] font-mono text-[color:var(--text-faint)]">
                      {horizonHours.toLocaleString()}h · {horizonSteps.toLocaleString()} steps
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--text-faint)] mb-2">
                    each row in your data = {dt} h · {availableSteps.toLocaleString()} steps = {availableHours.toLocaleString()} h available
                  </div>
                  {hasPendingChanges && customData != null && (
                    <div className="mb-2 text-[10px] font-mono text-[color:var(--accent-amber)]">
                      Pending changes
                    </div>
                  )}
                  {!customData && (
                    <div className="mb-2 text-[10px] font-mono text-[color:var(--text-faint)]">
                      Load price &amp; generation data to enable optimization.
                    </div>
                  )}
                  <button onClick={() => { void optimize(); }} disabled={running || customData == null}
                    className="btn-primary w-full flex items-center justify-center gap-2">
                    {running ? <><span className="spinner"></span> Optimizing dispatch…</> : <>Optimize dispatch ↗</>}
                  </button>
                  {err && <div className="mt-3 text-xs text-[color:var(--accent-rose)] font-mono">Error: {err}</div>}
                </div>
              </div>
              <EconomicsCard
                batteryCostPerKWh={batteryCostPerKWh}
                setBatteryCostPerKWh={setBatteryCostPerKWh}
                interestRatePct={interestRatePct}
                setInterestRatePct={setInterestRatePct}
                lifetimeYears={lifetimeYears}
                setLifetimeYears={setLifetimeYears}
                crf={crf}
                capacity={capacity}
              />
              <DegradationCard
                wearCost={wearCost} setWearCost={setWearCost}
                yearOneFadePct={yearOneFadePct} setYearOneFadePct={setYearOneFadePct}
                longTermFadePct={longTermFadePct} setLongTermFadePct={setLongTermFadePct}
                lifetimeYears={lifetimeYears}
                capacity={capacity}
                batteryCostPerKWh={batteryCostPerKWh}
              />

            </aside>
          )}

          {/* Results */}
          <section
            className={`relative min-w-0 w-full ${systemDesignOpen ? 'lg:basis-results' : 'flex-1'
              }`}
          >
            {!systemDesignOpen && (
              <button
                type="button"
                onClick={() => setSystemDesignOpen(true)}
                className="absolute left-0 top-8 z-10 flex flex-col items-center justify-center gap-2 w-10 py-4 rounded-r border border-l-0 border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--accent-teal)] transition-colors font-mono text-lg leading-none shadow-[4px_0_12px_rgba(0,0,0,0.2)] lg:top-24"
                aria-label="Show system design sidebar"
                title="System design"
              >
                <span aria-hidden>»</span>
                <span className="text-[9px] uppercase tracking-wider text-center leading-tight [writing-mode:vertical-rl] rotate-180">
                  System design
                </span>
              </button>
            )}
            <div className={`min-w-0 ${!systemDesignOpen ? 'pl-11 lg:pl-10' : ''}`}>
              <SectionHeader eyebrow="02 · plant BESS results" title="Revenue & utilization"
                kicker={appliedResult
                  ? `${appliedResult.traj.length.toLocaleString()} intervals · optimized dispatch · charging from ${appliedResult.params.chargeFromGrid === false ? 'on-site generation only' : 'grid and on-site generation'}.`
                  : customData
                    ? 'Press Optimize to run dispatch.'
                    : 'Load price & generation data, then optimize.'} />
              {spotWindChartProps && <ChartsPanel {...spotWindChartProps} />}
              {appliedResult && <KPIRow result={appliedResult} region={appliedRegion} />}
              {appliedResult && <PvGenerationCompareChart result={appliedResult} />}
              {appliedResult && (
                <>
                  <SectionHeader eyebrow="03 · dispatch &amp; cycling"
                    title="Stored energy and power, hour by hour"

                  />
                  <DispatchChart result={appliedResult} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="04 · market-aligned operation"
                    title="Dispatch vs wholesale price"

                  />
                  <BatteryVsPriceChart result={appliedResult} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="05 · value from storage"
                    title="Extra revenue from co-located BESS"

                  />
                  <UpliftChart result={appliedResult} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="06 · utilization profile"
                    title="Cycling pattern vs price"

                  />
                  <div className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 md:col-span-6"><ActionHistogram result={appliedResult} /></div>
                    <div className="col-span-12 md:col-span-6"><PriceDurationCurve result={appliedResult} /></div>
                  </div>

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="07 · sizing sweep"
                    title="How does project value scale with energy capacity?"

                  />
                  <CapacitySweepChart
                    basePrice={appliedResult.pricePeriod}
                    baseWind={appliedResult.windPeriod}
                    baseParams={appliedResult.params}
                    dt={appliedResult.dt}
                    runOptimizeBeforeSweep={runOptimizeBeforeSizingSweep}
                    onSweepComplete={setSweepOptimalResult}
                    batteryCostPerKWh={appliedBatteryCostPerKWh ?? batteryCostPerKWh}
                    crf={appliedCrf}
                    interestRatePct={appliedInterestRatePct ?? interestRatePct}
                    lifetimeYears={appliedLifetimeYears ?? lifetimeYears}
                    yearOneFadePct={appliedYearOneFadePct ?? yearOneFadePct}
                    longTermFadePct={appliedLongTermFadePct ?? longTermFadePct}
                  />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="08 · dispatch export"
                    title="Hour-by-hour operation table"

                  />
                  <OutputTable result={appliedResult} sweepResult={sweepOptimalResult} />

                  {/* <div className="my-10"></div>
                  <SectionHeader eyebrow="09 · notes"
                    title="Model scope (dispatch layer)"
                  />
                  <div className="card p-6 text-sm text-[color:var(--text-dim)] leading-relaxed grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div className="text-[color:var(--text)] font-semibold mb-2">Commercial objective</div>
                      <p>Maximize wholesale revenue over the horizon: energy delivered × price each interval for the hybrid plant. Aligns with how owners evaluate BESS add-ons.</p>
                    </div>
                    <div>
                      <div className="text-[color:var(--text)] font-semibold mb-2">Dispatch optimization</div>
                      <p>Charge and discharge are chosen each step to maximize that objective within power limits, round-trip efficiency, and installed MWh—runs locally from your scenario inputs.</p>
                    </div>
                    <div>
                      <div className="text-[color:var(--text)] font-semibold mb-2">Pack &amp; inverter assumptions</div>
                      <p>Efficiency sliders should reflect your product datasheet or integration losses so utilization and revenue stay credible for customer pitches.</p>
                    </div>
                    <div>
                      <div className="text-[color:var(--text)] font-semibold mb-2">Cycling cost &amp; fade</div>
                      <p>Optional <strong>throughput cost</strong> (€/MWh through the pack) penalizes heavy cycling in the objective. <strong>Calendar fade</strong> feeds economics views, not the hourly dispatch loop.</p>
                    </div>
                    <div className="md:col-span-2">
                      <div className="text-[color:var(--text)] font-semibold mb-2">Not in this layer</div>
                      <p>• BMS / thermal / C-rate limits beyond the MW caps shown<br />
                        • Dedicated grid export breaker settings (table may show combined plant + BESS)<br />
                        • Uncertain prices or forecasts (perfect foresight on uploaded series)</p>
                    </div>
                  </div> */}
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      <Footer />
      <FullScreenJobOverlay
        open={running || seriesLoading}
        eyebrow={running ? 'Dispatch optimization' : 'Power plant data'}
        title={running ? 'Optimizing dispatch' : 'Load EPİAŞ data'}
        hint={
          running
            ? undefined
            : 'Fetching hourly prices and generation for the selected plant and dates from the API.'
        }
        indeterminateStyle="shimmer"
      />
    </div>
  );
}

