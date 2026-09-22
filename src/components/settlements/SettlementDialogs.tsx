import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlanDialog, btn, textareaCls } from '../create/PlanDialog';
import { SettlementMap, polygonCentre, type ContextSettlement, type MapTool } from './SettlementMap';
import { METHOD_LABEL, type GeoValue, type GpsMethod, type RejectAction } from '../../lib/gpsEditStore';
import type { SettlementRecord } from '../../lib/settlementRegistry';
import { hasGps } from '../../lib/settlementRows';
import { cn } from '../../lib/ui';

/**
 * Dialogs for the Manage Settlements page:
 *
 *  - SettlementMapDialog  "View on map" and "Pick on map" (point or freehand area)
 *  - ManualGpsDialog      type or paste a latitude / longitude
 *  - RejectDialog         reject a row, choosing to blank or keep its GPS
 */

const fmt = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(6) : '—');

/** Nigeria's bounding box, give or take — outside it is almost always a typo. */
const inNigeria = (lat: number, lon: number) => lat >= 3.5 && lat <= 14.5 && lon >= 2.3 && lon <= 15.2;

/* ---- map dialog -------------------------------------------------------------- */

/** One line of the current-vs-new comparison. */
const Row: React.FC<{ label: string; cur: React.ReactNode; next?: React.ReactNode }> = ({ label, cur, next }) => (
  <div className="grid grid-cols-[6.5rem_1fr_1fr] items-baseline gap-2 border-b border-line py-1.5 last:border-0">
    <span className="text-[11.5px] text-muted">{label}</span>
    <span className="font-mono text-[12px] tabular-nums text-ink">{cur}</span>
    <span className={cn('font-mono text-[12px] tabular-nums', next !== undefined ? 'text-amber-700' : 'text-faint')}>
      {next ?? '—'}
    </span>
  </div>
);

export const SettlementMapDialog: React.FC<{
  record: SettlementRecord;
  current: GeoValue;
  proposed: GeoValue | null;
  status: string;
  context: ContextSettlement[];
  mode: 'view' | 'pick';
  onClose: () => void;
  onSave?: (v: GeoValue, method: GpsMethod) => void;
  /** from view mode, jump straight to picking (only offered when the row is editable) */
  onStartPick?: () => void;
}> = ({ record, current, proposed, status, context, mode, onClose, onSave, onStartPick }) => {
  const [tool, setTool] = useState<MapTool>('point'); // picking a point is the default
  const [draft, setDraft] = useState<GeoValue | null>(proposed);
  const [method, setMethod] = useState<GpsMethod>('MAP_POINT');
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  const change = (v: GeoValue, m: GpsMethod) => {
    setDraft(v);
    // a drawn outline is the more specific capture; a later point tweak doesn't demote it
    setMethod((cur) => (m === 'MAP_POINT' && cur === 'MAP_POLYGON' && v.polygon ? cur : m));
  };

  const changed = mode === 'pick' && JSON.stringify(draft) !== JSON.stringify(proposed);
  const canSave = mode === 'pick' && !!draft && (hasGps(draft) || !!draft.polygon) && changed;

  const shownProposal = mode === 'pick' ? draft : proposed;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/40 backdrop-blur-[2px] sm:p-4 lg:p-8">
      <div className="absolute inset-0" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal
        aria-label={`${mode === 'pick' ? 'Pick GPS for' : 'Map of'} ${record.name}`}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-7xl flex-col overflow-hidden bg-panel shadow-float outline-none sm:rounded-2xl"
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {mode === 'pick' ? 'Pick GPS on map' : 'Settlement on map'}
            </p>
            <h3 className="m-0 truncate text-[16px] font-semibold text-ink">{record.name || '(unnamed)'}</h3>
            <p className="m-0 truncate text-[12px] text-muted">
              {[record.ward, record.lga, record.state].filter(Boolean).join(' · ')} · ID {record.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* body: map + side panel (stacked on phones) */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="relative min-h-[45vh] flex-1 lg:min-h-0">
            <SettlementMap
              focus={record}
              current={current}
              proposed={shownProposal}
              focusStatus={status}
              context={context}
              mode={mode}
              tool={tool}
              onToolChange={setTool}
              onChange={change}
            />
          </div>

          <aside className="flex max-h-[42vh] w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-line bg-panel p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
            <div>
              <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-faint">
                <span />
                <span>Current</span>
                <span>{mode === 'pick' ? 'New' : 'Proposed'}</span>
              </div>
              <Row label="Latitude" cur={fmt(current.lat)} next={shownProposal ? fmt(shownProposal.lat) : undefined} />
              <Row label="Longitude" cur={fmt(current.lon)} next={shownProposal ? fmt(shownProposal.lon) : undefined} />
              <Row
                label="Polygon"
                cur={current.polygon ? 'Yes' : 'Missing'}
                next={shownProposal ? (shownProposal.polygon ? 'Yes' : 'None') : undefined}
              />
            </div>

            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg bg-panel2/60 p-3 text-[12px]">
              <dt className="text-muted">Status</dt>
              <dd className="m-0 text-right font-medium text-ink">{status}</dd>
              <dt className="text-muted">Households</dt>
              <dd className="m-0 text-right tabular-nums text-ink">{record.households?.toLocaleString() ?? '—'}</dd>
              <dt className="text-muted">Source</dt>
              <dd className="m-0 text-right text-ink">{record.source ?? '—'}</dd>
              {mode === 'pick' && draft && (
                <>
                  <dt className="text-muted">Captured</dt>
                  <dd className="m-0 text-right text-ink">{METHOD_LABEL[method]}</dd>
                </>
              )}
            </dl>

            {mode === 'pick' && (
              <div className="flex flex-col gap-2">
                {draft?.polygon && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={cn(btn.ghost, 'px-2.5 py-1.5 text-[12px]')}
                      onClick={() => setDraft({ ...draft, ...polygonCentre(draft.polygon!) })}
                    >
                      Point to area centre
                    </button>
                    <button
                      type="button"
                      className={cn(btn.ghost, 'px-2.5 py-1.5 text-[12px] text-flag hover:text-flag')}
                      onClick={() => {
                        setDraft({ ...draft, polygon: null });
                        setMethod('MAP_POINT');
                      }}
                    >
                      Remove area
                    </button>
                  </div>
                )}
                <p className="m-0 text-[11.5px] leading-relaxed text-muted">
                  <strong className="text-ink">Point</strong> places the settlement’s GPS.{' '}
                  <strong className="text-ink">Draw area</strong> outlines it freehand — the point is
                  set to the area’s centre if there isn’t one yet. Switch to{' '}
                  <strong className="text-ink">Satellite</strong> to see rooftops.
                </p>
              </div>
            )}

            {mode === 'view' && !hasGps(current) && !current.polygon && !proposed && (
              <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-inset ring-amber-200">
                This settlement has no GPS or polygon yet. The map shows the other settlements of its
                ward for orientation.
              </p>
            )}

            <div className="mt-auto flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end lg:flex-col-reverse">
              <button type="button" className={btn.ghost} onClick={onClose}>
                {mode === 'pick' ? 'Cancel' : 'Close'}
              </button>
              {mode === 'view' && onStartPick && (
                <button type="button" className={btn.secondary} onClick={onStartPick}>
                  Pick GPS on map
                </button>
              )}
              {mode === 'pick' && (
                <button
                  type="button"
                  className={btn.primary}
                  disabled={!canSave}
                  onClick={() => draft && onSave?.(draft, method)}
                >
                  Use this location
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ---- manual entry ------------------------------------------------------------ */

/** "9.08, 7.49" / "9.08 7.49" / "lat 9.08 lon 7.49" → [9.08, 7.49] */
const parsePair = (s: string): [number, number] | null => {
  const nums = s.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  return [Number(nums[0]), Number(nums[1])];
};

export const ManualGpsDialog: React.FC<{
  record: SettlementRecord;
  initial: GeoValue;
  onClose: () => void;
  onSave: (v: GeoValue) => void;
  onPickOnMap: () => void;
}> = ({ record, initial, onClose, onSave, onPickOnMap }) => {
  const [lat, setLat] = useState(initial.lat?.toString() ?? '');
  const [lon, setLon] = useState(initial.lon?.toString() ?? '');

  const latN = lat.trim() === '' ? NaN : Number(lat);
  const lonN = lon.trim() === '' ? NaN : Number(lon);
  const latErr = lat.trim() !== '' && !(Number.isFinite(latN) && latN >= -90 && latN <= 90);
  const lonErr = lon.trim() !== '' && !(Number.isFinite(lonN) && lonN >= -180 && lonN <= 180);
  const valid = Number.isFinite(latN) && Number.isFinite(lonN) && !latErr && !lonErr;
  const outside = valid && !inNigeria(latN, lonN);
  const swapped = outside && inNigeria(lonN, latN);

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pair = parsePair(e.clipboardData.getData('text'));
    if (!pair) return;
    e.preventDefault();
    setLat(String(pair[0]));
    setLon(String(pair[1]));
  };

  const input = (err: boolean) =>
    cn(
      'w-full rounded-lg border bg-panel px-3 py-2 font-mono text-[13px] tabular-nums text-ink outline-none placeholder:text-faint focus:ring-2',
      err ? 'border-flag focus:ring-flag/30' : 'border-line focus:border-accent focus:ring-accent/30'
    );

  return (
    <PlanDialog
      title="Enter GPS manually"
      description={
        <>
          <strong className="text-ink">{record.name}</strong> · {[record.ward, record.lga].filter(Boolean).join(' · ')}
        </>
      }
      onClose={onClose}
      actions={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btn.secondary} onClick={onPickOnMap}>
            Pick on map instead
          </button>
          <button
            type="button"
            className={btn.primary}
            disabled={!valid}
            onClick={() => onSave({ lat: +latN.toFixed(6), lon: +lonN.toFixed(6), polygon: initial.polygon })}
          >
            Use these coordinates
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">Latitude</span>
          <input
            autoFocus
            inputMode="decimal"
            className={input(latErr)}
            value={lat}
            placeholder="e.g. 12.009952"
            onChange={(e) => setLat(e.target.value)}
            onPaste={onPaste}
          />
          {latErr && <span className="text-[11px] text-flag">Between −90 and 90</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-muted">Longitude</span>
          <input
            inputMode="decimal"
            className={input(lonErr)}
            value={lon}
            placeholder="e.g. 8.512465"
            onChange={(e) => setLon(e.target.value)}
            onPaste={onPaste}
          />
          {lonErr && <span className="text-[11px] text-flag">Between −180 and 180</span>}
        </label>
      </div>
      <p className="m-0 text-[11.5px] text-faint">
        Decimal degrees (WGS84). Tip: paste “lat, lon” into either box to fill both.
      </p>
      {outside && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-inset ring-amber-200">
          <span className="flex-1">This point is outside Nigeria.{swapped && ' Latitude and longitude look swapped.'}</span>
          {swapped && (
            <button
              type="button"
              className="rounded-md bg-amber-500 px-2 py-1 text-[11.5px] font-semibold text-white hover:bg-amber-600"
              onClick={() => {
                setLat(lon);
                setLon(lat);
              }}
            >
              Swap
            </button>
          )}
        </div>
      )}
    </PlanDialog>
  );
};

/* ---- reject -------------------------------------------------------------------- */

export const RejectDialog: React.FC<{
  record: SettlementRecord;
  hasProposal: boolean;
  initialNote: string;
  onClose: () => void;
  onConfirm: (action: RejectAction, note: string) => void;
}> = ({ record, hasProposal, initialNote, onClose, onConfirm }) => {
  const [action, setAction] = useState<RejectAction>('KEEP');
  const [note, setNote] = useState(initialNote);

  const options: { value: RejectAction; title: string; body: string }[] = useMemo(
    () => [
      {
        value: 'KEEP',
        title: 'Maintain current GPS',
        body: hasProposal
          ? 'Discard the proposed change. The settlement keeps the coordinates and polygon it has now.'
          : 'Leave the coordinates and polygon as they are in the register.',
      },
      {
        value: 'BLANK',
        title: 'Blank the GPS',
        body: 'Clear the latitude, longitude and polygon, so the settlement shows as missing GPS and can be captured again.',
      },
    ],
    [hasProposal]
  );

  return (
    <PlanDialog
      title="Reject this settlement’s GPS"
      description={
        <>
          <strong className="text-ink">{record.name}</strong> · {[record.ward, record.lga].filter(Boolean).join(' · ')}
        </>
      }
      onClose={onClose}
      actions={
        <>
          <button type="button" className={btn.ghost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={cn(btn.primary, 'bg-flag focus-visible:ring-flag/50')} onClick={() => onConfirm(action, note)}>
            Reject
          </button>
        </>
      }
    >
      <div role="radiogroup" aria-label="What happens to the GPS" className="flex flex-col gap-2">
        {options.map((o) => {
          const on = action === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setAction(o.value)}
              className={cn(
                'flex items-start gap-2.5 rounded-xl border p-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                on ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-line hover:border-accent/50'
              )}
            >
              <span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', on ? 'border-accent' : 'border-line')} aria-hidden>
                {on && <span className="size-2 rounded-full bg-accent" />}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold text-ink">{o.title}</span>
                <span className="text-[12px] text-muted">{o.body}</span>
              </span>
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-muted">Review note (optional)</span>
        <textarea
          rows={2}
          className={textareaCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why is it rejected?"
        />
      </label>
    </PlanDialog>
  );
};
