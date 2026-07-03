import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { fetchProgramCoordinateDimensions } from '../lib/programCoordinates';
import { fetchEnrollmentAnalyticsTable, type AnalyticsTable } from '../lib/analyticsEnrollments';
import { usePrograms } from './usePrograms';

const TEN_MIN = 10 * 60_000;

/**
 * Lazily fetches the raw enrollment-analytics table (headers + rows) for the
 * current selection, matching the same dimensions / period / user filter used
 * for the map. `enabled` is toggled by the "View data" button so we only hit
 * analytics when the user asks for the table.
 */
export function useAnalyticsTable(
  opts: {
    program?: string;
    orgUnit: string | null;
    period?: string | null;
    userFilter?: string | null;
    selectedDimensionIds?: string[];
  },
  enabled: boolean
) {
  const engine = useDataEngine();
  const { data: programs = [] } = usePrograms();
  const stages = opts.program
    ? programs.find((p) => p.id === opts.program)?.programStages.map((s) => ({ id: s.id, name: s.name })) ?? []
    : [];
  const selectedKey = (opts.selectedDimensionIds ?? []).slice().sort().join(',');

  return useQuery<AnalyticsTable>({
    queryKey: [
      'analytics-table',
      opts.program,
      opts.orgUnit,
      opts.period ?? '',
      opts.userFilter ?? '',
      selectedKey,
      stages.length,
    ],
    enabled: enabled && !!opts.program && !!opts.orgUnit,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      let dims = await fetchProgramCoordinateDimensions(engine as any, opts.program as string, stages);
      if (opts.selectedDimensionIds && opts.selectedDimensionIds.length > 0) {
        const wanted = new Set(opts.selectedDimensionIds);
        dims = dims.filter((d) => wanted.has(d.dimensionId));
      }
      return fetchEnrollmentAnalyticsTable(engine as any, {
        program: opts.program as string,
        orgUnit: opts.orgUnit as string,
        dimensions: dims,
        period: opts.period || 'THIS_MONTH,LAST_MONTH',
        userFilter: opts.userFilter,
      });
    },
  });
}
