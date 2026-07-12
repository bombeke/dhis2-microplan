import type { Coord, TrackerPoint } from '../types';
import type { CoordinateDimension } from './programCoordinates';

/**
 * Step 3 — retrieve coordinates for all program-stage + attribute COORDINATE
 * dimensions via the enrollments analytics endpoint:
 *
 *   /api/analytics/enrollments/query/{program}
 *     ?dimension=<dim1>,<dim2>,...,ou:<orgUnit>
 *     &headers=...             (the coordinate dims we requested)
 *     &outputType=ENROLLMENT
 *     &includeMetadataDetails=true
 *
 * Each coordinate dimension becomes its own set of points (one per enrollment
 * row that has a value in that column), so the UI can toggle them independently.
 * Step 4 — the analytics response's metaData.items is returned as-is so the
 * caller can label each dimension in the overlay.
 */

type Engine = { query: (q: unknown) => Promise<any> };

export interface CoordinateAnalyticsResult {
  /** points grouped by the dimension id that produced them */
  pointsByDimension: Record<string, TrackerPoint[]>;
  /** analytics metaData.items (id -> { name, ... }) for labelling the overlay */
  metaDataItems: Record<string, { name?: string; [k: string]: unknown }>;
  /** the dimensions that actually yielded ≥1 point */
  nonEmptyDimensionIds: string[];
  table: AnalyticsTable;
}
export interface CoordinateAnalyticsResultD {
  pointsByDimension: Record<string, TrackerPoint[]>;
  metaDataItems: Record<string, { name?: string; [k: string]: unknown }>;
  nonEmptyDimensionIds: string[];
  
}

export interface AnalyticsTableColumn {
  name: string; // dimension/column id, e.g. "jJ82mWtkUW5" or "pi"
  label: string; // human label (from metaData.items or column header)
}


export interface AnalyticsTable {
  columns: AnalyticsTableColumn[];
  rows: string[][];
  total: number;
}



/** Parse a DHIS2 analytics COORDINATE cell into [lng,lat]. */
export function parseCoordinateCell(value: unknown): Coord | null {
  if (value == null || value === '') return null;
  // COORDINATE values arrive as "[lng,lat]" or "lng,lat" (occasionally an array)
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const s = String(value).trim().replace(/^\[/, '').replace(/\]$/, '');
  const parts = s.split(',').map((p) => Number(p.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1]];
  }
  return null;
}

/**
 * Extract the username enclosed in the LAST parentheses of a display value.
 * DHIS2 "…byDisplayName" columns look like "John Golla (golla)"; the "All users"
 * option label is likewise "Name (username)". Returns the inner text lowercased,
 * or null when there are no parentheses.
 */
export function extractParenValue(value: unknown): string | null {
  if (value == null) return null;
  const m = String(value).match(/\(([^)]*)\)\s*$/);
  return m ? m[1].trim().toLowerCase() : null;
}

/**
 * Single pass over the enrollments analytics endpoint that produces both the
 * per-dimension coordinate points for the map and the raw table for display.
 */
export async function fetchEnrollmentAnalytics(
  engine: Engine,
  opts: {
    program: string;
    orgUnit: string;
    dimensions: CoordinateDimension[];
    period?: string;
    userFilter?: string | null;
    pageSize?: number;
    maxPages?: number;
  }
): Promise<CoordinateAnalyticsResult> {
  const dims = opts.dimensions;
  const pointsByDimension: Record<string, TrackerPoint[]> = {};
  for (const d of dims) pointsByDimension[d.dimensionId] = [];

  let metaDataItems: CoordinateAnalyticsResult['metaDataItems'] = {};
  let columns: AnalyticsTableColumn[] = [];
  const tableRows: string[][] = [];

  if (dims.length === 0) {
    return {
      pointsByDimension,
      metaDataItems,
      nonEmptyDimensionIds: [],
      table: { columns, rows: tableRows, total: 0 },
    };
  }

  const userFilter = opts.userFilter ? opts.userFilter.toLowerCase() : null;

  const baseHeaders = [
    'ouname',
    'createdbydisplayname',
    'lastupdatedbydisplayname',
    'lastupdated',
  ];
  const dimHeaders = dims.map((d) => d.dimensionId);
  const dimensionParam = [...dimHeaders, `ou:${opts.orgUnit}`].join(',');
  const headers = [...baseHeaders, ...dimHeaders].join(',');

  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 20;

  const colIndex: Record<string, number> = {};
  let enrIdx = -1;
  let createdByIdx = -1;
  let lastUpdatedByIdx = -1;

  for (let page = 1; page <= maxPages; page++) {
    const data: any = await engine.query({
      a: {
        resource: `analytics/enrollments/query/${opts.program}`,
        params: {
          dimension: dimensionParam,
          headers,
          outputType: 'ENROLLMENT',
          displayProperty: 'NAME',
          totalPages: 'false',
          rowContext: 'true',
          includeMetadataDetails: 'true',
          ...(opts.period ? { lastUpdated: opts.period } : {}),
          pageSize,
          page,
        },
      },
    });

    const resp = data.a;
    const respHeaders: any[] = resp?.headers ?? [];
    const rows: any[][] = resp?.rows ?? [];

    if (page === 1) {
      metaDataItems = resp?.metaData?.items ?? {};
      columns = respHeaders.map((h) => ({
        name: h.name,
        label: (metaDataItems[h.name] as any)?.name ?? h.column ?? h.name,
      }));
      for (const d of dims) {
        const idx = respHeaders.findIndex(
          (h) => h.name === d.dimensionId || h.column === d.dimensionId
        );
        if (idx >= 0) colIndex[d.dimensionId] = idx;
      }
      enrIdx = respHeaders.findIndex((h) => h.name === 'pi' || h.name === 'enrollment');
      createdByIdx = respHeaders.findIndex(
        (h) => h.name === 'createdbydisplayname' || h.column === 'createdbydisplayname'
      );
      lastUpdatedByIdx = respHeaders.findIndex(
        (h) =>
          h.name === 'lastupdatedbydisplayname' || h.column === 'lastupdatedbydisplayname'
      );
    }

    if (rows.length === 0) break;

    rows.forEach((row, r) => {
      if (userFilter) {
        const createdBy = createdByIdx >= 0 ? extractParenValue(row[createdByIdx]) : null;
        const lastUpdatedBy =
          lastUpdatedByIdx >= 0 ? extractParenValue(row[lastUpdatedByIdx]) : null;
        if (createdBy !== userFilter && lastUpdatedBy !== userFilter) return;
      }

      tableRows.push(row.map((v) => (v == null ? '' : String(v))));

      const enrollmentId = enrIdx >= 0 ? String(row[enrIdx]) : `r${page}-${r}`;
      for (const d of dims) {
        const ci = colIndex[d.dimensionId];
        if (ci == null) continue;
        const coordinate = parseCoordinateCell(row[ci]);
        if (!coordinate) continue;
        pointsByDimension[d.dimensionId].push({
          id: `${d.dimensionId}:${enrollmentId}`,
          kind: d.kind === 'attribute' ? 'enrollment' : 'event',
          programStage: d.programStageId,
          programStageName: d.programStageName,
          coordinate,
          name: d.name,
          value: 1,
        });
      }
    });

    if (rows.length < pageSize) break;
  }

  const nonEmptyDimensionIds = dims
    .map((d) => d.dimensionId)
    .filter((id) => pointsByDimension[id].length > 0);

  return {
    pointsByDimension,
    metaDataItems,
    nonEmptyDimensionIds,
    table: { columns, rows: tableRows, total: tableRows.length },
  };
}