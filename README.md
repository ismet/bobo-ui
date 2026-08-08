# Plant BESS studio · EPİAŞ-integrated dispatch

Single-page web app for co-located battery (BESS) **dispatch optimization** at wind/solar plants. It pulls hourly market prices and plant generation from EPİAŞ, runs a dynamic-programming dispatch optimizer in a Web Worker, and presents dispatch trajectories, financial KPIs, and battery sizing sweeps — all in the browser.

Tech stack: **Vite 5 · React 18 · TypeScript 5.6 (strict) · Recharts** with hand-written CSS. No backend of its own and no state library — it talks to a remote EPİAŞ data API and uses React hooks for state.

## Quick start

Requirements: Node **>= 20**, npm.

```bash
npm install
cp .env.example .env          # then set VITE_AUTH_USERS (see below)
npm run dev                   # http://localhost:5173
```

The app starts behind a **login gate**: `VITE_AUTH_USERS` is a **build-time** JSON array of `{ "username", "password" }` objects read from the environment (`.env` / `.env.local`). It is plaintext-embedded in the built JS bundle, so treat it as an access gate, not real security. With users missing, sign-in shows a "not configured" error. Idle sessions sign out after **10 minutes** of inactivity.

## How it works

1. **Load data** — pick an EPİAŞ plant (`PowerPlantCombobox`), optionally a province/region for TEİAŞ regional tariffs, choose a quick range (`1w / 1m / 3m / 6m / 1y / 2y`) or manual start/end dates (end date maxes at yesterday), and click **Load EPİAŞ data**. There is no paste or file-upload path.
2. **Tune the battery** — sidebar drafts: capacity (MWh), charge/discharge power (MW), C-rate presets (1C / 0.5C), efficiencies, initial SOC, grid export ceiling ("Installed capacity"), disallow grid charging ("plant only" is the default), per-MWh wear cost, PV-clipping reconstruction, and finance inputs (battery €/kWh, interest %, lifetime years, OPEX % of gross revenue, capacity-fade rates).
3. **Optimize dispatch** — runs a backward-induction DP over hourly SOC bins; commits an `appliedResult` snapshot that drives all result views. Draft sidebar edits do not move the results until you optimize again.
4. **Review** — KPI cards (net/gross revenue with and without BESS, TEİAŞ tariff transmission cost, equivalent full cycles), charts, a paginated operation table with CSV export, and, optionally, a **capacity sizing sweep**.

### Data

Series come from a remote EPİAŞ data API (no local backend):

- `GET /power-plants` — plant list
- `GET /power-plants/{id}/prices-and-generation?start_date=…&end_date=…` — `{ prices: number[], powers: number[] }` (maps to the app's `wind` series)

In dev and `vite preview`, browser requests go to `/api`, proxied to the backend by `vite.config.ts` (CORS-friendly). Production builds use the remote URL directly unless `VITE_BOBO_API_BASE` is set at build time.

### Dispatch model (per optimized run)

- Hourly steps (`dt` fixed at 1.0 h). DP maximizes sum (hybrid export energy × price − throughput × wear cost) and stores a trajectory: SOC, charge/discharge action (MW), grid contribution, dispatched total vs. wind-only, revenue, spill/curtailment.
- Grid-export ceiling: installed wind/solar capacity if set, else the largest inverter limit.
- Default charging is **plant-only** — no grid imports (`chargeFromGrid` defaults to `false`; the engine can allow it).
- Optional PV-mode: trims to full 24 h days and reconstructs inverter-clipped generation before running the DP.

### Financial model (sweep / economics sidebar)

- **CRF** = `i(1+i)^n / ((1+i)^n − 1)`, defaults ~0.114 at 9.5% / 20 yr.
- **CAPEX** = battery cost (€/kWh) × capacity (MWh) × 1000.
- Annual uplift = year-1 uplift × fade-NPV factor (fade curve + discounting); net annual benefit = annual uplift − annualized CAPEX; simple payback = CAPEX ÷ annual uplift.
- **Wear cost** (Option A) feeds the DP objective; the fade curve (Option B) drives sweep NPV and informational degradation cards.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (`--host` for LAN) on port **5173** |
| `npm run build` | Production build → `./dist` |
| `npm run preview` | Serves the built `./dist` with the same `/api` proxy as dev |
| `npm run bench` | Benchmarks the DP solver (`tsx scripts/benchmark-dp.ts`, sync + Node `worker_threads`) |

There are no `lint` / `format` / `test` npm scripts; typecheck is manual:

```bash
npx tsc --noEmit -p tsconfig.json        # src/ + scripts/
npx tsc --noEmit -p tsconfig.node.json    # vite.config.ts + scripts/**/*.ts
```

`scripts/verify-ui.mjs` is a Playwright smoke test against `http://127.0.0.1:5173` (needs Playwright installed separately) but is **currently outdated** — it drives a paste/"Load data" flow that no longer exists.

## Deployment

- **Self-hosted**: `npm run build && vite preview --port 8484 --host 0.0.0.0`. The browser then talks to the data API directly (CORS-enabled).
- **Cloudflare Worker**: `wrangler deploy` serves `./dist` as static assets (SPA fallback for all routes) at `bataryaopt.insposoft.com` and proxies `/api` to the backend (`wrangler.jsonc`, `worker/index.ts`).

## Repository layout

| Path | Role |
|---|---|
| `src/app.tsx` | Main SPA: state, draft↔applied snapshot, optimize + sweep orchestration |
| `src/engine/` | DP solver, Web Worker bridge (fallback to sync on `file://`), PV clipping reconstruction |
| `src/charts/` | Recharts result views (brush zoom + legend isolation), capacity sweep chart |
| `src/panels/` | Data input, economics/degradation, PV-reconstruction controls |
| `src/tables/outputTable.tsx` | Paginated operation table + CSV export |
| `src/finance.ts` / `src/formatUtils.ts` | TEİAŞ tariff + EUR/TRY net math, series alignment/normalization |
| `src/auth.ts`, `src/LoginPage.tsx` | Build-time auth gate, idle-timeout |
| `css/` | Hand-written design tokens + utilities |
| `teias_tariff_dataset.json`, `eur_try.json` | Static reference data for tariff/FX math |
| `worker/`, `wrangler.jsonc` | Cloudflare deployment |
| `scripts/` | Benchmark + smoke-test scripts |