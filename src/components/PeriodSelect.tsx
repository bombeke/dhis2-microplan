import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CalendarInput } from '@dhis2/ui';
import { relativePeriodsByGroup } from '../lib/periods';
import {
  cn,
  selectCaret,
  selectEmpty,
  selectGroupHead,
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
 * Period selector matching the other filter dropdowns, but rendering DHIS2
 * relative periods grouped (Daily → Yearly) with a search box. Selecting a
 * period sets the relative-period keyword used by the analytics `lastUpdated`
 * param; the date pair at the top sets an explicit range instead.
 */
export const PeriodSelect: React.FC<{
  value: string | null;
  onChange: (id: string | null, type?: string | null) => void;
}> = ({ value, onChange }) => {
  const groups = useMemo(() => relativePeriodsByGroup(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const selectedName = useMemo(() => {
    if (!value) return 'Period';
    for (const g of groups) {
      const hit = g.periods.find((p) => p.id === value);
      if (hit) return hit.name;
    }
    if (value?.includes('_')) return value.replace('_', ' – ');
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
      const target = e.target as HTMLElement;
      // CalendarInput renders its popup in a portal (@dhis2-ui/layer → document.body),
      // outside boxRef's subtree — ignore clicks there so picking a date doesn't
      // close the period panel out from under the user.
      if (target.closest?.('.layer')) return;
      if (boxRef.current && !boxRef.current.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = (id: string | null, type?: string | null) => {
    onChange(id, type);
    setOpen(false);
    setQuery('');
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
        <div className={selectPanel}>
          <input
            autoFocus
            className={selectSearch}
            placeholder="Search periods…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          {/* Custom range first: it is the one option that can't be found by
              searching, so burying it under the relative periods hides it. */}
          <div className="flex flex-col gap-2 border-b border-line px-3 pb-3 pt-2.5">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <CalendarInput
                  dense
                  label="Start date"
                  calendar="gregory"
                  locale="en-GB"
                  date={startDate || undefined}
                  onDateSelect={({ calendarDateString }: any) => setStartDate(calendarDateString)}
                />
              </div>
              <div className="min-w-0 flex-1">
                <CalendarInput
                  dense
                  label="End date"
                  calendar="gregory"
                  locale="en-GB"
                  date={endDate || undefined}
                  onDateSelect={({ calendarDateString }: any) => setEndDate(calendarDateString)}
                />
              </div>
            </div>
            <div className="self-end">
              <Button
                small
                primary
                disabled={!startDate || !endDate}
                onClick={() => choose(`${startDate}_${endDate}`, 'RANGE')}
              >
                Apply range
              </Button>
            </div>
          </div>

          <ul className={selectList}>
            <li
              className={cn(selectOption, !value && selectOptionActive)}
              onClick={() => choose(null)}
            >
              Period (any)
            </li>
            {filteredGroups.map((g) => (
              <React.Fragment key={g.group}>
                <li className={selectGroupHead}>{g.group}</li>
                {g.periods.map((p) => (
                  <li
                    key={p.id}
                    className={cn(selectOption, 'pl-4', value === p.id && selectOptionActive)}
                    onClick={() => choose(p.id)}
                  >
                    {p.name}
                  </li>
                ))}
              </React.Fragment>
            ))}
            {filteredGroups.length === 0 && <li className={selectEmpty}>No matches</li>}
          </ul>
        </div>
      )}
    </div>
  );
};
