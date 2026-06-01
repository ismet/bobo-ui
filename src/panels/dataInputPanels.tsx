// ============================================================================
// DATA INPUT CARD — paste your own price & generation series
// ============================================================================
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { parsePaste, peakGenerationMW, type HorizonTrimInfo, type PredefinedDateRange, PREDEFINED_DATE_RANGES, computePredefinedRange } from '../formatUtils';
import { NumberInput } from '../uiPrimitives';
import type { ChangeEvent, CSSProperties, DragEvent, KeyboardEvent } from 'react';

export type FlashMsg = { tone: 'error' | 'info'; text: string };

// File upload (CSV / JSON) — accepts JSON with price/wind arrays,
// or any 2-column CSV with headers price/generation (or price/wind), or one column each.
export function FileUploadPanel({ setCustomData, parentSetMessage }: {
  setCustomData: (data: { price: number[]; wind: number[] } | null, fromBobo?: boolean) => void;
  parentSetMessage?: (m: FlashMsg | null) => void;
}) {
  const [localMsg, setLocalMsg] = useState<FlashMsg | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File | undefined) => {
    setLocalMsg(null);
    if (!file) return;
    try {
      const text = await file.text();
      let price, wind;

      // JSON branch
      if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const obj = JSON.parse(text);
        if (Array.isArray(obj.price) && Array.isArray(obj.wind)) {
          price = obj.price.map(Number); wind = obj.wind.map(Number);
        } else if (Array.isArray(obj?.data?.price) && Array.isArray(obj?.data?.wind)) {
          price = obj.data.price.map(Number); wind = obj.data.wind.map(Number);
        } else {
          throw new Error('JSON must have arrays "price" and "wind".');
        }
      } else {
        // CSV / TSV / whitespace branch
        const lines = text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
        // Detect header
        const splitLine = (l: string) => l.split(/[,;\t\s]+/).filter(Boolean);
        let startIdx = 0;
        const first = splitLine(lines[0] || '');
        const hasHeader = first.length >= 2 && first.some(t => isNaN(Number(t)));
        let priceCol = 0, windCol = 1;
        if (hasHeader) {
          const lower = first.map((s: string) => s.toLowerCase());
          const pIdx = lower.findIndex((s: string) => s.includes('price') || s.includes('mcp') || s.includes('ptf'));
          const wIdx = lower.findIndex((s: string) => s.includes('wind') || s.includes('gen') || s.includes('total') || s.includes('mwh'));
          if (pIdx !== -1) priceCol = pIdx;
          if (wIdx !== -1) windCol  = wIdx;
          startIdx = 1;
        }
        price = []; wind = [];
        for (let i = startIdx; i < lines.length; i++) {
          const toks = splitLine(lines[i]);
          if (toks.length < 2) continue;
          const p = Number(toks[priceCol]);
          const w = Number(toks[windCol]);
          if (Number.isFinite(p) && Number.isFinite(w)) { price.push(p); wind.push(w); }
        }
      }

      if (!price || price.length < 24) throw new Error(`Only ${price?.length || 0} valid rows parsed (need ≥ 24).`);
      if (price.length !== wind.length) throw new Error(`Length mismatch: ${price.length} prices vs ${wind.length} generation values.`);

      setCustomData({ price, wind });
      const msg = `Loaded ${price.length.toLocaleString()} hours from ${file.name}.`;
      setLocalMsg({ tone: 'info', text: msg });
      parentSetMessage?.({ tone: 'info', text: msg });
    } catch (e: unknown) {
      setLocalMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const onDrop = (ev: DragEvent) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="mt-3">
      <input ref={inputRef} type="file" accept=".csv,.tsv,.json,.txt"
             style={{ display: 'none' }}
             onChange={e => handleFile(e.target.files?.[0])}/>
      <div onClick={() => inputRef.current?.click()}
           onDragOver={e => e.preventDefault()}
           onDrop={onDrop}
           style={{
             border: '1px dashed var(--border-strong)', borderRadius: 4,
             padding: '24px 16px', textAlign: 'center', cursor: 'pointer',
             background: 'var(--bg)', transition: 'border-color .15s'
           }}>
        <div className="font-mono text-xs" style={{ color: 'var(--accent-teal)' }}>↑ Click or drop file</div>
        <div className="font-mono text-[10px] mt-2" style={{ color: 'var(--text-faint)', lineHeight: 1.5 }}>
          Accepts JSON with <code>price</code> and <code>wind</code> arrays, <br/>
          or CSV/TSV with <code>price</code> + generation columns (header optional; <code>wind</code> still works).
        </div>
      </div>
      {localMsg && (
        <div className="mt-3 text-xs font-mono" style={{
          color: localMsg.tone === 'error' ? 'var(--accent-rose)' : 'var(--accent-green)'
        }}>{localMsg.text}</div>
      )}
    </div>
  );
}

export type PowerPlantRow = { id: string | number; name?: string };

export function PowerPlantCombobox({
  plants, plantsLoading, plantsError, seriesLoading,
  selectedPlantId, onPickPlant
}: {
  plants: PowerPlantRow[];
  plantsLoading: boolean;
  plantsError: string | null;
  seriesLoading: boolean;
  selectedPlantId: string | null;
  onPickPlant: (id: string | number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => plants.find(p => String(p.id) === String(selectedPlantId)),
    [plants, selectedPlantId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return plants;
    return plants.filter(p => String(p.name || '').toLowerCase().includes(q));
  }, [plants, query]);

  useEffect(() => {
    setHi(h => (filtered.length ? Math.min(h, filtered.length - 1) : 0));
  }, [filtered.length]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && e.target instanceof Node && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showBar = plantsLoading || seriesLoading;
  const barLabel = plantsLoading ? 'Loading plants…' : (seriesLoading ? 'Loading market data…' : '');

  const pick = (p: PowerPlantRow) => {
    setOpen(false);
    setQuery('');
    onPickPlant(p.id);
  };

  const onInputFocus = () => {
    setOpen(true);
    setQuery(selected ? String(selected.name || '') : '');
    setHi(0);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setOpen(true);
    setHi(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi(i => Math.min(i + 1, Math.max(0, filtered.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered.length) {
      e.preventDefault();
      pick(filtered[hi]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const inputBlocked = plantsLoading && plants.length === 0;

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-2">Generation site</div>
      <div className="pp-combobox" ref={wrapRef}>
        <div className="pp-combobox-input-wrap">
          <input
            type="text"
            autoComplete="off"
            placeholder="Select power plant…"
            value={open ? query : (selected ? String(selected.name || '') : query)}
            onFocus={onInputFocus}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            disabled={inputBlocked}
            aria-expanded={open}
            aria-autocomplete="list"
          />
        </div>
        {open && !inputBlocked && filtered.length > 0 && (
          <div className="pp-combobox-list" role="listbox">
            {filtered.map((p, i) => (
              <button key={String(p.id)} type="button" role="option"
                aria-selected={i === hi}
                className="pp-combobox-item"
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(p)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {plantsError && (
        <div className="mt-2 text-xs font-mono" style={{ color: 'var(--accent-rose)' }}>{plantsError}</div>
      )}
      {showBar && (
        <div className="loading-bar-wrap">
          <div className="loading-bar-label">{barLabel}</div>
          <div className="loading-bar-track">
            {seriesLoading && !plantsLoading ? (
              <div className="job-overlay-stream" />
            ) : (
              <div className="loading-bar-indeterminate" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const DataInputCard = memo(({
  customData, setCustomData,
  onClearBoboInflight,
  powerPlants, plantsLoading, plantsError,
  seriesLoading, selectedPlantId, onPickPlant,
  boboStartDate, boboEndDate, onBoboStartDateChange, onBoboEndDateChange,
  selectedDateRange, setSelectedDateRange,
  onApplyPlantRange, canApplyPlantRange,
  boboSeriesError,
  pvReconstructEnabled, onPvReconstructEnabled,
  clippingLimitMW, setClippingLimitMW,
  pvDayThr, setPvDayThr,
  pvWideGap, setPvWideGap,
  pvPeakFactor, setPvPeakFactor,
  pvReconstructStats,
  horizonTrim,
}: {
  customData: { price: number[]; wind: number[] } | null;
  setCustomData: (data: { price: number[]; wind: number[] } | null, fromBobo?: boolean) => void;
  onClearBoboInflight?: () => void;
  powerPlants: PowerPlantRow[];
  plantsLoading: boolean;
  plantsError: string | null;
  seriesLoading: boolean;
  selectedPlantId: string | null;
  onPickPlant: (id: string | number) => void;
  boboStartDate: string;
  boboEndDate: string;
  onBoboStartDateChange: (value: string) => void;
  onBoboEndDateChange: (value: string) => void;
  selectedDateRange: PredefinedDateRange | null;
  setSelectedDateRange: (v: PredefinedDateRange | null) => void;
  onApplyPlantRange: () => void;
  canApplyPlantRange: boolean;
  boboSeriesError: string | null;
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
  pvReconstructStats: { clippedHours: number; recoveredEnergyMWh: number } | null;
  horizonTrim: HorizonTrimInfo | null;
}) => {
  const [tab, setTab] = useState('paste'); // 'paste' | 'upload'
  const [priceText, setPriceText] = useState('');
  const [windText,  setWindText]  = useState('');
  const [message,   setMessage]   = useState<FlashMsg | null>(null);

  const trimNotice = pvReconstructEnabled ? horizonTrim : null;

  const handleLoad = () => {
    onClearBoboInflight?.();
    setMessage(null);
    const p = parsePaste(priceText);
    if (p.kind === 'error') { setMessage({ tone: 'error', text: `Price box: ${p.message}` }); return; }

    let price, wind;

      if (p.kind === 'two') {
      // Excel-style paste in the price textarea: both columns in one shot
      price = p.price;
      wind  = p.wind;
      if (windText.trim()) {
        setMessage({ tone: 'info', text: `Detected 2-column paste in Price box — ignoring Generation box.` });
      }
    } else {
      // Single-column price; we need generation separately
      price = p.values;
      if (!windText.trim()) {
        setMessage({ tone: 'error', text: `Generation box is empty. Paste generation (MW) or use 2-column format in Price box.` });
        return;
      }
      const w = parsePaste(windText);
      if (w.kind === 'error') { setMessage({ tone: 'error', text: `Generation box: ${w.message}` }); return; }
      if (w.kind === 'two') {
        setMessage({ tone: 'error', text: `Generation box looks 2-column. Paste one column only, or put both columns in the Price box.` });
        return;
      }
      wind = w.values;
    }

    if (price.length !== wind.length) {
      setMessage({ tone: 'error', text: `Length mismatch: ${price.length} prices vs ${wind.length} generation values.` });
      return;
    }

    setCustomData({ price, wind });
    setMessage({ tone: 'info', text: `Loaded ${price.length.toLocaleString()} hours.` });
  };

  const handleReset = () => {
    onClearBoboInflight?.();
    setCustomData(null);
    setMessage(null);
    setPriceText(''); setWindText('');
  };

  const textareaStyle: CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 4, color: 'var(--text)', padding: '8px 10px',
    fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.4,
    width: '100%', resize: 'vertical', outline: 'none',
    marginTop: 6, marginBottom: 12
  };
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const tabBtn = (key: string, label: string) => {
    const active = tab === key;
    return (
      <button key={key} onClick={() => setTab(key)}
        style={{
          padding: '6px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          letterSpacing: '0.05em', textTransform: 'uppercase',
          color: active ? 'var(--accent-teal)' : 'var(--text-dim)',
          borderBottom: active ? '1px solid var(--accent-teal)' : '1px solid transparent',
          background: 'transparent', cursor: 'pointer',
          marginBottom: -1
        }}>
        {label}
      </button>
    );
  };

  return (
    <div className="mt-6 card p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
            EPİAŞ-connected · plant &amp; market series
          </div>
          <div className="font-display text-base mt-1">
            {customData ? 'Loaded dataset' : 'No dataset loaded'}
            <span className="text-[color:var(--text-dim)] font-mono text-xs ml-2">
              {(customData?.price.length ?? 0).toLocaleString()}h
            </span>
          </div>
        </div>
        <span className="chip">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: customData ? 'var(--accent-violet)' : 'var(--text-faint)' }}></span>
          {customData ? 'loaded' : 'none'}
        </span>
      </div>

      <p className="mb-2 text-[10px] font-mono text-[color:var(--text-faint)] leading-relaxed">
        Select a registered power plant to load hourly wholesale price and net generation for your date range—served through this app’s EPİAŞ-aligned transparency integration.
      </p>
      <PowerPlantCombobox
        plants={powerPlants}
        plantsLoading={plantsLoading}
        plantsError={plantsError}
        seriesLoading={seriesLoading}
        selectedPlantId={selectedPlantId}
        onPickPlant={onPickPlant}
      />
      <div className="mb-4">
        <div className="grid grid-cols-3 gap-3">
          <label className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
            Quick range
            <select
              value={selectedDateRange ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  const key = val as PredefinedDateRange;
                  setSelectedDateRange(key);
                  const range = computePredefinedRange(key);
                  onBoboStartDateChange(range.startDate);
                  onBoboEndDateChange(range.endDate);
                }
              }}
              className="mt-1 w-full border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-2 text-xs text-[color:var(--text)] font-mono"
            >
              <option value="" hidden></option>
              {PREDEFINED_DATE_RANGES.map(r => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
            Start date
            <input
              type="date"
              value={boboStartDate}
              max={boboEndDate || yesterday}
              onChange={(e) => { setSelectedDateRange(null); onBoboStartDateChange(e.target.value); }}
              className="mt-1 w-full border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-2 text-xs text-[color:var(--text)] font-mono"
            />
          </label>
          <label className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono">
            End date
            <input
              type="date"
              value={boboEndDate}
              min={boboStartDate}
              max={yesterday}
              onChange={(e) => { setSelectedDateRange(null); onBoboEndDateChange(e.target.value); }}
              className="mt-1 w-full border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-2 text-xs text-[color:var(--text)] font-mono"
            />
          </label>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={onApplyPlantRange}
            disabled={seriesLoading || !canApplyPlantRange}
            className="btn-primary w-full"
            style={{ opacity: seriesLoading || !canApplyPlantRange ? 0.6 : 1 }}
          >
            {seriesLoading ? 'Loading…' : 'Load EPİAŞ data'}
          </button>
        </div>
      </div>
      {boboSeriesError && (
        <div className="mb-4 text-xs font-mono" style={{ color: 'var(--accent-rose)' }}>
          Power plant data: {boboSeriesError}
        </div>
      )}

      <details>
        <summary className="text-xs text-[color:var(--text-dim)] font-mono py-1.5" style={{ userSelect: 'none' }}>
          <span style={{ color: 'var(--accent-teal)' }}>▸</span> load price &amp; generation series
        </summary>

        <div className="mt-3" style={{ borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
          {tabBtn('paste',  'Paste')}
          {tabBtn('upload', 'Upload file')}
        </div>

        {tab === 'paste' && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
              Price &nbsp;<span style={{ color: 'var(--text-faint)' }}>€/MWh · hourly</span>
            </div>
            <textarea value={priceText} onChange={e => setPriceText(e.target.value)}
              placeholder={"One value per line, OR paste 2 columns from Excel\n(price<tab>generation MW) — both series get filled at once"}
              rows={5} style={textareaStyle}
            />

            <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-dim)] font-mono">
              Generation &nbsp;<span style={{ color: 'var(--text-faint)' }}>MW · hourly</span>
            </div>
            <textarea value={windText} onChange={e => setWindText(e.target.value)}
              placeholder="One value per line — plant output in MW (ignored if Price box had 2 columns)"
              rows={5} style={textareaStyle}
            />

            <div className="flex gap-2">
              <button onClick={handleLoad} className="btn-primary" style={{ flex: 1 }}>Load data</button>
              <button onClick={handleReset}
                      style={{ padding: '10px 12px', border: '1px solid var(--border)',
                               borderRadius: 4, color: 'var(--text-dim)', fontSize: 12,
                               fontFamily: 'DM Sans', fontWeight: 500 }}>
                Clear data
              </button>
            </div>

            {message && (
              <div className="mt-3 text-xs font-mono" style={{
                color: message.tone === 'error' ? 'var(--accent-rose)' : 'var(--accent-green)'
              }}>{message.text}</div>
            )}

            <div className="mt-3 text-[10px] font-mono text-[color:var(--text-faint)] leading-relaxed" style={{ lineHeight: 1.5 }}>
              Accepts Excel paste (tab-separated), CSV, whitespace or one-per-line.<br/>
              Horizon auto-clamps to dataset length. Min 24 hours.
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <FileUploadPanel setCustomData={setCustomData} parentSetMessage={setMessage}/>
        )}

        {tab !== 'paste' && (
          <div className="mt-3 flex gap-2">
            <button onClick={handleReset}
                    style={{ padding: '8px 12px', border: '1px solid var(--border)',
                             borderRadius: 4, color: 'var(--text-dim)', fontSize: 12,
                             fontFamily: 'DM Sans', fontWeight: 500 }}>
              Clear data
            </button>
            {message && (
              <div className="text-xs font-mono" style={{
                alignSelf: 'center',
                color: message.tone === 'error' ? 'var(--accent-rose)' : 'var(--accent-green)'
              }}>{message.text}</div>
            )}
          </div>
        )}
      </details>

      {/* ── PV clipping reconstruction ── */}
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
    </div>
  );
});
