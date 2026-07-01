# bobo-ui (epias-frontend)

Single-package Vite 5 + React 18 + TypeScript 5.6 SPA. Co-located battery dispatch optimization for BESS + wind/solar plants. Recharts for charts, hand-written CSS, Web Worker DP solver, Render.com static deployment. Login gate with idle-timeout sign-out.

## Commands

| Command | Effect |
|---|---|
| `npm run dev` | Vite dev server (default port **5173**, `--host` for LAN) |
| `npm run build` | Prod build → `./dist` |
| `npm run preview` | Preview prod build (same `/api` proxy as dev) |
| `npm run bench` | Benchmark DP via `tsx scripts/benchmark-dp.ts` (sync + Node `worker_threads`) |

No `lint` / `format` / `typecheck` / `test` / `clean` npm scripts.

**Manual (not in `package.json`):** `node scripts/verify-ui.mjs` — Playwright smoke test against `http://127.0.0.1:5173` (requires `playwright` installed separately).

## Tooling & verification

- **Typecheck** (no npm script): `npx tsc --noEmit -p tsconfig.json` covers `src/` + `scripts/`; `npx tsc --noEmit -p tsconfig.node.json` covers `vite.config.ts` and `scripts/**/*.ts`. Both configs are `strict`, `noEmit`. Run both before claiming a change compiles.
- **Smoke test**: `node scripts/verify-ui.mjs` — Playwright script, not in `package.json`. Needs `playwright` installed separately and a dev/preview server on `127.0.0.1:5173`. **Currently broken: it drives a paste / "Load data" flow that no longer exists** (the app loads only via EPİAŞ). The /api/power-plants fetch and the 1416-interval horizon-trim math (1422 h → 1416 h with PV on) are still valid reference values. Update the script before relying on it.
- **No CI, no pre-commit hooks, no husky.** No `.github/` directory. Don't expect a status check on PRs.
- **Search workflow**: Prefer `Read` and `Grep` over `cd`/`find`/`rg` to discover behavior.

## Source layout

| Path | Role |
|---|---|
| `index.html` → `src/main.tsx` → `src/Root.tsx` → `src/app.tsx` | Entry chain. `Root` is the auth gate. |
| `src/Root.tsx` | Auth state machine, idle-timeout polling, renders `LoginPage` or `<App onLogout=…/>` |
| `src/LoginPage.tsx` | Sign-in form |
| `src/auth.ts` | Build-time user list from `VITE_AUTH_USERS`, idle timeout, localStorage helpers |
| `src/engine/` | DP solver (`runOptimization.ts`), worker bridge (`optimizationRunner.ts`, `optimizationWorker.ts`), `types.ts`, PV recon (`reconstructGeneration.ts`) |
| `src/data/` | `api.ts` (API base URL) |
| `src/charts/` | `resultCharts.tsx` (Header, Footer, all result charts), `capacitySweepChart.tsx`, `chartInteractions.tsx` (brush zoom, legend isolation) |
| `src/panels/` | `dataInputPanels.tsx`, `economicsDegradation.tsx`, `pvReconstructCard.tsx` |
| `src/tables/outputTable.tsx` | Paginated operation table + CSV |
| `src/uiPrimitives.tsx` | `SectionHeader`, `NumberInput`, `KPI`, `Tip` |
| `src/formatUtils.ts` | Formatting, `alignPriceWindSeries`, `normalizePowerPlantsPayload`, chart timestamps, `peakGenerationMW`, `fingerprintSeriesSample`, `boboDefaultDateRange` |
| `src/finance.ts` | EPİAŞ tariff + EUR/TRY FX net-revenue math (`computeTariffBreakdown`, `getTariffRatesForRange`, `getFxRatesForRange`) over `teias_tariff_dataset.json` + `eur_try.json` |
| `src/optimizationTypes.ts` | `OptimizationRunResult` bundle |
| `src/fullScreenJobOverlay.tsx` | Blocking overlay during optimize / plant fetch / sweep |
| `src/vite-env.d.ts` | `ImportMetaEnv.VITE_AUTH_USERS` typing |
| `css/utilities.css`, `css/theme.css` | Utility classes + design tokens |
| `teias_tariff_dataset.json`, `eur_try.json` | Static reference data imported by `src/finance.ts` (committed). |
| `scripts/` | `benchmark-dp.ts`, `dp-worker-thread.ts`, `verify-ui.mjs` |
| `render.yaml` | Render static site (`bataryaopt`). `package.json` name is `epias-frontend` — the two differ. |
| **Large files** (use `Read` with offset) | `src/app.tsx` 1044 · `src/charts/capacitySweepChart.tsx` 1030 · `src/charts/resultCharts.tsx` 800 · `src/panels/economicsDegradation.tsx` 784 · `src/panels/dataInputPanels.tsx` 413 lines |

## Architecture

- **State**: `useState` / `useCallback` / `useMemo` / `useEffect` in `app.tsx` — no external state library.
- **Draft vs applied**: Sidebar inputs are **draft** until the user clicks **Optimize dispatch**. Charts, KPIs, and the operation table read **`appliedResult`** (and the applied economics fields: `appliedBatteryCostPerKWh`, `appliedInterestRatePct`, `appliedLifetimeYears`, `appliedYearOneFadePct`, `appliedLongTermFadePct`, `appliedOpexPctPlantOnly`, and a derived `appliedCrf`). Changing draft values without optimizing does not move result charts. `sweepOptimalResult` is set by `CapacitySweepChart` when a sizing sweep completes (not by `optimize()`) and is cleared by `clearAppliedSnapshot` (`app.tsx:311`) whenever `customData` or sidebar params change, so the OutputTable reverts to `appliedResult` and never shows a stale sweep optimum.
- **Auto-sizing**: on every new `customData`, `capacity`, `chargeMax`, `dischargeMax`, and `installedCapacityMW` are all auto-snapshotted to `peakGenerationMW(wind)`. Sidebar `NumberInput` `max` is `max(100, ceil(peak × 1.25))` for power / capacity inputs and `max(200, ceil(peak × 1.25))` for the **Installed capacity (wind/solar)** slider (`powerSliderMax` / `installedSliderMax` at `app.tsx:434-435`). The user can still override any value; the auto-set only fires on data load.
- **Authentication** (build-time gate):
  - `VITE_AUTH_USERS` is a **build-time** JSON array of `{ username, password }`. `.env.example` is the committed template; `.env` and `.env.local` are gitignored and hold local-only `VITE_AUTH_USERS`.
  - `src/Root.tsx` renders `LoginPage` until `isLoggedIn()`; on success renders `<App onLogout=…/>`.
  - **Idle timeout 10 min** (`IDLE_TIMEOUT_MS = 10 × 60 × 1000`). Activity tracked on `mousedown / keydown / scroll / touchstart` + `visibilitychange`; re-checked every 30 s.
  - `App` accepts optional `onLogout?: () => void`; `Header` shows a "Log out" chip when provided.
  - When `VITE_AUTH_USERS` is missing/empty, the login screen surfaces a "not configured" error.
  - **localStorage keys** (in `src/auth.ts`): `bataryaopt-auth` = `'1'` when logged in; `bataryaopt-auth-at` = last-activity ms (epoch). `touchActivity()` is throttled to 1 s. Manipulate via the auth helpers, not by writing these keys directly.
- **DP engine**: Pure TS in `runOptimization.ts`. Browser runs via `runOptimizationDelegated()` → `optimizationWorker.ts`. Falls back to sync `runOptimization()` when `Worker` is unavailable or the page is served on **`file://`**.
- **Remote API** (no local backend): `https://bobo-api.onrender.com`
  - Browser base URL: `boboApiUrl()` in `src/data/api.ts` → `BOBO_API_BASE`
    - **Dev / `vite preview`:** `/api` (proxied to Render in `vite.config.ts`)
    - **Production build:** `https://bobo-api.onrender.com` unless `VITE_BOBO_API_BASE` is set at build time
  - `GET /power-plants` → plant list. Payload normalized by `normalizePowerPlantsPayload()` in `formatUtils.ts` (top-level array, or `{ data }`, `{ power_plants }`, `{ plants }`).
  - `GET /power-plants/{id}/prices-and-generation?start_date=…&end_date=…` → `{ prices: number[], powers: number[] }` (`powers` mapped to internal `wind` series).
- **No bundled default**: app starts with no series; user loads via EPİAŞ (`customData` state).
- **Styling**: Hand-written CSS (`utilities.css` + `theme.css`). Google Fonts loaded from `index.html`.
- **Deployment**: Render static site — `npm ci && npm run build`, publish `./dist`. Node `>=20` in `package.json` (was `>=20 <23`; the cap was dropped because Render's static-site runtime supports Node 22).

## Dispatch optimization (DP solver)

`runOptimization(price[], wind[], params): Trajectory`

- **Objective**: Backward DP maximizes `Σ (netE × price − throughputE × wearCost)` over the horizon, where `netE` is hybrid export/import energy (MWh) after the grid cap clamp. Forward pass stores hourly `revenue = gridTotalE × price` on each `TrajectoryStep`.
- **Algorithm**: Backward induction over discretized SOC. For each hour and SOC bin, enumerates integer charge/discharge actions `a` (in SOC steps); picks argmax `reward + Vnext[s − a]`.
- **Discretization**: `dSOC = capacity / socSteps`. Auto-picks `socSteps` (≤ **600**) so `chargeMax×dt/dSOC` and `dischargeMax×dt/dSOC` are near-integers (±**1e-4**). With `targetDsoc` set, only candidates with `dSOC ≤ targetDsoc` are allowed; among those, minimizes `N` (or `|N − socStepsHint|` if no cap). App passes `socSteps: 20` as hint and `targetDsoc` from sidebar (default **0.25 MWh**, `null` = auto only).
- **Grid export limit**: `gridLimit = installedCapacityMW` when `> 0`, else `max(chargeMax, dischargeMax)`. Hybrid export/import energy per step is clamped to `±gridLimit × dt`.
- **Charge source**: `chargeFromGrid === false` caps charge actions with `min(aMaxDown, floor(windE × chargeEff / dSOC))`. Engine default `true` allows full inverter charge from grid; **app sidebar default is `false` (plant only)**.
- **Wear cost (Option A)**: `wearCost` in €/MWh subtracted per step as `throughputE × wearCost` in the DP reward (`throughputE = |a| × dSOC`).
- **`OptimizationParams` fields**: `capacity`, `chargeMax`, `dischargeMax`, `chargeEff`, `dischargeEff`, `initialSOCFrac`, `socSteps`, `dt`, `targetDsoc` (number | null), `chargeFromGrid?` (engine default `true`), `wearCost?` (default `0`), `installedCapacityMW?` (wind/solar installed capacity; sets the hard grid export ceiling).
- **`TrajectoryStep` fields**: `t`, `soc`, `socFrac`, `action` (MW, + discharge), `gridEnergy` (battery contribution at grid, MW), `wind`, `gridTotal` (MW), `price`, `revenue`, `windOnlyRevenue` (`min(windE, cap) × price`), `throughput`, `wearStepCost`, `spillE` (curtailed MWh when hybrid export exceeds cap).
- **Array metadata**: `_dSOC`, `_socSteps`, `_gridLimit`, `_curtailedHours`, `_curtailedEnergy` on the `Trajectory` array.

## PV clipping reconstruction (optional)

`src/engine/reconstructGeneration.ts` — run at **optimize** time when **PV mode** is ON (`reconstructGeneration()`).

- Trims series to full 24 h days (`alignPriceWindSeries(..., { fullDaysOnly: true })`). Trailing partial-day hours are dropped and reported on `OptimizationRunResult.horizonTrim` (`{ originalHours, usedHours, droppedHours }`).
- Detects inverter clipping plateau (`detectClippingLimitMW`) or uses user slider. Pre-recon generation is preserved on `OptimizationRunResult.windPeriodMeasured` so the compare chart can show both.
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
- **Sidebar defaults**: `batteryCostPerKWh = 90 €/kWh`, `interestRatePct = 9.5 %`, `lifetimeYears = 20 yr`, `opexPctPlantOnly = 15 %`. The applied snapshot is committed on each successful optimize (`appliedBatteryCostPerKWh`, `appliedInterestRatePct`, `appliedLifetimeYears`, `appliedOpexPctPlantOnly`); the sweep finance layer uses `applied ? applied : draft`. The single OPEX % drives the O&M cells in both the Plant-only and with-BESS KPI cards (the with-BESS O&M mirrors the Plant-only O&M, so the two displayed values are equal). OPEX is independent of the TEİAŞ `System Ops (u_ops)` tariff line — user-OPEX feeds the O&M cells, tariff `u_ops` is part of the transmission cost.

## KPI calculations (per optimized run)

`KPIRow` in `resultCharts.tsx` from `appliedResult`. The 2×3 grid renders six cards:

| Card | Sub-cells | Calculation |
|---|---|---|
| **Revenue (Plant-only)** | Gross / NET | `Σ windOnlyRevenue`; NET = Gross − O&M − transmission (only when region is set) |
| **Revenue (with-BESS)** | Gross / NET | `Σ revenue`; NET = Gross − O&M − transmission (only when region is set) |
| **Incremental revenue from BESS** | — | NET_BESS − NET_plant when region is set; otherwise grossUplift (BESS_gross − plant_gross) |
| **Costs (Plant-only)** | O&M / Transmission | `(opexPctPlantOnly/100) × windOnlyRevenue`; per-month TEİAŞ tariff `(u_cap/12 + u_use + u_ops) × MWh` ÷ EUR/TRY |
| **Costs (with-BESS)** | O&M / Transmission | `(opexPctPlantOnly/100) × windOnlyRevenue` (mirrors Plant-only by design — both O&M cells show the same value); per-month TEİAŞ tariff on hybrid-exported MWh |
| **Equivalent full cycles** | charge / discharge hours subtext | `(Σ \|action\| × dt) / (2 × capacity)`; `action > 0.001` / `action < −0.001` (idle is remainder) |

`avgSellPrice` / `avgBuyPrice` / `spread` are still computed in the `useMemo` for `stats` (`exportRevenue / exportEnergy`, `importCost / importEnergy`, difference) but no longer rendered as their own card.

## Charts

Result charts use **`appliedResult`** trajectory values. Shared UX: `useZoom` (Recharts brush) and `useIsolation` (legend click) in `chartInteractions.tsx`.

| Component | Data / notes |
|---|---|
| **MarketOverview** | Input series stats (not trajectory): price avg/median/P05/P95, wind mean/peak, mean/peak % |
| **ChartsPanel** | Area wind MW + line price €/MWh; renders immediately on data load using `customData` (and the matching `chartEpochUtcMs` from `ymdToUtcMidnightMs(startDate)` if a plant is selected), and switches to `appliedResult.pricePeriod` / `windPeriod` once an optimize commit lands with no pending changes; brush zoom |
| **PvGenerationCompareChart** | Measured (dashed) vs reconstructed MW. Renders only when `result.windPeriodMeasured` is present (i.e. PV recon ran on this run). Subtitle shows `measured MWh · reconstructed MWh · clipped hours · recovered MWh · net Δ MWh (+%)` |
| **DispatchChart** | SOC line + stacked charge/discharge bars; zero reference |
| **BatteryVsPriceChart** | Charge/discharge bars + price line + average price reference |
| **UpliftChart** | Cumulative `revenue`, `windOnlyRevenue`, uplift area. When a region is set the lines are net (post-OPEX, post-transmission) and the subtitle shows "Net of OPEX and transmission"; otherwise the lines are pure gross. |
| **ActionHistogram** | **10** equal-width price bins; stacked charge / idle / discharge hours |
| **PriceDurationCurve** | Prices sorted descending; **subsampled to ≤300** points for rendering |
| **OutputTable** | Paginated (**50** rows/page default), CSV export; derived columns (SOC %, wear, cumulative benefit, etc.). Adds `generation_measured_mw` and `generation_reconstructed_mw` columns when `result.windPeriodMeasured` is present. The `marginal_benefit_vs_wind_only` column becomes net (post-OPEX, post-transmission) per step when a region is set; the CSV header renames it to `marginal_benefit_vs_wind_only_net` with a `(net)` table-header suffix. |
| **CapacitySweepChart** | See below |

Plant loads set `chartEpochUtcMs` from `ymdToUtcMidnightMs(startDate)` (applied only when a plant is selected). `DEFAULT_TS_EPOCH_MS` (`Date.UTC(2024,0,1)`) is the fallback for the pre-optimize spot chart when no plant is selected.

## Capacity sweep chart

**`pointCount + 1`** sweep points from **0** to `maxCapacityX × baseCapacity` MWh (`buildSweepGrid`). **0 MWh** point is analytic generation-only revenue; other points each call `runOptimizationDelegated` (Web Worker when available).

### Per-point calculations

- **Baseline** (0 MWh): plant-only revenue. Gross path = `Σ wind[t] × dt × price[t]` (no DP). Net path (`useNet` = region + OPEX present) = synthetic plant-only trajectory through `buildNetIncrementalBreakdown` so the zero-capacity point's uplift is exactly 0 (BESS NET === Plant NET at zero capacity by construction since BESS O&M mirrors Plant O&M).
- **Scaled power** (`scalePower` checkbox): `chargeMax` / `dischargeMax` scale as `cap × baseChargeMax / baseCapacity` (and discharge analog); else fixed inverter limits from last optimize. `installedCapacityMW` (the grid export ceiling) stays fixed from `baseParams`.
- **Marginal value**: `(uplift[i] − uplift[i−1]) / (capacity[i] − capacity[i−1])`. When `useNet` is true, `uplift` is already net (post-OPEX, post-transmission), so the marginal value is "net marginal value".
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

### Sweep optimum result

`sweepOptimalResult` — an `OptimizationRunResult` set by the sweep at its financially optimal point (max positive `netAnnual`). Read only by the `OutputTable`. Cleared by `clearAppliedSnapshot` (`app.tsx:311`) on data load, EPİAŞ refetch, or successful optimize commit (`app.tsx:594`); also cleared by a fresh sweep. Distinct from `appliedResult` (which comes from the sidebar **Optimize dispatch** path).

## Data input

Active series: `customData` only (null until loaded).

| Source | How |
|---|---|
| **EPİAŞ plant** | `PowerPlantCombobox` + `PlantProvinceCombobox` (for regional tariffs) + **Quick range** select (`1w / 1m / 3m / 6m / 1y / 2y`) + manual start/end dates (max end = **yesterday**). Selecting a quick range populates start/end; editing the date inputs clears the quick selection. **Load EPİAŞ data** fetches series; user runs **Optimize dispatch**. |

**There is no paste or file-upload path** in the current build — `parsePaste` / `FileUploadPanel` / drag-and-drop references are all stale. If you're adding manual data input, this is the obvious extension point in `DataInputCard` (`src/panels/dataInputPanels.tsx:276`).

**PV mode** (orthogonal, inside `PvReconstructCard`): when ON, optimize trims to full days and may reconstruct clipped generation (see above).

On any new data load, `capacity` / `chargeMax` / `dischargeMax` / `installedCapacityMW` are auto-set to the data peak (MW). The user can override.

The "**Load EPİAŞ data**" button is gated on `hasUnappliedChanges` (set to `false` on a successful EPİAŞ series load). The actual draft-vs-applied comparison is the derived `hasPendingChanges` (`appliedScenarioKey == null || appliedScenarioKey !== draftScenarioKey`), which drives the "Pending changes" indicator and the pre-optimize spot chart branch.

## Quirks

- `.gitignore` exists at the repo root (`.env`, `.env.local`, `node_modules/`, `dist/`). `.env.example` is committed (template); `.env` and `.env.local` are gitignored and hold local-only `VITE_AUTH_USERS`.
- Render service name (`bataryaopt` in `render.yaml`) differs from `package.json` name (`epias-frontend`).
- ESM (`"type": "module"`). Node scripts use `tsx`.
- `tsconfig.json`: `noEmit: true`, `"include": ["src", "scripts"]`. `tsconfig.node.json`: `vite.config.ts` + `scripts/**/*.ts`.
- `dt` is fixed **1.0 h** per row in `app.tsx`.
- Optimization overlay dismissal is deferred after a successful commit: two `requestAnimationFrame`s, then `requestIdleCallback` (2 s timeout) or `setTimeout(200)`, then a 500 ms hold, so charts paint before the overlay closes.
- **Node engine** `>=20` per `package.json` `engines` (was `>=20 <23`; the Node 22 cap was dropped because Render's static-site runtime already supports Node 22).
- **Adding a sidebar field?** Register it in three places in `app.tsx`: the `useState` declaration, the `draftScenarioKey` `useMemo` (`app.tsx:168-204` with deps `205-234`), and the local `snap*` snapshot in the `optimize()` callback (`app.tsx:461-487`). Forgetting `draftScenarioKey` makes the change invisible to the "Pending changes" indicator and `hasPendingChanges`; forgetting the snapshot causes stale-closure reads during optimize. Also add an `applied*` state + setter + `clearAppliedSnapshot` entry (`app.tsx:311-323`) if the field is consumed by result charts or sweep finance.
- **The "applied snapshot" is a single commit point** at `app.tsx:583-594` that flips nine `applied*` states together: `appliedScenarioKey`, `appliedResult`, `appliedBatteryCostPerKWh`, `appliedInterestRatePct`, `appliedLifetimeYears`, `appliedYearOneFadePct`, `appliedLongTermFadePct`, `appliedRegion`, `appliedOpexPctPlantOnly` (`appliedCrf` is derived, not stored). `appliedRegion` flows into `KPIRow region={appliedRegion}` for tariff net-revenue; `appliedOpexPctPlantOnly` flows into KPI / sweep / operation-table consumers. If a new field is consumed by result charts or sweep finance, register its setter here **and** add a reset line to `clearAppliedSnapshot` (`app.tsx:311-323`). `sweepOptimalResult` is a separate state managed by the sweep, not the sidebar — it does not need a `snap*` mirror, but it is cleared by `clearAppliedSnapshot` and again by every successful optimize commit (`app.tsx:594`).
- **`.opencode/`, `.cursor/`, `.commandcode/` are local agent tooling** (opencode / Cursor / CommandCode), not part of the app. App source is only `src/`, `scripts/`, `css/`. Don't `npm install` inside `.opencode/` or modify its `package.json` from app work.
- **Web Worker is module-bundled by Vite**: `optimizationRunner.ts:12` uses `new Worker(new URL('./optimizationWorker.ts', import.meta.url), { type: 'module' })`. Don't move `optimizationWorker.ts` out of `src/engine/` without updating that URL — Vite needs the literal relative path.
