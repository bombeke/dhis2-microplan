import { useEffect, useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  fetchVisualizationDetail,
  fetchVisualizationPage,
  type Pager,
  type VisualizationDetail,
  type VisualizationSource,
  type VisualizationSummary,
} from '../lib/visualizations';

/**
 * Server-state hooks for the Export page.
 *
 * `/api/visualizations` and `/api/eventVisualizations` are two independent
 * resources with two independent pagers, so they are two independent queries
 * rather than one merged list: merging them would mean either downloading both
 * in full to sort and re-page client-side, or showing a pager whose page 2 is
 * a different shape from page 1. The page shows them as two groups instead,
 * which is also how the user thinks about them (aggregated vs line list).
 *
 * Both list queries keep the previous page's data while the next one loads, so
 * typing in the search box doesn't flash an empty list between keystrokes.
 */
export interface VisualizationListResult {
  items: VisualizationSummary[];
  pager: Pager;
}

export function useVisualizationList(
  source: VisualizationSource,
  search: string,
  page: number,
  pageSize = 10,
  enabled = true
) {
  const engine = useDataEngine();
  return useQuery<VisualizationListResult>({
    queryKey: ['visualization-list', source, search, page, pageSize],
    enabled,
    queryFn: ({ signal }) =>
      fetchVisualizationPage(engine as any, source, { search, page, pageSize, signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useVisualizationDetail(source: VisualizationSource | null, id: string | null) {
  const engine = useDataEngine();
  return useQuery<VisualizationDetail>({
    queryKey: ['visualization', source, id],
    enabled: !!id && !!source,
    queryFn: ({ signal }) =>
      fetchVisualizationDetail(engine as any, source as VisualizationSource, id as string, signal),
    staleTime: 5 * 60_000,
  });
}

/** Debounce a fast-changing value (search box) before it reaches the server. */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
