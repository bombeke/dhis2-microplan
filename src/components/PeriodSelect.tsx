import React, { useEffect, useMemo, useRef, useState } from 'react';
import { relativePeriodsByGroup } from '../lib/periods';
import { Button, CalendarInput } from '@dhis2/ui';

/**
 * Period selector matching the modern combobox look of SearchableSelect, but
 * rendering DHIS2 relative periods grouped (Daily → Yearly) with a search box.
 * Selecting a period sets the relative-period keyword used by the analytics
 * `lastUpdated` param.
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
    if(value?.includes('_')){
      return value?.replace('_', " - ");
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
  const handleChangeStartDate =({ calendarDateString }: any)=>{
    setStartDate(calendarDateString)
  }
  const handleChangeEndDate =({ calendarDateString }: any)=>{
    setEndDate(calendarDateString)
  }


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
            <li className="ssel__daterange">
              <div className="ssel__daterow">
                <CalendarInput
                  className="ssel__dateinput"
                  dense
                  label="Start Date"
                  calendar="gregory"
                  locale="en-GB"
                  date={startDate || undefined}
                  onDateSelect={handleChangeStartDate}
                />
                <CalendarInput
                  className="ssel__dateinput"
                  dense
                  label="End Date"
                  calendar="gregory"
                  locale="en-GB"
                  date={endDate || undefined}
                  onDateSelect={handleChangeEndDate}
                />
              </div>
              <Button
                small
                primary
                className="ssel__dateapply"
                disabled={!startDate || !endDate}
                onClick={() => choose(`${startDate}_${endDate}`, 'RANGE')}
              >
                Apply
              </Button>
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
