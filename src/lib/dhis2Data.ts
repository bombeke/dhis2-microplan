import type { TrackerPoint, Coord } from '../types';

/**
 * Pulls georeferenced points from DHIS2. Two paths:
 *  - Tracker enrollments (one point per TEI enrollment) via /tracker/events
 *    and enrollment geometry.
 *  - Program-stage events (one point per stage occurrence), grouped by stage
 *    so the map can colour clusters by stage.
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

export async function fetchEnrollmentPoints(
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

export async function fetchEventPoints(
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
export async function fetchAnalyticsEventPoints(
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
