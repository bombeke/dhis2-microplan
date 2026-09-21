import React, { useEffect, useRef, useState } from 'react';
import {
  useOrgUnitRoots,
  useOrgUnitChildren,
  useOrgUnitSearch,
  useOrgUnitsByIds,
  type OrgUnitNode,
} from '../hooks/useOrgUnits';
import {
  cn,
  selectCaret,
  selectEmpty,
  selectOption,
  selectOptionActive,
  selectPanel,
  selectPlaceholder,
  selectSearch,
  selectTrigger,
  selectValue,
} from '../lib/ui';

/**
 * Lazy org-unit hierarchy picker.
 *
 * Performance fix: instead of downloading the whole hierarchy upfront, this
 * loads only the level-1 roots initially (fast), then fetches a node's children
 * on demand when it is expanded (each cached per parent). Searching hits the
 * server (name query) rather than a client index over the full tree, so there
 * is no upfront wait. Selecting any node filters the map to it and its
 * descendants (same downstream behaviour as before).
 *
 * The heavy whole-hierarchy hook (useOrgUnitTree) is intentionally left in place
 * for other use cases — this component simply doesn't use it.
 */
export const OrgUnitLazyTreeSelect: React.FC<{
  value: string | null;
  onChange: (id: string | null) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);

  const { data: roots = [], isLoading: rootsLoading } = useOrgUnitRoots();
  const { data: searchHits = [], isFetching: searching } = useOrgUnitSearch(debounced, open);
  // resolve the selected node's label without loading the tree
  const { data: byId = {} } = useOrgUnitsByIds(value ? [value] : []);

  const selectedName = value ? byId[value]?.name ?? '…' : 'All org units';

  // debounce the search box (250ms) so typing doesn't spam the API
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
    setDebounced('');
  };

  // when picking a search hit, expand its ancestor path so it's visible on reopen
  const jumpTo = (hit: { id: string; path: string }) => {
    const ids = hit.path.split('/').filter(Boolean);
    setExpanded((prev) => new Set([...prev, ...ids]));
    choose(hit.id);
  };

  return (
    <div className="relative w-full sm:w-auto" ref={boxRef}>
      <button
        type="button"
        className={selectTrigger}
        aria-expanded={open}
        title={selectedName}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? selectValue : selectPlaceholder}>{selectedName}</span>
        <span className={selectCaret}>▾</span>
      </button>

      {open && (
        <div className={cn(selectPanel, 'w-[min(22rem,calc(100vw-2rem))]')}>
          <input
            autoFocus
            className={selectSearch}
            placeholder="Search org units…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="max-h-[21rem] overflow-y-auto overscroll-contain p-1">
            <div
              className={cn(selectOption, !value && selectOptionActive)}
              onClick={() => choose(null)}
            >
              All org units
            </div>

            {debounced.length >= 2 ? (
              <ul>
                {searching && <li className={selectEmpty}>Searching…</li>}
                {!searching &&
                  searchHits.map((h) => (
                    <li
                      key={h.id}
                      className={cn(
                        selectOption,
                        'flex-row items-baseline justify-between gap-2',
                        value === h.id && selectOptionActive
                      )}
                      onClick={() => jumpTo(h)}
                    >
                      <span className="truncate">{h.name}</span>
                      <small className="shrink-0 text-[11px] text-muted">level {h.level}</small>
                    </li>
                  ))}
                {!searching && searchHits.length === 0 && (
                  <li className={selectEmpty}>No matches</li>
                )}
              </ul>
            ) : (
              <div>
                {rootsLoading && <div className={selectEmpty}>Loading…</div>}
                {roots.map((n) => (
                  <LazyBranch
                    key={n.id}
                    node={n}
                    depth={0}
                    value={value}
                    expanded={expanded}
                    onToggle={toggle}
                    onChoose={choose}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** A branch that fetches its own children only when expanded. */
const LazyBranch: React.FC<{
  node: OrgUnitNode;
  depth: number;
  value: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onChoose: (id: string) => void;
}> = ({ node, depth, value, expanded, onToggle, onChoose }) => {
  const isOpen = expanded.has(node.id);
  const hasChildren = !node.leaf && node.childCount !== 0;
  // only fetch children while this node is open
  const { data: children = [], isFetching } = useOrgUnitChildren(node.id, isOpen && hasChildren);

  return (
    <div style={{ paddingInlineStart: depth * 12 }}>
      <div className="flex items-center gap-0.5">
        {hasChildren ? (
          <button
            type="button"
            className="w-[18px] shrink-0 p-0.5 text-[11px] text-muted"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            onClick={() => onToggle(node.id)}
          >
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="inline-block w-[18px] shrink-0" />
        )}
        <button
          type="button"
          className={cn(
            'flex flex-1 items-baseline gap-1.5 rounded-md px-1.5 py-1 text-left text-[13px] text-ink hover:bg-panel2',
            value === node.id && 'bg-accent/15 text-accent'
          )}
          onClick={() => onChoose(node.id)}
        >
          <span className="truncate">{node.displayName}</span>
          <small className="shrink-0 text-[10px] text-faint">L{node.level}</small>
        </button>
      </div>
      {isOpen && (
        <>
          {isFetching && (
            <div
              className="py-1 text-xs italic text-muted"
              style={{ paddingInlineStart: (depth + 1) * 12 }}
            >
              Loading…
            </div>
          )}
          {children.map((c) => (
            <LazyBranch
              key={c.id}
              node={c}
              depth={depth + 1}
              value={value}
              expanded={expanded}
              onToggle={onToggle}
              onChoose={onChoose}
            />
          ))}
        </>
      )}
    </div>
  );
};
