import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import FlexSearch from 'flexsearch';

/**
 * In-memory FlexSearch index over a list of {id, label} options, optimized for
 * filtering large datasets (e.g. tens of thousands of org units across many
 * uploaded microplans) without shipping every option into a giant <select>.
 *
 * The index is rebuilt:
 *  - whenever the source list changes (new uploads appear), and
 *  - on a fixed interval (default 7 minutes) so a long-lived map session keeps
 *    a fresh index even as the catalogue mutates underneath it. This satisfies
 *    the "refresh memory every 5–10 minutes" requirement and bounds staleness.
 */
export interface SearchOption {
  id: string;
  label: string;
  sublabel?: string;
}

const REFRESH_MS = 7 * 60_000; // 7 minutes (within the 5–10 min window)

export function useFlexFilter(
  options: SearchOption[],
  refreshMs: number = REFRESH_MS
) {
  // a counter we bump to force index rebuilds on the timer
  const [refreshTick, setRefreshTick] = useState(0);
  const [query, setQuery] = useState('');
  const indexRef = useRef<FlexSearch.Index | null>(null);
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);

  // (re)build the index when options change or the refresh timer fires
  useEffect(() => {
    const idx = new FlexSearch.Index({ tokenize: 'forward', cache: true });
    for (const o of options) {
      idx.add(o.id as unknown as number, `${o.label} ${o.sublabel ?? ''}`);
    }
    indexRef.current = idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, refreshTick]);

  // periodic refresh — rebuilds the in-memory index every refreshMs
  useEffect(() => {
    const t = setInterval(() => setRefreshTick((n) => n + 1), refreshMs);
    return () => clearInterval(t);
  }, [refreshMs]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return options.slice(0, 50);
    const idx = indexRef.current;
    if (!idx) return [];
    const ids = idx.search(q, { limit: 50 }) as unknown as string[];
    return ids.map((id) => byId.get(id)).filter(Boolean) as SearchOption[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options, byId, refreshTick]);

  const reset = useCallback(() => setQuery(''), []);

  return { query, setQuery, results, reset };
}
