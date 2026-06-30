import React, { useEffect, useRef, useState } from 'react';
import { useFlexFilter, type SearchOption } from '../hooks/useFlexFilter';

/**
 * A combobox whose options are searched through an in-memory FlexSearch index
 * (see useFlexFilter). Designed for high-cardinality filters — thousands of org
 * units or users — where a plain <select> would be unusable. The index
 * refreshes on an interval so long sessions stay current.
 */
export const SearchableSelect: React.FC<{
  options: SearchOption[];
  value: string | null;
  placeholder: string;
  allLabel: string;
  onChange: (id: string | null) => void;
}> = ({ options, value, placeholder, allLabel, onChange }) => {
  const { query, setQuery, results } = useFlexFilter(options);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedLabel = value ? options.find((o) => o.id === value)?.label ?? value : allLabel;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="ssel" ref={boxRef}>
      <button className="ssel__trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'ssel__placeholder'}>{selectedLabel}</span>
        <span className="ssel__caret">▾</span>
      </button>
      {open && (
        <div className="ssel__panel">
          <input
            autoFocus
            className="ssel__input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="ssel__list">
            <li
              className={`ssel__opt ${!value ? 'is-active' : ''}`}
              onClick={() => {
                onChange(null);
                setOpen(false);
                setQuery('');
              }}
            >
              {allLabel}
            </li>
            {results.map((o) => (
              <li
                key={o.id}
                className={`ssel__opt ${value === o.id ? 'is-active' : ''}`}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>{o.label}</span>
                {o.sublabel && <small>{o.sublabel}</small>}
              </li>
            ))}
            {results.length === 0 && <li className="ssel__empty">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
