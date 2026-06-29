import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Settlement, TrackerPoint, FlagResult, Coord } from '../types';

/** Haversine distance in metres between two [lng,lat] coords. */
function haversine(a: Coord, b: Coord): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Flag tracker/event points against the polygons a team is actually assigned.
 *
 * `assignedIds` is the set of settlement ids the point's team should be within.
 * A point is IN-BOUNDS if it falls inside any assigned polygon. Otherwise it's
 * flagged, and we compute the nearest assigned settlement (centroid distance)
 * so the table can say *how far* off it landed — useful for triage.
 */
export function flagPoints(
  points: TrackerPoint[],
  settlements: Map<string, Settlement>,
  assignedByTeam: Map<string, Set<string>>
): FlagResult[] {
  return points.map((point) => {
    const assigned = point.teamCode ? assignedByTeam.get(point.teamCode) : undefined;
    const candidateIds = assigned ? [...assigned] : [...settlements.keys()];

    let matchedSettlementId: string | undefined;
    for (const id of candidateIds) {
      const s = settlements.get(id);
      if (!s) continue;
      if (
        booleanPointInPolygon(point.coordinate, {
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

    // Outside all assigned polygons — find nearest by centroid for context.
    let nearestSettlementId: string | undefined;
    let distanceMeters = Infinity;
    for (const id of candidateIds) {
      const s = settlements.get(id);
      if (!s) continue;
      const d = haversine(point.coordinate, s.centroid);
      if (d < distanceMeters) {
        distanceMeters = d;
        nearestSettlementId = id;
      }
    }

    return {
      point,
      inside: false,
      nearestSettlementId,
      distanceMeters: Number.isFinite(distanceMeters) ? Math.round(distanceMeters) : undefined,
    };
  });
}

/** Convenience: build the team -> assigned settlement-id set from team plans. */
export function assignedByTeamFrom(
  plans: { teamCode: string; visits: Record<string, number[]> }[]
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const p of plans) m.set(p.teamCode, new Set(Object.keys(p.visits)));
  return m;
}
