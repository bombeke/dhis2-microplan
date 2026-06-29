import { useCallback, useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { SearchWorkerApi } from '../workers/search.worker';

/**
 * Spins up the search worker once and exposes type-ahead + bulk indexing.
 * The worker keeps the 260k/50k index off the main thread; this hook only
 * marshals queries and exposes index-build progress for the UI.
 */
export function useSearchWorker() {
  const apiRef = useRef<Comlink.Remote<SearchWorkerApi> | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
      type: 'module',
    });
    apiRef.current = Comlink.wrap<SearchWorkerApi>(worker);
    setReady(true);
    return () => worker.terminate();
  }, []);

  const indexDataset = useCallback(
    async (
      signature: string,
      stream: AsyncGenerator<
        { id: string; name: string; ward: string; state: string; kind: 'settlement' | 'ward' | 'facility' }[]
      >
    ) => {
      const api = apiRef.current!;
      if (await api.hydrate(signature)) {
        setCount(await api.size());
        return;
      }
      await api.clear();
      for await (const batch of stream) {
        const total = await api.addBatch(batch);
        setCount(total);
      }
      await api.persist(signature);
    },
    []
  );

  const search = useCallback(
    async (query: string, opts?: { limit?: number; kind?: 'settlement' | 'ward' | 'facility' }) => {
      if (!apiRef.current) return [];
      return apiRef.current.search(query, opts);
    },
    []
  );

  return { ready, count, indexDataset, search };
}
