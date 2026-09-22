import React, { useState } from 'react';
import { formatDhis2Date } from '../../hooks/useTrackedEntityProfile';
import { useTrackedEntitiesRaw } from '../../hooks/useManageDuplicates';
import { userLabel, type EntityRef } from '../../lib/duplicateStore';
import type { ProgramMeta } from '../../lib/duplicateMerge';
import type { GroupView } from '../../lib/duplicateRows';
import { DupStatusPill } from './DuplicateTable';
import { WideDialog } from './WideDialog';
import { roleOf, toneOf } from './tones';
import { cn } from '../../lib/ui';

/**
 * The full profile of every record in a duplicate group, side by side: bio
 * data (every attribute) and every event of the programme, stage by stage,
 * with who registered and last updated each record and where. A group of
 * three shows three columns; values that differ from any other record are
 * highlighted. On a phone the records are one at a time behind a switcher.
 *
 * A merged-away record no longer exists in DHIS2, so its column falls back to
 * the snapshot stored with the merge.
 */

const HIDDEN = new Set(['FILE_RESOURCE', 'IMAGE']);

const fmt = (v: string, valueType?: string) => {
  if (!v) return '';
  if (valueType === 'DATE' || valueType === 'DATETIME' || valueType === 'AGE') return formatDhis2Date(v);
  if (valueType === 'BOOLEAN' || valueType === 'TRUE_ONLY') return v === 'true' ? 'Yes' : 'No';
  return v;
};

type AttrMap = Map<string, { name: string; value: string; valueType?: string }>;

function attributesOf(te: any, programId: string): AttrMap {
  const m: AttrMap = new Map();
  const enr = (te?.enrollments ?? []).find((e: any) => e.program === programId);
  for (const a of [...(enr?.attributes ?? []), ...(te?.attributes ?? [])])
    m.set(a.attribute, { name: a.displayName ?? a.attribute, value: a.value == null ? '' : String(a.value), valueType: a.valueType });
  return m;
}

/** Which record a column shows and how it stands in the group. */
interface Column {
  ref: EntityRef;
  index: number;
  record: any | null;
  loading: boolean;
  fromSnapshot: boolean;
  status: 'RETAINED' | 'MERGED' | null;
}

const RecordColumn: React.FC<{
  col: Column;
  attrs: AttrMap;
  others: AttrMap[];
  meta?: ProgramMeta;
  hierarchy: (path: string | undefined) => string;
  showEmpty: boolean;
}> = ({ col, attrs, others, meta, hierarchy, showEmpty }) => {
  const tone = toneOf(col.index);
  const { record, ref } = col;

  const header = (
    <div className={cn('sticky top-0 z-[1] flex flex-col gap-1 border-b border-line px-4 py-2.5 backdrop-blur', tone.soft)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-[11px] font-bold uppercase tracking-wider', tone.text)}>{roleOf(col.index)}</span>
        {col.status && <DupStatusPill status={col.status} />}
        {col.fromSnapshot && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10.5px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            Deleted · stored snapshot
          </span>
        )}
      </div>
      <span className="font-mono text-[11.5px] text-muted">{ref.id}</span>
    </div>
  );

  if (col.loading) {
    return (
      <div className="flex flex-col">
        {header}
        <div className="flex flex-col gap-2 p-4" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-md bg-panel2" />
          ))}
        </div>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="flex flex-col">
        {header}
        <p className="m-0 p-4 text-[13px] text-muted">This record no longer exists in DHIS2 and no snapshot was kept.</p>
      </div>
    );
  }

  const programId = meta?.id ?? '';
  const order = [...(meta?.attributes ?? []).map((a) => a.id)];
  for (const id of attrs.keys()) if (!order.includes(id)) order.push(id);
  const bio = order
    .map((id) => {
      const a = attrs.get(id);
      const known = meta?.attributes.find((x) => x.id === id);
      return { id, name: known?.name ?? a?.name ?? id, value: a?.value ?? '', valueType: known?.valueType ?? a?.valueType };
    })
    .filter((f) => !HIDDEN.has(f.valueType ?? '') && (showEmpty || f.value));

  const enr = (record.enrollments ?? []).find((e: any) => e.program === programId);
  const otherPrograms = (record.enrollments ?? []).filter((e: any) => e.program !== programId).length;
  const stageOf = new Map((meta?.stages ?? []).map((s) => [s.id, s]));
  const events: any[] = [...(enr?.events ?? [])].sort((a, b) =>
    String(a.occurredAt ?? a.scheduledAt ?? '').localeCompare(String(b.occurredAt ?? b.scheduledAt ?? ''))
  );
  const byStage = new Map<string, any[]>();
  for (const ev of events) byStage.set(ev.programStage, [...(byStage.get(ev.programStage) ?? []), ev]);
  const path = ref.orgUnitPath;

  return (
    <div className="flex flex-col">
      {header}
      <dl className="m-0 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1 border-b border-line px-4 py-3 text-[12px]">
        <dt className="text-muted">Org unit</dt>
        <dd className="m-0 min-w-0">
          <span className="block text-ink">{ref.orgUnitName ?? enr?.orgUnitName ?? record.orgUnit}</span>
          {path && <span className="block break-words text-[11px] text-faint">{hierarchy(path)}</span>}
        </dd>
        <dt className="text-muted">Registered</dt>
        <dd className="m-0 text-ink">
          {formatDhis2Date(record.createdAt)}
          <span className="block text-[11px] text-muted">by {userLabel(record.createdBy) ?? ref.createdBy ?? 'unknown user'}</span>
        </dd>
        <dt className="text-muted">Last updated</dt>
        <dd className="m-0 text-ink">
          {formatDhis2Date(record.updatedAt)}
          <span className="block text-[11px] text-muted">by {userLabel(record.updatedBy) ?? ref.updatedBy ?? 'unknown user'}</span>
        </dd>
        {enr && (
          <>
            <dt className="text-muted">Enrolled</dt>
            <dd className="m-0 text-ink">
              {formatDhis2Date(enr.enrolledAt)} · <span className="capitalize">{String(enr.status ?? '').toLowerCase()}</span>
            </dd>
          </>
        )}
        {otherPrograms > 0 && (
          <>
            <dt className="text-muted">Other programmes</dt>
            <dd className="m-0 text-ink">{otherPrograms} enrollment(s)</dd>
          </>
        )}
      </dl>

      <section className="border-b border-line px-4 py-3">
        <h4 className="m-0 mb-2 text-[12.5px] font-semibold text-ink">Bio data</h4>
        {bio.length ? (
          <dl className="m-0 flex flex-col">
            {bio.map((f) => {
              const differs = !!f.value && others.some((o) => {
                const v = o.get(f.id)?.value ?? '';
                return !!v && v.trim() !== f.value.trim();
              });
              return (
                <div key={f.id} className={cn('grid grid-cols-[42%_1fr] items-baseline gap-2.5 rounded-md px-1.5 py-1', differs && 'bg-amber-50')}>
                  <dt className="truncate text-[11.5px] text-muted" title={f.name}>
                    {f.name}
                  </dt>
                  <dd className={cn('m-0 break-words text-[12.5px]', f.value ? 'text-ink' : 'text-faint', differs && 'font-semibold text-amber-900')}>
                    {fmt(f.value, f.valueType) || '—'}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="m-0 text-[12px] text-muted">No values recorded.</p>
        )}
      </section>

      {[...byStage.entries()].map(([sid, evs]) => {
        const stage = stageOf.get(sid);
        const deName = new Map((stage?.dataElements ?? []).map((d) => [d.id, d]));
        return (
          <section key={sid} className="border-b border-line px-4 py-3">
            <h4 className="m-0 mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-ink">
              {stage?.name ?? 'Stage'}
              <span className="rounded-full bg-panel2 px-2 py-px text-[10.5px] font-semibold tabular-nums text-muted">
                {evs.length} {evs.length === 1 ? 'event' : 'events'}
              </span>
            </h4>
            <div className="flex flex-col gap-2">
              {evs.map((ev) => {
                const dvs = (ev.dataValues ?? []).filter((d: any) => d.value !== '' && d.value != null);
                return (
                  <div key={ev.event} className="rounded-lg border border-line bg-panel2/40 px-3 py-2">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[11.5px] font-semibold text-ink">
                      <span>{formatDhis2Date(ev.occurredAt ?? ev.scheduledAt) || 'No date'}</span>
                      <span className="font-medium capitalize text-muted">{String(ev.status ?? '').toLowerCase()}</span>
                    </div>
                    {ev.orgUnitName && <div className="mb-1 truncate text-[11px] text-faint">{ev.orgUnitName}</div>}
                    {dvs.length ? (
                      <dl className="m-0 flex flex-col gap-0.5">
                        {dvs.map((d: any) => (
                          <div key={d.dataElement} className="grid grid-cols-[42%_1fr] gap-2.5">
                            <dt className="truncate text-[11px] text-muted" title={deName.get(d.dataElement)?.name}>
                              {deName.get(d.dataElement)?.name ?? d.dataElement}
                            </dt>
                            <dd className="m-0 break-words text-[12px] text-ink">{fmt(String(d.value), deName.get(d.dataElement)?.valueType)}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="m-0 text-[11.5px] text-faint">No values</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {!byStage.size && <p className="m-0 px-4 py-3 text-[12px] text-muted">No events in this programme.</p>}
    </div>
  );
};

/** Latest stored snapshot of a record, from any merge of the group. */
export const snapshotOf = (group: GroupView, id: string) => group.cases.find((c) => c.snapshots?.[id])?.snapshots[id];

export const ProfileDialog: React.FC<{
  group: GroupView;
  /** the row the dialog was opened from — shown first on a phone */
  focusId: string;
  meta?: ProgramMeta;
  hierarchy: (path: string | undefined) => string;
  onClose: () => void;
  onMerge?: () => void;
  mergeLabel?: string;
}> = ({ group, focusId, meta, hierarchy, onClose, onMerge, mergeLabel }) => {
  const [showEmpty, setShowEmpty] = useState(false);
  const [side, setSide] = useState(focusId);
  const qs = useTrackedEntitiesRaw(group.members.map((m) => m.id));

  const columns: Column[] = group.members.map((ref, index) => {
    const q = qs[index];
    const snap = q?.data ? undefined : snapshotOf(group, ref.id);
    return {
      ref,
      index,
      record: q?.data ?? snap ?? null,
      loading: !!q?.isLoading,
      fromSnapshot: !q?.data && !!snap,
      status: group.retained.has(ref.id) ? 'RETAINED' : group.deleted.has(ref.id) ? 'MERGED' : null,
    };
  });
  const programId = meta?.id ?? '';
  const attrMaps = columns.map((c) => attributesOf(c.record, programId));
  const title = group.original.values.filter(Boolean).slice(0, 3).join(' · ') || group.original.id;
  const n = columns.length;

  return (
    <WideDialog
      label="Duplicate group profiles"
      title={title}
      subtitle={
        <span>
          {n} records share these values
          {group.retained.size > 0 && ` · ${group.retained.size} retained`}
          {group.deleted.size > 0 && ` · ${group.deleted.size} merged away`}
        </span>
      }
      headerExtra={
        <label className="hidden cursor-pointer items-center gap-1.5 self-center text-[12px] text-muted sm:inline-flex">
          <input type="checkbox" className="size-3.5 accent-accent" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} />
          Show empty
        </label>
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-muted hover:bg-panel2 hover:text-ink">
            Close
          </button>
          {onMerge && (
            <button type="button" onClick={onMerge} className="rounded-lg bg-accent px-3.5 py-2 text-[13px] font-semibold text-accent-ink shadow-card hover:brightness-110">
              {mergeLabel ?? 'Merge'}
            </button>
          )}
        </>
      }
    >
      {/* phones: one record at a time */}
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 lg:hidden" role="tablist" aria-label="Record">
        {columns.map((c) => (
          <button
            key={c.ref.id}
            type="button"
            role="tab"
            aria-selected={side === c.ref.id}
            onClick={() => setSide(c.ref.id)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold transition',
              side === c.ref.id ? 'bg-ink text-white' : cn('bg-panel2', toneOf(c.index).text)
            )}
          >
            {roleOf(c.index)}
          </button>
        ))}
      </div>
      <div
        className="grid lg:overflow-x-auto lg:[grid-template-columns:var(--cols)] lg:divide-x lg:divide-line"
        style={{ '--cols': `repeat(${n}, minmax(${n > 3 ? '20rem' : '0'}, 1fr))` } as React.CSSProperties}
      >
        {columns.map((c, i) => (
          <div key={c.ref.id} className={cn('min-w-0', side !== c.ref.id && 'max-lg:hidden')}>
            <RecordColumn
              col={c}
              attrs={attrMaps[i]}
              others={attrMaps.filter((_, j) => j !== i && !columns[j].status)}
              meta={meta}
              hierarchy={hierarchy}
              showEmpty={showEmpty}
            />
          </div>
        ))}
      </div>
    </WideDialog>
  );
};
