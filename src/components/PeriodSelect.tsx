import React, { useEffect, useMemo, useRef, useState } from 'react';
import { relativePeriodsByGroup } from '../lib/periods';

/**
 * Period selector matching the modern combobox look of SearchableSelect, but
 * rendering DHIS2 relative periods grouped (Daily → Yearly) with a search box.
 * Selecting a period sets the relative-period keyword used by the analytics
 * `lastUpdated` param.
 */
export const PeriodSelect: React.FC<{
  value: string | null;
  onChange: (id: string | null) => void;
}> = ({ value, onChange }) => {
  const groups = useMemo(() => relativePeriodsByGroup(), []);
  console.log("gr:",groups);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedName = useMemo(() => {
    if (!value) return 'Period';
    for (const g of groups) {
      const hit = g.periods.find((p) => p.id === value);
      if (hit) return hit.name;
    }
    return value;
  }, [value, groups]);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        group: g.group,
        periods: g.periods.filter(
          (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.periods.length > 0);
  }, [groups, query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="ssel" ref={boxRef}>
      <button className="ssel__trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'ssel__placeholder'}>{selectedName}</span>
        <span className="ssel__caret">▾</span>
      </button>
      {open && (
        <div className="ssel__panel">
          <input
            autoFocus
            className="ssel__input"
            placeholder="Search periods…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="ssel__list">
            <li
              className={`ssel__opt ${!value ? 'is-active' : ''}`}
              onClick={() => choose(null)}
            >
              Period (any)
            </li>
            {filteredGroups.map((g) => (
              <React.Fragment key={g.group}>
                <li className="ssel__grouphead">{g.group}</li>
                {g.periods.map((p) => (
                  <li
                    key={p.id}
                    className={`ssel__opt ssel__opt--indent ${value === p.id ? 'is-active' : ''}`}
                    onClick={() => choose(p.id)}
                  >
                    {p.name}
                  </li>
                ))}
              </React.Fragment>
            ))}
            {filteredGroups.length === 0 && <li className="ssel__empty">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
