import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  GPS_STATUS_LABEL,
  METHOD_LABEL,
  SYNC_LABEL,
  currentOf,
  isEditableGps,
  isOpenCycle,
  isReviewableGps,
  proposedOf,
  type GpsEdit,
  type GpsStatus,
  type SyncState,
} from '../../lib/gpsEditStore';
import type { SettlementRecord } from '../../lib/settlementRegistry';
import { hasGps, type SortKey, type SortState } from '../../lib/settlementRows';
import { useIsNarrow } from '../../hooks/useIsNarrow';
import { cn } from '../../lib/ui';

/**
 * The settlement grid: a spreadsheet you can scroll through 200 000 rows of
 * without the browser noticing.
 *
 * Only the rows in view (plus a small overscan) exist in the DOM — the
 * virtualiser positions ~30 fixed-height rows inside one tall spacer — so
 * memory and paint cost are the same for 50 rows as for 200 000. Every row is
 * a memoised component whose props are the record, its staged edit and a few
 * booleans; changing one row re-renders that row only.
 *
 * Spreadsheet conventions: a frozen header and frozen first columns (row
 * number and settlement name) while the rest scrolls sideways; hairline
 * gridlines; click a header to sort, again to reverse; arrow keys, Page
 * Up/Down and Home/End move the active row and Enter opens it on the map.
 * Only the reviewer's decision and note are ever editable in place — every
 * other cell is read-only, and coordinates change through the GPS dialogs.
 */

export const ROW_H = 46;

export interface RowAccess {
  edit: boolean;
  review: boolean;
}

/**
 * The four possible RowAccess values as shared constants. `accessOf` must
 * return one of these (never a fresh object) or every memoised row would
 * re-render on every pass.
 */
const ACCESS: RowAccess[][] = [
  [Object.freeze({ edit: false, review: false }), Object.freeze({ edit: false, review: true })],
  [Object.freeze({ edit: true, review: false }), Object.freeze({ edit: true, review: true })],
];
export const accessFor = (edit: boolean, review: boolean): RowAccess => ACCESS[+edit][+review];

export interface TableHandlers {
  onView: (r: SettlementRecord) => void;
  onManual: (r: SettlementRecord) => void;
  onPick: (r: SettlementRecord) => void;
  onRevert: (r: SettlementRecord) => void;
  onAccept: (r: SettlementRecord) => void;
  onReject: (r: SettlementRecord) => void;
  onClearDecision: (r: SettlementRecord) => void;
  onNote: (r: SettlementRecord, note: string) => void;
}

interface Col {
  id: string;
  label: string;
  w: number;
  sort?: SortKey;
  align?: 'right' | 'center';
  hint?: string;
}

const COLS: Col[] = [
  { id: 'idx', label: '#', w: 56, align: 'right' },
  { id: 'name', label: 'Settlement', w: 240, sort: 'name' },
  { id: 'status', label: 'Status', w: 128, sort: 'status' },
  { id: 'ward', label: 'Ward', w: 150, sort: 'ward' },
  { id: 'lga', label: 'LGA', w: 140, sort: 'lga' },
  { id: 'state', label: 'State', w: 112, sort: 'state' },
  { id: 'lat', label: 'Latitude', w: 124, sort: 'lat', align: 'right' },
  { id: 'lon', label: 'Longitude', w: 124, sort: 'lon', align: 'right' },
  { id: 'polygon', label: 'Polygon', w: 104, sort: 'polygon' },
  { id: 'source', label: 'Source', w: 104, sort: 'source' },
  { id: 'households', label: 'Est. households', w: 124, sort: 'households', align: 'right' },
  { id: 'actions', label: 'GPS actions', w: 148 },
  { id: 'review', label: 'Review', w: 150, hint: 'Accept or reject the settlement’s GPS (reviewers)' },
  { id: 'note', label: 'Review note', w: 240 },
  { id: 'updated', label: 'Last change', w: 168, sort: 'updated' },
  { id: 'sync', label: 'Sync', w: 118 },
];

/* ---- small pieces ------------------------------------------------------------ */

const STATUS_STYLE: Record<GpsStatus, string> = {
  DRAFT: 'bg-sky-50 text-sky-700 ring-sky-200',
  SUBMITTED: 'bg-violet-50 text-violet-700 ring-violet-200',
  SENT_BACK: 'bg-amber-50 text-amber-800 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export const GpsStatusPill: React.FC<{ status: GpsStatus | undefined; className?: string }> = ({ status, className }) =>
  status ? (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
        STATUS_STYLE[status],
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
      {GPS_STATUS_LABEL[status]}
    </span>
  ) : (
    <span className={cn('text-[11.5px] text-faint', className)}>Not edited</span>
  );

const SYNC_STYLE: Record<SyncState, string> = {
  NOT_READY: 'text-faint',
  PENDING: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  SYNCED: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200',
  FAILED: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200',
  NOT_REQUIRED: 'text-faint',
};

const Missing: React.FC<{ label?: string; title?: string }> = ({ label = 'Missing', title }) => (
  <span
    title={title}
    className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"
  >
    <span aria-hidden>!</span>
    {label}
  </span>
);

const iconBtn =
  'grid size-8 place-items-center rounded-md border border-transparent text-muted transition ' +
  'hover:border-line hover:bg-panel hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' +
  'disabled:pointer-events-none disabled:opacity-30';

const I = {
  map: (
    <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden>
      <path d="m15 5.1-6-2.1-6 2.3v15.6l6-2.3 6 2.1 6-2.3V2.8l-6 2.3zM10 5.5l4 1.4v11.6l-4-1.4V5.5zM5 6.7l3-1.1v11.6l-3 1.2V6.7zm14 10.6-3 1.1V6.8l3-1.2v11.7z" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden>
      <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden>
      <path d="M12.5 8c-2.6 0-5 1-6.9 2.6L2 7v9h9l-3.6-3.6A8 8 0 0 1 20.1 16l2.4-.8A10.5 10.5 0 0 0 12.5 8z" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
    </svg>
  ),
  cross: (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z" />
    </svg>
  ),
};

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 1 && d.getDate() === new Date().getDate())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined });
};

/* ---- note cell ---------------------------------------------------------------- */

const NoteCell: React.FC<{ value: string; editable: boolean; onCommit: (v: string) => void; label: string }> = ({
  value,
  editable,
  onCommit,
  label,
}) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editable) {
    return (
      <span className={cn('block truncate text-[12.5px]', value ? 'text-ink' : 'text-faint')} title={value || undefined}>
        {value || '—'}
      </span>
    );
  }
  return (
    <input
      value={draft}
      aria-label={label}
      placeholder="Add a review note…"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        e.stopPropagation(); // arrows move the caret, not the active row
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="h-8 w-full rounded-md border border-line bg-amber-50/60 px-2 text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent focus:bg-panel focus:ring-2 focus:ring-accent/30"
    />
  );
};

/* ---- row ------------------------------------------------------------------------ */

interface RowProps {
  r: SettlementRecord;
  e: GpsEdit | undefined;
  number: number;
  dirty: boolean;
  access: RowAccess;
  active: boolean;
  top: number;
  template: string;
  width: number;
  nameW: number;
  handlers: React.MutableRefObject<TableHandlers>;
  onMenu: (r: SettlementRecord, el: HTMLElement) => void;
  onActivate: (id: string) => void;
}

const cell = 'flex h-full min-w-0 items-center border-b border-r border-line/70 px-2.5';

const Row = memo<RowProps>(
  ({ r, e, number, dirty, access, active, top, template, width, nameW, handlers, onMenu, onActivate }) => {
    const cur = currentOf(r, e);
    const prop = proposedOf(e);
    const editable = access.edit && isEditableGps(e);
    const reviewable = access.review && isReviewableGps(e);
    const inReview = e?.status === 'SUBMITTED';
    const canRevert = editable && !!prop && isOpenCycle(e);
    const h = handlers.current;

    const bg = active ? 'bg-accent/[0.07]' : dirty ? 'bg-amber-50/70' : 'bg-panel';
    const stickyBg = active ? 'bg-[#eef8f7]' : dirty ? 'bg-[#fffaeb]' : 'bg-panel';

    const coord = (key: 'lat' | 'lon') => {
      const now = cur[key];
      const next = prop?.[key];
      if (prop && next !== now) {
        return (
          <span className="flex flex-col items-end leading-tight" title={`Current: ${now ?? 'missing'}`}>
            <span className="font-mono text-[12.5px] font-semibold tabular-nums text-amber-700">
              {typeof next === 'number' ? next.toFixed(6) : '—'}
            </span>
            <span className="font-mono text-[10.5px] tabular-nums text-faint line-through">
              {typeof now === 'number' ? now.toFixed(6) : 'missing'}
            </span>
          </span>
        );
      }
      if (hasGps(cur)) return <span className="font-mono text-[12.5px] tabular-nums text-ink">{now!.toFixed(6)}</span>;
      if (now !== null && r.gpsIssue === 'invalid' && !e) return <Missing label="Invalid" title={`Register value: ${now}`} />;
      return <Missing />;
    };

    return (
      <div
        role="row"
        aria-rowindex={number + 1}
        aria-selected={active}
        onMouseDown={() => onActivate(r.id)}
        onDoubleClick={() => h.onView(r)}
        className={cn('group absolute left-0 grid text-[13px] transition-colors hover:bg-panel2/70', bg)}
        style={{ top, height: ROW_H, width, gridTemplateColumns: template }}
      >
        {/* # */}
        <div role="cell" className={cn(cell, 'sticky left-0 z-[2] justify-end text-[11px] tabular-nums text-faint', stickyBg, 'group-hover:bg-panel2')}>
          {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
          {number}
        </div>
        {/* name */}
        <div
          role="cell"
          className={cn(cell, 'sticky z-[2] shadow-[1px_0_0_var(--color-line)]', stickyBg, 'group-hover:bg-panel2')}
          style={{ left: COLS[0].w, width: nameW }}
        >
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex items-center gap-1.5">
              {dirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved change" />}
              <span className="truncate font-medium text-ink" title={r.name}>
                {r.name || <span className="italic text-faint">(unnamed)</span>}
              </span>
            </span>
            <span className="truncate text-[10.5px] text-faint">ID {r.id}</span>
          </span>
        </div>
        {/* status */}
        <div role="cell" className={cell}>
          <GpsStatusPill status={e?.status} />
        </div>
        <div role="cell" className={cell}>
          <span className="truncate" title={r.ward}>{r.ward || '—'}</span>
        </div>
        <div role="cell" className={cell}>
          <span className="truncate" title={r.lga}>{r.lga || '—'}</span>
        </div>
        <div role="cell" className={cell}>
          <span className="truncate" title={r.state}>{r.state || '—'}</span>
        </div>
        <div role="cell" className={cn(cell, 'justify-end')}>{coord('lat')}</div>
        <div role="cell" className={cn(cell, 'justify-end')}>{coord('lon')}</div>
        {/* polygon */}
        <div role="cell" className={cell}>
          {prop && JSON.stringify(prop.polygon) !== JSON.stringify(cur.polygon) ? (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
              {prop.polygon ? 'New area' : 'Removed'}
            </span>
          ) : cur.polygon ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700">
              {I.check} Present
            </span>
          ) : (
            <Missing />
          )}
        </div>
        <div role="cell" className={cell}>
          {r.source ? (
            <span className="truncate rounded bg-panel2 px-1.5 py-0.5 text-[11px] font-medium text-muted">{r.source}</span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </div>
        <div role="cell" className={cn(cell, 'justify-end tabular-nums')}>
          {r.households !== null ? r.households.toLocaleString() : <span className="text-faint">—</span>}
        </div>
        {/* actions */}
        <div role="cell" className={cn(cell, 'gap-0.5 px-1.5')}>
          <button type="button" className={iconBtn} title="View on map" aria-label={`View ${r.name} on map`} onClick={() => h.onView(r)}>
            {I.map}
          </button>
          <button
            type="button"
            className={cn(iconBtn, 'w-auto gap-1 px-2 text-[12px] font-semibold', editable && 'text-accent hover:text-accent')}
            disabled={!editable}
            title={editable ? 'Add or correct GPS' : e && !isEditableGps(e) ? `Read-only while ${GPS_STATUS_LABEL[e.status].toLowerCase()}` : 'Outside your edit scope'}
            aria-haspopup="menu"
            onClick={(ev) => onMenu(r, ev.currentTarget)}
          >
            {I.pin} GPS
          </button>
          {canRevert && (
            <button type="button" className={iconBtn} title="Undo the proposed change" aria-label="Undo the proposed change" onClick={() => h.onRevert(r)}>
              {I.undo}
            </button>
          )}
        </div>
        {/* review */}
        <div role="cell" className={cn(cell, 'px-1.5')}>
          {reviewable ? (
            <div className="flex overflow-hidden rounded-md border border-line bg-panel shadow-card" role="group" aria-label="Review decision">
              <button
                type="button"
                aria-pressed={e?.decision === 'ACCEPTED'}
                onClick={() => (e?.decision === 'ACCEPTED' ? h.onClearDecision(r) : h.onAccept(r))}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 text-[11.5px] font-semibold transition',
                  e?.decision === 'ACCEPTED' ? 'bg-emerald-600 text-white' : 'text-emerald-700 hover:bg-emerald-50'
                )}
              >
                {I.check} Accept
              </button>
              <button
                type="button"
                aria-pressed={e?.decision === 'REJECTED'}
                onClick={() => (e?.decision === 'REJECTED' ? h.onClearDecision(r) : h.onReject(r))}
                className={cn(
                  'inline-flex items-center gap-1 border-l border-line px-2 py-1 text-[11.5px] font-semibold transition',
                  e?.decision === 'REJECTED' ? 'bg-rose-600 text-white' : 'text-rose-700 hover:bg-rose-50'
                )}
              >
                {I.cross} Reject
              </button>
            </div>
          ) : e?.decision ? (
            <span className={cn('text-[12px] font-medium', e.decision === 'ACCEPTED' ? 'text-emerald-700' : 'text-rose-700')}>
              {e.decision === 'ACCEPTED' ? 'Accepted' : e.rejectAction === 'BLANK' ? 'Rejected · blanked' : 'Rejected · kept'}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </div>
        {/* note */}
        <div role="cell" className={cn(cell, 'px-1.5')}>
          <NoteCell
            value={e?.note ?? ''}
            editable={access.review && inReview}
            label={`Review note for ${r.name}`}
            onCommit={(v) => h.onNote(r, v)}
          />
        </div>
        {/* last change */}
        <div role="cell" className={cell}>
          {e ? (
            <span className="flex min-w-0 flex-col leading-tight" title={e.method ? METHOD_LABEL[e.method] : undefined}>
              <span className="truncate text-[12px] text-ink">{e.updatedBy.name}</span>
              <span className="truncate text-[10.5px] text-faint">
                {when(e.updatedAt)}
                {e.method && ` · ${METHOD_LABEL[e.method]}`}
              </span>
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </div>
        <div role="cell" className={cell}>
          {e && e.sync !== 'NOT_READY' ? (
            <span
              className={cn('truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold', SYNC_STYLE[e.sync])}
              title={e.syncError ?? (e.syncedAt ? `Synced ${new Date(e.syncedAt).toLocaleString()} by ${e.syncedBy?.name}` : undefined)}
            >
              {SYNC_LABEL[e.sync]}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </div>
      </div>
    );
  }
);
Row.displayName = 'SettlementRow';

/* ---- table ---------------------------------------------------------------------------- */

interface Props {
  rows: SettlementRecord[];
  offset: number;
  editOf: (id: string) => GpsEdit | undefined;
  isDirty: (id: string) => boolean;
  accessOf: (r: SettlementRecord) => RowAccess;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  handlers: TableHandlers;
  /** changes when the row set is replaced (page, filter, sort) — scrolls back to the top */
  resetKey: string;
}

export const SettlementTable: React.FC<Props> = ({
  rows,
  offset,
  editOf,
  isDirty,
  accessOf,
  sort,
  onSort,
  handlers,
  resetKey,
}) => {
  const narrow = useIsNarrow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ r: SettlementRecord; rect: DOMRect } | null>(null);

  // handlers reach rows through a ref, so a new closure never re-renders a row
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const nameW = narrow ? 168 : COLS[1].w;
  const cols = useMemo(() => COLS.map((c) => (c.id === 'name' ? { ...c, w: nameW } : c)), [nameW]);
  const template = cols.map((c) => `${c.w}px`).join(' ');
  const width = cols.reduce((s, c) => s + c.w, 0);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  // back to the top when the row set is replaced (new page, filter, sort) —
  // not when an edit merely produces a new array of the same rows
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

  const openMenu = useCallback((r: SettlementRecord, el: HTMLElement) => {
    setMenu((m) => (m?.r.id === r.id ? null : { r, rect: el.getBoundingClientRect() }));
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const el = scrollRef.current;
    el?.addEventListener('scroll', close, { passive: true });
    window.addEventListener('resize', close);
    return () => {
      el?.removeEventListener('scroll', close);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    const idx = Math.max(0, rows.findIndex((r) => r.id === activeId));
    const page = Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 400) / ROW_H) - 1);
    const moves: Record<string, number> = {
      ArrowDown: idx + 1,
      ArrowUp: idx - 1,
      PageDown: idx + page,
      PageUp: idx - page,
      Home: 0,
      End: rows.length - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      const next = Math.min(rows.length - 1, Math.max(0, moves[e.key]));
      setActiveId(rows[next].id);
      virt.scrollToIndex(next, { align: 'auto' });
    } else if (e.key === 'Enter' && activeId) {
      const r = rows[idx];
      if (r) handlersRef.current.onView(r);
    }
  };

  const th =
    'flex h-full min-w-0 items-center gap-1 border-b border-r border-line bg-panel2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted select-none';

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-label="Settlements"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative min-h-[18rem] flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div style={{ width, minWidth: '100%' }}>
        {/* header */}
        <div role="row" className="sticky top-0 z-[5] grid h-10" style={{ gridTemplateColumns: template, width }}>
          {cols.map((c, i) => {
            const sorted = sort && c.sort === sort.key;
            const sticky = i === 0 ? { left: 0 } : i === 1 ? { left: cols[0].w } : undefined;
            return (
              <div
                key={c.id}
                role="columnheader"
                aria-sort={sorted ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                title={c.hint}
                className={cn(
                  th,
                  sticky && 'sticky z-[6]',
                  i === 1 && 'shadow-[1px_0_0_var(--color-line)]',
                  c.align === 'right' && 'justify-end'
                )}
                style={sticky}
              >
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sort!)}
                    className={cn(
                      'inline-flex min-w-0 items-center gap-1 uppercase tracking-wider transition hover:text-ink',
                      sorted && 'text-ink'
                    )}
                  >
                    <span className="truncate">{c.label}</span>
                    <span className={cn('text-[9px]', sorted ? 'opacity-100' : 'opacity-30')} aria-hidden>
                      {sorted && sort!.dir === -1 ? '▼' : '▲'}
                    </span>
                  </button>
                ) : (
                  <span className="truncate">{c.label}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* body */}
        <div role="rowgroup" className="relative" style={{ height: virt.getTotalSize(), width }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index];
            return (
              <Row
                key={r.id}
                r={r}
                e={editOf(r.id)}
                number={offset + v.index + 1}
                dirty={isDirty(r.id)}
                access={accessOf(r)}
                active={activeId === r.id}
                top={v.start}
                template={template}
                width={width}
                nameW={nameW}
                handlers={handlersRef}
                onMenu={openMenu}
                onActivate={setActiveId}
              />
            );
          })}
        </div>
      </div>

      {menu && (
        <GpsMenu
          rect={menu.rect}
          onClose={() => setMenu(null)}
          onManual={() => {
            handlersRef.current.onManual(menu.r);
            setMenu(null);
          }}
          onPick={() => {
            handlersRef.current.onPick(menu.r);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
};

/* ---- the "GPS" row menu ------------------------------------------------------------------ */

const GpsMenu: React.FC<{ rect: DOMRect; onClose: () => void; onManual: () => void; onPick: () => void }> = ({
  rect,
  onClose,
  onManual,
  onPick,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    setTimeout(() => document.addEventListener('mousedown', onDoc));
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const w = 248;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - w - 8);
  const below = rect.bottom + 6 + 120 < window.innerHeight;
  const style = below ? { left, top: rect.bottom + 6 } : { left, bottom: window.innerHeight - rect.top + 6 };

  const item =
    'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-panel2 focus:bg-panel2 focus:outline-none';
  return createPortal(
    <div ref={ref} role="menu" className="fixed z-50 rounded-xl border border-line bg-panel p-1 shadow-float" style={{ ...style, width: w }}>
      <button type="button" role="menuitem" className={item} onClick={onPick}>
        <span className="mt-0.5 text-accent">{I.map}</span>
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold text-ink">Pick on map</span>
          <span className="text-[11.5px] text-muted">Click a point, or draw the area freehand</span>
        </span>
      </button>
      <button type="button" role="menuitem" className={item} onClick={onManual}>
        <span className="mt-0.5 text-accent">
          <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden>
            <path d="M3 17.3V21h3.8l11-11.1-3.7-3.7L3 17.3zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7z" />
          </svg>
        </span>
        <span className="flex flex-col">
          <span className="text-[13px] font-semibold text-ink">Enter manually</span>
          <span className="text-[11.5px] text-muted">Type or paste latitude and longitude</span>
        </span>
      </button>
    </div>,
    document.body
  );
};
