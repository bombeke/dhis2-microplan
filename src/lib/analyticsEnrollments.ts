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

export async function fetchEnrollmentCoordinateAnalytics(
  engine: Engine,
  opts: {
    program: string;
    orgUnit: string;
    dimensions: CoordinateDimension[];
    period?: string; // e.g. "THIS_MONTH,LAST_MONTH" or a fixed pe
    pageSize?: number;
    maxPages?: number;
  }
): Promise<CoordinateAnalyticsResult> {
  const dims = opts.dimensions;
  const pointsByDimension: Record<string, TrackerPoint[]> = {};
  for (const d of dims) pointsByDimension[d.dimensionId] = [];
  let metaDataItems: CoordinateAnalyticsResult['metaDataItems'] = {};

  if (dims.length === 0) {
    return { pointsByDimension, metaDataItems, nonEmptyDimensionIds: [] };
  }

  const dimensionParam = [
    ...dims.map((d) => d.dimensionId),
    `ou:${opts.orgUnit}`,
  ].join(',');
  // request the coordinate dimensions as output columns
  const headers = dims.map((d) => d.dimensionId).join(',');

  const pageSize = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? 20;

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
    if (page === 1) metaDataItems = resp?.metaData?.items ?? {};

    const respHeaders: any[] = resp?.headers ?? [];
    const rows: any[][] = resp?.rows ?? [];
    if (rows.length === 0) break;

    // map each coordinate dimension to its column index in this response
    const colIndex: Record<string, number> = {};
    for (const d of dims) {
      const idx = respHeaders.findIndex(
        (h) => h.name === d.dimensionId || h.column === d.dimensionId
      );
      if (idx >= 0) colIndex[d.dimensionId] = idx;
    }
    // enrollment id column, for stable point ids
    const enrIdx = respHeaders.findIndex(
      (h) => h.name === 'pi' || h.name === 'enrollment'
    );

    rows.forEach((row, r) => {
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

  return { pointsByDimension, metaDataItems, nonEmptyDimensionIds };
}
