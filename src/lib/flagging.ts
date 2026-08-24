import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Settlement, TrackerPoint, FlagResult, Coord } from '../types';
import centroid from '@turf/centroid';
import bbox from '@turf/bbox';

function haversine(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Cheap bbox reject before the expensive ray-cast. */
function inBbox(c: Coord, bbox: [number, number, number, number] | GeoJSON.BBox): boolean {
  return c[0] >= bbox[0] && c[0] <= bbox[2] && c[1] >= bbox[1] && c[1] <= bbox[3];
}

export function flagPoints(
  points: TrackerPoint[],
  settlements: Map<string, Partial<Settlement>>,
  assignedByTeam: Map<string, Set<string>>,
  opts?: { strictTeams?: boolean }
): FlagResult[] {
  
  const allIds = [...settlements.keys()];
  const strict = opts?.strictTeams ?? false;

  return points.map((point) => {
    const assigned = point.teamCode ? assignedByTeam.get(point.teamCode) : undefined;

    // When strict, an unknown/absent team means NO candidates — the point is
    // out-of-bounds by definition rather than accidentally matching someone
    // else's polygon.
    const candidateIds = assigned
      ? [...assigned]
      : strict
        ? []
        : allIds;

    const coord = point.coordinate;

    let matchedSettlementId: string | undefined;
    for (const id of candidateIds) {
      const s = settlements.get(id);
      if (!s?.geometry) continue;
      if (s.bbox && !inBbox(coord, s.bbox)) continue; // fast reject
      if (
        booleanPointInPolygon(coord, {
          type: 'Feature',
          geometry: s.geometry,
          properties: {},
        })
      ) {
        matchedSettlementId = id;
        break;
      }
    }

    if (matchedSettlementId) {
      return { point, inside: true, matchedSettlementId };
    }

    // Outside all candidate polygons. Nearest-centroid over the SAME candidate
    // set when assigned; otherwise over all settlements so triage still gets a
    // distance instead of undefined.
    const nearestPool = candidateIds.length ? candidateIds : allIds;

    let nearestSettlementId: string | undefined;
    let distanceMeters = Infinity;
    for (const id of nearestPool) {
      const s = settlements.get(id);
      if (!s?.centroid) continue;
      const d = haversine(coord, s.centroid);
      if (d < distanceMeters) {
        distanceMeters = d;
        nearestSettlementId = id;
      }
    }

    return {
      point,
      inside: false,
      nearestSettlementId,
      distanceMeters: Number.isFinite(distanceMeters)
        ? Math.round(distanceMeters)
        : undefined,
    };
  });
}


export function settlementsFrom(fc: GeoJSON.FeatureCollection): Map<string,Partial<Settlement>> {
  const m = new Map<string, Partial<Settlement>>();
  for (const f of fc.features) {
    const id = String((f.properties as any)?.set_id ?? (f.properties as any)?.id ?? '');
    if (!id || !f.geometry) continue;
    m.set(id, {
      id,
      name: (f.properties as any)?.set_name,
      geometry: f.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
      centroid: centroid(f as any).geometry.coordinates as Coord,
      bbox: bbox(f as any) as [number, number, number, number],
    });
  }
  return m;
}


/** All points falling outside every polygon in the collection. */
export function pointsOutside(
  points: TrackerPoint[],
  settlements: Map<string, Partial<Settlement>>,
  assignedByTeam: Map<string, Set<string>> = new Map()
): FlagResult[] {
  return flagPoints(points, settlements, assignedByTeam).filter((r) => !r.inside);
}

export function assignedByTeamFrom(
  plans: { teamCode: string; visits: Record<string, number[]> }[]
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const p of plans) m.set(p.teamCode, new Set(Object.keys(p.visits)));
  return m;
}
