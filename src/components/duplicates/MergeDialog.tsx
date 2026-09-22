import React, { useEffect, useMemo, useState } from 'react';
import { formatDhis2Date } from '../../hooks/useTrackedEntityProfile';
import { useTrackedEntitiesRaw } from '../../hooks/useManageDuplicates';
import {
  allFields,
  buildMergeModel,
  buildMergePayload,
  choiceFor,
  choicesFromResolutions,
  defaultChoice,
  generateUid,
  resolvedValue,
  sharedBy,
  type BuiltMerge,
  type Choice,
  type MergeField,
  type MergeModel,
  type ProgramMeta,
} from '../../lib/duplicateMerge';
import { importedAlready, userLabel, type DuplicateCase, type EntityRef } from '../../lib/duplicateStore';
import type { GroupView } from '../../lib/duplicateRows';
import { DupStatusPill, when } from './DuplicateTable';
import { snapshotOf } from './ProfileDialog';
import { WideDialog } from './WideDialog';
import { roleOf, toneOf } from './tones';
import { btn, textareaCls } from '../create/PlanDialog';
import { cn } from '../../lib/ui';

/**
 * The manual merge of a duplicate group, in two modes:
 *
 *  - **Prepare** (reviewers, F_REVIEW_DUPLICATES_MICROPLAN): every record of
 *    the group side by side. Choose the record to keep, **retain** any record
 *    that turns out not to be a duplicate (it is left out of the merge and
 *    never listed for review again), and resolve every value the remaining
 *    records disagree on — any record's value, or a typed correction. Events
 *    only one removed record has can be copied across. "Save for approval"
 *    stores the merged result with snapshots of every record and marks all
 *    but the kept one for deletion.
 *  - **Preview** (everyone; approvers act, F_APPROVE_DUPLICATES_MICROPLAN): the
 *    stored merge read-only — what is kept, what is removed, what was
 *    retained, every resolved value and the exact tracker payload — with
 *    Accept (save to DHIS2, then delete the others) and Reject (keep the group
 *    marked as duplicates).
 *
 * Nothing touches the tracked entities until an approver accepts.
 */

export interface PreparedMerge {
  keptId: string;
  built: BuiltMerge;
  /** the records taking part, oldest first (snapshots) */
  records: any[];
  /** group members to mark retained / to list as duplicates again */
  retain: string[];
  unretain: string[];
  copied: string[];
}

type Mode = 'prepare' | 'preview';
type Hierarchy = (path: string | undefined) => string;

/* ---- field table -------------------------------------------------------------------- */

const fmt = (v: string, valueType?: string) =>
  !v
    ? ''
    : valueType === 'DATE' || valueType === 'DATETIME'
      ? formatDhis2Date(v)
      : valueType === 'BOOLEAN' || valueType === 'TRUE_ONLY'
        ? v === 'true'
          ? 'Yes'
          : 'No'
        : v;

/** Column layout shared by the header and every row: label, one column per record, merged value. */
const gridCols = (n: number) => `minmax(8.5rem,0.9fr) repeat(${n}, minmax(0,1fr)) minmax(0,1.15fr)`;

interface Columns {
  ids: string[];
  /** index in the group (fixes colour and "Duplicate n") */
  toneIdx: number[];
  keptId: string;
}

const ValueButton: React.FC<{
  value: string;
  valueType?: string;
  picked: boolean;
  tone: number;
  disabled: boolean;
  onPick: () => void;
  label: string;
}> = ({ value, valueType, picked, tone, disabled, onPick, label }) => {
  const t = toneOf(tone);
  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-label={label}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        'flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        picked ? t.picked : 'border-line bg-panel text-ink hover:border-accent/50',
        disabled && 'cursor-default hover:border-line'
      )}
    >
      <span aria-hidden className={cn('grid size-4 shrink-0 place-items-center rounded-full border', picked ? t.dot : 'border-line bg-panel')}>
        {picked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className={cn('min-w-0 flex-1 break-words', !value && 'italic text-faint')}>{fmt(value, valueType) || 'empty'}</span>
    </button>
  );
};

const FieldRow: React.FC<{
  f: MergeField;
  cols: Columns;
  choice: Choice | undefined;
  readOnly: boolean;
  onChoose: (key: string, c: Choice) => void;
}> = ({ f, cols, choice, readOnly, onChoose }) => {
  const c = choiceFor(f, choice, cols.ids, cols.keptId);
  const result = resolvedValue(f, c, cols.ids);
  const n = cols.ids.length;
  return (
    <div
      className={cn(
        'grid gap-2 border-b border-line/70 px-3 py-2 last:border-b-0 md:items-center md:gap-3 md:[grid-template-columns:var(--cols)] sm:px-4',
        f.conflict && 'bg-amber-50/40'
      )}
      style={{ '--cols': gridCols(n) } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn('size-2 shrink-0 rounded-full', f.conflict ? 'bg-amber-500' : 'bg-emerald-500/60')}
          title={f.conflict ? 'Values differ' : 'No disagreement'}
        />
        <span className="truncate text-[12.5px] font-medium text-ink" title={f.label}>
          {f.label}
        </span>
        {f.unique && (
          <span className="rounded bg-panel2 px-1 text-[9.5px] font-bold uppercase text-muted" title="Unique attribute">
            uniq
          </span>
        )}
      </div>
      <div className={cn('grid gap-2 md:contents', n === 2 ? 'grid-cols-2' : 'grid-cols-1 min-[420px]:grid-cols-2')}>
        {cols.ids.map((id, i) => (
          <ValueButton
            key={id}
            value={f.values[i]}
            valueType={f.valueType}
            tone={cols.toneIdx[i]}
            picked={c.pick === id}
            disabled={readOnly}
            label={`${f.label}: take the value of ${roleOf(cols.toneIdx[i])}`}
            onPick={() => onChoose(f.key, { pick: id })}
          />
        ))}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {c.pick === 'CUSTOM' && !readOnly ? (
          <input
            autoFocus
            value={c.custom ?? ''}
            aria-label={`${f.label}: corrected value`}
            placeholder="Type the correct value"
            onChange={(e) => onChoose(f.key, { pick: 'CUSTOM', custom: e.target.value })}
            className="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-panel px-2.5 text-[12.5px] text-ink outline-none ring-2 ring-accent/20 placeholder:text-faint"
          />
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 break-words rounded-lg px-2.5 py-1.5 text-[12.5px]',
              c.pick === 'CUSTOM' ? 'bg-violet-50 font-semibold text-violet-900' : f.conflict ? 'bg-emerald-50 font-semibold text-emerald-900' : 'text-muted'
            )}
          >
            {fmt(result, f.valueType) || <span className="font-normal italic text-faint">cleared</span>}
          </span>
        )}
        {!readOnly && (
          <button
            type="button"
            title={c.pick === 'CUSTOM' ? 'Use one of the records’ values instead' : 'Type a correction'}
            onClick={() =>
              c.pick === 'CUSTOM'
                ? onChoose(f.key, defaultChoice(f, cols.ids, cols.keptId))
                : onChoose(f.key, { pick: 'CUSTOM', custom: result })
            }
            className={cn(
              'shrink-0 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition',
              c.pick === 'CUSTOM' ? 'border-violet-300 bg-violet-50 text-violet-800' : 'border-line text-muted hover:border-accent/60 hover:text-ink'
            )}
          >
            {c.pick === 'CUSTOM' ? 'Reset' : 'Edit'}
          </button>
        )}
      </div>
    </div>
  );
};

const FieldTable: React.FC<{
  title: React.ReactNode;
  fields: MergeField[];
  cols: Columns;
  choices: Record<string, Choice>;
  readOnly: boolean;
  onlyDiff: boolean;
  onChoose: (key: string, c: Choice) => void;
}> = ({ title, fields, cols, choices, readOnly, onlyDiff, onChoose }) => {
  const shown = onlyDiff ? fields.filter((f) => f.conflict || choices[f.key]?.pick === 'CUSTOM') : fields;
  const conflicts = fields.filter((f) => f.conflict).length;
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel2/60 px-3 py-2 sm:px-4">
        <h4 className="m-0 flex-1 text-[13px] font-semibold text-ink">{title}</h4>
        <span className="text-[11.5px] text-muted">
          {fields.length} field{fields.length === 1 ? '' : 's'}
          {conflicts > 0 && (
            <>
              {' · '}
              <strong className="text-amber-800">{conflicts} differ</strong>
            </>
          )}
        </span>
      </div>
      <div
        className="hidden gap-3 border-b border-line px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-faint md:grid md:[grid-template-columns:var(--cols)]"
        style={{ '--cols': gridCols(cols.ids.length) } as React.CSSProperties}
      >
        <span>Field</span>
        {cols.ids.map((id, i) => (
          <span key={id} className={cn('truncate', toneOf(cols.toneIdx[i]).text)}>
            {roleOf(cols.toneIdx[i])}
            {id === cols.keptId && ' · kept'}
          </span>
        ))}
        <span>Merged value</span>
      </div>
      {shown.length ? (
        shown.map((f) => <FieldRow key={f.key} f={f} cols={cols} choice={choices[f.key]} readOnly={readOnly} onChoose={onChoose} />)
      ) : (
        <p className="m-0 px-4 py-3 text-[12.5px] text-muted">{onlyDiff ? 'No differences — every value matches.' : 'Nothing to merge.'}</p>
      )}
    </section>
  );
};

/* ---- record card ------------------------------------------------------------------------ */

const RecordCard: React.FC<{
  toneIdx: number;
  ref_: EntityRef;
  te: any;
  state: 'kept' | 'removed' | 'retained' | 'deleted';
  hierarchy: Hierarchy;
  children?: React.ReactNode;
}> = ({ toneIdx, ref_, te, state, hierarchy, children }) => {
  const enr = te?.enrollments?.[0];
  const badge = {
    kept: ['Kept', 'bg-emerald-600 text-white ring-emerald-600'],
    removed: ['Marked for delete', 'bg-rose-50 text-rose-700 ring-rose-200'],
    retained: ['Retained · not a duplicate', 'bg-slate-100 text-slate-700 ring-slate-300'],
    deleted: ['Deleted', 'bg-rose-600 text-white ring-rose-600'],
  }[state];
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 transition',
        state === 'kept' && 'border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200',
        (state === 'removed' || state === 'deleted') && 'border-rose-200 bg-rose-50/40',
        state === 'retained' && 'border-dashed border-slate-300 bg-panel2/60'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-[11px] font-bold uppercase tracking-wider', toneOf(toneIdx).text)}>{roleOf(toneIdx)}</span>
        <span className={cn('ms-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset', badge[1])}>{badge[0]}</span>
      </div>
      <span className="font-mono text-[12px] text-ink">{ref_.id}</span>
      <span className="text-[11.5px] leading-snug text-muted" title={hierarchy(ref_.orgUnitPath)}>
        <span className="text-ink">{ref_.orgUnitName ?? enr?.orgUnitName ?? ref_.orgUnit}</span>
        {ref_.orgUnitPath && <span className="block truncate text-[11px] text-faint">{hierarchy(ref_.orgUnitPath)}</span>}
      </span>
      <span className="text-[11.5px] leading-snug text-muted">
        Registered {when(te?.createdAt ?? ref_.createdAt)} by {userLabel(te?.createdBy) ?? ref_.createdBy ?? 'unknown user'}
        <br />
        Updated {when(te?.updatedAt ?? ref_.updatedAt)} by {userLabel(te?.updatedBy) ?? ref_.updatedBy ?? 'unknown user'}
      </span>
      {children}
    </div>
  );
};

/* ---- the dialog --------------------------------------------------------------------------- */

export const MergeDialog: React.FC<{
  group: GroupView;
  /** the merge to show: the row's own (e.g. an accepted one, for audit) or the group's open one */
  current?: DuplicateCase;
  meta: ProgramMeta;
  hierarchy: Hierarchy;
  canPrepare: boolean;
  canDecide: boolean;
  busy: string | null;
  onClose: () => void;
  onPrepare: (p: PreparedMerge) => Promise<DuplicateCase | null>;
  /** nothing left to merge — only save who is retained */
  onRetainOnly: (retain: string[], unretain: string[]) => Promise<boolean>;
  onAccept: (c: DuplicateCase, note: string) => void;
  onReject: (c: DuplicateCase, note: string) => void;
  /** why the user can only look, when that is the case */
  notice?: string;
}> = ({ group, current: initial, meta, hierarchy, canPrepare, canDecide, busy, onClose, onPrepare, onRetainOnly, onAccept, onReject, notice }) => {
  const startPrepare = canPrepare && (!initial || initial.status === 'FLAGGED');
  const [mode, setMode] = useState<Mode>(startPrepare ? 'prepare' : 'preview');
  const [current, setCurrent] = useState<DuplicateCase | undefined>(initial);
  useEffect(() => setCurrent(initial), [initial]);

  const title = group.original.values.filter(Boolean).slice(0, 3).join(' · ') || group.original.id;

  return (
    <WideDialog
      label="Merge duplicates"
      title={title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          {current && <DupStatusPill status={current.status} />}
          <span>
            {mode === 'prepare'
              ? `${group.members.length - group.deleted.size} records match. Keep one, retain any that are not duplicates, and merge the rest into it.`
              : 'Review the prepared merge.'}
          </span>
        </span>
      }
      onClose={onClose}
    >
      {notice && (
        <p className="m-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12.5px] text-amber-900 sm:px-5">{notice}</p>
      )}
      {mode === 'prepare' ? (
        <PrepareView
          group={group}
          meta={meta}
          hierarchy={hierarchy}
          stored={current?.status !== 'MERGED' ? current : undefined}
          busy={busy}
          onCancel={() => (current?.status === 'PENDING' ? setMode('preview') : onClose())}
          onSave={async (p) => {
            const saved = await onPrepare(p);
            if (saved) {
              setCurrent(saved);
              setMode('preview');
            }
          }}
          onRetainOnly={async (retain, unretain) => {
            if (await onRetainOnly(retain, unretain)) onClose();
          }}
        />
      ) : current ? (
        <PreviewView
          c={current}
          group={group}
          meta={meta}
          hierarchy={hierarchy}
          canDecide={canDecide && current.status === 'PENDING'}
          canEdit={canPrepare && current.status !== 'MERGED' && !importedAlready(current)}
          busy={busy}
          onEdit={() => setMode('prepare')}
          onClose={onClose}
          onAccept={(note) => onAccept(current, note)}
          onReject={(note) => onReject(current, note)}
        />
      ) : (
        <p className="m-0 p-6 text-[13px] text-muted">No merge has been prepared for this group yet.</p>
      )}
    </WideDialog>
  );
};

/* ---- prepare ---------------------------------------------------------------------------------- */

const PrepareView: React.FC<{
  group: GroupView;
  meta: ProgramMeta;
  hierarchy: Hierarchy;
  stored?: DuplicateCase;
  busy: string | null;
  onCancel: () => void;
  onSave: (p: PreparedMerge) => void;
  onRetainOnly: (retain: string[], unretain: string[]) => void;
}> = ({ group, meta, hierarchy, stored, busy, onCancel, onSave, onRetainOnly }) => {
  // every member that still exists, oldest first
  const candidates = useMemo(() => group.members.filter((m) => !group.deleted.has(m.id)), [group]);
  const toneOfId = useMemo(() => new Map(group.members.map((m, i) => [m.id, i])), [group]);

  const [retained, setRetained] = useState<Set<string>>(() => new Set(candidates.filter((m) => group.retained.has(m.id)).map((m) => m.id)));
  const participants = candidates.filter((m) => !retained.has(m.id));
  const [keptPref, setKeptPref] = useState<string>(stored?.keptId ?? participants[0]?.id ?? '');
  const keptId = participants.some((m) => m.id === keptPref) ? keptPref : participants[0]?.id ?? '';

  const [choices, setChoices] = useState<Record<string, Choice>>(() => (stored ? choicesFromResolutions(stored.resolutions) : {}));
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [include, setInclude] = useState<Set<string> | null>(stored?.copied ? new Set(stored.copied) : null);
  // ids for created events / a created enrollment stay fixed while the dialog is open
  const [uids] = useState(() => new Map<string, string>());
  const idFor = (k: string) => {
    if (!uids.has(k)) uids.set(k, generateUid());
    return uids.get(k)!;
  };

  const qs = useTrackedEntitiesRaw(candidates.map((m) => m.id));
  const teOf = new Map(candidates.map((m, i) => [m.id, qs[i]?.data]));
  const loading = qs.some((q) => q.isLoading);
  const missing = candidates.filter((m, i) => !qs[i]?.isLoading && !qs[i]?.data);

  const records = participants.map((m) => teOf.get(m.id)).filter(Boolean);
  const recordsKey = records.map((r: any) => `${r.trackedEntity}@${r.updatedAt}`).join('|');
  const model: MergeModel | null = useMemo(
    () => (records.length >= 2 && records.length === participants.length ? buildMergeModel(records, meta) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recordsKey, meta]
  );

  // visits only one removed record has: copied by default
  const copyable = useMemo(
    () => (model ? model.visits.filter((v) => sharedBy(v) === 1 && model.ids[v.events.findIndex(Boolean)] !== keptId) : []),
    [model, keptId]
  );
  const included = useMemo(() => include ?? new Set(copyable.map((v) => v.key)), [include, copyable]);

  const built = useMemo(
    () => (model ? buildMergePayload(model, meta, keptId, choices, included, idFor) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, meta, keptId, choices, included]
  );

  const choose = (key: string, c: Choice) => setChoices((m) => ({ ...m, [key]: c }));
  const allTo = (which: 'oldest' | 'newest' | 'kept') => {
    if (!model) return;
    setChoices((m) => {
      const next = { ...m };
      for (const f of allFields(model)) {
        if (!f.conflict) continue;
        const order = model.ids.map((_, i) => i);
        if (which === 'newest') order.reverse();
        if (which === 'kept') {
          next[f.key] = { pick: keptId };
          continue;
        }
        const i = order.find((j) => f.values[j].trim());
        if (i !== undefined) next[f.key] = { pick: model.ids[i] };
      }
      return next;
    });
  };
  const toggleRetain = (id: string) =>
    setRetained((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const retain = [...retained].filter((id) => !group.retained.has(id));
  const unretain = candidates.filter((m) => group.retained.has(m.id) && !retained.has(m.id)).map((m) => m.id);

  const cards = (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
      {candidates.map((m) => {
        const isRetained = retained.has(m.id);
        const isKept = m.id === keptId;
        return (
          <RecordCard
            key={m.id}
            toneIdx={toneOfId.get(m.id) ?? 0}
            ref_={m}
            te={teOf.get(m.id)}
            state={isRetained ? 'retained' : isKept ? 'kept' : 'removed'}
            hierarchy={hierarchy}
          >
            <div className="mt-1 flex flex-wrap gap-1.5">
              {!isRetained && (
                <button
                  type="button"
                  aria-pressed={isKept}
                  disabled={isKept}
                  onClick={() => {
                    setKeptPref(m.id);
                    setInclude(null);
                  }}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11.5px] font-semibold transition',
                    isKept ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line bg-panel text-ink hover:border-emerald-500'
                  )}
                >
                  {isKept ? '✓ Keep this record' : 'Keep this record'}
                </button>
              )}
              <button
                type="button"
                aria-pressed={isRetained}
                onClick={() => {
                  toggleRetain(m.id);
                  setInclude(null);
                }}
                title={isRetained ? 'List it as a duplicate again' : 'Not a duplicate: leave it out of the merge and stop listing it for review'}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11.5px] font-semibold transition',
                  isRetained ? 'border-slate-500 bg-slate-600 text-white' : 'border-line bg-panel text-slate-700 hover:border-slate-400'
                )}
              >
                {isRetained ? 'Retained · undo' : 'Retain — not a duplicate'}
              </button>
            </div>
          </RecordCard>
        );
      })}
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-5" aria-busy>
        <p className="m-0 text-[12.5px] text-muted">Loading {candidates.length} records…</p>
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-panel2" />
        ))}
      </div>
    );
  }

  const blocked = missing.filter((m) => !retained.has(m.id));
  const footer = (primary: React.ReactNode, text: React.ReactNode) => (
    <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:px-5">
      <p className="m-0 flex-1 text-[12px] text-muted">{text}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button type="button" className={btn.ghost} onClick={onCancel} disabled={!!busy}>
          Cancel
        </button>
        {primary}
      </div>
    </div>
  );

  // nothing (or no longer anything) to merge: only the retained marks change
  if (participants.length < 2 || blocked.length) {
    return (
      <div className="flex min-h-full flex-col">
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          {cards}
          {blocked.length > 0 ? (
            <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-800 ring-1 ring-inset ring-rose-200">
              {blocked.map((m) => m.id).join(', ')} could not be loaded — deleted, or outside your search scope. Retain it to leave it out,
              or rescan.
            </p>
          ) : (
            <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-800 ring-1 ring-inset ring-slate-200">
              {participants.length === 1
                ? 'Only one record is left once the retained ones are set aside, so there is nothing to merge.'
                : 'Every record is retained, so there is nothing to merge.'}{' '}
              Saving marks the retained records so later scans show them as retained instead of listing them for review.
            </p>
          )}
        </div>
        {footer(
          <button
            type="button"
            className={btn.primary}
            disabled={!!busy || (!retain.length && !unretain.length)}
            onClick={() => onRetainOnly(retain, unretain)}
          >
            {busy === 'retain' ? 'Saving…' : 'Save retained'}
          </button>,
          `${retain.length} to retain · ${unretain.length} to list again`
        )}
      </div>
    );
  }
  if (!model || !built) return null;

  const cols: Columns = { ids: model.ids, toneIdx: model.ids.map((id) => toneOfId.get(id) ?? 0), keptId };
  const fields = allFields(model);
  const conflicts = fields.filter((f) => f.conflict).length;
  const k = model.ids.indexOf(keptId);
  const uniqueTaken = model.attributes.filter((f) => {
    if (!f.unique || !f.conflict) return false;
    const c = choiceFor(f, choices[f.key], model.ids, keptId);
    return c.pick !== 'CUSTOM' && c.pick !== keptId;
  });
  const shared = model.visits.filter((v) => sharedBy(v) >= 2);
  const singles = model.visits.filter((v) => sharedBy(v) === 1);
  const removedCount = model.ids.length - 1;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {cards}

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel2/50 px-3 py-2">
          <span className="text-[12.5px] text-ink">
            <strong className="tabular-nums">{conflicts}</strong> value{conflicts === 1 ? '' : 's'} differ
          </span>
          <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
          <span className="text-[12px] text-muted">Set all differences to</span>
          {(
            [
              ['oldest', 'First (oldest)'],
              ['newest', 'Last (newest)'],
              ['kept', 'Kept record'],
            ] as const
          ).map(([w, label]) => (
            <button
              key={w}
              type="button"
              className="rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] font-semibold text-ink hover:border-accent/60"
              onClick={() => allTo(w)}
            >
              {label}
            </button>
          ))}
          <label className="ms-auto inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-ink">
            <input type="checkbox" className="size-4 accent-accent" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
            Only differences
          </label>
        </div>

        <FieldTable title="Bio data" fields={model.attributes} cols={cols} choices={choices} readOnly={false} onlyDiff={onlyDiff} onChoose={choose} />
        {model.enrollmentFields.length > 0 && (
          <FieldTable title="Enrollment" fields={model.enrollmentFields} cols={cols} choices={choices} readOnly={false} onlyDiff={onlyDiff} onChoose={choose} />
        )}
        {shared.map((v) => (
          <FieldTable
            key={v.key}
            title={
              <span className="flex flex-wrap items-center gap-x-2">
                {v.stageName}
                <span className="text-[11.5px] font-normal text-muted">
                  shared visit · {formatDhis2Date(v.date) || 'no date'} · {sharedBy(v)} records
                  {!v.events[k] && ' · created on the kept record'}
                </span>
              </span>
            }
            fields={v.fields}
            cols={cols}
            choices={choices}
            readOnly={false}
            onlyDiff={onlyDiff}
            onChoose={choose}
          />
        ))}

        {singles.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-card">
            <div className="border-b border-line bg-panel2/60 px-3 py-2 sm:px-4">
              <h4 className="m-0 text-[13px] font-semibold text-ink">Visits only one record has</h4>
              <p className="m-0 text-[11.5px] text-muted">
                Ticked visits of the records being removed are copied onto the kept record. The kept record’s own visits stay as they are.
              </p>
            </div>
            <ul className="m-0 list-none divide-y divide-line/70 p-0">
              {singles.map((v) => {
                const owner = v.events.findIndex(Boolean);
                const ownerId = model.ids[owner];
                const ev = v.events[owner];
                const stays = ownerId === keptId;
                return (
                  <li key={v.key} className={cn('flex items-start gap-3 px-3 py-2 sm:px-4', stays && 'opacity-80')}>
                    {stays ? (
                      <span className="mt-0.5 grid size-4 place-items-center text-[11px] text-emerald-600" aria-hidden>
                        ✓
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-accent"
                        aria-label={`Copy ${v.stageName} visit`}
                        checked={included.has(v.key)}
                        onChange={(e) => {
                          const next = new Set(included);
                          if (e.target.checked) next.add(v.key);
                          else next.delete(v.key);
                          setInclude(next);
                        }}
                      />
                    )}
                    <EventLine ev={ev} stageName={v.stageName} meta={meta} toneIdx={toneOfId.get(ownerId) ?? 0} stays={stays} />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <Warnings
          otherPrograms={built.summary.otherPrograms}
          uniqueTaken={uniqueTaken.map((f) => f.label)}
          noEnrollment={!model.enrollments.some(Boolean)}
        />
      </div>

      {footer(
        <button type="button" className={btn.primary} disabled={!!busy} onClick={() => onSave({ keptId, built, records, retain, unretain, copied: [...included] })}>
          {busy === 'prepare' ? 'Saving…' : `Merge ${removedCount + 1} into 1 & save for approval`}
        </button>,
        <>
          Keeps <span className="font-mono text-ink">{keptId}</span> ·{' '}
          <span className="font-semibold text-rose-700">
            marks {removedCount} record{removedCount === 1 ? '' : 's'} for deletion
          </span>
          {retained.size > 0 && ` · ${retained.size} retained`} · {built.summary.eventsCopied} visit(s) copied, {built.summary.eventsMerged} merged
        </>
      )}
    </div>
  );
};

const EventLine: React.FC<{ ev: any; stageName: string; meta: ProgramMeta; toneIdx: number; stays: boolean }> = ({ ev, stageName, meta, toneIdx, stays }) => {
  const stage = meta.stages.find((s) => s.id === ev.programStage);
  const dvs = (ev.dataValues ?? []).filter((d: any) => d.value !== '' && d.value != null);
  const names = new Map((stage?.dataElements ?? []).map((d) => [d.id, d.name]));
  const text = dvs.map((d: any) => `${names.get(d.dataElement) ?? d.dataElement}: ${d.value}`);
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] font-medium text-ink">
        {stageName}
        <span className="text-[11.5px] font-normal text-muted">{formatDhis2Date(ev.occurredAt ?? ev.scheduledAt) || 'no date'}</span>
        <span className={cn('rounded bg-panel2 px-1.5 py-px text-[10px] font-bold uppercase', toneOf(toneIdx).text)}>{roleOf(toneIdx)}</span>
        {stays && <span className="text-[10.5px] text-emerald-700">stays on the kept record</span>}
      </span>
      <span className="truncate text-[11.5px] text-muted" title={text.join(' · ')}>
        {text.length ? text.slice(0, 4).join(' · ') + (text.length > 4 ? ` · +${text.length - 4}` : '') : 'No values'}
      </span>
    </div>
  );
};

const Warnings: React.FC<{ otherPrograms: number; uniqueTaken: string[]; noEnrollment: boolean }> = ({ otherPrograms, uniqueTaken, noEnrollment }) => {
  const box = 'rounded-lg px-3 py-2 text-[12.5px] ring-1 ring-inset';
  const items: React.ReactNode[] = [];
  if (otherPrograms > 0)
    items.push(
      <div key="p" className={cn(box, 'bg-rose-50 text-rose-800 ring-rose-200')}>
        The records being removed have <strong>{otherPrograms}</strong> enrollment(s) in other programmes. Those enrollments are deleted
        with them — merge them in their own programme first if they matter.
      </div>
    );
  if (uniqueTaken.length)
    items.push(
      <div key="u" className={cn(box, 'bg-amber-50 text-amber-900 ring-amber-200')}>
        {uniqueTaken.join(', ')} {uniqueTaken.length === 1 ? 'is a unique attribute' : 'are unique attributes'} taken from a record being
        removed. DHIS2 may refuse the save while that record still holds the value — if accepting fails, keep that record instead or
        correct the value.
      </div>
    );
  if (noEnrollment)
    items.push(
      <div key="e" className={cn(box, 'bg-sky-50 text-sky-900 ring-sky-200')}>
        None of the records is enrolled in this programme, so only bio data is merged.
      </div>
    );
  items.push(
    <p key="r" className="m-0 text-[11.5px] text-faint">
      Relationships and enrollments in other programmes are not moved. Nothing changes in DHIS2 until an approver accepts the merge.
    </p>
  );
  return <div className="flex flex-col gap-2">{items}</div>;
};

/* ---- preview ------------------------------------------------------------------------------------ */

const PreviewView: React.FC<{
  c: DuplicateCase;
  group: GroupView;
  meta: ProgramMeta;
  hierarchy: Hierarchy;
  canDecide: boolean;
  canEdit: boolean;
  busy: string | null;
  onEdit: () => void;
  onClose: () => void;
  onAccept: (note: string) => void;
  onReject: (note: string) => void;
}> = ({ c, group, meta, hierarchy, canDecide, canEdit, busy, onEdit, onClose, onAccept, onReject }) => {
  const [note, setNote] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const merging = useMemo(() => c.members.filter((m) => m.id === c.keptId || c.removedIds.includes(m.id)), [c]);
  const toneOfId = useMemo(() => new Map(group.members.map((m, i) => [m.id, i])), [group]);
  const model = useMemo(() => {
    const recs = merging.map((m) => c.snapshots?.[m.id]).filter(Boolean);
    return recs.length === merging.length && recs.length >= 2 ? buildMergeModel(recs, meta) : null;
  }, [c, merging, meta]);
  const choices = useMemo(() => choicesFromResolutions(c.resolutions), [c]);

  // has any record changed in DHIS2 since the merge was prepared, or been retained since?
  const live = useTrackedEntitiesRaw(c.status === 'PENDING' ? merging.map((m) => m.id) : []);
  const imported = importedAlready(c);
  const changed =
    c.status === 'PENDING' &&
    !imported &&
    merging.some((m, i) => live[i]?.data === null || (live[i]?.data && live[i].data.updatedAt !== c.snapshots?.[m.id]?.updatedAt));
  const nowRetained = c.status === 'PENDING' ? merging.filter((m) => group.retained.has(m.id)) : [];
  const stale = changed || nowRetained.length > 0;

  const s = c.summary;
  const stat = (label: string, n: React.ReactNode, cls = 'bg-panel2 text-ink ring-line') => (
    <div className={cn('rounded-xl px-3 py-2 ring-1 ring-inset', cls)}>
      <div className="text-[18px] font-semibold tabular-nums">{n}</div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
    </div>
  );
  const cols: Columns | null = model ? { ids: model.ids, toneIdx: model.ids.map((id) => toneOfId.get(id) ?? 0), keptId: c.keptId } : null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {c.members.map((m) => {
            const state =
              m.id === c.keptId
                ? 'kept'
                : c.retainedIds.includes(m.id) || group.retained.has(m.id)
                  ? 'retained'
                  : c.removedIds.includes(m.id)
                    ? c.deletedIds.includes(m.id)
                      ? 'deleted'
                      : 'removed'
                    : null;
            if (!state) return null;
            return (
              <RecordCard
                key={m.id}
                toneIdx={toneOfId.get(m.id) ?? 0}
                ref_={m}
                te={c.snapshots?.[m.id] ?? snapshotOf(group, m.id)}
                state={state}
                hierarchy={hierarchy}
              />
            );
          })}
        </div>

        {s && (
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            {stat('Values resolved', s.conflicts, 'bg-amber-50 text-amber-900 ring-amber-200')}
            {stat('Records removed', c.removedIds.length, 'bg-rose-50 text-rose-900 ring-rose-200')}
            {stat('Visits merged', s.eventsMerged)}
            {stat('Visits copied', s.eventsCopied)}
          </div>
        )}

        {c.error && (
          <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 ring-1 ring-inset ring-rose-200">
            <strong>Last attempt failed:</strong> {c.error}
          </p>
        )}
        {stale && (
          <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
            {nowRetained.length
              ? `${nowRetained.map((m) => m.id).join(', ')} has been retained since this merge was prepared.`
              : 'One of the records has changed in DHIS2 (or no longer exists) since this merge was prepared.'}{' '}
            Edit the merge to prepare it again from the current data before accepting.
          </p>
        )}

        {model && cols && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-1.5 self-end text-[12px] text-ink">
              <input type="checkbox" className="size-4 accent-accent" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
              Only differences
            </label>
            <FieldTable title="Bio data" fields={model.attributes} cols={cols} choices={choices} readOnly onlyDiff={onlyDiff} onChoose={() => {}} />
            {model.enrollmentFields.length > 0 && (
              <FieldTable title="Enrollment" fields={model.enrollmentFields} cols={cols} choices={choices} readOnly onlyDiff={onlyDiff} onChoose={() => {}} />
            )}
            {model.visits
              .filter((v) => sharedBy(v) >= 2)
              .map((v) => (
                <FieldTable
                  key={v.key}
                  title={`${v.stageName} · shared visit · ${formatDhis2Date(v.date) || 'no date'}`}
                  fields={v.fields}
                  cols={cols}
                  choices={choices}
                  readOnly
                  onlyDiff={onlyDiff}
                  onChoose={() => {}}
                />
              ))}
          </>
        )}

        <details className="group rounded-xl border border-line bg-panel">
          <summary className="cursor-pointer select-none px-4 py-2.5 text-[12.5px] font-semibold text-ink marker:text-muted">
            Tracker payload <span className="font-normal text-muted">— POST /api/tracker?async=false&amp;importStrategy=CREATE_AND_UPDATE</span>
          </summary>
          <pre className="m-0 max-h-80 overflow-auto border-t border-line bg-panel2/60 px-4 py-3 font-mono text-[11px] leading-relaxed text-ink">
            {JSON.stringify(c.payload, null, 2)}
          </pre>
        </details>

        <History c={c} />

        {canDecide && (
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Note (optional — saved with your decision)</span>
            <textarea rows={2} className={textareaCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </div>

      <div className="sticky bottom-0 mt-auto flex flex-col-reverse gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:px-5">
        <button type="button" className={btn.ghost} onClick={onClose} disabled={!!busy}>
          Close
        </button>
        {canEdit && (
          <button type="button" className={btn.secondary} onClick={onEdit} disabled={!!busy}>
            {c.status === 'FLAGGED' ? 'Prepare a new merge' : 'Edit merge'}
          </button>
        )}
        {canDecide && (
          <>
            <button type="button" className={btn.warn} disabled={!!busy} onClick={() => onReject(note.trim())}>
              {busy === 'reject' ? 'Rejecting…' : 'Reject · keep as duplicates'}
            </button>
            <button type="button" className={btn.success} disabled={!!busy || stale} onClick={() => onAccept(note.trim())}>
              {busy === 'accept' ? 'Merging…' : 'Accept & merge'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const ACTION_LABEL: Record<string, string> = {
  PREPARED: 'Prepared the merge',
  EDITED: 'Edited the merge',
  ACCEPTED: 'Accepted — saved to DHIS2',
  REJECTED: 'Rejected — kept as duplicates',
  IMPORT_FAILED: 'Save to DHIS2 failed',
  DELETE_FAILED: 'Deleting a record failed',
  DELETED: 'Deleted the merged records',
  INVALIDATED: 'Merge set aside',
};

const History: React.FC<{ c: DuplicateCase }> = ({ c }) =>
  c.history.length ? (
    <section className="rounded-xl border border-line bg-panel px-4 py-3">
      <h4 className="m-0 mb-2 text-[12.5px] font-semibold text-ink">History</h4>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {[...c.history].reverse().map((h, i) => (
          <li key={i} className="flex gap-2.5 text-[12px]">
            <span
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                h.action.includes('FAILED')
                  ? 'bg-rose-500'
                  : h.action === 'REJECTED' || h.action === 'INVALIDATED'
                    ? 'bg-amber-500'
                    : h.action === 'ACCEPTED' || h.action === 'DELETED'
                      ? 'bg-emerald-500'
                      : 'bg-sky-500'
              )}
              aria-hidden
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-ink">
                <strong className="font-semibold">{ACTION_LABEL[h.action] ?? h.action}</strong> · {h.by.name}
              </span>
              <span className="text-[11px] text-faint">{new Date(h.at).toLocaleString()}</span>
              {h.note && <span className="break-words text-[11.5px] text-muted">{h.note}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  ) : null;
