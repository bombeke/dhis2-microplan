import React, { useState } from 'react';
import { RELATIVE_PERIODS, resolvePeriod } from '../lib/periods';

/**
 * A compact, modern period selector. We use our own card rather than the
 * heavier analytics PeriodDimension widget: this renders the resolved date
 * range inline and switches instantly, which feels live during demos.
 */
export const PeriodCard: React.FC<{ value: string; onChange: (id: string) => void }> = ({
  value,
  onChange,
}) => {
  const [open, setOpen] = useState(false);
  const current = RELATIVE_PERIODS.find((p) => p.id === value) ?? RELATIVE_PERIODS[0];
  const range = resolvePeriod(value);

  return (
    <div className="period">
      <button className="period__trigger" onClick={() => setOpen((o) => !o)}>
        <span className="period__label">{current.name}</span>
        <span className="period__range">{range.start} → {range.end}</span>
      </button>
      {open && (
        <ul className="period__menu">
          {RELATIVE_PERIODS.map((p) => (
            <li
              key={p.id}
              className={p.id === value ? 'is-active' : ''}
              onClick={() => {
                onChange(p.id);
                setOpen(false);
              }}
            >
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
