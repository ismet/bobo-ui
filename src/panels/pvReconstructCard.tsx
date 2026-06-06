// ============================================================================
// PV CLIPPING RECONSTRUCTION CARD — optional inverter-clipping recovery
// ============================================================================
import { memo } from 'react';
import { NumberInput } from '../uiPrimitives';
import { peakGenerationMW, type HorizonTrimInfo } from '../formatUtils';
import type { ReconstructStats } from '../engine/reconstructGeneration';

type CustomData = { price: number[]; wind: number[] } | null;

export const PvReconstructCard = memo(({
  customData,
  pvReconstructEnabled, onPvReconstructEnabled,
  clippingLimitMW, setClippingLimitMW,
  pvDayThr, setPvDayThr,
  pvWideGap, setPvWideGap,
  pvPeakFactor, setPvPeakFactor,
  pvReconstructStats,
  horizonTrim,
}: {
  customData: CustomData;
  pvReconstructEnabled: boolean;
  onPvReconstructEnabled: (enabled: boolean) => void;
  clippingLimitMW: number | null;
  setClippingLimitMW: (v: number | null) => void;
  pvDayThr: number;
  setPvDayThr: (v: number) => void;
  pvWideGap: number;
  setPvWideGap: (v: number) => void;
  pvPeakFactor: number;
  setPvPeakFactor: (v: number) => void;
  pvReconstructStats: ReconstructStats | null;
  horizonTrim: HorizonTrimInfo | null;
}) => {
  const trimNotice = pvReconstructEnabled ? horizonTrim : null;

  return (
    <>
      <div className="hairline my-4" />
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-2">
          PV clipping reconstruction
        </div>
        <div className="grid grid-cols-2 gap-1 mb-3">
          <button onClick={() => onPvReconstructEnabled(true)}
            className={`py-2 text-xs font-mono border transition-colors ${pvReconstructEnabled
              ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
              : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
            }`}>PV mode ON</button>
          <button onClick={() => onPvReconstructEnabled(false)}
            className={`py-2 text-xs font-mono border transition-colors ${!pvReconstructEnabled
              ? 'bg-[color:var(--accent-teal)] border-[color:var(--accent-teal)] text-[#05140f]'
              : 'bg-transparent border-[color:var(--border)] text-[color:var(--text-dim)] hover:border-[color:var(--border-strong)]'
            }`}>PV mode OFF</button>
        </div>

        {trimNotice && (
          <div className="mb-3 text-[10px] font-mono text-[color:var(--accent-amber)] leading-relaxed">
            At last optimize with PV mode: horizon shortened to {trimNotice.usedHours.toLocaleString()} h
            ({Math.floor(trimNotice.usedHours / 24)} full days);
            last {trimNotice.droppedHours.toLocaleString()} h of{' '}
            {trimNotice.originalHours.toLocaleString()} h omitted.
          </div>
        )}

        {pvReconstructEnabled && (
          <>
            <NumberInput label="Inverter clipping limit" unit="MW"
              min={0.01} max={50}
              value={clippingLimitMW ?? peakGenerationMW(customData?.wind ?? [])}
              setValue={setClippingLimitMW}
              hint={clippingLimitMW === null
                ? 'Detected at optimize (or set manually before optimizing)'
                : 'From last optimize or manual; used on next optimize'} />

            <details className="mt-1">
              <summary className="text-[10px] font-mono text-[color:var(--text-dim)] py-1 cursor-pointer"
                       style={{ userSelect: 'none' }}>
                <span style={{ color: 'var(--accent-teal)' }}>▸</span> advanced settings
              </summary>
              <div className="mt-2">
                <NumberInput label="Daytime threshold" unit="MW" min={0.01} max={1}
                  value={pvDayThr} setValue={setPvDayThr}
                  hint="Values below this (nighttime) are not used as fitting anchors" />
                <NumberInput label="Wide gap threshold" unit="hrs" min={1} max={12}
                  value={pvWideGap} setValue={setPvWideGap}
                  hint="Consecutive clipped hours triggering peak scaling" />
                <NumberInput label="Peak factor" unit="×" min={1} max={3}
                  value={pvPeakFactor} setValue={setPvPeakFactor}
                  hint="Reconstructed peak ≥ this × inverter limit on wide-gap days" />
              </div>
            </details>

            {/* Warning when data doesn't look like clipped PV */}
            {pvReconstructStats && trimNotice && pvReconstructStats.clippedHours / trimNotice.usedHours > 0.5 && (
              <div className="mt-2 text-[10px] font-mono text-[color:var(--accent-amber)] leading-relaxed">
                ⚠ Most hours detected as clipped ({pvReconstructStats.clippedHours.toLocaleString()} of {(customData?.price.length ?? 0).toLocaleString()}).<br/>
                Generation data may not be PV with clipping at this limit.
              </div>
            )}

            {/* Reconstruction stats after optimize */}
            {pvReconstructStats && (
              <div className="mt-2 text-[10px] font-mono text-[color:var(--accent-green)] leading-relaxed">
                ✓ Reconstructed {pvReconstructStats.clippedHours.toLocaleString()} clipped hours<br/>
                · Recovered {pvReconstructStats.recoveredEnergyMWh.toFixed(1)} MWh of energy
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
});
