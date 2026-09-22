import React from 'react';
import {
  REPORTING_CYCLES,
  periodLabel,
  periodOptions,
  type ReportingCycle,
} from '../../lib/planSchedule';
import { cn } from '../../lib/ui';

/**
 * Settings → Reporting cycle: which month the reporting year starts in.
 *
 * The Create Microplan page builds its yearly and quarterly periods from this
 * (and groups the monthly list by it), so each option previews what the
 * current year and its quarters will look like — the admin sees the effect of
 * the choice, not just its name.
 */
export const ReportingCyclePanel: React.FC<{
  value: ReportingCycle;
  onChange: (c: ReportingCycle) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const today = new Date();

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h4 className="m-0 text-[14px] font-semibold text-ink">Reporting cycle</h4>
        <p className="m-0 text-[13px] text-muted">
          The month your reporting (financial) year starts in. Create Microplan uses it for
          yearly and quarterly plans, and groups the months in the monthly list by it.
          Microplans already created keep the period they were created for.
        </p>
      </div>

      <div role="radiogroup" aria-label="Reporting cycle" className="grid gap-2.5 sm:grid-cols-2">
        {REPORTING_CYCLES.map((c) => {
          const on = value === c.value;
          const yearId = periodOptions('YEARLY', c.value, today)[0].id;
          const quarters = [1, 2, 3, 4].map((q) =>
            periodLabel(`${yearId}Q${q}`).replace(/^(Q\d).*\((.*)\)$/, '$1 · $2')
          );
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(c.value)}
              className={cn(
                'flex flex-col gap-2 rounded-xl border bg-panel p-3.5 text-left transition',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60',
                on ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-accent/50'
              )}
            >
              <span className="flex items-start gap-2.5">
                <span
                  className={cn(
                    'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                    on ? 'border-accent' : 'border-line'
                  )}
                  aria-hidden
                >
                  {on && <span className="size-2 rounded-full bg-accent" />}
                </span>
                <span className="flex flex-col">
                  <span className="text-[13.5px] font-semibold text-ink">{c.label}</span>
                  <span className="text-[12px] text-muted">{c.description}</span>
                </span>
              </span>
              <span className="ms-6.5 flex flex-col gap-0.5 text-[11.5px] text-faint">
                <span>
                  Current year: <span className="text-muted">{periodLabel(yearId)}</span>
                </span>
                <span className="flex flex-wrap gap-x-2.5">
                  {quarters.map((q) => (
                    <span key={q}>{q}</span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
