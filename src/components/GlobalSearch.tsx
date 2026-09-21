import React, { useEffect, useRef, useState } from 'react';
import { IconSearch16 } from '@dhis2/ui';
import { cn, selectEmpty, selectPanel } from '../lib/ui';

type Worker = {
  ready: boolean;
  count: number;
  search: (q: string, opts?: { limit?: number; kind?: any }) => Promise<any[]>;
};

/**
 * Type-ahead over the 260k-settlement / 50k-ward FlexSearch index. Queries are
 * debounced and run on the worker, so keystrokes never block the map.
 *
 * The results list previously had no styling at all — its class names were
 * never given rules — so matches rendered as an unstyled bullet list over the
 * map. It is now a proper dropdown, which matters more since the field moved
 * to its own full-width row on phones.
 */
export const GlobalSearch: React.FC<{ worker: Worker }> = ({ worker }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showPanel = open && q.trim().length > 0;

  return (
    <div className="relative w-full md:w-72 lg:w-96" ref={boxRef}>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-2.5 grid place-items-center text-muted"
      >
        <IconSearch16 />
      </span>
      <input
        className={
          'w-full rounded-lg border border-line bg-canvas py-2 pe-3 ps-8 text-[13px] text-ink ' +
          'outline-none placeholder:text-faint focus:border-accent/60 focus:bg-panel ' +
          'focus:ring-2 focus:ring-accent/25'
        }
        placeholder={`Search ${worker.count.toLocaleString()} settlements & wards…`}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {showPanel && (
        <div className={cn(selectPanel, 'w-full')}>
          <ul className="max-h-80 overflow-y-auto overscroll-contain p-1">
            {results.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-panel2"
              >
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide',
                    r.kind === 'ward'
                      ? 'bg-sky-100 text-sky-800'
                      : 'bg-accent/15 text-accent'
                  )}
                >
                  {r.kind}
                </span>
                <strong className="min-w-0 truncate font-semibold">{r.name}</strong>
                <small className="ms-auto shrink-0 text-[11px] text-muted">
                  {[r.ward, r.state].filter(Boolean).join(' · ')}
                </small>
              </li>
            ))}
            {results.length === 0 && (
              <li className={selectEmpty}>{worker.ready ? 'No matches' : 'Building index…'}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
