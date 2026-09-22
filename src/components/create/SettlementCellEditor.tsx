import React, {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useWardSettlements, type SettlementScope } from '../../hooks/useCreatePlan';
import {
  customSettlementId,
  fold,
  searchSettlements,
  type SettlementOption,
} from '../../lib/settlementCatalog';
import type { CellItem } from '../../lib/createdPlanStore';
import { useIsNarrow } from '../../hooks/useIsNarrow';
import { cn } from '../../lib/ui';

/**
 * The multi-select editor for one grid cell.
 *
 * There is only ever one of these on screen. Cells themselves are plain
 * buttons showing chips; opening one mounts this editor against it. That is
 * what keeps a 500-row × 5-week page light — a hundred-odd buttons, not
 * hundreds of comboboxes each holding its own option list.
 *
 * The option list can be very long (the brief sizes it at 150 000), so:
 *  - filtering is a linear scan over pre-folded keys (settlementCatalog.ts),
 *    run against a *deferred* copy of the query so typing never waits on it;
 *  - the list is virtualised, so the DOM holds only the rows on screen.
 *
 * On a laptop it floats beside the cell; on a phone it becomes a bottom sheet,
 * since a popover anchored to a cell in a sideways-scrolling table has
 * nowhere sensible to go on a narrow screen.
 */

const ROW_H = 44;
const PANEL_W = 380;
const PANEL_H = 460;

export interface CellEditorProps {
  anchor: HTMLElement;
  title: string;
  subtitle?: string;
  scope: SettlementScope | null;
  value: CellItem[];
  readOnly: boolean;
  /** settlement id → other columns of the same row it is already planned in */
  usedElsewhere?: Map<string, string[]>;
  onChange: (items: CellItem[]) => void;
  onClose: () => void;
}

export const SettlementCellEditor: React.FC<CellEditorProps> = ({
  anchor,
  title,
  subtitle,
  scope,
  value,
  readOnly,
  usedElsewhere,
  onChange,
  onClose,
}) => {
  const narrow = useIsNarrow();
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const deferred = useDeferredValue(query);

  const { data: options = [], isLoading, isError, error, refetch } = useWardSettlements(
    readOnly ? null : scope
  );

  const selectedIds = useMemo(() => new Set(value.map((v) => v.id)), [value]);

  const results = useMemo(
    () => (readOnly ? [] : searchSettlements(options, deferred)),
    [options, deferred, readOnly]
  );

  const trimmed = query.trim();
  const exact =
    trimmed.length > 0 && results.some((o) => fold(o.name) === fold(trimmed));
  const canAddCustom = !readOnly && trimmed.length > 1 && !exact && !isLoading;

  useEffect(() => setActive(0), [deferred]);

  // ---- placement -----------------------------------------------------------
  const place = useCallback(() => {
    if (narrow) return setPos(null);
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = Math.min(PANEL_H, vh - 16);
    const left = Math.max(8, Math.min(r.left, vw - PANEL_W - 8));
    const below = vh - r.bottom;
    const top = below >= h + 8 ? r.bottom + 4 : Math.max(8, r.top - h - 4 < 8 ? vh - h - 8 : r.top - h - 4);
    // scrolling the option list fires this too; don't re-render for nothing
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [anchor, narrow]);

  useLayoutEffect(() => {
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place]);

  // close on outside click (but not on the cell that opened us — it toggles)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchor, onClose]);

  useEffect(() => {
    // phones: don't pop the keyboard over the list before the user asks
    if (!narrow) inputRef.current?.focus();
    else panelRef.current?.focus();
  }, [narrow]);

  // ---- editing -------------------------------------------------------------
  const toggle = (o: { id: string; name: string }) => {
    if (readOnly) return;
    if (selectedIds.has(o.id)) onChange(value.filter((v) => v.id !== o.id));
    else onChange([...value, { id: o.id, name: o.name }]);
  };

  const addCustom = () => {
    const id = customSettlementId(trimmed);
    if (!selectedIds.has(id)) onChange([...value, { id, name: trimmed }]);
    setQuery('');
  };

  const selectAllShown = () => {
    const add = results.filter((o) => !selectedIds.has(o.id)).map((o) => ({ id: o.id, name: o.name }));
    onChange([...value, ...add]);
  };

  // ---- virtual list --------------------------------------------------------
  const virt = useVirtualizer({
    count: results.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      anchor.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => {
        const n = Math.min(results.length - 1, i + 1);
        virt.scrollToIndex(n);
        return n;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => {
        const n = Math.max(0, i - 1);
        virt.scrollToIndex(n);
        return n;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) toggle(results[active]);
      else if (canAddCustom) addCustom();
    } else if (e.key === 'Backspace' && !query && value.length && !readOnly) {
      onChange(value.slice(0, -1));
    }
  };

  const bulkBtn =
    'rounded-md px-2 py-1 text-[12px] font-medium text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent';

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${title}${subtitle ? ` — ${subtitle}` : ''}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={cn(
        'fixed z-50 flex flex-col overflow-hidden border border-line bg-panel shadow-float outline-none',
        narrow
          ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]'
          : 'rounded-xl'
      )}
      style={
        narrow
          ? undefined
          : { left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: PANEL_W, maxHeight: Math.min(PANEL_H, window.innerHeight - 16) }
      }
    >
      {narrow && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line" aria-hidden />}

      {/* header */}
      <div className="flex items-start gap-2 border-b border-line px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{title}</div>
          {subtitle && <div className="truncate text-[11.5px] text-muted">{subtitle}</div>}
        </div>
        <span className="shrink-0 rounded-full bg-panel2 px-2 py-0.5 text-[11px] font-medium text-muted">
          {value.length} selected
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-panel2 hover:text-ink"
        >
          ✕
        </button>
      </div>

      {/* selected chips */}
      {value.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto border-b border-line bg-panel2/50 px-3 py-2">
          {value.map((v) => (
            <span
              key={v.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/25 bg-accent/10 py-0.5 pl-2.5 pr-1 text-[12px] text-accent"
            >
              <span className="truncate">{v.name}</span>
              {v.id.startsWith('name:') && (
                <span className="text-[10px] uppercase tracking-wide opacity-70" title="Typed in by hand">
                  new
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${v.name}`}
                  className="grid size-4 shrink-0 place-items-center rounded-full text-[10px] hover:bg-accent/20"
                  onClick={() => onChange(value.filter((x) => x.id !== v.id))}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {readOnly ? (
        value.length === 0 && (
          <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">No settlements planned.</p>
        )
      ) : (
        <>
          <div className="relative border-b border-line">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-faint" aria-hidden>
              ⌕
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={scope ? `Search settlements in ${scope.name}…` : 'Search settlements…'}
              className="w-full border-0 bg-panel py-2.5 pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-faint"
              aria-autocomplete="list"
              aria-controls="cell-editor-list"
            />
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11.5px] text-muted">
            <span>
              {isLoading
                ? 'Loading settlements…'
                : trimmed
                  ? `${results.length.toLocaleString()} of ${options.length.toLocaleString()} match`
                  : `${options.length.toLocaleString()} settlements`}
            </span>
            <span className="flex gap-1">
              <button
                type="button"
                className={bulkBtn}
                disabled={!results.length || results.length > 1000}
                title={results.length > 1000 ? 'Narrow the search to 1,000 or fewer first' : undefined}
                onClick={selectAllShown}
              >
                Select {trimmed ? 'matches' : 'all'}
              </button>
              <button
                type="button"
                className={bulkBtn}
                disabled={!value.length}
                onClick={() => onChange([])}
              >
                Clear
              </button>
            </span>
          </div>

          {isError ? (
            <div className="px-4 py-6 text-center text-[13px]">
              <p className="m-0 mb-2 text-flag">{(error as Error)?.message ?? 'Could not load settlements.'}</p>
              <button type="button" className={bulkBtn} onClick={() => refetch()}>
                Try again
              </button>
            </div>
          ) : isLoading ? (
            <div className="flex flex-col gap-1.5 px-3 pb-3" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-panel2" />
              ))}
            </div>
          ) : (
            <div
              ref={listRef}
              id="cell-editor-list"
              role="listbox"
              aria-multiselectable
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-1.5"
              style={{ height: Math.min(results.length * ROW_H + 8, narrow ? 360 : 300) }}
            >
              <div className="relative w-full" style={{ height: virt.getTotalSize() }}>
                {virt.getVirtualItems().map((vi) => {
                  const o: SettlementOption = results[vi.index];
                  const on = selectedIds.has(o.id);
                  const elsewhere = usedElsewhere?.get(o.id);
                  return (
                    <div
                      key={o.id}
                      role="option"
                      aria-selected={on}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => toggle(o)}
                      onMouseEnter={() => setActive(vi.index)}
                      className={cn(
                        'absolute left-0 top-0 flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5',
                        vi.index === active && 'bg-panel2',
                        on && 'text-accent'
                      )}
                      style={{ height: ROW_H, transform: `translateY(${vi.start}px)` }}
                    >
                      <span
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded border text-[10px] font-bold',
                          on ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-panel'
                        )}
                        aria-hidden
                      >
                        {on ? '✓' : ''}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-[13px]">{o.name}</span>
                        <span className="truncate text-[11px] text-faint">{o.sub}</span>
                      </span>
                      {elsewhere && (
                        <span
                          className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                          title={`Also planned in ${elsewhere.join(', ')}`}
                        >
                          {elsewhere.join(', ')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              {results.length === 0 && (
                <p className="m-0 px-3 py-5 text-center text-[13px] text-muted">
                  {options.length === 0
                    ? `No settlements found for ${scope?.name ?? 'this unit'}.`
                    : 'No matches.'}
                </p>
              )}
            </div>
          )}

          {canAddCustom && (
            <button
              type="button"
              onClick={addCustom}
              className="mx-1.5 mb-1.5 flex items-center gap-2 rounded-lg border border-dashed border-line px-2.5 py-2 text-left text-[12.5px] text-muted hover:border-accent hover:text-accent"
            >
              <span className="text-[15px] leading-none">＋</span>
              <span className="truncate">
                Add “<strong className="font-semibold">{trimmed}</strong>” as a settlement not in the list
              </span>
            </button>
          )}
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line bg-panel2/40 px-3 py-2">
        <span className="hidden text-[11px] text-faint sm:inline">
          {readOnly ? 'Read only' : '↑↓ move · Enter select · Esc close'}
        </span>
        <button
          type="button"
          onClick={() => {
            onClose();
            anchor.focus();
          }}
          className="ms-auto rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-ink shadow-card hover:brightness-110"
        >
          Done
        </button>
      </div>
    </div>
  );

  return createPortal(
    <>
      {narrow && <div className="fixed inset-0 z-40 bg-ink/30" aria-hidden onClick={onClose} />}
      {panel}
    </>,
    document.body
  );
};
