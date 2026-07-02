import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Fetches organisationUnitLevels (level number + name, e.g. 3 → "LGA") so the
 * FilterMap can show levels as "Name (Level N)" instead of a bare number.
 * Cached for 10 minutes.
 */
const TEN_MIN = 10 * 60_000;

export interface OrgUnitLevel {
  level: number;
  name: string;
}

export function useOrgUnitLevels() {
  const engine = useDataEngine();
  return useQuery<OrgUnitLevel[]>({
    queryKey: ['levels'],
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        levels: {
          resource: 'organisationUnitLevels',
          params: {
            fields: 'level,displayName~rename(name)',
            order: 'level:asc',
            paging: 'false',
          },
        },
      });
      return (data.levels.organisationUnitLevels ?? []).map((l: any) => ({
        level: l.level,
        name: l.name ?? `Level ${l.level}`,
      }));
    },
  });
}
