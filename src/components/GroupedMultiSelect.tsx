import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@dhis2/ui';
import type { DimensionGroup } from '../lib/programDimensions';
import {
  cn,
  selectCaret,
  selectEmpty,
  selectPanel,
  selectPlaceholder,
  selectSearch,
  selectTrigger,
  selectValue,
} from '../lib/ui';

/**
 * Searchable multiselect that displays options in groups — bio-data attributes
 * in one group, data elements grouped by program stage. Selected ids are
 * controlled by the parent. Search matches option names across all groups.
 *
 * Nothing selected does NOT mean "nothing included": bio data and the
 * coordinate fields the map draws are always fetched. What this picker adds is
 * stage data elements, which are opt-in because a many-stage programme would
 * otherwise make every request hundreds of columns wide. The empty-state label
 * and the footnote both say so, since "All …" would be a plain lie here.
 */
export const GroupedMultiSelect: React.FC<{
  groups: DimensionGroup[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  allLabel?: string;
  loading?: boolean;
}> = ({
  groups,
  selected,
  onChange,
  placeholder = 'Search fields…',
  allLabel = 'Bio data only',
  loading,
}) => {
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
      : `+${selected.length} field${selected.length === 1 ? '' : 's'}`;

  const geoBadge = (
    <span className="rounded bg-accent/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent">
      geo
    </span>
  );

  return (
    <div className="relative w-full sm:w-auto" ref={boxRef}>
      <button
        type="button"
        className={selectTrigger}
        aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={selected.length ? selectValue : selectPlaceholder}>{triggerLabel}</span>
        <span className={selectCaret}>▾</span>
      </button>
      {open && (
        <div className={cn(selectPanel, 'w-[min(22rem,calc(100vw-2rem))]')}>
          <input
            autoFocus
            className={selectSearch}
            placeholder={`${placeholder} (${total})`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {selected.length > 0 && (
            <button
              type="button"
              className="w-full border-b border-line px-3 py-2 text-left text-xs text-accent hover:bg-panel2"
              onClick={() => onChange([])}
            >
              Clear selection ({selected.length})
            </button>
          )}
          <div className="max-h-80 overflow-y-auto overscroll-contain p-1">
            {filteredGroups.map((g) => {
              const ids = g.options.map((o) => o.id);
              const allOn = ids.every((id) => selectedSet.has(id));
              const someOn = !allOn && ids.some((id) => selectedSet.has(id));
              return (
                <div key={g.key} className="border-line [&+&]:mt-1 [&+&]:border-t [&+&]:pt-1">
                  <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-panel px-2 py-1.5">
                    <Checkbox
                      dense
                      checked={allOn}
                      indeterminate={someOn}
                      label={
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          {g.label}
                        </span>
                      }
                      onChange={() => toggleGroup(g)}
                    />
                    <span className="text-[11px] text-faint">{g.options.length}</span>
                  </div>
                  <ul className="pb-1">
                    {g.options.map((o) => (
                      <li
                        key={o.id}
                        className="flex items-center gap-2 rounded-lg py-1 pl-5 pr-2 hover:bg-panel2"
                      >
                        <span className="min-w-0 flex-1">
                          <Checkbox
                            dense
                            checked={selectedSet.has(o.id)}
                            label={<span className="text-[13px]">{o.name}</span>}
                            onChange={() => toggle(o.id)}
                          />
                        </span>
                        {o.valueType === 'COORDINATE' && geoBadge}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {filteredGroups.length === 0 && <div className={selectEmpty}>No matches</div>}
          </div>
          <p className="m-0 border-t border-line bg-panel2 px-3 pb-2.5 pt-2 text-[11px] leading-relaxed text-muted">
            Bio data and the fields marked {geoBadge} are always included. Picking a {geoBadge} field
            narrows the map to that layer.
          </p>
        </div>
      )}
    </div>
  );
};
