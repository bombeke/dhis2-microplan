import { useQuery } from '@tanstack/react-query';
import { fetchSettlementsByNameLocal } from '../lib/settlementsGeoservice';
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
  // stable signature keyed on name + ward + state, since all three now scope the query
  const signature = (weekSettlements ?? [])
    .map(
      (w) =>
        `${w.week}:${w.settlements
          .map((s) => `${s.name}~${s.ward}~${s.state}`)
          .sort()
          .join('|')}`
    )
    .join(';');

  return useQuery<WeekGeojson[]>({
    queryKey: ['settlement-geoservice', signature],
    enabled: !!weekSettlements && weekSettlements.some((w) => w.settlements.length > 0),
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      const results: WeekGeojson[] = [];
      for (const w of weekSettlements ?? []) {
        if (w.settlements.length === 0) continue;

        // group by ward/state so each request is scoped to one admin area
        const groups = new Map<string, { lga?: string; ward: string; state: string; names: string[] }>();
        for (const s of w.settlements) {
          const k = `${s.state.toLowerCase()}|${s.ward.toLowerCase()}`;
          if (!groups.has(k)) groups.set(k, {lga: s.lga, ward: s.ward, state: s.state, names: [] });
          groups.get(k)!.names.push(s.name);
        }

        const features: GeoJSON.Feature[] = [];
        for (const { ward, state, names } of groups.values()) {
          const geojson = await fetchSettlementsByNameLocal(names, { ward, state });
          for (const f of geojson.features) {
            f.properties = { ...(f.properties ?? {}), week: w.week, ward, state };
          }
          features.push(...geojson.features);
        }

        results.push({ week: w.week, geojson: { type: 'FeatureCollection', features } });
      }
      return results;
    },
  });
}
