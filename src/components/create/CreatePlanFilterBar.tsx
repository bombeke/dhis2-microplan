import React, { useMemo } from 'react';
import { ProgramSelect } from '../ProgramSelect';
import { OrgUnitLazyTreeSelect } from '../OrgUnitLazyTreeSelect';
import {
  REPORTING_CYCLES,
  periodLabel,
  periodOptions,
  type PeriodOption,
  type ReportingCycle,
  type Schedule,
} from '../../lib/planSchedule';
import { cn, selectTrigger } from '../../lib/ui';

/**
 * Filter panel for the Create Microplan page, modelled on MapFilterBar: the
 * controls read left to right as one sentence — "for this programme, in this
 * org unit, plan monthly, for August 2026" — wrap on narrow windows and stack
 * full-width on phones. Every one of the four is required, so the grid only
 * appears once the sentence is complete.
 *
 * Years and quarters come from the reporting cycle set on the Settings page;
 * the periods are grouped under the reporting year they belong to, so a
 * planner on an April–March cycle sees "FY 2026/27 · Q2" above September.
 */

const SCHEDULES: { value: Schedule; label: string }[] = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export interface CreatePlanFilters {
  programId: string | null;
  orgUnitId: string | null;
  schedule: Schedule;
  period: string | null;
}

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
    <span className="inline-flex items-center gap-1 text-[11px] tracking-[0.01em] text-muted">
      {label}
      <span className="text-flag" aria-hidden>
        *
      </span>
    </span>
    {children}
  </div>
);

export const CreatePlanFilterBar: React.FC<{
  value: CreatePlanFilters;
  onChange: (patch: Partial<CreatePlanFilters>) => void;
  onReset: () => void;
  cycle: ReportingCycle;
  disabled?: boolean;
}> = ({ value, onChange, onReset, cycle, disabled }) => {
  const periods = useMemo(() => {
    const list = periodOptions(value.schedule, cycle);
    // A plan opened from the list may be for a period no longer offered (it
    // has started, or the reporting cycle changed since). Keep it selectable
    // rather than silently switching to another plan.
    if (value.period && !list.some((p) => p.id === value.period)) {
      list.unshift({ id: value.period, label: periodLabel(value.period), group: 'Selected' });
    }
    return list;
  }, [value.schedule, value.period, cycle]);

  const groups = useMemo(() => {
    const out: { group: string; items: PeriodOption[] }[] = [];
    for (const p of periods) {
      const g = p.group ?? '';
      const last = out[out.length - 1];
      if (last && last.group === g) last.items.push(p);
      else out.push({ group: g, items: [p] });
    }
    return out;
  }, [periods]);

  const ready = value.programId && value.orgUnitId && value.period;
  const touched = !!(
    value.programId ||
    value.orgUnitId ||
    value.schedule !== 'MONTHLY' ||
    value.period !== periodOptions('MONTHLY', cycle)[0].id
  );
  const cycleLabel = REPORTING_CYCLES.find((c) => c.value === cycle);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 shadow-card sm:p-3.5">
      <fieldset
        disabled={disabled}
        className="m-0 flex min-w-0 flex-col items-stretch gap-3 border-0 p-0 sm:flex-row sm:flex-wrap sm:items-end"
      >
        <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold uppercase tracking-wider text-muted sm:self-center">
          <svg viewBox="0 0 24 24" className="size-4 fill-muted" aria-hidden>
            <path d="M3 5h18v2l-7 7v5l-4 2v-7L3 7z" />
          </svg>
          Plan for
        </span>

        <Field label="Programme">
          <ProgramSelect
            value={value.programId}
            allLabel="Choose a programme"
            onChange={(programId) => onChange({ programId })}
          />
        </Field>

        <Field label="Organisation unit">
          <OrgUnitLazyTreeSelect
            value={value.orgUnitId}
            onChange={(orgUnitId) => onChange({ orgUnitId })}
          />
        </Field>

        <span className="hidden w-px self-stretch bg-line sm:block" aria-hidden />

        <Field label="Schedule">
          <div
            role="radiogroup"
            aria-label="Schedule"
            className="inline-flex w-full rounded-lg border border-line bg-panel2 p-0.5 shadow-card sm:w-auto"
          >
            {SCHEDULES.map(({ value: s, label }) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={value.schedule === s}
                onClick={() =>
                  s !== value.schedule && onChange({ schedule: s, period: periodOptions(s, cycle)[0].id })
                }
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors sm:flex-none',
                  value.schedule === s
                    ? 'bg-panel text-ink shadow-card'
                    : 'text-muted hover:text-ink'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Period">
          <div className="relative w-full sm:w-auto">
            <select
              value={value.period ?? ''}
              onChange={(e) => onChange({ period: e.target.value || null })}
              className={cn(selectTrigger, 'appearance-none pr-8 sm:min-w-[13rem] sm:max-w-[20rem]')}
            >
              {groups.map((g) =>
                g.group ? (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  g.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))
                )
              )}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">
              ▾
            </span>
          </div>
        </Field>

        {touched && (
          <div className="self-start sm:self-end sm:pb-0.5">
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg px-3 py-2 text-[13px] font-medium text-muted hover:bg-panel2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Reset filters
            </button>
          </div>
        )}
      </fieldset>

      {value.schedule !== 'MONTHLY' && cycleLabel && (
        <p className="m-0 text-[11.5px] text-faint">
          Reporting cycle: <span className="text-muted">{cycleLabel.label}</span> (
          {cycleLabel.description}) — set by an administrator in Settings.
        </p>
      )}

      {!ready && (
        <p className="m-0 text-[12.5px] text-muted">
          Choose a <strong className="font-semibold text-ink">programme</strong> and an{' '}
          <strong className="font-semibold text-ink">organisation unit</strong> to open its microplan
          for the period. Facilities the programme is assigned to are listed with the people
          assigned to them.
        </p>
      )}
    </div>
  );
};
