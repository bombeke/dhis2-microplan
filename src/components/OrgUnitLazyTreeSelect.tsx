import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useOrgUnitRoots,
  useOrgUnitChildren,
  useOrgUnitSearch,
  useOrgUnitsByIds,
  type OrgUnitNode,
} from '../hooks/useOrgUnits';

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
    <div className="outree" ref={boxRef}>
      <button className="ssel__trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'ssel__placeholder'}>{selectedName}</span>
        <span className="ssel__caret">▾</span>
      </button>

      {open && (
        <div className="outree__panel">
          <input
            autoFocus
            className="ssel__input"
            placeholder="Search org units…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <div className="outree__body">
            <div
              className={`outree__all ${!value ? 'is-active' : ''}`}
              onClick={() => choose(null)}
            >
              All org units
            </div>

            {debounced.length >= 2 ? (
              <ul className="outree__results">
                {searching && <li className="ssel__empty">Searching…</li>}
                {!searching &&
                  searchHits.map((h) => (
                    <li
                      key={h.id}
                      className={value === h.id ? 'is-active' : ''}
                      onClick={() => jumpTo(h)}
                    >
                      <span>{h.name}</span>
                      <small>level {h.level}</small>
                    </li>
                  ))}
                {!searching && searchHits.length === 0 && (
                  <li className="ssel__empty">No matches</li>
                )}
              </ul>
            ) : (
              <div className="outree__tree">
                {rootsLoading && <div className="ssel__empty">Loading…</div>}
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
    <div className="outree__branch" style={{ paddingLeft: depth * 12 }}>
      <div className="outree__row">
        {hasChildren ? (
          <button className="outree__toggle" onClick={() => onToggle(node.id)}>
            {isOpen ? '▾' : '▸'}
          </button>
        ) : (
          <span className="outree__spacer" />
        )}
        <button
          className={`outree__name ${value === node.id ? 'is-selected' : ''}`}
          onClick={() => onChoose(node.id)}
        >
          {node.displayName}
          <small>L{node.level}</small>
        </button>
      </div>
      {isOpen && (
        <>
          {isFetching && <div className="outree__loading" style={{ paddingLeft: (depth + 1) * 12 }}>Loading…</div>}
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
