import { useQuery } from '@tanstack/react-query';
import { fetchSettlementsByName } from '../lib/settlementsGeoservice';
import type { WeekSettlements } from './useSelectedOrgUnitLayers';

const TEN_MIN = 10 * 60_000;

export interface WeekGeojson {
  week: number;
  geojson: GeoJSON.FeatureCollection;
}

/**
 * For the week-grouped settlements (already filtered by selected user + org
 * unit upstream), search the Settlements_in_Nigeria geoservice by settlement
 * NAME and return the geojson per week, so the map can draw a fill layer with a
 * distinct colour per outreach week.
 *
 * Cached 10 min per (week → names) signature; only runs when there are names.
 */
export function useSettlementGeoservice(weekSettlements: WeekSettlements[] | undefined) {
  // stable signature of the requested names so the cache key changes only when
  // the actual settlement set changes.
  const signature = (weekSettlements ?? [])
    .map((w) => `${w.week}:${w.settlements.map((s) => s.name).sort().join('|')}`)
    .join(';');

  return useQuery<WeekGeojson[]>({
    queryKey: ['settlement-geoservice', signature],
    enabled: !!weekSettlements && weekSettlements.some((w) => w.settlements.length > 0),
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      const results: WeekGeojson[] = [];
      for (const w of weekSettlements ?? []) {
        const names = w.settlements.map((s) => s.name);
        if (names.length === 0) continue;
        const geojson = await fetchSettlementsByName(names);
        // stamp week on each feature so the map can colour by week
        for (const f of geojson.features) {
          f.properties = { ...(f.properties ?? {}), week: w.week };
        }
        results.push({ week: w.week, geojson });
      }
      return results;
    },
  });
}
