// ============================================================================
// ECONOMICS CARD — battery cost, interest rate, lifetime → CRF / annualisation
// ============================================================================
import { memo, useMemo } from "react";
import { fmtMoney } from "../formatUtils";
import {
  getFxRatesForRange,
  getTariffRatesForRange,
  type FxRateRow,
  type TariffRateRow,
} from "../finance";

const fmtRate = (n: number) =>
  n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export const EconomicsCard = memo(
  ({
    batteryCostPerKWh,
    setBatteryCostPerKWh,
    interestRatePct,
    setInterestRatePct,
    lifetimeYears,
    setLifetimeYears,
    crf,
    capacity,
    boboStartDate,
    boboEndDate,
    selectedRegion,
    opexPctPlantOnly,
    setOpexPctPlantOnly,
  }: {
    batteryCostPerKWh: number;
    setBatteryCostPerKWh: (v: number) => void;
    interestRatePct: number;
    setInterestRatePct: (v: number) => void;
    lifetimeYears: number;
    setLifetimeYears: (v: number) => void;
    crf: number;
    capacity: number;
    boboStartDate: string;
    boboEndDate: string;
    selectedRegion: string | null;
    opexPctPlantOnly: number;
    setOpexPctPlantOnly: (v: number) => void;
  }) => {
    const capexK = batteryCostPerKWh * capacity; // €/MWh × MWh = € (since €/kWh × MWh × 1000 / 1000 = €/kWh × MWh? no)
    // Actually: cost is €/kWh, capacity is MWh. CAPEX [€] = cost [€/kWh] × capacity [MWh] × 1000 [kWh/MWh]
    const capex = batteryCostPerKWh * capacity * 1000;
    const annualised = capex * crf;

    const tariffRates = useMemo<TariffRateRow[]>(() => {
      const regionNum = selectedRegion != null ? Number(selectedRegion) : null;
      return getTariffRatesForRange({
        startYmd: boboStartDate,
        endYmd: boboEndDate,
        region: Number.isFinite(regionNum) ? regionNum : null,
      });
    }, [boboStartDate, boboEndDate, selectedRegion]);
    const tariffMonths = tariffRates.reduce((s, r) => s + r.months, 0);
    const tariffMissing = tariffRates.some((r) => !r.available);

    const fxRates = useMemo<FxRateRow[]>(
      () => getFxRatesForRange({ startYmd: boboStartDate, endYmd: boboEndDate }),
      [boboStartDate, boboEndDate],
    );
    const fxMissing = fxRates.some((r) => !r.available);
    const MONTHS_ABBR = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const fmtFx = (n: number) =>
      n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });

    return (
      <div className="mt-6 card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
              Project economics
            </div>
            <div className="font-display text-base mt-1">
              Customer capex &amp; financing
            </div>
          </div>
          <span className="chip">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--accent-amber)" }}
            ></span>
            Annual charge · {(crf * 100).toFixed(2)}% of CAPEX
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
            Battery cost{" "}
            <span className="text-[color:var(--text-faint)]">€/kWh</span>
          </label>
          <input
            type="number"
            value={batteryCostPerKWh}
            min={0}
            max={2000}
            step={10}
            onChange={(e) =>
              setBatteryCostPerKWh(Math.max(0, Number(e.target.value) || 0))
            }
            className="num-input"
          />

          <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
            Interest rate{" "}
            <span className="text-[color:var(--text-faint)]">% / yr</span>
          </label>
          <input
            type="number"
            value={interestRatePct}
            min={0}
            max={30}
            step={0.1}
            onChange={(e) =>
              setInterestRatePct(Math.max(0, Number(e.target.value) || 0))
            }
            className="num-input"
          />

          <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
            Lifetime{" "}
            <span className="text-[color:var(--text-faint)]">years</span>
          </label>
          <input
            type="number"
            value={lifetimeYears}
            min={1}
            max={50}
            step={1}
            onChange={(e) =>
              setLifetimeYears(
                Math.max(1, Math.round(Number(e.target.value) || 1)),
              )
            }
            className="num-input"
          />
        </div>

        <div className="hairline my-4"></div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "6px 12px",
            fontSize: 12,
            fontFamily: "JetBrains Mono, monospace",
          }}
        >
          <span className="text-[color:var(--text-dim)]">
            CAPEX (current size)
          </span>
          <span className="num text-[color:var(--accent-amber)]">
            {fmtMoney(capex)}
          </span>

          <span className="text-[color:var(--text-dim)]">Annualised cost</span>
          <span className="num text-[color:var(--accent-amber)]">
            {fmtMoney(annualised)}/yr
          </span>
        </div>

        <div className="hairline my-4"></div>

        <div>
          <div className="mb-2">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
              OPEX as % of gross revenue
            </div>
            <div className="font-display text-sm mt-0.5">
              O&amp;M share of revenue
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <label className="text-[11px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
              OPEX (% of gross revenue)
            </label>
            <input
              type="number"
              value={opexPctPlantOnly}
              min={0}
              max={30}
              step={0.5}
              onChange={(e) => {
                const v = Number(e.target.value) || 0;
                setOpexPctPlantOnly(
                  Math.min(30, Math.max(0, Math.round(v * 2) / 2)),
                );
              }}
              onBlur={(e) => {
                const v = Number(e.target.value) || 0;
                setOpexPctPlantOnly(
                  Math.min(30, Math.max(0, Math.round(v * 2) / 2)),
                );
              }}
              className="num-input"
            />
          </div>

          <div
            className="mt-2 text-[10px] text-[color:var(--text-faint)] font-mono"
            style={{ lineHeight: 1.5 }}
          >
            OPEX drives the O&amp;M cells in the Revenue and Costs KPI cards. Transmission costs use u_cap + u_use + u_ops.
          </div>
        </div>

        <div className="hairline my-4"></div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
                TEİAŞ tariffs
              </div>
              <div className="font-display text-sm mt-0.5">
                Per-year rate sheet
              </div>
            </div>
            {selectedRegion != null && tariffRates.length > 0 ? (
              <span className="chip">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--accent-violet)" }}
                ></span>
                region {selectedRegion}
              </span>
            ) : (
              <span className="chip">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--text-faint)" }}
                ></span>
                no region
              </span>
            )}
          </div>

          {selectedRegion == null ? (
            <div className="text-[11px] text-[color:var(--text-faint)] font-mono leading-relaxed">
              Select a province in the data input card above to apply TEİAŞ
              regional tariffs to the cost calculation.
            </div>
          ) : tariffRates.length === 0 ? (
            <div className="text-[11px] text-[color:var(--text-faint)] font-mono leading-relaxed">
              Pick a valid start and end date to see the rate sheet.
            </div>
          ) : (
            <>
              <div className="text-[10px] text-[color:var(--text-faint)] font-mono mb-2">
                {tariffMonths} month{tariffMonths === 1 ? "" : "s"} ·{" "}
                {boboStartDate} → {boboEndDate}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  className="w-full text-[11px] font-mono"
                  style={{ borderCollapse: "collapse" }}
                >
                  <thead>
                    <tr
                      style={{ color: "var(--text-dim)", textAlign: "right" }}
                    >
                      <th
                        className="text-left font-normal pb-2"
                        style={{ fontWeight: 500 }}
                      >
                        Year
                      </th>
                      <th
                        className="font-normal pb-2"
                        style={{ fontWeight: 500 }}
                      >
                        Months
                      </th>
                      <th
                        className="font-normal pb-2"
                        style={{ fontWeight: 500 }}
                        title="Capacity tariff · per installed MW per year (billed monthly)"
                      >
                        CAP (₺/MW·yr)
                      </th>
                      <th
                        className="font-normal pb-2"
                        style={{ fontWeight: 500 }}
                        title="Energy tariff · per MWh exported"
                      >
                        USE (₺/MWh)
                      </th>
                      <th
                        className="font-normal pb-2"
                        style={{ fontWeight: 500 }}
                        title="System Ops tariff · per MWh exported"
                      >
                        System Ops (₺/MWh)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tariffRates.map((r) => (
                      <tr
                        key={r.year}
                        style={{
                          borderTop: "1px solid var(--border)",
                          color: r.available
                            ? "var(--text)"
                            : "var(--accent-rose)",
                          textAlign: "right",
                        }}
                      >
                        <td className="py-2 text-left">{r.year}</td>
                        <td className="py-2">{r.months}</td>
                        <td className="py-2">
                          {r.available ? `₺${fmtRate(r.u_cap)}` : "—"}
                        </td>
                        <td className="py-2">
                          {r.available ? `₺${fmtRate(r.u_use)}` : "—"}
                        </td>
                        <td className="py-2">
                          {r.available ? `₺${fmtRate(r.u_ops)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tariffMissing && (
                <div
                  className="mt-2 text-[10px] font-mono"
                  style={{ color: "var(--accent-rose)" }}
                >
                  Some years in this range have no published TEİAŞ tariff — cost
                  calc will skip them.
                </div>
              )}
              <div className="mt-2 text-[10px] text-[color:var(--text-faint)] font-mono leading-relaxed">
                Source: TEİAŞ year-end tariff tables. Rates in ₺ (no FX). Cost =
                capacity·MW/12 + (energy + System Ops)·MWh, converted at the
                monthly EUR/TRY rate.
              </div>
              {fxRates.length > 0 && (
                <details className="mt-3">
                  <summary
                    className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-dim)] font-mono py-1 cursor-pointer hover:text-[color:var(--text)]"
                    style={{ userSelect: "none" }}
                  >
                    <span style={{ color: "var(--accent-teal)" }}>▸</span>{" "}
                    EUR/TRY rates by month ({fxRates.length} month
                    {fxRates.length === 1 ? "" : "s"})
                  </summary>
                  <div
                    className="mt-2 pl-3"
                    style={{ borderLeft: "1px solid var(--border)" }}
                  >
                    <div
                      className="text-[10px] text-[color:var(--text-faint)] font-mono mb-2"
                    >
                      Each month&apos;s ₺ bill is divided by its EUR/TRY rate to
                      give the € cost. Snapshot dates are month-end unless
                      otherwise noted.
                    </div>
                    <table
                      className="w-full text-[11px] font-mono"
                      style={{ borderCollapse: "collapse" }}
                    >
                      <thead>
                        <tr style={{ color: "var(--text-dim)" }}>
                          <th
                            className="text-left font-normal pb-2"
                            style={{ fontWeight: 500, width: "30%" }}
                          >
                            Period
                          </th>
                          <th
                            className="text-left font-normal pb-2"
                            style={{ fontWeight: 500, width: "40%" }}
                          >
                            Snapshot date
                          </th>
                          <th
                            className="text-left font-normal pb-2"
                            style={{ fontWeight: 500, width: "30%" }}
                          >
                            EUR/TRY
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fxRates.map((r) => (
                          <tr
                            key={r.ym}
                            style={{
                              borderTop: "1px solid var(--border)",
                              color: r.available
                                ? "var(--text)"
                                : "var(--accent-rose)",
                            }}
                          >
                            <td className="py-2 text-left">
                              {MONTHS_ABBR[r.month - 1]} {r.year}
                            </td>
                            <td className="py-2 text-left text-[color:var(--text-faint)]">
                              {r.date || "—"}
                            </td>
                            <td className="py-2 text-left">
                              {r.available ? fmtFx(r.rate) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {fxMissing && (
                      <div
                        className="mt-2 text-[10px] font-mono"
                        style={{ color: "var(--accent-rose)" }}
                      >
                        Some months in this range have no EUR/TRY snapshot —
                        cost calc will skip them.
                      </div>
                    )}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </div>
    );
  },
);

// ============================================================================
// DEGRADATION CARD — Option A (per-MWh wear cost) + Option B (capacity fade)
//
// Option A applies during DP solve: the optimiser sees wear cost as a per-MWh
// throughput penalty and naturally avoids unprofitable cycling.
//
// Option B is shown here as a fade curve (informational); the multi-year NPV
// using these fade params is computed in the Economics card extension below.
// ============================================================================

// Compute capacity retention as a function of year (1-indexed from year 1 → N).
// Two-rate exponential model:
//   fade_rate(y) = LT + (Y1 − LT) · exp(−(y−1)/τ)        // %/year
// where τ (FADE_TAU_YEARS) is the SEI-relaxation time over which the high
// year-1 fade rate decays toward the long-term linear rate. τ ≈ 3–5 years is
// typical for utility-scale Li-ion based on published cell-level data; we use
// τ = 4 years.
//
// Retention[y] = 1 − Σ_{k=1..y} fade_rate(k) / 100
// End-of-life retention = retention[lifetime], reported as a derived quantity.
export const FADE_TAU_YEARS = 4;
export function buildFadeCurve(
  lifetime: number,
  yearOneFadePct: number,
  longTermFadePct: number,
  tau = FADE_TAU_YEARS,
): number[] {
  const retention = [1.0];
  let cum = 0;
  for (let y = 1; y <= lifetime; y++) {
    cum +=
      longTermFadePct +
      (yearOneFadePct - longTermFadePct) * Math.exp(-(y - 1) / tau);
    retention.push(Math.max(0, 1 - cum / 100));
  }
  return retention;
}

export const DegradationCard = memo(
  ({
    wearCost,
    setWearCost,
    yearOneFadePct,
    setYearOneFadePct,
    longTermFadePct,
    setLongTermFadePct,
    lifetimeYears,
    capacity,
    batteryCostPerKWh,
  }: {
    wearCost: number;
    setWearCost: (v: number) => void;
    yearOneFadePct: number;
    setYearOneFadePct: (v: number) => void;
    longTermFadePct: number;
    setLongTermFadePct: (v: number) => void;
    lifetimeYears: number;
    capacity: number;
    batteryCostPerKWh: number;
  }) => {
    const fadeCurve = useMemo(
      () => buildFadeCurve(lifetimeYears, yearOneFadePct, longTermFadePct),
      [lifetimeYears, yearOneFadePct, longTermFadePct],
    );
    // End-of-life retention is now a *derived* quantity: the last value of the
    // fade curve. Displayed read-only so the user sees the consequence of their
    // Y1 / LT / lifetime choices instead of having to guess a target.
    const endOfLifeFrac = fadeCurve[lifetimeYears];
    const endOfLifePct = endOfLifeFrac * 100;
    // CAPEX-implied wear cost benchmark for context: distribute total CAPEX over
    // typical lifetime throughput (cycles × capacity × 2 × avg_eff). Helps the
    // user calibrate `wearCost` if they're unsure.
    const capex = batteryCostPerKWh * capacity * 1000;
    const assumedCycles = 6000; // typical Li-ion at 80% retention
    const lifetimeThroughputMWh = assumedCycles * capacity * 2 * 0.9;
    const benchmarkWear =
      lifetimeThroughputMWh > 0 ? capex / lifetimeThroughputMWh : 0;

    // Mini sparkline of the fade curve (drawn inline as SVG)
    const W = 240,
      H = 60,
      PAD_L = 28,
      PAD_R = 8,
      PAD_T = 8,
      PAD_B = 16;
    const innerW = W - PAD_L - PAD_R,
      innerH = H - PAD_T - PAD_B;
    const xAt = (y: number) => PAD_L + (y / lifetimeYears) * innerW;
    const yAt = (ret: number) => PAD_T + (1 - (ret - 0.5) / 0.5) * innerH; // map 0.5..1.0 to bottom..top
    const linePts = fadeCurve
      .map((r, i) => `${xAt(i)},${yAt(Math.max(0.5, r))}`)
      .join(" ");

    return (
      <div className="mt-6 card p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
              Lifetime &amp; throughput
            </div>
            <div className="font-display text-base mt-1">
              Cycling cost &amp; capacity fade
            </div>
          </div>
          <span className="chip">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--accent-rose)" }}
            ></span>
            {(fadeCurve[lifetimeYears] * 100).toFixed(0)}% at EoL
          </span>
        </div>

        <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">
          Throughput cost (per MWh cycled)
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
            Wear cost{" "}
            <span className="text-[color:var(--text-faint)]">
              €/MWh through cells
            </span>
          </label>
          <input
            type="number"
            value={wearCost}
            min={0}
            max={200}
            step={1}
            onChange={(e) =>
              setWearCost(Math.max(0, Number(e.target.value) || 0))
            }
            className="num-input"
          />
        </div>
        <div
          className="text-[10px] text-[color:var(--text-faint)] mb-4"
          style={{ lineHeight: 1.5 }}
        >
          Aligns dispatch economics with cell stress: each MWh through the pack
          carries this €/MWh charge. Benchmark from CAPEX ÷ ~{assumedCycles}{" "}
          equivalent full cycles ≈{" "}
          <span className="text-[color:var(--text-dim)]">
            €{benchmarkWear.toFixed(1)}/MWh
          </span>
          .
        </div>

        <div className="hairline my-3"></div>

        <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono mb-2">
          Capacity retention over time
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
            Year-1 fade{" "}
            <span className="text-[color:var(--text-faint)]">% / yr</span>
          </label>
          <input
            type="number"
            value={yearOneFadePct}
            min={0}
            max={20}
            step={0.1}
            onChange={(e) =>
              setYearOneFadePct(Math.max(0, Number(e.target.value) || 0))
            }
            className="num-input"
          />

          <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
            Long-term fade{" "}
            <span className="text-[color:var(--text-faint)]">% / yr</span>
          </label>
          <input
            type="number"
            value={longTermFadePct}
            min={0}
            max={10}
            step={0.1}
            onChange={(e) =>
              setLongTermFadePct(Math.max(0, Number(e.target.value) || 0))
            }
            className="num-input"
          />

          <label className="text-[11px] text-[color:var(--text-dim)] font-mono">
            End-of-life retention{" "}
            <span className="text-[color:var(--text-faint)]">
              % nameplate · derived
            </span>
          </label>
          <div
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--accent-rose)",
              padding: "6px 10px",
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
              width: 90,
              textAlign: "right",
              fontWeight: 500,
              cursor: "default",
              userSelect: "none",
            }}
            title={`Computed from Y1=${yearOneFadePct}%, LT=${longTermFadePct}%, lifetime=${lifetimeYears}y, τ=${FADE_TAU_YEARS}y`}
          >
            {endOfLifePct.toFixed(1)}
          </div>
        </div>

        {/* Fade sparkline */}
        <div
          className="mt-3"
          style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "6px 4px",
          }}
        >
          <svg
            width="100%"
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block" }}
          >
            {/* Y axis labels */}
            <text x={4} y={PAD_T + 4} className="axis-label">
              100%
            </text>
            <text x={4} y={PAD_T + innerH / 2 + 3} className="axis-label">
              75%
            </text>
            <text x={4} y={PAD_T + innerH + 4} className="axis-label">
              50%
            </text>
            {/* Grid line at EoL retention */}
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yAt(fadeCurve[lifetimeYears])}
              y2={yAt(fadeCurve[lifetimeYears])}
              stroke="var(--border)"
              strokeDasharray="2 3"
            />
            {/* The fade curve */}
            <polyline
              points={linePts}
              fill="none"
              stroke="var(--accent-rose)"
              strokeWidth="1.6"
            />
            {/* Endpoint dot */}
            <circle
              cx={xAt(lifetimeYears)}
              cy={yAt(fadeCurve[lifetimeYears])}
              r="3"
              fill="var(--accent-rose)"
            />
            {/* X axis labels */}
            <text x={PAD_L} y={H - 3} className="axis-label">
              0
            </text>
            <text
              x={(PAD_L + W - PAD_R) / 2 - 6}
              y={H - 3}
              className="axis-label"
            >
              {Math.round(lifetimeYears / 2)}y
            </text>
            <text x={W - PAD_R - 16} y={H - 3} className="axis-label">
              {lifetimeYears}y
            </text>
          </svg>
        </div>
      </div>
    );
  },
);
