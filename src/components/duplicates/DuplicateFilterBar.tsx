import React from 'react';
import { OrgUnitLazyTreeSelect } from '../OrgUnitLazyTreeSelect';
import { ProgramSelect } from '../ProgramSelect';
import { cn } from '../../lib/ui';

/**
 * The Manage Duplicates filter toolbar — the same shape as the map's
 * (MapFilterBar): labelled controls reading from the left edge, a clear
 * button beside them, and a line underneath restating the selection.
 *
 * Programme and organisation unit are the two decisions a scan needs; the
 * programme starts on the one configured in Settings → Duplicates. Search,
 * status, sort and paging narrow the table and live on its own toolbar.
 */

const Field: React.FC<{ label: string; hint?: string; required?: boolean; children: React.ReactNode }> = ({
  label,
  hint,
  required,
  children,
}) => (
  <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
    <span className="inline-flex items-center gap-1 text-[11px] tracking-[0.01em] text-muted">
      {label}
      {required && (
        <span className="text-flag" aria-hidden>
          *
        </span>
      )}
      {hint && (
        <span
          title={hint}
          aria-label={hint}
          className="inline-grid size-3.5 cursor-help place-items-center rounded-full bg-panel2 text-[9px] font-bold text-muted"
        >
          ?
        </span>
      )}
    </span>
    {children}
  </div>
);

const FilterIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4 fill-muted" aria-hidden>
    <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
  </svg>
);

export const DuplicateFilterBar: React.FC<{
  programId: string | null;
  onProgramChange: (id: string | null) => void;
  orgUnitId: string | null;
  onOrgUnitChange: (id: string | null) => void;
  orgUnitName?: string;
  attributeNames: string[];
  counts?: { total: number; visible: number } | null;
  captureNames: string[];
  restricted: boolean;
}> = ({
  programId,
  onProgramChange,
  orgUnitId,
  onOrgUnitChange,
  orgUnitName,
  attributeNames,
  counts,
  captureNames,
  restricted,
}) => (
  <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 shadow-card sm:p-3.5">
    <div className="flex flex-col items-stretch justify-start gap-x-3 gap-y-3 sm:flex-row sm:flex-wrap sm:items-end">
      <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold uppercase tracking-wider text-muted sm:self-center">
        <FilterIcon />
        Filter duplicates
      </span>

      <Field label="Programme" required hint="Tracked entities enrolled in this programme are compared.">
        <ProgramSelect value={programId} onChange={onProgramChange} allLabel="Choose a programme" />
      </Field>

      <Field
        label="Organisation unit"
        required
        hint="Every tracked entity registered here or anywhere below is compared."
      >
        <OrgUnitLazyTreeSelect value={orgUnitId} onChange={onOrgUnitChange} />
      </Field>

      {orgUnitId && (
        <div className="self-start sm:self-end sm:pb-0.5">
          <button
            type="button"
            onClick={() => onOrgUnitChange(null)}
            className="inline-flex items-center rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] font-medium text-ink shadow-card transition hover:border-accent/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Clear
          </button>
        </div>
      )}
    </div>

    {!orgUnitId || !programId ? (
      <p className="m-0 text-[12.5px] text-muted">
        Choose a <strong className="font-semibold text-ink">programme</strong> and an{' '}
        <strong className="font-semibold text-ink">organisation unit</strong> to list its duplicates.
        {restricted && captureNames.length > 0 && (
          <>
            {' '}
            You can work on duplicates in{' '}
            <strong className="font-semibold text-ink">{captureNames.slice(0, 3).join(', ')}</strong>
            {captureNames.length > 3 && ` and ${captureNames.length - 3} more`}.
          </>
        )}
      </p>
    ) : (
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        {orgUnitName && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 font-medium text-accent">
            {orgUnitName}
            <button type="button" aria-label="Clear organisation unit" className="opacity-70 hover:opacity-100" onClick={() => onOrgUnitChange(null)}>
              ✕
            </button>
          </span>
        )}
        {attributeNames.length > 0 && (
          <span className="rounded-full bg-panel2 px-2.5 py-0.5 text-muted" title="Configured in Settings → Duplicates">
            Matched on: {attributeNames.join(' + ')}
          </span>
        )}
        {counts && (
          <span
            className={cn(
              'rounded-full px-2.5 py-0.5',
              counts.visible < counts.total ? 'bg-amber-50 text-amber-800' : 'bg-panel2 text-muted'
            )}
          >
            {counts.visible.toLocaleString()}
            {counts.visible < counts.total && ` of ${counts.total.toLocaleString()}`} duplicates
            {counts.visible < counts.total && ' in your org units'}
          </span>
        )}
      </div>
    )}
  </div>
);
