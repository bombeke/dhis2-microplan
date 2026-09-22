import React, { useMemo, useState } from 'react';
import type { DuplicateSettings } from '../../lib/microplanSettings';
import { useOrgUnitLevels } from '../../hooks/useOrgUnitLevels';
import { useProgramMeta } from '../../hooks/useManageDuplicates';
import { ProgramSelect } from '../ProgramSelect';
import { cn } from '../../lib/ui';

/**
 * Settings → Duplicates: what makes two tracked entities duplicates, and who
 * may work on them beyond their own org units.
 *
 * The attribute list is ordered — the order is the order of the columns on
 * Manage Duplicates — and every attribute in it must match for two records to
 * count as duplicates, so fewer, more identifying attributes (a name, a date
 * of birth, a phone number) find more real duplicates than a long list.
 */

const SWITCHES: {
  key: 'allowReviewAll' | 'allowApproveAll';
  title: string;
  authority: string;
  body: string;
}[] = [
  {
    key: 'allowReviewAll',
    title: 'Allow to review all duplicates',
    authority: 'F_REVIEW_DUPLICATES_ALL_MICROPLAN',
    body: 'Holders can see duplicates and prepare merges outside their data capture org units.',
  },
  {
    key: 'allowApproveAll',
    title: 'Allow to create/approve all duplicates',
    authority: 'F_APPROVE_DUPLICATES_ALL_MICROPLAN',
    body: 'Holders can accept or reject merges outside their data capture org units (and see them).',
  },
];

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }> = ({ on, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={cn(
      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60',
      on ? 'bg-accent' : 'bg-line'
    )}
  >
    <span className={cn('inline-block size-5 rounded-full bg-white shadow-card transition', on ? 'translate-x-5.5' : 'translate-x-0.5')} />
  </button>
);

export const DuplicateSettingsPanel: React.FC<{
  value: DuplicateSettings;
  onChange: (v: DuplicateSettings) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { data: levels = [] } = useOrgUnitLevels();
  const meta = useProgramMeta(value.programId || null);
  const [q, setQ] = useState('');
  const set = <K extends keyof DuplicateSettings>(k: K, v: DuplicateSettings[K]) => onChange({ ...value, [k]: v });

  const nameOf = useMemo(() => new Map((meta.data?.attributes ?? []).map((a) => [a.id, a])), [meta.data]);
  const available = (meta.data?.attributes ?? []).filter(
    (a) => !value.attributes.includes(a.id) && a.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  const move = (i: number, d: -1 | 1) => {
    const next = [...value.attributes];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    set('attributes', next);
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Attributes for duplicate detection</h4>
          <p className="m-0 text-[13px] text-muted">
            Two tracked entities are duplicates when <strong className="text-ink">every</strong> attribute below has the same value on
            both — ignoring case, accents and extra spaces. Records with any of them empty are never matched.
          </p>
        </div>

        <label className="flex flex-col gap-1 sm:max-w-sm">
          <span className="text-[12px] font-medium text-muted">Programme</span>
          <ProgramSelect value={value.programId || null} onChange={(id) => set('programId', id ?? '')} allLabel="Choose a programme" />
          <span className="text-[11.5px] text-faint">Manage Duplicates opens on this programme, and its attributes are listed here.</span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex min-h-[12rem] flex-col overflow-hidden rounded-xl border border-line">
            <div className="border-b border-line bg-panel2/60 px-3 py-2 text-[12px] font-semibold text-ink">
              Matched on <span className="font-normal text-muted">({value.attributes.length})</span>
            </div>
            {value.attributes.length ? (
              <ol className="m-0 flex list-none flex-col divide-y divide-line/70 p-0">
                {value.attributes.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                    <span className="w-4 text-right text-[11px] tabular-nums text-faint">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={id}>
                      {nameOf.get(id)?.name ?? <span className="font-mono text-[12px] text-muted">{id}</span>}
                    </span>
                    <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} className="rounded px-1 text-muted hover:text-ink disabled:opacity-30" aria-label="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={disabled || i === value.attributes.length - 1}
                      onClick={() => move(i, 1)}
                      className="rounded px-1 text-muted hover:text-ink disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => set('attributes', value.attributes.filter((x) => x !== id))}
                      className="rounded px-1.5 text-[12px] text-rose-700 hover:bg-rose-50"
                      aria-label={`Remove ${nameOf.get(id)?.name ?? id}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="m-0 px-3 py-3 text-[12.5px] text-muted">Nothing yet — add attributes from the list.</p>
            )}
          </div>

          <div className="flex min-h-[12rem] flex-col overflow-hidden rounded-xl border border-line">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={value.programId ? 'Search attributes…' : 'Choose a programme first'}
              disabled={!value.programId}
              className="w-full border-0 border-b border-line bg-panel px-3 py-2 text-[13px] text-ink outline-none placeholder:text-faint"
            />
            <ul className="m-0 max-h-64 list-none overflow-y-auto p-1">
              {meta.isLoading && <li className="px-2.5 py-2 text-[12.5px] text-muted">Loading…</li>}
              {available.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => set('attributes', [...value.attributes, a.id])}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-panel2"
                  >
                    <span className="text-accent">+</span>
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    {a.unique && <span className="rounded bg-panel2 px-1 text-[10px] font-semibold uppercase text-muted">unique</span>}
                    {a.valueType && <span className="text-[10.5px] text-faint">{a.valueType.toLowerCase()}</span>}
                  </button>
                </li>
              ))}
              {!meta.isLoading && value.programId && !available.length && (
                <li className="px-2.5 py-2 text-[12.5px] text-muted">No more attributes.</li>
              )}
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Access beyond data capture org units</h4>
          <p className="m-0 text-[13px] text-muted">
            On Manage Duplicates everyone is limited to the duplicates in their data capture org units. A user holding one of the
            authorities below goes beyond that limit only while its switch is on — both are needed.
          </p>
        </div>
        <div className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line">
          {SWITCHES.map((s) => (
            <div key={s.key} className="flex items-start gap-4 bg-panel p-3.5">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-semibold text-ink">{s.title}</span>
                <span className="text-[12.5px] text-muted">{s.body}</span>
                <code className="mt-0.5 self-start rounded bg-panel2 px-1.5 py-0.5 text-[11px] text-muted">{s.authority}</code>
              </div>
              <Toggle on={value[s.key]} onChange={(v) => set(s.key, v)} disabled={disabled} label={s.title} />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h4 className="m-0 text-[14px] font-semibold text-ink">Storage level</h4>
          <p className="m-0 text-[13px] text-muted">
            Merge records are kept in the dataStore in one key per org unit at this level, so reviewers in different areas never
            write the same key. Changing it affects new records only.
          </p>
        </div>
        <select
          value={value.shardLevel}
          disabled={disabled}
          onChange={(e) => set('shardLevel', Number(e.target.value))}
          className="rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px] text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:max-w-xs"
        >
          {(levels.length ? levels : Array.from({ length: 6 }, (_, i) => ({ level: i + 1, name: `Level ${i + 1}` }))).map((l) => (
            <option key={l.level} value={l.level}>
              {l.name} (level {l.level})
            </option>
          ))}
        </select>
      </section>
    </div>
  );
};
