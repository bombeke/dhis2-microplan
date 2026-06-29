import Supercluster from 'supercluster';
import type { TrackerPoint, FlagResult } from '../types';

/**
 * Builds a Supercluster index per logical layer (enrollments, each program
 * stage, and out-of-bounds points). Clustering happens client-side so panning
 * 100k points stays at 60fps — Supercluster returns only the clusters visible
 * in the current bbox/zoom.
 */
export interface ClusterLayer {
  key: string;
  index: Supercluster<{ point: TrackerPoint; flagged: boolean }>;
}

function toFeature(point: TrackerPoint, flagged: boolean): Supercluster.PointFeature<{
  point: TrackerPoint;
  flagged: boolean;
}> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: point.coordinate },
    properties: { point, flagged },
  };
}

export function buildClusterLayers(flags: FlagResult[]): ClusterLayer[] {
  const groups = new Map<string, FlagResult[]>();

  for (const f of flags) {
    const key = !f.inside
      ? 'flagged'
      : f.point.kind === 'enrollment'
      ? 'enrollment'
      : `stage:${f.point.programStage ?? 'unknown'}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  return [...groups.entries()].map(([key, items]) => {
    const index = new Supercluster<{ point: TrackerPoint; flagged: boolean }>({
      radius: 60,
      maxZoom: 16,
      map: (props) => ({ sum: props.point.value ?? 1 }),
      reduce: (acc, props) => {
        acc.sum += props.sum;
      },
    });
    index.load(items.map((i) => toFeature(i.point, !i.inside)));
    return { key, index };
  });
}

export function clustersFor(
  layer: ClusterLayer,
  bbox: [number, number, number, number],
  zoom: number
) {
  return layer.index.getClusters(bbox, Math.round(zoom));
}
