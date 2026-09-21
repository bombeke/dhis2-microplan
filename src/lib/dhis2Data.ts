import type { TrackerPoint, Coord } from '../types';
import {
  fetchProgramCoordinateDimensions,
  type CoordinateDimension,
} from './programCoordinates';
import {
  fetchEnrollmentAnalytics,
  type CoordinateAnalyticsResult,
} from './analyticsEnrollments';
import {
  dimensionIndex,
  fetchProgramDimensionGroups,
  flattenDimensionGroups,
  type DimensionGroup,
  type DimensionOption,
} from './programDimensions';

/**
 * Pulls georeferenced points from DHIS2.
 *
 * As of patch 8 the three public fetchers below are *switched* to use the
 * enrollment coordinate-analytics path (program COORDINATE attributes +
 * program-stage COORDINATE data elements → analytics/enrollments/query). The
 * original tracker/analytics-event implementations are KEPT in this file
 * (suffixed `Legacy`) and used as a fallback when no coordinate dimensions are
 * discovered or the analytics call fails, so nothing is lost.
 *
 * The DHIS2 data engine instance is injected so this stays testable.
 */
type Engine = { query: (q: unknown) => Promise<any> };

const parseGeometry = (geometry: any): Coord | null => {
  if (!geometry) return null;
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const [lng, lat] = geometry.coordinates;
    if (typeof lng === 'number' && typeof lat === 'number') return [lng, lat];
  }
  return null;
};

/**
 * Shared helper: discover a program's COORDINATE dimensions and run the
 * enrollment coordinate-analytics query. Returns null when the program has no
 * coordinate dimensions at all (so callers can fall back to the legacy path).
 *
 * `selectedDimensionIds` — what the user picked in the map filter bar — is
 * split two ways, because the two kinds of pick mean different things:
 *
 *   - picked COORDINATE dimensions **narrow the map layers** to just those
 *     (this is the long-standing behaviour of the filter);
 *   - picked non-coordinate attributes / data elements are **extra columns**:
 *     they are added to the analytics request so they appear in the data table
 *     and in each tracked entity's profile, but they draw nothing.
 *
 * Every tracked-entity attribute is requested regardless, because the profile's
 * bio-data section is only useful when it is complete. Stage data elements are
 * requested on demand (the picked ones), so a program with a dozen stages does
 * not turn every map pan into a 300-column query.
 */
export async function fetchProgramCoordinatePoints(
  engine: Engine,
  opts: {
    program: string;
    orgUnit: string;
    period?: string;
    periodType?: string | null;
    stages?: { id: string; name?: string }[];
    kindFilter?: 'attribute' | 'stageDataElement';
    /** the attributes / data elements the user picked in the FilterMap */
    selectedDimensionIds?: string[];
    /** username to filter enrollment rows by (created/last-updated-by) */
    userFilter?: string | null;
    /** include every tracked-entity attribute as a column (default true) */
    includeAllAttributes?: boolean;
    /** pre-fetched program dimensions, to avoid a second metadata round-trip */
    dimensionGroups?: DimensionGroup[];
  }
): Promise<CoordinateAnalyticsResult | null> {
  // stages are optional; without them we still get attribute dimensions
  const stages = opts.stages ?? [];
  const [allCoordinateDims, groups] = await Promise.all([
    fetchProgramCoordinateDimensions(engine, opts.program, stages),
    opts.dimensionGroups
      ? Promise.resolve(opts.dimensionGroups)
      : fetchProgramDimensionGroups(engine, opts.program),
  ]);

  let coordinateDims: CoordinateDimension[] = opts.kindFilter
    ? allCoordinateDims.filter((d) => d.kind === opts.kindFilter)
    : allCoordinateDims;
  if (coordinateDims.length === 0) return null;

  const coordinateIds = new Set(coordinateDims.map((d) => d.dimensionId));
  const selected = opts.selectedDimensionIds ?? [];
  const selectedCoordinateIds = selected.filter((id) => coordinateIds.has(id));
  const selectedExtraIds = new Set(selected.filter((id) => !coordinateIds.has(id)));

  // picked coordinate dimensions narrow the drawn layers
  if (selectedCoordinateIds.length > 0) {
    const wanted = new Set(selectedCoordinateIds);
    coordinateDims = coordinateDims.filter((d) => wanted.has(d.dimensionId));
  }

  const includeAllAttributes = opts.includeAllAttributes ?? true;
  const extraDimensions: DimensionOption[] = flattenDimensionGroups(groups).filter(
    (o) =>
      !coordinateIds.has(o.id) &&
      o.valueType !== 'COORDINATE' &&
      (selectedExtraIds.has(o.id) || (includeAllAttributes && o.kind === 'attribute'))
  );

  return fetchEnrollmentAnalytics(engine, {
    program: opts.program,
    orgUnit: opts.orgUnit,
    dimensions: coordinateDims,
    extraDimensions,
    dimensionLookup: dimensionIndex(groups),
    period: opts.period,
    periodType: opts.periodType,
    userFilter: opts.userFilter ?? null,
  });
}

/** Flatten a coordinate-analytics result into a single point list. */
export function flattenCoordinateResult(res: CoordinateAnalyticsResult): TrackerPoint[] {
  return Object.values(res.pointsByDimension).flat();
}

export async function fetchEnrollmentPointsLegacy(
  engine: Engine,
  opts: { program: string; orgUnit: string; period: string; teamAttr?: string }
): Promise<TrackerPoint[]> {
  const data = await engine.query({
    enrollments: {
      resource: 'tracker/enrollments',
      params: {
        program: opts.program,
        orgUnit: opts.orgUnit,
        ouMode: 'DESCENDANTS',
        updatedAfter: undefined,
        fields:
          'enrollment,trackedEntity,geometry,enrolledAt,attributes[attribute,value]',
        paging: 'false',
        order: 'enrolledAt:desc',
      },
    },
  });

  return (data.enrollments.instances ?? data.enrollments.enrollments ?? [])
    .map((e: any): TrackerPoint | null => {
      const coordinate = parseGeometry(e.geometry);
      if (!coordinate) return null;
      const teamAttr = opts.teamAttr
        ? (e.attributes ?? []).find((a: any) => a.attribute === opts.teamAttr)?.value
        : undefined;
      const nameAttr = (e.attributes ?? []).find((a: any) => /name/i.test(a.attribute))?.value;
      return {
        id: e.enrollment,
        kind: 'enrollment',
        teamCode: teamAttr,
        coordinate,
        name: nameAttr,
        value: 1,
      };
    })
    .filter(Boolean) as TrackerPoint[];
}

export async function fetchEventPointsLegacy(
  engine: Engine,
  opts: { program: string; orgUnit: string; period: string; teamDataElement?: string }
): Promise<TrackerPoint[]> {
  const data = await engine.query({
    events: {
      resource: 'tracker/events',
      params: {
        program: opts.program,
        orgUnit: opts.orgUnit,
        ouMode: 'DESCENDANTS',
        fields:
          'event,programStage,geometry,occurredAt,dataValues[dataElement,value]',
        paging: 'false',
        order: 'occurredAt:desc',
      },
    },
  });

  return (data.events.instances ?? data.events.events ?? [])
    .map((ev: any): TrackerPoint | null => {
      const coordinate = parseGeometry(ev.geometry);
      if (!coordinate) return null;
      const team = opts.teamDataElement
        ? (ev.dataValues ?? []).find((d: any) => d.dataElement === opts.teamDataElement)?.value
        : undefined;
      return {
        id: ev.event,
        kind: 'event',
        programStage: ev.programStage,
        teamCode: team,
        coordinate,
        value: 1,
      };
    })
    .filter(Boolean) as TrackerPoint[];
}

/**
 * Analytics fallback: when tracker geometry isn't available, the analytics
 * event API can return coordinate columns. Used for aggregated stage counts.
 */
export async function fetchAnalyticsEventPointsLegacy(
  engine: Engine,
  opts: { program: string; stage: string; orgUnit: string; period: string }
): Promise<TrackerPoint[]> {
  const data = await engine.query({
    a: {
      resource: `analytics/events/query/${opts.program}`,
      params: {
        stage: opts.stage,
        dimension: [`ou:${opts.orgUnit}`, `pe:${opts.period}`],
        coordinatesOnly: 'true',
        outputType: 'EVENT',
        pageSize: '100000',
      },
    },
  });

  const rows: any[][] = data.a.rows ?? [];
  const headers: any[] = data.a.headers ?? [];
  const lngIdx = headers.findIndex((h) => h.name === 'longitude' || h.column === 'Longitude');
  const latIdx = headers.findIndex((h) => h.name === 'latitude' || h.column === 'Latitude');
  if (lngIdx < 0 || latIdx < 0) return [];

  return rows
    .map((r, i): TrackerPoint | null => {
      const lng = Number(r[lngIdx]);
      const lat = Number(r[latIdx]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      return {
        id: `an:${opts.stage}:${i}`,
        kind: 'event',
        programStage: opts.stage,
        coordinate: [lng, lat],
        value: 1,
      };
    })
    .filter(Boolean) as TrackerPoint[];
}

// ---------------------------------------------------------------------------
// Public fetchers — SWITCHED to the coordinate-analytics path (patch 8).
// Each tries program COORDINATE dimensions via analytics/enrollments/query and
// falls back to its `…Legacy` implementation above when there are no coordinate
// dimensions or the analytics call fails. Signatures are unchanged so existing
// callers keep working.
// ---------------------------------------------------------------------------

/** Fetch the program's stage list (id,name) for stage-dataElement dimensions. */
async function fetchProgramStages(
  engine: Engine,
  program: string
): Promise<{ id: string; name?: string }[]> {
  try {
    const data: any = await engine.query({
      p: {
        resource: `programs/${program}`,
        params: { fields: 'programStages[id,name]', paging: 'false' },
      },
    });
    return (data.p.programStages ?? []).map((s: any) => ({ id: s.id, name: s.name }));
  } catch {
    return [];
  }
}

export async function fetchEnrollmentPoints(
  engine: Engine,
  opts: { program: string; orgUnit: string; period: string; teamAttr?: string }
): Promise<TrackerPoint[]> {
  try {
    const stages = await fetchProgramStages(engine, opts.program);
    const res = await fetchProgramCoordinatePoints(engine, {
      program: opts.program,
      orgUnit: opts.orgUnit,
      period: 'THIS_MONTH,LAST_MONTH',
      stages,
      kindFilter: 'attribute', // enrollment ≈ tracked-entity attribute coordinates
    });
    if (res) return flattenCoordinateResult(res);
  } catch (e) {
    console.warn('coordinate-analytics enrollment fetch failed; using legacy', e);
  }
  return fetchEnrollmentPointsLegacy(engine, opts);
}

export async function fetchEventPoints(
  engine: Engine,
  opts: { program: string; orgUnit: string; period: string; teamDataElement?: string }
): Promise<TrackerPoint[]> {
  try {
    const stages = await fetchProgramStages(engine, opts.program);
    const res = await fetchProgramCoordinatePoints(engine, {
      program: opts.program,
      orgUnit: opts.orgUnit,
      period: 'THIS_MONTH,LAST_MONTH',
      stages,
      kindFilter: 'stageDataElement', // events ≈ program-stage dataElement coordinates
    });
    if (res) return flattenCoordinateResult(res);
  } catch (e) {
    console.warn('coordinate-analytics event fetch failed; using legacy', e);
  }
  return fetchEventPointsLegacy(engine, opts);
}

export async function fetchAnalyticsEventPoints(
  engine: Engine,
  opts: { program: string; stage: string; orgUnit: string; period: string }
): Promise<TrackerPoint[]> {
  try {
    const stages = await fetchProgramStages(engine, opts.program);
    const res = await fetchProgramCoordinatePoints(engine, {
      program: opts.program,
      orgUnit: opts.orgUnit,
      period: 'THIS_MONTH,LAST_MONTH',
      stages,
    });
    if (res) return flattenCoordinateResult(res);
  } catch (e) {
    console.warn('coordinate-analytics fetch failed; using legacy', e);
  }
  return fetchAnalyticsEventPointsLegacy(engine, opts);
}
