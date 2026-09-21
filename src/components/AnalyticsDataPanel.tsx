import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Button,
  Chip,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableColumnHeader,
  DataTableHead,
  DataTableRow,
  IconChevronDown24,
  IconChevronUp24,
  IconCross16,
  IconDownload16,
  IconTable16,
  Input,
  Pagination,
} from '@dhis2/ui';
import { displayColumnOrder, type AnalyticsTable } from '@/lib/analyticsEnrollments';
import { ENROLLMENT_GROUP_KEY } from '@/lib/programDimensions';
import { cn } from '@/lib/ui';

/**
 * The data behind the map, as a table.
 *
 * The sheet is rendered into `document.body`, not into the map. Inside the map
 * it was clipped to the map's box and could only ever show a strip of rows;
 * over the page it can take the height it needs, and "expand" can go nearly
 * full-screen for a long read without the map's bounds getting in the way.
 *
 * Columns arrive already tagged with the group they belong to — the enrollment
 * itself, the tracked entity's bio data, or a named program stage — so the head
 * is two rows: a grouped band, then the column names. That is what makes a wide
 * table readable once a user adds a dozen data elements in the filter bar; a
 * flat header of UIDs is not.
 *
 * Everything below the fetch is client-side (search, sort, paging, CSV), since
 * the rows are already in memory: the map is drawing the same response.
 */

// The fetch ceiling is 20,000 rows, so the larger sizes are worth offering:
// paging 250 at a time through that is 80 clicks.
const PAGE_SIZES = [25, 50, 100, 250, 500, 1000];

type SortState = { index: number; direction: 'asc' | 'desc' } | null;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const csv = [columns, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const AnalyticsDataPanel: React.FC<{
  program?: string;
  orgUnitId: string | null;
  period?: string | null;
  userFilter?: string | null;
  tableResult?: AnalyticsTable;
}> = ({ program, orgUnitId, period, userFilter, tableResult: data }) => {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([ENROLLMENT_GROUP_KEY]);

  const enabled = !!program && !!orgUnitId && !!period && !!userFilter;

  const columns = useMemo(() => data?.columns ?? [], [data]);

  // Bio data first, then the stages (coordinate columns included, inside
  // whichever group owns them), then the enrollment columns — and no
  // duplicates. See `displayColumnOrder`.
  const orderedIndexes = useMemo(() => displayColumnOrder(columns), [columns]);

  // Hiding a group hides its columns; the indexes are kept so a row can still
  // be read straight off the original (unfiltered) row array.
  const visibleIndexes = useMemo(
    () => orderedIndexes.filter((i) => !hiddenGroups.includes(columns[i].groupKey)),
    [orderedIndexes, columns, hiddenGroups]
  );

  /** Collapse a run of column indexes into the header bands they span. */
  const bandsFor = useCallback(
    (indexes: number[]) => {
      const out: { key: string; label: string; span: number }[] = [];
      for (const i of indexes) {
        const c = columns[i];
        const last = out[out.length - 1];
        if (last && last.key === c.groupKey) last.span += 1;
        else out.push({ key: c.groupKey, label: c.group, span: 1 });
      }
      return out;
    },
    [columns]
  );

  // The section chips are derived from the *display* order, not the response
  // order, so their sequence and their counts match the table beneath them —
  // `data.columnGroups` still describes the raw response and would disagree on
  // both once columns are reordered and deduped.
  const groups = useMemo(() => bandsFor(orderedIndexes), [bandsFor, orderedIndexes]);
  const visibleGroups = useMemo(() => bandsFor(visibleIndexes), [bandsFor, visibleIndexes]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => visibleIndexes.some((i) => (row[i] ?? '').toLowerCase().includes(q)));
  }, [data, query, visibleIndexes]);

  // Hoisted out of the table's own memo so the CSV can apply the same ordering
  // to the *whole* dataset rather than re-deriving a second, subtly different
  // comparator.
  const sortRows = useCallback(
    (rows: string[][]) => {
      if (!sort) return rows;
      const { index, direction } = sort;
      const dir = direction === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const x = a[index] ?? '';
        const y = b[index] ?? '';
        const nx = Number(x);
        const ny = Number(y);
        if (x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)) {
          return (nx - ny) * dir;
        }
        return x.localeCompare(y) * dir;
      });
    },
    [sort]
  );

  const sorted = useMemo(() => sortRows(filtered), [filtered, sortRows]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  // A new search or a new response can leave the viewer on a page that no
  // longer exists; snap back rather than showing an empty table.
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  useEffect(() => setPage(1), [query, pageSize, data]);

  // Escape closes the sheet, like any other overlay on the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggleGroup = (key: string) =>
    setHiddenGroups((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));

  const onSort = (index: number) =>
    setSort((s) =>
      s?.index === index
        ? s.direction === 'asc'
          ? { index, direction: 'desc' }
          : null
        : { index, direction: 'asc' }
    );

  /**
   * The CSV is the **whole fetched dataset**, not the view.
   *
   * Deliberately ignores the search box, the paging and the hidden sections:
   * those exist to make a wide table readable on screen, and a spreadsheet
   * doesn't need them. Someone exporting to follow up on a round wants every
   * record they were shown a map of — flagged and not — with every column,
   * rather than the fifty rows that happened to be on screen. Only the column
   * *order* and the active sort carry over, so the file opens looking like the
   * table it came from.
   */
  const exportCsv = () => {
    const header = orderedIndexes.map((i) => `${columns[i].group} · ${columns[i].label}`);
    const rows = sortRows(data?.rows ?? []).map((r) => orderedIndexes.map((i) => r[i] ?? ''));
    downloadCsv(`microplan-analytics-${orgUnitId ?? 'data'}.csv`, header, rows);
  };

  const sheet = (
    <div
      role="dialog"
      aria-label="Analytics data"
      className={cn(
        'fixed inset-x-0 bottom-0 z-[1100] mx-auto flex flex-col',
        'w-full max-w-[110rem] overflow-hidden rounded-t-2xl border border-b-0 border-line',
        'bg-panel shadow-sheet',
        expanded ? 'h-[88vh]' : 'h-[min(28rem,55vh)]'
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13.5px] font-semibold">Analytics data</span>
          <span className="text-[11.5px] tabular-nums text-muted">
            {/* Every fetched row is in here — flagged and not. The map draws a
                subset of them (only rows with coordinates in the visible point
                layers), so the table is always the larger number. */}
            {sorted.length !== (data?.total ?? 0)
              ? `${sorted.length.toLocaleString()} of ${(data?.total ?? 0).toLocaleString()} row(s)`
              : `${(data?.total ?? 0).toLocaleString()} row(s)`}
            {data?.truncated ? ' · capped, narrow the period to see the rest' : ''}
          </span>
        </div>

        <div className="ms-auto flex flex-1 items-center justify-end gap-2 sm:flex-none">
          <div className="w-full min-w-0 sm:w-56">
            <Input
              dense
              name="datapanel-search"
              placeholder="Search all columns…"
              value={query}
              onChange={({ value }: { value?: string }) => setQuery(value ?? '')}
            />
          </div>
          <Button
            small
            secondary
            icon={<IconDownload16 />}
            title={`Download all ${(data?.total ?? 0).toLocaleString()} fetched row(s) and every column — not just what is shown`}
            onClick={exportCsv}
          >
            CSV
          </Button>
          <Button
            small
            secondary
            icon={expanded ? <IconChevronDown24 /> : <IconChevronUp24 />}
            title={expanded ? 'Collapse panel' : 'Expand panel'}
            onClick={() => setExpanded((e) => !e)}
          />
          <Button
            small
            secondary
            icon={<IconCross16 />}
            title="Close"
            onClick={() => setOpen(false)}
          />
        </div>
      </div>

      {groups.length > 1 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 overflow-x-auto border-b border-line bg-panel2 px-3 py-2 sm:px-4 [&>*]:!m-0">
          <span className="me-0.5 shrink-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            Sections
          </span>
          {groups.map((g) => (
            <Chip
              key={g.key}
              dense
              selected={!hiddenGroups.includes(g.key)}
              onClick={() => toggleGroup(g.key)}
            >
              {`${g.label} (${g.span})`}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {(!data || data.rows.length === 0) && (
          <div className="m-auto p-6 text-[13px] text-muted">No rows for the current selection.</div>
        )}
        {data && data.rows.length > 0 && sorted.length === 0 && (
          <div className="m-auto p-6 text-[13px] text-muted">No rows match “{query}”.</div>
        )}
        {data && sorted.length > 0 && (
          <div className="datapanel-scroll min-h-0 flex-1 overflow-auto">
            <DataTable>
              <DataTableHead>
                {/* Band of section names, then the column names beneath. Both
                    rows are sticky: the second is offset by the first row's
                    height (fixed in CSS) so they stack rather than overlap. */}
                <DataTableRow>
                  {visibleGroups.map((g, i) => (
                    <DataTableColumnHeader
                      key={`${g.key}-${i}`}
                      colSpan={String(g.span)}
                      fixed
                      top="0"
                      className="datapanel-band"
                    >
                      {g.label}
                    </DataTableColumnHeader>
                  ))}
                </DataTableRow>
                <DataTableRow>
                  {visibleIndexes.map((i) => (
                    <DataTableColumnHeader
                      key={columns[i].name}
                      fixed
                      top="28px"
                      sortDirection={sort?.index === i ? sort.direction : 'default'}
                      onSortIconClick={() => onSort(i)}
                    >
                      {columns[i].label}
                    </DataTableColumnHeader>
                  ))}
                </DataTableRow>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((row, r) => (
                  <DataTableRow key={`${page}-${r}`}>
                    {visibleIndexes.map((i) => (
                      <DataTableCell key={i}>{row[i]}</DataTableCell>
                    ))}
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </div>
        )}
      </div>

      {data && sorted.length > 0 && (
        <div className="shrink-0 border-t border-line px-3 py-1.5 sm:px-4">
          <Pagination
            page={page}
            pageSize={pageSize}
            pageCount={pageCount}
            total={sorted.length}
            pageSizeSelectText="Rows per page"
            pageSizes={PAGE_SIZES.map(String)}
            onPageChange={setPage}
            onPageSizeChange={(size: number) => setPageSize(size)}
          />
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className={cn(
          'absolute bottom-4 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2',
          'rounded-full px-4 py-2.5 text-[13px] font-semibold shadow-lg transition',
          enabled
            ? 'bg-accent text-accent-ink shadow-accent/30 hover:-translate-y-0.5 hover:shadow-xl'
            : 'cursor-not-allowed bg-line text-muted shadow-none'
        )}
        onClick={() => setOpen((o) => !o)}
        disabled={!enabled}
        title={!enabled ? 'Select a programme and org unit first' : 'View the underlying data'}
      >
        <IconTable16 />
        {open ? 'Hide data' : 'View data'}
        {data ? (
          <span className="rounded-full bg-white/25 px-2 py-px text-[11px] tabular-nums">
            {data.total}
          </span>
        ) : null}
      </button>

      {open && typeof document !== 'undefined' && createPortal(sheet, document.body)}
    </>
  );
};
