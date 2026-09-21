import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgUnitTree, type OrgTreeNode } from '../hooks/useOrgUnits';
import { useFlexFilter, type SearchOption } from '../hooks/useFlexFilter';
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
 * Org-unit selector that lets the user pick from the FULL DHIS2 hierarchy
 * (state → … → ward, any level). The whole tree comes from the 10-min cached
 * `useOrgUnitTree` (no server refetch within the window). Two ways to choose:
 *  - expand the tree and click a node, or
 *  - type to search (FlexSearch over all units) and jump straight to a match.
 *
 * Selecting any node filters the map to that unit and everything beneath it.
 */
export const OrgUnitTreeSelect: React.FC<{
  value: string | null;
  onChange: (id: string | null) => void;
}> = ({ value, onChange }) => {
  const { tree, flat, isLoading, isError, error } = useOrgUnitTree();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // FlexSearch over the flat list (cached + periodic refresh inside the hook)
  const options: SearchOption[] = useMemo(
    () => flat.map((o) => ({ id: o.id, label: o.name, sublabel: `level ${o.level}` })),
    [flat]
  );
  const { query, setQuery, results } = useFlexFilter(options);

  const selectedName = value ? flat.find((o) => o.id === value)?.name ?? value : 'All org units';

  // expand the path to the selected node so it's visible when reopened
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!value) return;
    const node = flat.find((o) => o.id === value);
    if (!node) return;
    // path looks like /id1/id2/.../value — expand all ancestors
    const ids = node.path.split('/').filter(Boolean);
    setExpanded((prev) => new Set([...prev, ...ids]));
  }, [value, flat]);

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
  };

  // when searching, jumping to a result also expands its ancestors
  const jumpTo = (id: string) => {
    const node = flat.find((o) => o.id === id);
    if (node) setExpanded((prev) => new Set([...prev, ...node.path.split('/').filter(Boolean)]));
    choose(id);
  };

  return (
    <div className="relative w-full sm:w-auto" ref={boxRef}>
      <button
        className={selectTrigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading}
      >
        <span className={value ? selectValue : selectPlaceholder}>
          {isLoading ? 'Loading org units…' : selectedName}
        </span>
        <span className={selectCaret}>▾</span>
      </button>

      {open && (
        <div className={cn(selectPanel, 'w-[min(22rem,calc(100vw-2rem))]')}>
          <input
            autoFocus
            className={selectSearch}
            placeholder={`Search ${flat.length.toLocaleString()} org units…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {isError && (
            <div className="px-3 py-2.5 text-xs text-flag">Failed to load org units: {(error as Error)?.message}</div>
          )}

          <div className="max-h-[21rem] overflow-y-auto overscroll-contain p-1">
            <div
              className={cn(selectOption, !value && selectOptionActive)}
              onClick={() => choose(null)}
            >
              All org units
            </div>

            {query.trim() ? (
              // search results (flat) while typing
              <ul>
                {results.map((o) => (
                  <li
                    key={o.id}
                    className={cn(
                      selectOption,
                      'flex-row items-baseline justify-between gap-2',
                      value === o.id && selectOptionActive
                    )}
                    onClick={() => jumpTo(o.id)}
                  >
                    <span className="truncate">{o.label}</span>
                    <small className="shrink-0 text-[11px] text-muted">{o.sublabel}</small>
                  </li>
                ))}
                {results.length === 0 && <li className={selectEmpty}>No matches</li>}
              </ul>
            ) : (
              // hierarchy tree when not searching
              <div>
                {tree.map((n) => (
                  <OrgBranch
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

const OrgBranch: React.FC<{
  node: OrgTreeNode;
  depth: number;
  value: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onChoose: (id: string) => void;
}> = ({ node, depth, value, expanded, onToggle, onChoose }) => {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  return (
    <div style={{ paddingInlineStart: depth * 12 }}>
      <div className="flex items-center gap-0.5">
        {hasChildren ? (
          <button
            type="button"
            className="w-[18px] shrink-0 p-0.5 text-[11px] text-muted"
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
          {node.name}
          <small>L{node.level}</small>
        </button>
      </div>
      {isOpen &&
        node.children.map((c) => (
          <OrgBranch
            key={c.id}
            node={c}
            depth={depth + 1}
            value={value}
            expanded={expanded}
            onToggle={onToggle}
            onChoose={onChoose}
          />
        ))}
    </div>
  );
};
