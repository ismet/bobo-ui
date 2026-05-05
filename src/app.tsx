// ============================================================================
// MAIN APP
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CapacitySweepChart } from './charts/capacitySweepChart';
import {
  BatteryVsPriceChart,
  ChartsPanel,
  DispatchChart,
  Footer,
  Header,
  KPIRow,
  MarketOverview,
  PriceDurationCurve,
  ActionHistogram,
  UpliftChart,
} from './charts/resultCharts';
import { DataInputCard, type PowerPlantRow } from './panels/dataInputPanels';
import { DegradationCard, EconomicsCard } from './panels/economicsDegradation';
import { OutputTable } from './tables/outputTable';
import { PRICE_DATA, WIND_DATA } from './data/constants';
import {
  boboDefaultDateRange,
  formatLocalYMD,
  fingerprintSeriesSample,
  normalizePowerPlantsPayload,
} from './formatUtils';
import { runOptimizationDelegated } from './engine/optimizationRunner';
import type { OptimizationParams } from './engine/types';
import type { OptimizationRunResult } from './optimizationTypes';
import { SectionHeader, Slider } from './uiPrimitives';

export default function App() {
  // Parameters
  const [capacity, setCapacity] = useState(11);   // MWh
  const [chargeMax, setChargeMax] = useState(6);    // MW
  const [dischargeMax, setDischargeMax] = useState(11);   // MW
  const [chargeEff, setChargeEff] = useState(0.93); // frac
  const [dischargeEff, setDischargeEff] = useState(0.95); // frac
  const [windScale, setWindScale] = useState(1.0);
  const [initialSOC, setInitialSOC] = useState(0.5);
  const [systemDesignOpen, setSystemDesignOpen] = useState(true);

  // Time step in hours (1.0 = hourly, 0.25 = 15 min, 0.5 = 30 min, etc.)
  const [dt, setDt] = useState(1.0);

  // Solution grid resolution (max MWh per SOC step). null = auto.
  // Finer grids give more precise dispatch but are slower. Default 1 MWh.
  const [targetDsoc, setTargetDsoc] = useState<number | null>(1.0);

  // Whether the battery may import energy from the grid to charge.
  // false = on-site generation only for charging (no grid imports).
  const [chargeFromGrid, setChargeFromGrid] = useState(true);

  // ---- Degradation parameters -----------------------------------------------
  // OPTION A: per-MWh wear cost charged against battery throughput in the DP.
  //   Pulls the optimiser toward economically rational cycling. €20/MWh is a
  //   reasonable default for utility-scale Li-ion at 250 €/kWh CAPEX.
  const [wearCost, setWearCost] = useState(20);                 // €/MWh
  // OPTION B: capacity fade applied year-over-year as the asset ages.
  //   Year-1 fade is highest (SEI growth), declining toward an asymptote.
  //   Defaults match typical Li-ion: ~2.5%/yr year-1 trending to ~0.7%/yr.
  //   End-of-life retention is *derived* from these rates + lifetime — see
  //   buildFadeCurve. With the defaults (2.5%/0.7%/20y, τ=4y) EoL ≈ 78%.
  const [yearOneFadePct, setYearOneFadePct] = useState(2.5);    // % year 1
  const [longTermFadePct, setLongTermFadePct] = useState(0.7);  // % long term
  // ---------------------------------------------------------------------------

  // ---- Financial parameters --------------------------------------------------
  // Battery cost: € per kWh of energy capacity (industry-standard quoting).
  //   2024 typical Li-ion utility-scale cost: ~250–350 €/kWh (BNEF, NREL).
  const [batteryCostPerKWh, setBatteryCostPerKWh] = useState(250); // €/kWh
  const [interestRatePct, setInterestRatePct] = useState(9.5); // %
  const [lifetimeYears, setLifetimeYears] = useState(20);  // years

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

  // User-pasted dataset (null = use embedded default)
  const [customData, setCustomData] = useState<SeriesData | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const initialBoboDateRange = useMemo(() => boboDefaultDateRange(), []);
  const [boboStartDate, setBoboStartDate] = useState(initialBoboDateRange.startDate);
  const [boboEndDate, setBoboEndDate] = useState(initialBoboDateRange.endDate);
  const [hasUnappliedChanges, setHasUnappliedChanges] = useState(true);

  const setCustomDataWithSource = useCallback((data: SeriesData | null, fromBobo = false) => {
    if (data === null || !fromBobo) setSelectedPlantId(null);
    setCustomData(data);
  }, []);

  const [powerPlants, setPowerPlants] = useState<PowerPlantRow[]>([]);
  const [plantsLoading, setPlantsLoading] = useState(true);
  const [plantsError, setPlantsError] = useState<string | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [boboSeriesError, setBoboSeriesError] = useState<string | null>(null);

  const seriesAbortRef = useRef<AbortController | null>(null);
  const seriesFetchGenRef = useRef(0);
  const optimGenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPlantsLoading(true);
      setPlantsError(null);
      try {
        const r = await fetch('https://bobo-api.onrender.com/power-plants');
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

  useEffect(() => () => { seriesAbortRef.current?.abort(); }, []);

  const fetchPlantSeries = useCallback(async (id: string | number, startDate: string, endDate: string) => {
    const gen = ++seriesFetchGenRef.current;
    seriesAbortRef.current?.abort();
    const ac = new AbortController();
    seriesAbortRef.current = ac;
    setSeriesLoading(true);
    setBoboSeriesError(null);
    const url = 'https://bobo-api.onrender.com/power-plants/' + encodeURIComponent(id)
      + '/prices-and-generation?start_date=' + encodeURIComponent(startDate)
      + '&end_date=' + encodeURIComponent(endDate);
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
      setCustomDataWithSource({ price, wind }, true);
      setHasUnappliedChanges(false);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setBoboSeriesError(e instanceof Error ? e.message : String(e));
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

  const [result, setResult] = useState<OptimizationRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Active data source
  const activePrice = useMemo(() => customData ? customData.price : PRICE_DATA, [customData]);
  const activeWind = useMemo(() => customData ? customData.wind : WIND_DATA, [customData]);
  const availableHours = activePrice.length * dt;          // total hours covered by dataset
  const availableSteps = activePrice.length;               // raw point count
  const horizonHours = availableHours;
  const horizonSteps = availableSteps;
  const dateRangeLabel = selectedPlantId ? `${boboStartDate} -> ${boboEndDate}` : 'Loaded dataset';

  // Slice data
  const pricePeriod = useMemo(() => activePrice.slice(0, horizonSteps), [activePrice, horizonSteps]);
  const windPeriod = useMemo(() => activeWind.slice(0, horizonSteps).map(w => w * windScale),
    [activeWind, horizonSteps, windScale]);

  const runOptim = useCallback(async () => {
    setRunning(true); setErr(null);
    await new Promise(r => setTimeout(r, 20));
    const gen = ++optimGenRef.current;
    try {
      const socSteps = 20;
      const params: OptimizationParams = {
        capacity, chargeMax, dischargeMax, chargeEff, dischargeEff,
        initialSOCFrac: initialSOC, socSteps, dt, targetDsoc, chargeFromGrid,
        wearCost
      };
      const tWall0 = performance.now();
      const { traj, workerMs, usedWorker } = await runOptimizationDelegated(pricePeriod, windPeriod, params);
      if (optimGenRef.current !== gen) return;
      const wallMs = performance.now() - tWall0;
      const n = pricePeriod.length;
      const ph = fingerprintSeriesSample(pricePeriod, windPeriod);
      const spotWindRescaleKey = `${n}:${ph}`;
      setResult({
        traj,
        params,
        pricePeriod,
        windPeriod,
        spotWindRescaleKey,
        ms: workerMs,
        ipcOverheadMs: Math.max(0, wallMs - workerMs),
        usedWorker,
        dateRangeLabel,
        dt
      });
    } catch (e) {
      if (optimGenRef.current !== gen) return;
      setErr(String(e));
    } finally {
      if (optimGenRef.current === gen) setRunning(false);
    }
  }, [capacity, chargeMax, dischargeMax, chargeEff, dischargeEff,
    initialSOC, pricePeriod, windPeriod, dateRangeLabel, dt, targetDsoc, chargeFromGrid,
    wearCost]);

  // auto run on mount, when dataset loads,
  // when dt changes, when grid resolution changes, charge source changes,
  // or wear cost changes.
  useEffect(() => { runOptim(); /* eslint-disable-next-line */ },
    [customData, dt, targetDsoc, chargeFromGrid, wearCost]);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="w-full px-6 pb-24">
        {/* Hero */}
        <section className="pt-10 pb-8 grid-bg border-b border-[color:var(--border)] -mx-6 px-6 mb-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="chip"><span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent-teal)]"></span>Plant-integrated BESS</span>
            <span className="chip">Dispatch optimization</span>
            <span className="chip">Utilization &amp; cycling</span>
          </div>
          <h1 className="font-display text-5xl md:text-6xl lg:text-7xl leading-[1.02] max-w-5xl">
            Improve battery utilization at the
            <span className="italic text-[color:var(--accent-teal)]"> power plant</span>
            <span className="text-[color:var(--text-dim)]">.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-[color:var(--text-dim)] leading-relaxed">
            For battery producers and integrators: show customers how co-located BESS raises revenue and clarifies cycling when
            storage works alongside generation—optimized dispatch for wholesale signals, export limits, and your efficiency assumptions.
            Load plant prices and output or use the bundled sample.
          </p>
        </section>

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
              <div className="card p-5">
                <div>
                  <Slider label="Battery capacity" unit="MWh" min={1} max={100} step={1}
                    value={capacity} setValue={setCapacity}
                    hint="energy stored when fully charged" />
                  <Slider label="Max charge power" unit="MW" min={1} max={100} step={1}
                    value={chargeMax} setValue={setChargeMax} />
                  <Slider label="Max discharge power" unit="MW" min={1} max={100} step={1}
                    value={dischargeMax} setValue={setDischargeMax} />
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <Slider label="Charge efficiency" unit="" min={0.7} max={0.99} step={0.01}
                    value={chargeEff} setValue={setChargeEff}
                    hint={`round-trip ≈ ${(chargeEff * dischargeEff * 100).toFixed(1)}%`} />
                  <Slider label="Discharge efficiency" unit="" min={0.7} max={0.99} step={0.01}
                    value={dischargeEff} setValue={setDischargeEff} />
                </div>
                <div className="hairline my-4"></div>
                <div>
                  <Slider label="Plant output scaling" unit="×" min={0.25} max={3} step={0.05}
                    value={windScale} setValue={setWindScale}
                    hint={`peak generation ≈ ${(23 * windScale).toFixed(1)} MW (default dataset)`} />
                  <Slider label="Starting charge level" unit="" min={0} max={1} step={0.05}
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
                  <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">Time interval</div>
                  <div className="grid grid-cols-4 gap-1 mb-2">
                    {([
                      [0.25, '15 min'],
                      [0.5, '30 min'],
                      [1.0, '1 hr'],
                      [2.0, '2 hr'],
                    ] as const).map(([v, lbl]) => (
                      <button key={v} onClick={() => setDt(v)}
                        className={`py-2 text-xs font-mono border transition-colors ${Math.abs(dt - v) < 1e-6
                            ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
                            : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
                          }`}>{lbl}</button>
                    ))}
                  </div>
                  <div className="text-[10px] font-mono text-[color:var(--text-faint)]">
                    each row in your data = {dt < 1 ? `${(dt * 60).toFixed(0)} min` : `${dt} h`} ·
                    &nbsp;{availableSteps.toLocaleString()} steps = {availableHours.toLocaleString()} h available
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
                <div className="hairline my-4"></div>
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">Loaded horizon</div>
                    <div className="text-[10px] font-mono text-[color:var(--text-faint)]">
                      {horizonHours.toLocaleString()}h · {horizonSteps.toLocaleString()} steps
                    </div>
                  </div>
                  <button onClick={runOptim} disabled={running}
                    className="btn-primary w-full flex items-center justify-center gap-2">
                    {running ? <><span className="spinner"></span> Optimizing dispatch…</> : <>Optimize dispatch ↗</>}
                  </button>
                  {err && <div className="mt-3 text-xs text-[color:var(--accent-rose)] font-mono">Error: {err}</div>}
                </div>
              </div>
              <DataInputCard
                customData={customData}
                setCustomData={setCustomDataWithSource}
                defaultLen={PRICE_DATA.length}
                onClearBoboInflight={clearBoboInflight}
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
                onApplyPlantRange={handleApplyPlantRange}
                canApplyPlantRange={hasUnappliedChanges}
                boboSeriesError={boboSeriesError}
              />
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
              <MarketOverview price={pricePeriod} wind={windPeriod} dateRangeLabel={dateRangeLabel} />
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
                kicker={result ? `${result.traj.length.toLocaleString()} intervals · optimized dispatch · charging from ${result.params.chargeFromGrid === false ? 'on-site generation only' : 'grid and on-site generation'}.` : 'Preparing dispatch…'} />
              {result && <KPIRow result={result} />}
              {result && <ChartsPanel result={result} />}
              {result && (
                <>
                  <SectionHeader eyebrow="03 · dispatch &amp; cycling"
                    title="Stored energy and power, hour by hour"
                    kicker="Recommended schedule from dispatch optimization—state of charge plus charge/discharge power. Bars above zero export to the grid; below zero draw power for charging."
                  />
                  <DispatchChart result={result} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="04 · market-aligned operation"
                    title="Dispatch vs wholesale price"
                    kicker="Same optimized schedule against the market—energy shifted to high-price hours, replenished in low-price hours."
                  />
                  <BatteryVsPriceChart result={result} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="05 · value from storage"
                    title="Extra revenue from co-located BESS"
                    kicker="Generation-only revenue vs plant + battery—the gap is the incremental value your system delivers at this site."
                  />
                  <UpliftChart result={result} />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="06 · utilization profile"
                    title="Cycling pattern vs price"
                    kicker="How charge, idle, and discharge hours fall across wholesale price bands—useful for throughput and warranty discussions."
                  />
                  <div className="grid grid-cols-12 gap-6">
                    <div className="col-span-12 md:col-span-6"><ActionHistogram result={result} /></div>
                    <div className="col-span-12 md:col-span-6"><PriceDurationCurve result={result} /></div>
                  </div>

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="07 · sizing sweep"
                    title="How does project value scale with energy capacity?"
                    kicker="Repeated dispatch optimization across MWh sizes—typical for quoting modular racks or proving ROI at different pack sizes. Inverter limits match the left panel unless power scales with energy."
                  />
                  <CapacitySweepChart
                    basePrice={result.pricePeriod}
                    baseWind={result.windPeriod}
                    baseParams={result.params}
                    dt={result.dt}
                    batteryCostPerKWh={batteryCostPerKWh}
                    crf={crf}
                    interestRatePct={interestRatePct}
                    lifetimeYears={lifetimeYears}
                    yearOneFadePct={yearOneFadePct}
                    longTermFadePct={longTermFadePct}
                  />

                  <div className="my-10"></div>
                  <SectionHeader eyebrow="08 · dispatch export"
                    title="Hour-by-hour operation table"
                    kicker="Physical dispatch, throughput, and revenue by interval—export for customer studies, warranty models, or integration specs."
                  />
                  <OutputTable result={result} />

                  <div className="my-10"></div>
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
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}

