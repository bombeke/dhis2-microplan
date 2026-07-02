import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { DimensionGroup } from '../hooks/useProgramDimensions';

/**
 * Searchable multiselect that displays options in groups — attributes in one
 * group, data elements grouped by program stage. Selected ids are controlled by
 * the parent. Search matches option names across all groups.
 */
export const GroupedMultiSelect: React.FC<{
  groups: DimensionGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  loading?: boolean;
}> = ({ groups, selected, onChange, placeholder = 'Search attributes & data elements…', allLabel = 'All attributes & data elements', loading }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, options: g.options.filter((o) => o.name.toLowerCase().includes(q)) }))
      .filter((g) => g.options.length > 0);
  }, [groups, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.options.length, 0), [groups]);

  const toggle = (id: string) => {
    const next = new Set(selectedSet);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange([...next]);
  };
  const toggleGroup = (g: DimensionGroup) => {
    const ids = g.options.map((o) => o.id);
    const allOn = ids.every((id) => selectedSet.has(id));
    const next = new Set(selectedSet);
    ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
    onChange([...next]);
  };

  const triggerLabel =
    selected.length === 0
      ? loading
        ? 'Loading…'
        : allLabel
      : `${selected.length} selected`;

  return (
    <div className="gmsel" ref={boxRef}>
      <button className="ssel__trigger" onClick={() => setOpen((o) => !o)} disabled={loading}>
        <span className={selected.length ? '' : 'ssel__placeholder'}>{triggerLabel}</span>
        <span className="ssel__caret">▾</span>
      </button>
      {open && (
        <div className="gmsel__panel">
          <input
            autoFocus
            className="ssel__input"
            placeholder={`${placeholder} (${total})`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {selected.length > 0 && (
            <button className="gmsel__clear" onClick={() => onChange([])}>
              Clear selection ({selected.length})
            </button>
          )}
          <div className="gmsel__body">
            {filteredGroups.map((g) => {
              const ids = g.options.map((o) => o.id);
              const allOn = ids.every((id) => selectedSet.has(id));
              const someOn = !allOn && ids.some((id) => selectedSet.has(id));
              return (
                <div key={g.key} className="gmsel__group">
                  <div className="gmsel__grouphead">
                    <label>
                      <input
                        type="checkbox"
                        checked={allOn}
                        ref={(el) => el && (el.indeterminate = someOn)}
                        onChange={() => toggleGroup(g)}
                      />
                      <span>{g.label}</span>
                    </label>
                    <span className="gmsel__groupcount">{g.options.length}</span>
                  </div>
                  <ul className="gmsel__list">
                    {g.options.map((o) => (
                      <li key={o.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedSet.has(o.id)}
                            onChange={() => toggle(o.id)}
                          />
                          <span className="gmsel__optname">{o.name}</span>
                          {o.valueType === 'COORDINATE' && <span className="gmsel__badge">geo</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {filteredGroups.length === 0 && <div className="ssel__empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
};
