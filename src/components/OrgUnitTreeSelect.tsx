import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOrgUnitTree, type OrgTreeNode } from '../hooks/useOrgUnits';
import { useFlexFilter, type SearchOption } from '../hooks/useFlexFilter';

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
    <div className="outree" ref={boxRef}>
      <button
        className="ssel__trigger"
        onClick={() => setOpen((o) => !o)}
        disabled={isLoading}
      >
        <span className={value ? '' : 'ssel__placeholder'}>
          {isLoading ? 'Loading org units…' : selectedName}
        </span>
        <span className="ssel__caret">▾</span>
      </button>

      {open && (
        <div className="outree__panel">
          <input
            autoFocus
            className="ssel__input"
            placeholder={`Search ${flat.length.toLocaleString()} org units…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {isError && (
            <div className="outree__error">Failed to load org units: {(error as Error)?.message}</div>
          )}

          <div className="outree__body">
            <div
              className={`outree__all ${!value ? 'is-active' : ''}`}
              onClick={() => choose(null)}
            >
              All org units
            </div>

            {query.trim() ? (
              // search results (flat) while typing
              <ul className="outree__results">
                {results.map((o) => (
                  <li
                    key={o.id}
                    className={value === o.id ? 'is-active' : ''}
                    onClick={() => jumpTo(o.id)}
                  >
                    <span>{o.label}</span>
                    <small>{o.sublabel}</small>
                  </li>
                ))}
                {results.length === 0 && <li className="ssel__empty">No matches</li>}
              </ul>
            ) : (
              // hierarchy tree when not searching
              <div className="outree__tree">
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
