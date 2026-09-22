import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ROW_STATUS_LABEL, type RowStatus } from '../../lib/duplicateStore';
import type { DupRow, SortKey, SortState } from '../../lib/duplicateRows';
import { useIsNarrow } from '../../hooks/useIsNarrow';
import { cn } from '../../lib/ui';

/**
 * The duplicates grid — a spreadsheet you can scroll through 200 000 rows of
 * without the browser noticing, built the same way as the settlement grid:
 * only the rows in view (plus a small overscan) exist in the DOM, every row is
 * a memoised fixed-height component, and handlers reach rows through a ref so
 * a new closure never re-renders one.
 *
 * Frozen header and first two columns (row number, duplicate), hairline
 * gridlines, click a header to sort and again to reverse; arrow keys, Page
 * Up/Down and Home/End move the active row, Enter opens the merge and Space
 * the profile.
 */

export const ROW_H = 48;

export interface RowAccess {
  review: boolean;
  approve: boolean;
}
const ACCESS: RowAccess[][] = [
  [Object.freeze({ review: false, approve: false }), Object.freeze({ review: false, approve: true })],
  [Object.freeze({ review: true, approve: false }), Object.freeze({ review: true, approve: true })],
];
/** always one of four frozen objects, so memoised rows compare equal */
export const accessFor = (review: boolean, approve: boolean): RowAccess => ACCESS[+review][+approve];

export interface DuplicateTableHandlers {
  onProfile: (r: DupRow) => void;
  onMerge: (r: DupRow) => void;
  /** mark the record as not a duplicate */
  onRetain: (r: DupRow) => void;
  onUnretain: (r: DupRow) => void;
}

interface Col {
  id: string;
  label: string;
  w: number;
  sort?: SortKey;
  col?: number;
  align?: 'right' | 'center';
  hint?: string;
}

/* ---- pieces ------------------------------------------------------------------------ */

const STATUS_STYLE: Record<RowStatus, string> = {
  DETECTED: 'bg-sky-50 text-sky-700 ring-sky-200',
  PENDING: 'bg-violet-50 text-violet-700 ring-violet-200',
  FLAGGED: 'bg-amber-50 text-amber-800 ring-amber-200',
  MERGED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  RETAINED: 'bg-slate-100 text-slate-700 ring-slate-300',
};

export const DupStatusPill: React.FC<{ status: RowStatus; className?: string }> = ({ status, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
      STATUS_STYLE[status],
      className
    )}
  >
    <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
    {ROW_STATUS_LABEL[status]}
  </span>
);

export const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const iconBtn =
  'grid size-8 place-items-center rounded-md border border-transparent text-muted transition ' +
  'hover:border-line hover:bg-panel hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" className="size-[18px] fill-current" aria-hidden>
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5z" />
  </svg>
);
const KeepIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
    <path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4z" />
  </svg>
);
const MergeIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
    <path d="M17 20.4 18.4 19 15 15.6 13.6 17zM7.5 8H11v5.6L5.6 19 7 20.4l6-6V8h3.5L12 3.5z" />
  </svg>
);

function actionOf(r: DupRow, a: RowAccess): { label: string; tone: 'primary' | 'review' | 'plain'; enabled: boolean; title: string } {
  switch (r.status) {
    case 'DETECTED':
    case 'FLAGGED':
      return a.review
        ? { label: 'Merge', tone: 'primary', enabled: true, title: 'Match and merge with the original' }
        : { label: 'Merge', tone: 'plain', enabled: false, title: 'Outside your review scope' };
    case 'PENDING':
      if (a.approve) return { label: 'Review', tone: 'review', enabled: true, title: 'Preview the merge and accept or reject it' };
      if (a.review) return { label: 'Edit', tone: 'plain', enabled: true, title: 'Change the prepared merge' };
      return { label: 'View', tone: 'plain', enabled: true, title: 'View the prepared merge' };
    case 'MERGED':
      return { label: 'Audit', tone: 'plain', enabled: true, title: 'What was merged, by whom and when' };
    case 'RETAINED':
      return { label: 'Group', tone: 'plain', enabled: true, title: 'Open the group this record was matched with' };
  }
}

/* ---- row -------------------------------------------------------------------------- */

interface RowProps {
  r: DupRow;
  number: number;
  access: RowAccess;
  active: boolean;
  top: number;
  template: string;
  width: number;
  firstW: number;
  attrCount: number;
  hierarchy: (path: string | undefined) => string;
  handlers: React.MutableRefObject<DuplicateTableHandlers>;
  onActivate: (id: string) => void;
}

const cell = 'flex h-full min-w-0 items-center border-b border-r border-line/70 px-2.5';

/** a date on top, who did it underneath */
const WhenWho: React.FC<{ at?: string; by?: string }> = ({ at, by }) =>
  at || by ? (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="truncate tabular-nums text-ink">{when(at) || '—'}</span>
      <span className="truncate text-[10.5px] text-faint" title={by}>
        {by ?? 'unknown user'}
      </span>
    </span>
  ) : (
    <span className="text-faint">—</span>
  );

const Row = memo<RowProps>(({ r, number, access, active, top, template, width, firstW, attrCount, hierarchy, handlers, onActivate }) => {
  const h = handlers.current;
  const act = actionOf(r, access);
  const c = r.case;
  const rec = r.record;
  const orig = r.group.original;
  const trail = hierarchy(rec.orgUnitPath);
  const parents = trail.split(' › ').slice(0, -1).join(' › ');
  const canRetain = access.review && (r.status === 'DETECTED' || r.status === 'FLAGGED');
  const bg = active ? 'bg-accent/[0.07]' : 'bg-panel';
  const stickyBg = active ? 'bg-[#eef8f7]' : 'bg-panel';
  const lead = rec.values.filter(Boolean).slice(0, 2).join(' · ');

  return (
    <div
      role="row"
      aria-rowindex={number + 1}
      aria-selected={active}
      onMouseDown={() => onActivate(r.id)}
      onDoubleClick={() => h.onProfile(r)}
      className={cn('group absolute left-0 grid text-[13px] transition-colors hover:bg-panel2/70', bg)}
      style={{ top, height: ROW_H, width, gridTemplateColumns: template }}
    >
      <div role="cell" className={cn(cell, 'sticky left-0 z-[2] justify-end text-[11px] tabular-nums text-faint group-hover:bg-panel2', stickyBg)}>
        {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" aria-hidden />}
        {number.toLocaleString()}
      </div>
      <div
        role="cell"
        className={cn(cell, 'sticky z-[2] shadow-[1px_0_0_var(--color-line)] group-hover:bg-panel2', stickyBg)}
        style={{ left: 56, width: firstW }}
      >
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-medium text-ink" title={lead}>
            {lead || <span className="italic text-faint">(no values)</span>}
          </span>
          <span className="truncate font-mono text-[10.5px] text-faint">{rec.id}</span>
        </span>
      </div>
      <div role="cell" className={cell}>
        <span className="flex min-w-0 items-center gap-1.5">
          <DupStatusPill status={r.status} />
          {c?.error && (
            <span title={c.error} className="grid size-4 shrink-0 place-items-center rounded-full bg-rose-600 text-[10px] font-bold text-white">
              !
            </span>
          )}
        </span>
      </div>
      {Array.from({ length: attrCount }, (_, i) => {
        const v = rec.values[i] ?? '';
        const o = orig.id === rec.id ? '' : orig.values[i] ?? '';
        const differs = !!o && o.trim() !== v.trim();
        return (
          <div role="cell" key={i} className={cell}>
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-ink" title={v}>{v || <span className="text-faint">—</span>}</span>
              {differs && (
                <span className="truncate text-[10.5px] text-amber-700" title={`Original: ${o}`}>
                  orig. {o}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <div role="cell" className={cell}>
        <span className="flex min-w-0 flex-col leading-tight" title={trail}>
          <span className="truncate text-ink">{rec.orgUnitName || rec.orgUnit || '—'}</span>
          {parents && <span className="truncate text-[10.5px] text-faint">{parents}</span>}
        </span>
      </div>
      <div role="cell" className={cell}>
        <WhenWho at={rec.createdAt} by={rec.createdBy} />
      </div>
      <div role="cell" className={cell}>
        <WhenWho at={rec.updatedAt} by={rec.updatedBy} />
      </div>
      <div role="cell" className={cell}>
        {orig.id === rec.id ? (
          <span className="text-faint">—</span>
        ) : (
          <span className="flex min-w-0 flex-col leading-tight" title={hierarchy(orig.orgUnitPath)}>
            <span className="truncate font-mono text-[12px] text-ink">{orig.id}</span>
            <span className="truncate text-[10.5px] text-faint">
              {when(orig.createdAt)}
              {orig.orgUnitName && orig.orgUnit !== rec.orgUnit && ` · ${orig.orgUnitName}`}
            </span>
          </span>
        )}
      </div>
      <div role="cell" className={cn(cell, 'justify-center')}>
        <span
          className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', r.group.members.length > 2 ? 'bg-amber-50 text-amber-800' : 'bg-panel2 text-muted')}
        >
          {r.group.members.length}
        </span>
      </div>
      <div role="cell" className={cn(cell, 'gap-1 px-1.5')}>
        <button type="button" className={iconBtn} title="View full profile" aria-label="View full profile" onClick={() => h.onProfile(r)}>
          <ProfileIcon />
        </button>
        <button
          type="button"
          disabled={!act.enabled}
          title={act.title}
          onClick={() => h.onMerge(r)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-35',
            act.tone === 'primary' && 'bg-accent text-accent-ink shadow-card hover:brightness-110',
            act.tone === 'review' && 'bg-violet-600 text-white shadow-card hover:bg-violet-700',
            act.tone === 'plain' && 'border border-line bg-panel text-ink hover:border-accent/60'
          )}
        >
          <MergeIcon />
          {act.label}
        </button>
        {canRetain && (
          <button
            type="button"
            title="Not a duplicate — retain this record and stop listing it for review"
            onClick={() => h.onRetain(r)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-line bg-panel px-2 text-[12px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <KeepIcon />
            Retain
          </button>
        )}
        {r.status === 'RETAINED' && access.review && (
          <button
            type="button"
            title="List this record as a duplicate again"
            onClick={() => h.onUnretain(r)}
            className="inline-flex h-8 items-center rounded-md px-2 text-[12px] font-semibold text-muted transition hover:bg-panel2 hover:text-ink"
          >
            Undo
          </button>
        )}
      </div>
      <div role="cell" className={cell}>
        {c?.preparedBy ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12px] text-ink">{c.preparedBy.name}</span>
            <span className="truncate text-[10.5px] text-faint">{when(c.preparedAt)}</span>
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </div>
      <div role="cell" className={cell}>
        {r.retained ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12px] text-ink">{r.retained.retainedBy.name}</span>
            <span className="truncate text-[10.5px] text-faint">retained {when(r.retained.retainedAt)}</span>
          </span>
        ) : c?.reviewedBy ? (
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[12px] text-ink">{c.reviewedBy.name}</span>
            <span className="truncate text-[10.5px] text-faint">{when(c.reviewedAt)}</span>
          </span>
        ) : (
          <span className="text-faint">—</span>
        )}
      </div>
      <div role="cell" className={cell}>
        <span
          className={cn('truncate text-[12px]', c?.error ? 'text-rose-700' : c?.note || r.retained?.note ? 'text-ink' : 'text-faint')}
          title={c?.error ?? r.retained?.note ?? c?.note}
        >
          {c?.error ?? r.retained?.note ?? c?.note ?? '—'}
        </span>
      </div>
    </div>
  );
});
Row.displayName = 'DuplicateRow';

/* ---- table --------------------------------------------------------------------------- */

export const DuplicateTable: React.FC<{
  rows: DupRow[];
  offset: number;
  attributes: { id: string; name: string }[];
  hierarchy: (path: string | undefined) => string;
  accessOf: (r: DupRow) => RowAccess;
  sort: SortState | null;
  onSort: (key: SortKey, col?: number) => void;
  handlers: DuplicateTableHandlers;
  resetKey: string;
}> = ({ rows, offset, attributes, hierarchy, accessOf, sort, onSort, handlers, resetKey }) => {
  const narrow = useIsNarrow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const firstW = narrow ? 170 : 230;
  const cols: Col[] = useMemo(
    () => [
      { id: 'idx', label: '#', w: 56, align: 'right' },
      { id: 'dup', label: 'Record', w: firstW, sort: 'value', col: 0 },
      { id: 'status', label: 'Status', w: 168, sort: 'status' },
      ...attributes.map((a, i) => ({ id: `a${i}`, label: a.name, w: 168, sort: 'value' as SortKey, col: i })),
      { id: 'ou', label: 'Org unit', w: 240, sort: 'orgUnit', hint: 'Org unit, with its full hierarchy underneath' },
      { id: 'created', label: 'Registered · by', w: 168, sort: 'created' },
      { id: 'updated', label: 'Updated · by', w: 168, sort: 'updated' },
      { id: 'original', label: 'Duplicate of', w: 196, sort: 'originalCreated', hint: 'The oldest matching record that is not retained' },
      { id: 'group', label: 'Group', w: 72, sort: 'group', align: 'center', hint: 'How many records share these values' },
      { id: 'actions', label: 'Actions', w: 230 },
      { id: 'prepared', label: 'Prepared by', w: 156 },
      { id: 'decided', label: 'Decided by', w: 156, sort: 'decided' },
      { id: 'note', label: 'Note', w: 260 },
    ],
    [attributes, firstW]
  );
  const template = cols.map((c) => `${c.w}px`).join(' ');
  const width = cols.reduce((s, c) => s + c.w, 0);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [resetKey]);

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
    } else if (activeId && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const r = rows[idx];
      if (!r) return;
      if (e.key === ' ') handlersRef.current.onProfile(r);
      else if (actionOf(r, accessOf(r)).enabled) handlersRef.current.onMerge(r);
    }
  };

  const th =
    'flex h-full min-w-0 items-center gap-1 border-b border-r border-line bg-panel2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted select-none';

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-label="Duplicates"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative min-h-[18rem] flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div style={{ width, minWidth: '100%' }}>
        <div role="row" className="sticky top-0 z-[5] grid h-10" style={{ gridTemplateColumns: template, width }}>
          {cols.map((c, i) => {
            const sorted = !!sort && c.sort === sort.key && (c.sort !== 'value' || sort.col === c.col);
            const sticky = i === 0 ? { left: 0 } : i === 1 ? { left: 56 } : undefined;
            return (
              <div
                key={c.id}
                role="columnheader"
                aria-sort={sorted ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}
                title={c.hint ?? c.label}
                className={cn(th, sticky && 'sticky z-[6]', i === 1 && 'shadow-[1px_0_0_var(--color-line)]', c.align === 'right' && 'justify-end', c.align === 'center' && 'justify-center')}
                style={sticky}
              >
                {c.sort ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.sort!, c.col)}
                    className={cn('inline-flex min-w-0 items-center gap-1 uppercase tracking-wider transition hover:text-ink', sorted && 'text-ink')}
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

        <div role="rowgroup" className="relative" style={{ height: virt.getTotalSize(), width }}>
          {virt.getVirtualItems().map((v) => {
            const r = rows[v.index];
            return (
              <Row
                key={r.id}
                r={r}
                number={offset + v.index + 1}
                access={accessOf(r)}
                active={activeId === r.id}
                top={v.start}
                template={template}
                width={width}
                firstW={firstW}
                attrCount={attributes.length}
                hierarchy={hierarchy}
                handlers={handlersRef}
                onActivate={setActiveId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};
