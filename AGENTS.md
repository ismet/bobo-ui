# bobo-ui (epias-frontend)

Single-package Vite 5 + React 18 + TypeScript 5.6 SPA. Co-located battery dispatch optimization for BESS + wind/solar plants. Recharts for charts, hand-written CSS, Web Worker DP solver, Render.com static deployment.

## Commands

| Command | Effect |
|---|---|
| `npm run dev` | Vite dev server (default port **5173**) |
| `npm run build` | Prod build → `./dist` |
| `npm run preview` | Preview prod build (same `/api` proxy as dev) |
| `npm run bench` | Benchmark DP via `tsx scripts/benchmark-dp.ts` (sync + Node `worker_threads`) |

No `lint` / `format` / `typecheck` / `test` / `clean` npm scripts.

**Manual (not in `package.json`):** `node scripts/verify-ui.mjs` — Playwright smoke test against `http://127.0.0.1:5173` (requires `playwright` installed separately).

## Source layout

| Path | Role |
|---|---|
| `index.html` → `src/main.tsx` → `src/app.tsx` | Entry and all UI state |
| `src/engine/` | DP solver (`runOptimization.ts`), worker bridge (`optimizationRunner.ts`, `optimizationWorker.ts`), `types.ts`, PV recon (`reconstructGeneration.ts`) |
| `src/data/` | `api.ts` (API base URL) |
| `src/charts/` | `resultCharts.tsx`, `capacitySweepChart.tsx`, `chartInteractions.tsx` (brush zoom, legend isolation) |
| `src/panels/` | `dataInputPanels.tsx`, `economicsDegradation.tsx` |
| `src/tables/outputTable.tsx` | Paginated operation table + CSV |
| `src/formatUtils.ts` | Formatting, `parsePaste`, `alignPriceWindSeries`, `normalizePowerPlantsPayload`, chart timestamps |
| `src/optimizationTypes.ts` | `OptimizationRunResult` bundle |
| `src/fullScreenJobOverlay.tsx` | Blocking overlay during optimize / plant fetch / sweep |
| `css/utilities.css`, `css/theme.css` | Utility classes + design tokens |
| `scripts/` | `benchmark-dp.ts`, `dp-worker-thread.ts`, `verify-ui.mjs` |
| `render.yaml` | Render static site (`epias-frontend`) |

## Architecture

- **State**: `useState` / `useCallback` / `useMemo` / `useEffect` in `app.tsx` — no external state library.
- **Draft vs applied**: Sidebar inputs are **draft** until the user clicks **Optimize dispatch**. Charts, KPIs, and the operation table read **`appliedResult`** (and applied economics fields). Changing draft values without optimizing does not move result charts.
- **DP engine**: Pure TS in `runOptimization.ts`. Browser runs via `runOptimizationDelegated()` → `optimizationWorker.ts`. Falls back to sync `runOptimization()` when `Worker` is unavailable or the page is served on **`file://`**.
- **Remote API** (no local backend): `https://bobo-api.onrender.com`
  - Browser base URL: `boboApiUrl()` in `src/data/api.ts` → `BOBO_API_BASE`
    - **Dev / `vite preview`:** `/api` (proxied to Render in `vite.config.ts`)
    - **Production build:** `https://bobo-api.onrender.com` unless `VITE_BOBO_API_BASE` is set at build time
  - `GET /power-plants` → plant list. Payload normalized by `normalizePowerPlantsPayload()` in `formatUtils.ts` (top-level array, or `{ data }`, `{ power_plants }`, `{ plants }`).
  - `GET /power-plants/{id}/prices-and-generation?start_date=…&end_date=…` → `{ prices: number[], powers: number[] }` (`powers` mapped to internal `wind` series).
- **No bundled default**: app starts with no series; user loads via EPİAŞ, paste, or file upload (`customData` state).
- **Styling**: Hand-written CSS (`utilities.css` + `theme.css`). Google Fonts loaded from `index.html`.
- **Deployment**: Render static site — `npm ci && npm run build`, publish `./dist`. Node `>=20 <23` in `package.json`.

## Dispatch optimization (DP solver)

`runOptimization(price[], wind[], params): Trajectory`

- **Objective**: Backward DP maximizes `Σ (netE × price − throughputE × wearCost)` over the horizon, where `netE` is hybrid export/import energy (MWh) after the grid cap clamp. Forward pass stores hourly `revenue = gridTotalE × price` on each `TrajectoryStep`.
- **Algorithm**: Backward induction over discretized SOC. For each hour and SOC bin, enumerates integer charge/discharge actions `a` (in SOC steps); picks argmax `reward + Vnext[s − a]`.
- **Discretization**: `dSOC = capacity / socSteps`. Auto-picks `socSteps` (≤ **600**) so `chargeMax×dt/dSOC` and `dischargeMax×dt/dSOC` are near-integers (±**1e-4**). With `targetDsoc` set, only candidates with `dSOC ≤ targetDsoc` are allowed; among those, minimizes `N` (or `|N − socStepsHint|` if no cap). App passes `socSteps: 20` as hint and `targetDsoc` from sidebar (default **1.0 MWh**, `null` = auto only).
- **Grid export limit**: `gridLimit = installedCapacityMW` when `> 0`, else `max(chargeMax, dischargeMax)`. Hybrid export/import energy per step is clamped to `±gridLimit × dt`.
- **Charge source**: `chargeFromGrid === false` caps charge actions with `min(aMaxDown, floor(windE × chargeEff / dSOC))`. Default `true` allows full inverter charge from grid.
- **Wear cost (Option A)**: `wearCost` in €/MWh subtracted per step as `throughputE × wearCost` in the DP reward (`throughputE = |a| × dSOC`).
- **`TrajectoryStep` fields**: `t`, `soc`, `socFrac`, `action` (MW, + discharge), `gridEnergy` (battery contribution at grid, MW), `wind`, `gridTotal` (MW), `price`, `revenue`, `windOnlyRevenue` (`min(windE, cap) × price`), `throughput`, `wearStepCost`, `spillE` (curtailed MWh when hybrid export exceeds cap).
- **Array metadata**: `_dSOC`, `_socSteps`, `_gridLimit`, `_curtailedHours`, `_curtailedEnergy` on the `Trajectory` array.

## PV clipping reconstruction (optional)

`src/engine/reconstructGeneration.ts` — run at **optimize** time when **PV mode** is ON (`reconstructGeneration()`).

- Trims series to full 24 h days (`alignPriceWindSeries(..., { fullDaysOnly: true })`).
- Detects inverter clipping plateau (`detectClippingLimitMW`) or uses user slider.
- Rebuilds clipped hours before DP; stats stored on `OptimizationRunResult.pvReconstructStats` (`clippedHours`, `recoveredEnergyMWh`).
- Tunables: `dayThr`, `wideGap`, `peakFactor` (sidebar advanced sliders).

## Degradation model

`buildFadeCurve(lifetime, yearOneFadePct, longTermFadePct, tau = FADE_TAU_YEARS)` in `economicsDegradation.tsx` (`FADE_TAU_YEARS = 4`).

Per calendar year `y = 1…lifetime`:

```
fade_rate(y) = longTermFadePct + (yearOneFadePct − longTermFadePct) × exp(−(y−1)/τ)
retention[y] = max(0, 1 − Σ_{k=1..y} fade_rate(k) / 100)
```

`retention[0] = 1.0`. End-of-life retention = `retention[lifetime]` (read-only in UI).

- **Option A** — `wearCost` €/MWh: enters DP objective.
- **Option B** — fade curve: informational in degradation card; drives sweep NPV via `fadeNpvFactor`.

## Economics

- **CRF**: `i(1+i)^n / ((1+i)^n − 1)` with `i = interestRatePct/100`. If `i ≤ 0`, `CRF = 1/n`. Defaults 9.5% / 20 yr → ~0.114.
- **CAPEX** [€] = `batteryCostPerKWh × capacity [MWh] × 1000`.
- **Annualised cost** = CAPEX × CRF.
- **Benchmark wear** (display only): `CAPEX / (6000 × capacity × 2 × 0.9)` €/MWh (`6000` equivalent full cycles, 0.9 round-trip eff).

## KPI calculations (per optimized run)

`KPIRow` in `resultCharts.tsx` from `appliedResult`:

| KPI | Calculation |
|---|---|
| Hybrid revenue | `Σ revenue` |
| Plant-only revenue | `Σ windOnlyRevenue` |
| Incremental BESS revenue | hybrid − plant-only (€ and % vs plant-only) |
| Avg selling price | `exportRevenue / exportEnergy` where export uses `gridTotal × dt > 0` |
| Avg buying price | `importCost / importEnergy` where import uses `gridTotal × dt < 0` |
| Spread (computed, not shown in UI) | avg sell − avg buy |
| Equivalent full cycles | `(Σ \|action\| × dt) / (2 × capacity)` |
| Charge / discharge hours | `action > 0.001` / `action < −0.001` (subtext on cycles KPI; idle is remainder) |

## Charts

Result charts use **`appliedResult`** trajectory values. Shared UX: `useZoom` (Recharts brush) and `useIsolation` (legend click) in `chartInteractions.tsx`.

| Component | Data / notes |
|---|---|
| **MarketOverview** | Input series stats (not trajectory): price avg/median/P05/P95, wind mean/peak, mean/peak % |
| **ChartsPanel** | Area wind MW + line price €/MWh; all trajectory hours; brush zoom |
| **DispatchChart** | SOC line + stacked charge/discharge bars; zero reference |
| **BatteryVsPriceChart** | Charge/discharge bars + price line + average price reference |
| **UpliftChart** | Cumulative `revenue`, `windOnlyRevenue`, uplift area |
| **ActionHistogram** | **10** equal-width price bins; stacked charge / idle / discharge hours |
| **PriceDurationCurve** | Prices sorted descending; **subsampled to ≤300** points for rendering |
| **OutputTable** | Paginated (**50** rows/page default), CSV export; derived columns (SOC %, wear, cumulative benefit, etc.) |
| **CapacitySweepChart** | See below |

Pasted/uploaded charts use `DEFAULT_TS_EPOCH_MS` (`Date.UTC(2024,0,1)`). Plant loads set `chartEpochUtcMs` from `ymdToUtcMidnightMs(startDate)`.

## Capacity sweep chart

**`pointCount + 1`** sweep points from **0** to `maxCapacityX × baseCapacity` MWh (`buildSweepGrid`). **0 MWh** point is analytic generation-only revenue; other points each call `runOptimizationDelegated` (Web Worker when available).

### Per-point calculations

- **Baseline** (0 MWh): `Σ wind[t] × dt × price[t]` — no DP.
- **Scaled power** (`scalePower` checkbox): `chargeMax` / `dischargeMax` scale as `cap × baseChargeMax / baseCapacity` (and discharge analog); else fixed inverter limits from last optimize.
- **Marginal value**: `(uplift[i] − uplift[i−1]) / (capacity[i] − capacity[i−1])`.
- **Regime** (first vs last marginal, index 1 vs last): `ratio = endMarg/startMarg` — `> 0.85` **linear**, `> 0.10` **saturating**, else **saturated**.
- **Sweet spot** (gross chart): highest `uplift / capacity` among positive sizes.

### Financial layer (no re-DP)

Uses sweep trajectory revenues and sidebar/applied economics (`appliedBatteryCostPerKWh ?? draft`, same for CRF inputs).

- **Annualisation**: `periodToAnnual = 8760 / periodHours` (`periodHours = price.length × dt`).
- **Year-1 uplift** = period uplift × `periodToAnnual`.
- **Fade NPV factor**: `Σ_{y=1..lifetime} (avg_retention[y] / (1+i)^y) × CRF` with `avg_retention = (curve[y−1]+curve[y])/2`.
- **Annual uplift** = year-1 uplift × fade NPV factor.
- **Net annual benefit** = annual uplift − annualised CAPEX.
- **Simple payback** = CAPEX / year-1 uplift (∞ if year-1 uplift ≤ 0).
- **Net optimum**: sweep point with max **positive** `netAnnual` (null if none).

### Lifetime cash bridge

At sweep point closest to sidebar `capacity`: year table (retention, nominal uplift, discount factor, PV, cumulative PV) plus fade / revenue bar charts in collapsible `<details>`.

### Usage flow

1. Adjust sidebar → **Optimize dispatch** snapshots draft → runs DP (and optional PV recon) → commits `appliedResult`.
2. **Run sizing sweep** calls `optimize()` first (`runOptimizeBeforeSweep`), then sweep grid.
3. Changing battery cost / interest / lifetime / fade updates sweep finance charts immediately (no re-DP).

## Data input

Active series: `customData` only (null until loaded).

| Source | How |
|---|---|
| **EPİAŞ plant** | Combobox + date range (max end = **yesterday**); **Load EPİAŞ data** fetches series; user runs **Optimize dispatch** (same as paste/upload) |
| **Paste** | Tab under “load price & generation series”; `parsePaste()` — min **24** rows |
| **File upload** | CSV/JSON/TSV via `FileUploadPanel` |

**PV mode** (orthogonal): when ON, optimize trims to full days and may reconstruct clipped generation (see above).

`hasUnappliedChanges` tracks draft edits vs last applied scenario key (`draftScenarioKey` vs `appliedScenarioKey`).

## Quirks

- No `.gitignore` in repo — only `.git/info/exclude`.
- ESM (`"type": "module"`). Node scripts use `tsx`.
- `tsconfig.json`: `noEmit: true`, `"include": ["src", "scripts"]`. `tsconfig.node.json`: `vite.config.ts` + `scripts/**/*.ts`.
- `fmtMoney()` / `fmtNumber()`: `€` prefix on money; `k` / `M` suffixes; no thousands separators.
- `plotAll()` adds `idx` for Recharts X-axis.
- `fingerprintSeriesSample()`: hashes first, middle, last `(price, wind)` pairs for stable scenario keys.
- `dt` is fixed **1.0 h** per row in `app.tsx`.
