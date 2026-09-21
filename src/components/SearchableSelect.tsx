import React, { useEffect, useRef, useState } from 'react';
import { useFlexFilter, type SearchOption } from '../hooks/useFlexFilter';
import {
  cn,
  selectCaret,
  selectEmpty,
  selectList,
  selectOption,
  selectOptionActive,
  selectPanel,
  selectPlaceholder,
  selectSearch,
  selectTrigger,
  selectValue,
} from '../lib/ui';

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
  /** when true, render options and trigger as "Label (sublabel)" inline */
  bracketSublabel?: boolean;
}> = ({ options, value, placeholder, allLabel, onChange, bracketSublabel }) => {
  const { query, setQuery, results } = useFlexFilter(options);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const fmt = (o: SearchOption) =>
    bracketSublabel && o.sublabel ? `${o.label} (${o.sublabel})` : o.label;

  const selectedOpt = value ? options.find((o) => o.id === value) : undefined;
  const selectedLabel = selectedOpt ? fmt(selectedOpt) : value ? value : allLabel;

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative w-full sm:w-auto" ref={boxRef}>
      <button
        type="button"
        className={selectTrigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={selectedLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={value ? selectValue : selectPlaceholder}>{selectedLabel}</span>
        <span className={selectCaret}>▾</span>
      </button>
      {open && (
        <div className={selectPanel}>
          <input
            autoFocus
            className={selectSearch}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className={selectList} role="listbox">
            <li
              className={cn(selectOption, !value && selectOptionActive)}
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
                className={cn(selectOption, value === o.id && selectOptionActive)}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {bracketSublabel ? (
                  <span className="truncate">{fmt(o)}</span>
                ) : (
                  <>
                    <span className="truncate">{o.label}</span>
                    {o.sublabel && <small className="truncate text-[11px] text-muted">{o.sublabel}</small>}
                  </>
                )}
              </li>
            ))}
            {results.length === 0 && <li className={selectEmpty}>No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
