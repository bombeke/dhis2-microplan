import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import {
  fetchProgramDimensionGroups,
  type DimensionGroup,
  type DimensionOption,
} from '../lib/programDimensions';

/**
 * A program's tracked-entity attributes and program-stage data elements,
 * grouped for the map filter bar's multiselect: attributes in one "Bio data"
 * group, data elements grouped by their program stage.
 *
 * The fetching + grouping itself lives in `lib/programDimensions` so the
 * analytics query (which is not a React context) can reuse it verbatim — the
 * hook is just the cached, component-facing wrapper.
 */

const TEN_MIN = 10 * 60_000;

export type { DimensionGroup, DimensionOption };

export function useProgramDimensions(programId: string | null | undefined) {
  const engine = useDataEngine();
  return useQuery<DimensionGroup[]>({
    queryKey: ['program-dimensions', programId],
    enabled: !!programId,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: () => fetchProgramDimensionGroups(engine as any, programId as string),
  });
}
