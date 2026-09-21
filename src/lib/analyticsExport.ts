import Papa from 'papaparse';
import type { AnalyticsRequest } from './visualizations';

/**
 * Chunked download of an analytics grid, plus the JSON/CSV serialisers the
 * Export page hands to the browser.
 *
 * Analytics responses for a wide pivot table over a long period are big enough
 * to time out (or blow up the JSON parser) if asked for in one go, so we page
 * through them: page 1 tells us how many pages there are, then the rest are
 * fetched in order and concatenated. Everything runs off one AbortSignal so a
 * user who navigates away or hits Cancel doesn't leave a request storm behind.
 */
type Engine = { query: (q: unknown, opts?: { signal?: AbortSignal }) => Promise<any> };

export const DEFAULT_PAGE_SIZE = 500;

export interface AnalyticsHeader {
  name: string;
  column?: string;
  valueType?: string;
  type?: string;
  hidden?: boolean;
  meta?: boolean;
}

export interface AnalyticsGrid {
  headers: AnalyticsHeader[];
  rows: string[][];
  metaData: any;
  /** how many chunks were actually fetched */
  chunks: number;
  /** server-reported row total when available */
  total: number | null;
}

export interface DownloadProgress {
  /** chunk just completed (1-based) */
  chunk: number;
  /** total chunks, once the first response tells us — null until then */
  chunkCount: number | null;
  rowsFetched: number;
  rowsTotal: number | null;
}

const readPager = (res: any) => res?.pager ?? res?.metaData?.pager ?? null;

/**
 * Fetch every page of `request` and concatenate the rows.
 *
 * `pageSize` defaults to 500 — one chunk per 500 rows, so a 5 000-row pivot
 * table downloads as 10 chunks.
 *
 * The resource and the per-endpoint parameters come from the request: an
 * aggregate pivot table is `/api/analytics`, a line list is one of the
 * `/api/analytics/{events,enrollments,trackedEntities}/…` endpoints, and those
 * take a different parameter set (see lib/visualizations.ts). Only the paging
 * parameters are added here, because paging is this function's job.
 */
export async function fetchAnalyticsChunked(
  engine: Engine,
  request: AnalyticsRequest,
  opts: {
    pageSize?: number;
    onProgress?: (p: DownloadProgress) => void;
    signal?: AbortSignal;
    /** guard against a server that never stops paging */
    maxChunks?: number;
  } = {}
): Promise<AnalyticsGrid> {
  if (request.error) throw new Error(request.error);

  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxChunks = opts.maxChunks ?? 1000;

  const baseParams: Record<string, unknown> = {
    ...request.params,
    dimension: request.dimension,
    pageSize,
  };
  if (request.filter.length) baseParams.filter = request.filter;
  // The query endpoints always page and reject `paging`; they only report a
  // page count when explicitly asked, and without it there is no progress bar.
  if (request.totalPages) baseParams.totalPages = true;

  const fetchPage = async (page: number) => {
    const data: any = await engine.query(
      { analytics: { resource: request.resource, params: { ...baseParams, page } } },
      { signal: opts.signal }
    );
    return data.analytics;
  };

  const first = await fetchPage(1);
  const headers: AnalyticsHeader[] = first?.headers ?? [];
  const rows: string[][] = [...(first?.rows ?? [])];
  const pager = readPager(first);

  const rowsTotal: number | null = typeof pager?.total === 'number' ? pager.total : null;
  let chunkCount: number | null = typeof pager?.pageCount === 'number' ? pager.pageCount : null;

  // No pager (some versions omit it when everything fits), or a query endpoint
  // that reports `isLastPage` instead of a count: a short first page means
  // there is nothing more to ask for.
  if (chunkCount === null && (pager?.isLastPage === true || rows.length < pageSize)) chunkCount = 1;

  opts.onProgress?.({ chunk: 1, chunkCount, rowsFetched: rows.length, rowsTotal });

  let chunk = 1;
  while (chunk < maxChunks) {
    if (chunkCount !== null && chunk >= chunkCount) break;
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    chunk += 1;
    const res = await fetchPage(chunk);
    const pageRows: string[][] = res?.rows ?? [];
    rows.push(...pageRows);

    const p = readPager(res);
    if (chunkCount === null && typeof p?.pageCount === 'number') chunkCount = p.pageCount;
    if (chunkCount === null && (p?.isLastPage === true || pageRows.length < pageSize))
      chunkCount = chunk;

    opts.onProgress?.({ chunk, chunkCount, rowsFetched: rows.length, rowsTotal });

    if (pageRows.length === 0) break;
  }

  return {
    headers,
    rows,
    metaData: first?.metaData ?? {},
    chunks: chunk,
    total: rowsTotal ?? rows.length,
  };
}

/** Item uid → display name, from the analytics `metaData.items` map. */
const itemName = (metaData: any, id: string): string | undefined =>
  metaData?.items?.[id]?.name ?? metaData?.items?.[id]?.displayName ?? metaData?.names?.[id];

/** Column label for a header: the dimension's name, falling back to its uid. */
export function headerLabel(header: AnalyticsHeader, metaData: any): string {
  return itemName(metaData, header.name) ?? header.column ?? header.name;
}

export interface RecordOptions {
  /** also emit the raw uid next to each resolved dimension name */
  includeIds?: boolean;
}

/**
 * Flatten the grid into plain objects, resolving dimension-item uids to names.
 *
 * Analytics returns uids in the dimension columns (`ImspTQPwCqd`) and the
 * display names only in `metaData.items`, which is unreadable in a spreadsheet.
 * The uid is kept in a sibling `… ID` column when `includeIds` is set, so the
 * export still joins against other DHIS2 extracts.
 */
export function toRecords(grid: AnalyticsGrid, opts: RecordOptions = {}): Record<string, string>[] {
  const includeIds = opts.includeIds ?? true;
  const visible = grid.headers.map((h, i) => ({ h, i })).filter(({ h }) => !h.hidden);

  return grid.rows.map((row) => {
    const out: Record<string, string> = {};
    for (const { h, i } of visible) {
      const raw = row[i] ?? '';
      const label = headerLabel(h, grid.metaData);
      if (h.meta) {
        out[label] = itemName(grid.metaData, raw) ?? raw;
        if (includeIds) out[`${label} ID`] = raw;
      } else {
        out[label] = raw;
      }
    }
    return out;
  });
}

export interface ExportEnvelope {
  /**
   * Enough provenance to tell two exports apart months later: which favourite,
   * from which metadata resource, and which analytics endpoint produced the
   * rows — a line list and a pivot table of the same name are not the same
   * extract.
   */
  visualization: {
    id: string;
    name: string;
    type?: string;
    source?: string;
    outputType?: string;
  };
  endpoint: string;
  generatedAt: string;
  dateRange: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, string>[];
}

export function toJsonString(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function toCsvString(records: Record<string, string>[], columns: string[]): string {
  // Papa needs an explicit column list: rows built from a sparse grid could
  // otherwise disagree on key order between the first row and the rest.
  return Papa.unparse({ fields: columns, data: records.map((r) => columns.map((c) => r[c] ?? '')) });
}

/** Column order, taken from the headers rather than from the first record. */
export function recordColumns(grid: AnalyticsGrid, opts: RecordOptions = {}): string[] {
  const includeIds = opts.includeIds ?? true;
  const cols: string[] = [];
  for (const h of grid.headers) {
    if (h.hidden) continue;
    const label = headerLabel(h, grid.metaData);
    cols.push(label);
    if (h.meta && includeIds) cols.push(`${label} ID`);
  }
  return cols;
}

/** Hand the browser a file. Revokes the object URL on the next tick. */
export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `pivot-name_last-3-months_2026-09-21.csv` — safe on every filesystem. */
export function exportFileName(visName: string, rangeToken: string, ext: 'json' | 'csv'): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export';
  const today = new Date().toISOString().slice(0, 10);
  return `${slug(visName)}_${slug(rangeToken)}_${today}.${ext}`;
}
