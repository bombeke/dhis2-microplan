import React, { useEffect, useState } from 'react';

type Worker = {
  ready: boolean;
  count: number;
  search: (q: string, opts?: { limit?: number; kind?: any }) => Promise<any[]>;
};

/**
 * Type-ahead over the 260k-settlement / 50k-ward FlexSearch index. Queries are
 * debounced and run on the worker, so keystrokes never block the map.
 */
export const GlobalSearch: React.FC<{ worker: Worker }> = ({ worker }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setResults(await worker.search(q, { limit: 20 }));
    }, 120);
    return () => clearTimeout(t);
  }, [q, worker]);

  return (
    <div className="search">
      <input
        className="search__input"
        placeholder={`Search ${worker.count.toLocaleString()} settlements & wards…`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {results.length > 0 && (
        <ul className="search__results">
          {results.map((r) => (
            <li key={r.id}>
              <span className={`search__kind search__kind--${r.kind}`}>{r.kind}</span>
              <strong>{r.name}</strong>
              <small>{r.ward} · {r.state}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
