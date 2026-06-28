// ============================================================================
// DATA INPUT CARD — EPİAŞ plant & market series
// ============================================================================
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { type PredefinedDateRange, PREDEFINED_DATE_RANGES, computePredefinedRange } from '../formatUtils';
import tariffs from '../../teias_tariff_dataset.json';
import type { ChangeEvent, KeyboardEvent } from 'react';

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

export const PlantProvinceCombobox = memo(({
  selectedRegion, onPickRegion
}: {
  selectedRegion: string | null;
  onPickRegion: (v: string | null) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [pickedProvince, setPickedProvince] = useState<string | null>(null);
  const lastSentRegion = useRef<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const provinces = useMemo(() => {
    return Object.entries(tariffs.province_to_region_map)
      .sort(([a], [b]) => a.localeCompare(b, 'tr'))
      .map(([province, region]) => ({ province, region: String(region) }));
  }, []);

  useEffect(() => {
    if (selectedRegion !== lastSentRegion.current) {
      setPickedProvince(null);
    }
  }, [selectedRegion]);

  const selectedProvince = useMemo(() => {
    if (pickedProvince) return pickedProvince;
    if (!selectedRegion) return null;
    return provinces.find(p => p.region === selectedRegion)?.province ?? null;
  }, [provinces, selectedRegion, pickedProvince]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return provinces;
    return provinces.filter(p => p.province.toLowerCase().includes(q));
  }, [provinces, query]);

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

  const pick = (province: string) => {
    const region = provinces.find(p => p.province === province)?.region ?? null;
    setPickedProvince(province);
    lastSentRegion.current = region;
    setOpen(false);
    setQuery('');
    onPickRegion(region);
  };

  const onInputFocus = () => {
    setOpen(true);
    setQuery(selectedProvince ?? '');
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
      pick(filtered[hi].province);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-faint)] font-mono mb-2">Plant province (for regional tariffs)</div>
      <div className="pp-combobox" ref={wrapRef}>
        <div className="pp-combobox-input-wrap">
          <input
            type="text"
            autoComplete="off"
            placeholder="— select province —"
            value={open ? query : (selectedProvince ?? query)}
            onFocus={onInputFocus}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            aria-expanded={open}
            aria-autocomplete="list"
          />
        </div>
        {open && filtered.length > 0 && (
          <div className="pp-combobox-list" role="listbox">
            {filtered.map((p, i) => (
              <button key={p.province} type="button" role="option"
                aria-selected={i === hi}
                className="pp-combobox-item"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(p.province)}>
                <span>{p.province}</span>
                <span className="text-[10px] text-[color:var(--text-faint)] font-mono">region {p.region}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedRegion && (
        <div className="text-[10px] text-[color:var(--text-faint)] mt-1 font-mono">
          TEİAŞ region {selectedRegion}
        </div>
      )}
    </div>
  );
});

export const DataInputCard = memo(({
  customData,
  powerPlants, plantsLoading, plantsError,
  seriesLoading, selectedPlantId, onPickPlant,
  selectedRegion, onPickRegion,
  boboStartDate, boboEndDate, onBoboStartDateChange, onBoboEndDateChange,
  selectedDateRange, setSelectedDateRange,
  onApplyPlantRange, canApplyPlantRange,
  boboSeriesError,
}: {
  customData: { price: number[]; wind: number[] } | null;
  powerPlants: PowerPlantRow[];
  plantsLoading: boolean;
  plantsError: string | null;
  seriesLoading: boolean;
  selectedPlantId: string | null;
  onPickPlant: (id: string | number) => void;
  selectedRegion: string | null;
  onPickRegion: (v: string | null) => void;
  boboStartDate: string;
  boboEndDate: string;
  onBoboStartDateChange: (value: string) => void;
  onBoboEndDateChange: (value: string) => void;
  selectedDateRange: PredefinedDateRange | null;
  setSelectedDateRange: (v: PredefinedDateRange | null) => void;
  onApplyPlantRange: () => void;
  canApplyPlantRange: boolean;
  boboSeriesError: string | null;
}) => {
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

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


      <PowerPlantCombobox
        plants={powerPlants}
        plantsLoading={plantsLoading}
        plantsError={plantsError}
        seriesLoading={seriesLoading}
        selectedPlantId={selectedPlantId}
        onPickPlant={onPickPlant}
      />
      <PlantProvinceCombobox
        selectedRegion={selectedRegion}
        onPickRegion={onPickRegion}
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
    </div>
  );
});
