import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQueryClient } from '@tanstack/react-query';
import { DuplicateFilterBar } from '../components/duplicates/DuplicateFilterBar';
import { DuplicateTable, accessFor, type DuplicateTableHandlers } from '../components/duplicates/DuplicateTable';
import { ProfileDialog } from '../components/duplicates/ProfileDialog';
import { MergeDialog, type PreparedMerge } from '../components/duplicates/MergeDialog';
import { PlanDialog, btn, textareaCls } from '../components/create/PlanDialog';
import { useDuplicateStore } from '../store/useDuplicateStore';
import { useUserPermissions } from '../hooks/useUserPermissions';
import {
  decisionsQueryKey,
  hierarchyOf,
  useDuplicateAccess,
  useDuplicateDecisions,
  useDuplicateScan,
  useOrgUnitIndex,
  useProgramMeta,
} from '../hooks/useManageDuplicates';
import {
  ROW_STATUS_LABEL,
  acceptCase,
  deleteTrackedEntity,
  dupShardKey,
  failCase,
  importMerge,
  importedAlready,
  invalidateCase,
  pool,
  rejectCase,
  saveDuplicateDecisions,
  shardOuOf,
  toScanEntity,
  type DecisionWrite,
  type DuplicateCase,
  type EntityRef,
  type RetainedMark,
  type StoredDecisions,
} from '../lib/duplicateStore';
import { fetchTrackedEntity } from '../lib/duplicateMerge';
import {
  ROW_FILTER_LABEL,
  buildGroups,
  buildRows,
  duplicatesToCsv,
  filterRows,
  sortRows,
  type DupRow,
  type GroupView,
  type RowFilter,
  type SortKey,
  type SortState,
} from '../lib/duplicateRows';
import type { UserStamp } from '../lib/gpsEditStore';
import { downloadText, safeFileName } from '../lib/planRows';
import { cn } from '../lib/ui';

/**
 * Manage Duplicates (#/duplicates).
 *
 * Pick a programme and an org unit, scan, and every group of tracked entities
 * whose duplicate-detection attributes (Settings → Duplicates) match is
 * listed, one row per record after the group's original. From any row a
 * reviewer opens every record of the group side by side, and then either
 * **retains** records that turn out not to be duplicates — they are never
 * listed for review again, however often anyone rescans — or **merges** the
 * rest into the one record they keep: each differing value taken from any
 * record or typed in, saved for approval. An approver previews the merge and
 * accepts — the kept record is saved with `POST /api/tracker` and every other
 * record deleted — or rejects, which keeps the group marked as duplicates.
 *
 * Scans are cached in the browser; merges, retained marks, snapshots and
 * payloads are shared in the dataStore (lib/duplicateStore.ts), which is the
 * audit trail.
 *
 * Access (hooks/useManageDuplicates.ts): reviewing and approving are each
 * limited to the user's data capture org units unless an
 * F_*_DUPLICATES_ALL_MICROPLAN authority and its Settings switch both say
 * otherwise. Every decision is per group or per record, so partial updates
 * are natural: a ward team works its ward, an LGA supervisor approves only
 * their LGA.
 */

// The grid is virtualised, so page size only changes how many rows are sliced
// into it, never how many are drawn.
const PAGE_SIZES = [25, 50, 100, 250, 500, 1000, 5000, 10000];
const FILTERS: RowFilter[] = ['ALL', 'DETECTED', 'PENDING', 'FLAGGED', 'RETAINED', 'MERGED', 'ERRORS'];

type Dialog =
  | { kind: 'profile'; groupId: string; focusId: string }
  | { kind: 'merge'; groupId: string; caseId?: string }
  | { kind: 'retain'; r: DupRow }
  | { kind: 'bulk'; action: 'accept' | 'reject' }
  | null;

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

const EMPTY: StoredDecisions = { cases: new Map(), retained: new Map() };

export const ManageDuplicatesPage: React.FC = () => {
  const engine = useDataEngine();
  const qc = useQueryClient();
  const { permissions } = useUserPermissions();
  const access = useDuplicateAccess();
  const me: UserStamp | null = useMemo(
    () => (permissions ? { id: permissions.id, username: permissions.username, name: permissions.displayName } : null),
    [permissions]
  );

  const store = useDuplicateStore();
  const programId = store.programId ?? (access.settings.programId || null);
  const orgUnitId = store.orgUnitId;

  // ---- data ---------------------------------------------------------------------
  const ouQ = useOrgUnitIndex(orgUnitId);
  const metaQ = useProgramMeta(programId);
  const attrIds = access.settings.attributes;
  const attributes = useMemo(
    () => attrIds.map((id) => ({ id, name: metaQ.data?.attributes.find((a) => a.id === id)?.name ?? id })),
    [attrIds, metaQ.data]
  );
  const missingAttrs = metaQ.data ? attrIds.filter((id) => !metaQ.data!.attributes.some((a) => a.id === id)) : [];

  const scan = useDuplicateScan(programId, orgUnitId, attrIds, permissions?.username ?? '');
  const decisionsQ = useDuplicateDecisions(programId, ouQ.data);
  const decisions = decisionsQ.data ?? EMPTY;

  const lookup = useCallback((id: string) => ouQ.data?.byId.get(id), [ouQ.data]);
  const hierarchy = useCallback((path: string | undefined) => hierarchyOf(ouQ.data, path), [ouQ.data]);

  const groups = useMemo(
    () => (ouQ.data ? buildGroups(scan.cached?.groups ?? [], decisions, lookup) : []),
    [scan.cached, decisions, lookup, ouQ.data]
  );
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const allRows = useMemo(() => buildRows(groups), [groups]);
  const visibleRows = useMemo(
    () => allRows.filter((r) => access.reviewIn(r.record.orgUnitPath) || access.approveIn(r.record.orgUnitPath)),
    [allRows, access]
  );
  const accessOf = useCallback(
    (r: DupRow) => accessFor(access.reviewIn(r.record.orgUnitPath), access.approveIn(r.record.orgUnitPath)),
    [access]
  );

  // ---- search, filter, sort, paging -----------------------------------------------
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [sort, setSort] = useState<SortState | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => filterRows(visibleRows, deferredQuery, filter), [visibleRows, deferredQuery, filter]);
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  useEffect(() => setPage(0), [deferredQuery, filter, sort, pageSize, orgUnitId, programId]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(() => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize), [sorted, safePage, pageSize]);

  const onSort = useCallback(
    (key: SortKey, col?: number) =>
      setSort((s) => (!s || s.key !== key || s.col !== col ? { key, dir: 1, col } : s.dir === 1 ? { key, dir: -1, col } : null)),
    []
  );

  const counts = useMemo(() => {
    const c: Record<RowFilter, number> = { ALL: visibleRows.length, DETECTED: 0, PENDING: 0, FLAGGED: 0, RETAINED: 0, MERGED: 0, ERRORS: 0 };
    for (const r of visibleRows) {
      c[r.status]++;
      if (r.case?.error) c.ERRORS++;
    }
    return c;
  }, [visibleRows]);

  // prepared merges in the current view the user may decide (one per group)
  const decidable = useMemo(() => {
    const out = new Map<string, DuplicateCase>();
    for (const r of sorted) if (r.status === 'PENDING' && r.case && accessOf(r).approve) out.set(r.case.id, r.case);
    return [...out.values()];
  }, [sorted, accessOf]);

  // ---- feedback ---------------------------------------------------------------------
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [bulkProgress, setBulkProgress] = useState<{ done: number; ok: number; failed: number } | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 10000 : 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // ---- saving decisions ------------------------------------------------------------------
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;

  /** Write cases and retained marks; the cache takes the result. Conflicts are reported and the stored version shown. */
  const save = useCallback(
    async (writes: DecisionWrite[]): Promise<boolean> => {
      if (!writes.length) return true;
      const res = await saveDuplicateDecisions(engine as any, writes);
      qc.setQueryData<StoredDecisions>(decisionsQueryKey(programId, orgUnitId), (old) => {
        const next: StoredDecisions = { cases: new Map(old?.cases ?? []), retained: new Map(old?.retained ?? []) };
        for (const c of [...res.cases, ...res.conflicts.cases]) next.cases.set(c.id, c);
        for (const m of [...res.retained, ...res.conflicts.retained]) next.retained.set(m.id, m);
        for (const id of res.removedRetained) next.retained.delete(id);
        return next;
      });
      if (res.conflicts.cases.length || res.conflicts.retained.length) {
        setToast({ kind: 'err', text: 'Someone else changed these duplicates in the meantime — their version is now shown.' });
        return false;
      }
      return true;
    },
    [engine, qc, programId, orgUnitId]
  );
  const saveCase = (c: DuplicateCase) => save([{ kind: 'case', id: c.id, shardKey: c.shardKey, value: c, baseRev: c.rev }]);

  const shardFor = useCallback(
    (ref: EntityRef) => dupShardKey(programId ?? '', shardOuOf(ref.orgUnitPath, ref.orgUnit, access.settings.shardLevel)),
    [programId, access.settings.shardLevel]
  );

  const refOf = useCallback(
    (te: any): EntityRef => {
      const e = toScanEntity(te, attrIds);
      const ou = ouQ.data?.byId.get(e.ou);
      return {
        id: e.id,
        orgUnit: e.ou,
        orgUnitName: ou?.name,
        orgUnitPath: ou?.path,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
        createdBy: e.createdBy,
        updatedBy: e.updatedBy,
        values: e.values,
      };
    },
    [attrIds, ouQ.data]
  );

  /**
   * The writes that retain `retain` and list `unretain` again. A prepared
   * merge that would delete (or keep) a record now retained can't run as
   * prepared, so it is set aside with a note unless `except` replaces it.
   */
  const retentionWrites = (g: GroupView, retain: string[], unretain: string[], why: string, except?: string): DecisionWrite[] => {
    if (!me || !programId) return [];
    const at = new Date().toISOString();
    const writes: DecisionWrite[] = [];
    const after = new Set([...g.retained.keys(), ...retain].filter((id) => !unretain.includes(id)));
    const original = g.members.find((m) => !after.has(m.id) && !g.deleted.has(m.id)) ?? g.original;
    for (const id of retain) {
      const record = g.members.find((m) => m.id === id);
      if (!record) continue;
      const mark: RetainedMark = {
        id,
        programId,
        shardKey: shardFor(record),
        key: g.key,
        groupId: g.id,
        record,
        original: original.id === id ? g.original : original,
        note: why || undefined,
        rev: 0,
        retainedAt: at,
        retainedBy: me,
      };
      writes.push({ kind: 'retained', id, shardKey: mark.shardKey, value: mark, baseRev: decisionsRef.current.retained.get(id)?.rev ?? 0 });
    }
    for (const id of unretain) {
      const m = g.retained.get(id);
      if (m) writes.push({ kind: 'retained', id, shardKey: m.shardKey, value: null, baseRev: m.rev });
    }
    const open = g.open;
    if (open && open.status === 'PENDING' && open.id !== except && retain.some((id) => id === open.keptId || open.removedIds.includes(id))) {
      const c = invalidateCase(open, me, `${retain.join(', ')} retained — prepare the merge again`);
      writes.push({ kind: 'case', id: c.id, shardKey: c.shardKey, value: c, baseRev: open.rev });
    }
    return writes;
  };

  const onRetain = async (g: GroupView, retain: string[], unretain: string[], why = ''): Promise<boolean> => {
    setBusy('retain');
    try {
      const ok = await save(retentionWrites(g, retain, unretain, why));
      if (ok)
        setToast({
          kind: 'ok',
          text: retain.length
            ? `${retain.length} record(s) retained. Later scans show ${retain.length === 1 ? 'it' : 'them'} as retained.`
            : `${unretain.length} record(s) listed as duplicates again.`,
        });
      return ok;
    } catch (e) {
      setToast({ kind: 'err', text: `Could not save: ${(e as Error)?.message ?? e}` });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const onPrepare = async (g: GroupView, p: PreparedMerge): Promise<DuplicateCase | null> => {
    if (!me || !programId) return null;
    setBusy('prepare');
    try {
      const prev = g.open;
      const at = new Date().toISOString();
      // a group merged before gets a new record, so the accepted one stays as it was (audit)
      let id = prev?.id ?? g.id;
      for (let n = 1; !prev && decisionsRef.current.cases.has(id); n++) id = `${g.id}-${n}`;
      const fresh = new Map(p.records.map((te) => [te.trackedEntity as string, refOf(te)]));
      const members = g.members.map((m) => fresh.get(m.id) ?? m);
      const kept = fresh.get(p.keptId)!;
      const retainedAfter = members
        .filter((m) => (g.retained.has(m.id) || p.retain.includes(m.id)) && !p.unretain.includes(m.id))
        .map((m) => m.id);
      const c: DuplicateCase = {
        id,
        groupId: g.id,
        programId,
        shardKey: prev?.shardKey ?? shardFor(kept),
        key: g.key,
        attributes,
        members,
        status: 'PENDING',
        keptId: p.built.keptId,
        removedIds: p.built.removedIds,
        retainedIds: retainedAfter,
        deletedIds: [],
        resolutions: p.built.resolutions,
        payload: p.built.payload,
        snapshots: Object.fromEntries(p.records.map((te) => [te.trackedEntity, te])),
        copied: p.copied,
        summary: p.built.summary,
        note: prev?.note,
        error: undefined,
        rev: prev?.rev ?? 0,
        createdAt: prev?.createdAt ?? at,
        createdBy: prev?.createdBy ?? me,
        updatedAt: at,
        updatedBy: me,
        preparedAt: at,
        preparedBy: me,
        reviewedAt: prev?.reviewedAt,
        reviewedBy: prev?.reviewedBy,
        history: [...(prev?.history ?? []), { at, by: me, action: prev?.status === 'PENDING' ? 'EDITED' : 'PREPARED' }],
      };
      const ok = await save([
        { kind: 'case', id: c.id, shardKey: c.shardKey, value: c, baseRev: prev?.rev ?? 0 },
        ...retentionWrites(g, p.retain, p.unretain, '', c.id),
      ]);
      if (!ok) return null;
      setToast({ kind: 'ok', text: `Merge saved for approval. ${c.removedIds.length} record(s) are marked for deletion.` });
      return { ...c, rev: c.rev + 1 };
    } catch (e) {
      setToast({ kind: 'err', text: `Could not save the merge: ${(e as Error)?.message ?? e}` });
      return null;
    } finally {
      setBusy(null);
    }
  };

  /**
   * Accept one prepared merge: check nothing changed or was retained since it
   * was prepared, save the kept record, delete every other one, and record
   * it. A retry after a failed delete skips the save and the records already
   * deleted.
   */
  const acceptOne = useCallback(
    async (c: DuplicateCase, why: string): Promise<{ ok: boolean; message: string }> => {
      if (!me || !c.payload) return { ok: false, message: 'Nothing to save' };
      const retainedNow = [c.keptId, ...c.removedIds].filter((id) => decisionsRef.current.retained.has(id));
      if (retainedNow.length) return { ok: false, message: `${retainedNow.join(', ')} was retained since — edit the merge first.` };
      if (!importedAlready(c)) {
        const ids = [c.keptId, ...c.removedIds];
        const live = await Promise.all(ids.map((id) => fetchTrackedEntity(engine as any, id)));
        if (live.some((te, i) => !te || te.updatedAt !== c.snapshots?.[ids[i]]?.updatedAt)) {
          return { ok: false, message: 'A record changed since the merge was prepared — edit the merge first.' };
        }
        const imp = await importMerge(engine as any, c.payload);
        if (!imp.ok) {
          await saveCase(failCase(c, me, 'IMPORT_FAILED', imp.message));
          return { ok: false, message: `DHIS2 refused the merged record: ${imp.message}` };
        }
      }
      const deleted = [...c.deletedIds];
      for (const id of c.removedIds) {
        if (deleted.includes(id)) continue;
        const del = await deleteTrackedEntity(engine as any, id);
        if (!del.ok) {
          const msg = `Merged record saved; deleting ${id} failed: ${del.message}`;
          await saveCase(failCase(c, me, 'DELETE_FAILED', msg, deleted));
          return { ok: false, message: msg };
        }
        deleted.push(id);
      }
      const ok = await saveCase(acceptCase(c, me, why));
      qc.invalidateQueries({ queryKey: ['dup-te', c.keptId] });
      for (const id of c.removedIds) qc.removeQueries({ queryKey: ['dup-te', id] });
      return ok ? { ok: true, message: 'Merged' } : { ok: false, message: 'Merged, but the audit record could not be saved.' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me, engine, save, qc]
  );

  const onAccept = async (c: DuplicateCase, why: string) => {
    setBusy('accept');
    try {
      const res = await acceptOne(c, why);
      if (res.ok) {
        setToast({ kind: 'ok', text: `Merged into ${c.keptId}; ${c.removedIds.length} record(s) deleted.` });
        setDialog(null);
      } else setToast({ kind: 'err', text: res.message });
    } catch (e) {
      setToast({ kind: 'err', text: `Could not merge: ${(e as Error)?.message ?? e}` });
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (c: DuplicateCase, why: string) => {
    if (!me) return;
    setBusy('reject');
    try {
      if (await saveCase(rejectCase(c, me, why))) {
        setToast({ kind: 'ok', text: 'Merge rejected. The group stays marked as duplicates.' });
        setDialog(null);
      }
    } catch (e) {
      setToast({ kind: 'err', text: `Could not save: ${(e as Error)?.message ?? e}` });
    } finally {
      setBusy(null);
    }
  };

  const onBulk = async (action: 'accept' | 'reject') => {
    if (!me) return;
    const list = decidable;
    setBusy('bulk');
    setBulkProgress({ done: 0, ok: 0, failed: 0 });
    let ok = 0;
    let failed = 0;
    try {
      await pool(list, action === 'accept' ? 2 : 4, async (c) => {
        try {
          const res = action === 'accept' ? (await acceptOne(c, note.trim())).ok : await saveCase(rejectCase(c, me, note.trim()));
          if (res) ok++;
          else failed++;
        } catch {
          failed++;
        }
        setBulkProgress({ done: ok + failed, ok, failed });
      });
      setToast({
        kind: failed ? 'err' : 'ok',
        text:
          action === 'accept'
            ? `Merged ${ok.toLocaleString()} group(s)${failed ? `; ${failed.toLocaleString()} failed — filter by “With errors” to see why` : ''}.`
            : `Rejected ${ok.toLocaleString()} merge(s)${failed ? `; ${failed.toLocaleString()} could not be saved` : ''}.`,
      });
      setDialog(null);
      setNote('');
    } finally {
      setBusy(null);
      setBulkProgress(null);
    }
  };

  const onCsv = (rows: DupRow[], label: string) =>
    downloadText(duplicatesToCsv(rows, attributes, hierarchy), `${safeFileName(`duplicates ${ouQ.data?.selected.name ?? ''} ${label}`)}.csv`);

  // ---- handlers --------------------------------------------------------------------------
  const handlers: DuplicateTableHandlers = {
    onProfile: (r) => setDialog({ kind: 'profile', groupId: r.group.id, focusId: r.id }),
    onMerge: (r) => setDialog({ kind: 'merge', groupId: r.group.id, caseId: r.status === 'MERGED' ? r.case?.id : undefined }),
    onRetain: (r) => {
      setNote('');
      setDialog({ kind: 'retain', r });
    },
    onUnretain: (r) => void onRetain(r.group, [], [r.id]),
  };

  /**
   * Access to a whole group: a merge deletes records, so preparing or
   * approving one needs every record still in the group inside the user's
   * scope — a ward team can't remove another ward's record.
   */
  const groupAccess = (g: GroupView) => {
    const live = g.members.filter((m) => !g.deleted.has(m.id));
    const outside = live.filter((m) => !access.reviewIn(m.orgUnitPath) && !access.approveIn(m.orgUnitPath)).length;
    return {
      review: live.every((m) => access.reviewIn(m.orgUnitPath)),
      approve: live.every((m) => access.approveIn(m.orgUnitPath)),
      outside,
    };
  };

  // ---- render ------------------------------------------------------------------------------
  if (!access.loading && !access.canView) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-inset ring-rose-200">
          Manage Duplicates needs <code>F_REVIEW_DUPLICATES_MICROPLAN</code> or <code>F_APPROVE_DUPLICATES_MICROPLAN</code>. Ask an
          administrator to grant it on the app’s Settings page.
        </div>
      </div>
    );
  }

  const ready = !!programId && !!orgUnitId;
  const restricted = !(access.reviewAll || access.approveAll);
  const hiddenByScope = allRows.length - visibleRows.length;
  const viewFiltered = sorted.length !== visibleRows.length;
  const scanning = scan.progress !== null;
  const loading = ready && (ouQ.isLoading || scan.cacheLoading || decisionsQ.isLoading);
  const found = scan.cached ? scan.cached.groups.reduce((n, g) => n + g.members.length - 1, 0) : 0;

  const dialogGroup = dialog && (dialog.kind === 'profile' || dialog.kind === 'merge') ? groupById.get(dialog.groupId) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold tracking-tight text-ink sm:text-[22px]">Manage duplicates</h2>
          <p className="m-0 max-w-[80ch] text-[13px] text-muted">
            Find tracked entities registered more than once and compare every record of a group side by side. Retain the ones that
            are not duplicates; merge the rest into one. Merges are saved for approval first; accepting one writes the kept record to
            DHIS2 and deletes the others.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          <RoleChip on={access.canReview} label="Review" all={access.reviewAll} />
          <RoleChip on={access.canApprove} label="Approve" all={access.approveAll} />
        </div>
      </header>

      <DuplicateFilterBar
        programId={programId}
        onProgramChange={store.setProgramId}
        orgUnitId={orgUnitId}
        onOrgUnitChange={store.setOrgUnitId}
        orgUnitName={ouQ.data?.selected.name}
        attributeNames={attributes.map((a) => a.name)}
        counts={allRows.length ? { total: allRows.length, visible: visibleRows.length } : null}
        captureNames={access.captureNames}
        restricted={restricted}
      />

      {!attrIds.length ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] text-amber-900 ring-1 ring-inset ring-amber-200">
          No attributes are set for duplicate detection yet. An administrator chooses them in <strong>Settings → Duplicates</strong> — for
          example first name, surname, sex and date of birth.
          {permissions?.can('F_ADMIN_MICROPLAN') && (
            <>
              {' '}
              <a href="#/settings" className="font-semibold text-amber-900 underline">
                Open Settings
              </a>
            </>
          )}
        </div>
      ) : !ready ? (
        <Intro canReview={access.canReview} canApprove={access.canApprove} />
      ) : (
        <section className="flex h-[calc(100dvh-13rem)] min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          {/* ---- title + actions ---- */}
          <div className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:px-4 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <h3 className="m-0 truncate text-[15px] font-semibold text-ink">
                {ouQ.data?.selected.name ?? '…'}
                {metaQ.data && <span className="font-normal text-muted"> · {metaQ.data.name}</span>}
              </h3>
              <p className="m-0 text-[12px] text-muted">
                {scanning
                  ? `Scanning… ${scan.progress!.toLocaleString()} tracked entities compared so far`
                  : scan.cached
                    ? `Last scanned ${ago(scan.cached.scannedAt)}${scan.cached.scannedBy ? ` by ${scan.cached.scannedBy}` : ''} · ${scan.cached.entityCount.toLocaleString()} tracked entities compared · ${scan.cached.groups.length.toLocaleString()} groups, ${found.toLocaleString()} duplicates`
                    : decisions.cases.size || decisions.retained.size
                      ? `${(decisions.cases.size + decisions.retained.size).toLocaleString()} saved decision(s). Scan to find new duplicates.`
                      : 'Not scanned yet on this device.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CsvButton
                disabled={!visibleRows.length}
                full={visibleRows.length}
                view={viewFiltered ? sorted.length : null}
                onFull={() => onCsv(visibleRows, 'full')}
                onView={() => onCsv(sorted, 'view')}
              />
              {access.canApprove && decidable.length > 0 && (
                <>
                  <button
                    type="button"
                    className={btn.secondary}
                    disabled={!!busy}
                    onClick={() => {
                      setNote('');
                      setDialog({ kind: 'bulk', action: 'reject' });
                    }}
                  >
                    Reject {decidable.length.toLocaleString()}
                  </button>
                  <button
                    type="button"
                    className={btn.success}
                    disabled={!!busy}
                    onClick={() => {
                      setNote('');
                      setDialog({ kind: 'bulk', action: 'accept' });
                    }}
                  >
                    Accept {decidable.length.toLocaleString()}
                  </button>
                </>
              )}
              {scanning ? (
                <button type="button" className={btn.warn} onClick={scan.cancel}>
                  Cancel scan
                </button>
              ) : (
                <button type="button" className={btn.primary} disabled={!!busy || !ouQ.data} onClick={scan.scan}>
                  <ScanIcon /> {scan.cached ? 'Rescan' : 'Scan for duplicates'}
                </button>
              )}
            </div>
          </div>

          {scanning && (
            <div className="h-1 w-full overflow-hidden bg-line">
              <div className="h-full w-full animate-pulse bg-accent/70" />
            </div>
          )}

          {/* ---- search + status filter ---- */}
          <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:px-4 lg:flex-row lg:items-center">
            <div className="relative lg:w-80">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 fill-faint" aria-hidden>
                <path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, ID, org unit, user…"
                className="h-9 w-full rounded-lg border border-line bg-panel pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
            <div className="flex gap-1 overflow-x-auto pb-0.5 lg:flex-1" role="tablist" aria-label="Status">
              {FILTERS.filter((f) => f === 'ALL' || counts[f] > 0 || filter === f).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold transition',
                    filter === f ? 'bg-ink text-white' : 'bg-panel2 text-muted hover:text-ink'
                  )}
                >
                  {ROW_FILTER_LABEL[f]}
                  <Count n={counts[f]} light={filter === f} />
                </button>
              ))}
            </div>
          </div>

          <Banners
            scanError={scan.error}
            casesError={decisionsQ.error ? (decisionsQ.error as Error).message : null}
            missingAttrs={missingAttrs.length}
            hiddenByScope={hiddenByScope}
            captureNames={access.captureNames}
            pending={counts.PENDING}
            canApprove={access.canApprove}
          />

          {loading ? (
            <TableSkeleton />
          ) : !visibleRows.length ? (
            <Empty
              title={scan.cached ? 'No duplicates found' : 'Scan to find duplicates'}
              body={
                scan.cached ? (
                  <>No two tracked entities here share the same {attributes.map((a) => a.name).join(', ')}.</>
                ) : (
                  <>
                    Every tracked entity under <strong>{ouQ.data?.selected.name}</strong> is compared on{' '}
                    {attributes.map((a) => a.name).join(' + ')}. The result is kept on this device until you rescan.
                  </>
                )
              }
              action={
                !scan.cached && !scanning ? (
                  <button type="button" className={btn.primary} onClick={scan.scan}>
                    <ScanIcon /> Scan for duplicates
                  </button>
                ) : null
              }
            />
          ) : (
            <>
              <DuplicateTable
                rows={pageRows}
                offset={safePage * pageSize}
                attributes={attributes}
                hierarchy={hierarchy}
                accessOf={accessOf}
                sort={sort}
                onSort={onSort}
                handlers={handlers}
                resetKey={`${safePage}|${pageSize}|${filter}|${deferredQuery}|${sort?.key}|${sort?.dir}|${sort?.col}|${orgUnitId}`}
              />
              {!sorted.length && (
                <p className="m-0 px-4 py-6 text-center text-[13px] text-muted">
                  No rows match.{' '}
                  <button
                    type="button"
                    className="font-semibold text-accent hover:underline"
                    onClick={() => {
                      setQuery('');
                      setFilter('ALL');
                    }}
                  >
                    Clear search and filters
                  </button>
                </p>
              )}
              <Footer
                total={sorted.length}
                page={safePage}
                pageCount={pageCount}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
                pending={counts.PENDING}
                merged={counts.MERGED}
              />
            </>
          )}
        </section>
      )}

      {/* ---- dialogs ---- */}
      {dialog?.kind === 'profile' && dialogGroup && (
        <ProfileDialog
          group={dialogGroup}
          focusId={dialog.focusId}
          meta={metaQ.data}
          hierarchy={hierarchy}
          onClose={() => setDialog(null)}
          onMerge={
            groupAccess(dialogGroup).review || groupAccess(dialogGroup).approve || dialogGroup.open
              ? () => setDialog({ kind: 'merge', groupId: dialogGroup.id })
              : undefined
          }
          mergeLabel={dialogGroup.open?.status === 'PENDING' ? 'Open merge' : 'Retain or merge'}
        />
      )}

      {dialog?.kind === 'merge' && dialogGroup && metaQ.data && (
        <MergeDialog
          key={`${dialogGroup.id}:${dialog.caseId ?? ''}`}
          group={dialogGroup}
          current={dialog.caseId ? decisions.cases.get(dialog.caseId) : dialogGroup.open}
          meta={metaQ.data}
          hierarchy={hierarchy}
          canPrepare={groupAccess(dialogGroup).review}
          canDecide={groupAccess(dialogGroup).approve}
          notice={
            groupAccess(dialogGroup).outside > 0
              ? `${groupAccess(dialogGroup).outside} record(s) of this group are outside your data capture org units, so you can view the group but not merge or approve it. Records inside your org units can still be retained from the table.`
              : undefined
          }
          busy={busy}
          onClose={() => !busy && setDialog(null)}
          onPrepare={(p) => onPrepare(dialogGroup, p)}
          onRetainOnly={(retain, unretain) => onRetain(dialogGroup, retain, unretain)}
          onAccept={onAccept}
          onReject={onReject}
        />
      )}

      {dialog?.kind === 'retain' && (
        <PlanDialog
          title="Retain — not a duplicate"
          description={
            <>
              <span className="font-mono">{dialog.r.id}</span> is kept as its own record and left out of any merge of this group. Later
              scans list it as <strong className="text-ink">Retained</strong> instead of asking for it to be reviewed again.
            </>
          }
          onClose={() => !busy && setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} disabled={!!busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={btn.primary}
                disabled={!!busy}
                onClick={async () => {
                  if (await onRetain(dialog.r.group, [dialog.r.id], [], note.trim())) setDialog(null);
                }}
              >
                {busy === 'retain' ? 'Saving…' : 'Retain'}
              </button>
            </>
          }
        >
          {dialog.r.group.open?.status === 'PENDING' && (
            <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
              This record is part of a merge waiting for approval. Retaining it sets that merge aside; it has to be prepared again.
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Why is it not a duplicate? (optional)</span>
            <textarea
              rows={2}
              className={textareaCls}
              value={note}
              placeholder="e.g. twins with the same date of birth"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </PlanDialog>
      )}

      {dialog?.kind === 'bulk' && (
        <PlanDialog
          title={dialog.action === 'accept' ? 'Accept prepared merges' : 'Reject prepared merges'}
          description={
            dialog.action === 'accept' ? (
              <>
                {decidable.length.toLocaleString()} prepared merge(s) in the current view will be saved to DHIS2 and their other records{' '}
                <strong className="text-ink">deleted</strong>. Merges whose records changed or were retained since they were prepared are
                skipped.
              </>
            ) : (
              <>
                {decidable.length.toLocaleString()} prepared merge(s) in the current view will be rejected. The groups stay marked as
                duplicates.
              </>
            )
          }
          onClose={() => !busy && setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} disabled={!!busy} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={dialog.action === 'accept' ? btn.success : btn.warn}
                disabled={!!busy}
                onClick={() => onBulk(dialog.action)}
              >
                {busy === 'bulk' ? 'Working…' : `${dialog.action === 'accept' ? 'Accept' : 'Reject'} ${decidable.length.toLocaleString()}`}
              </button>
            </>
          }
        >
          {viewFiltered && (
            <p className="m-0 rounded-lg bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900 ring-1 ring-inset ring-sky-200">
              Only the rows matching your search and filter are included.
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Note (optional)</span>
            <textarea rows={2} className={textareaCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {bulkProgress && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${(bulkProgress.done / Math.max(1, decidable.length)) * 100}%` }}
                />
              </div>
              <span className="text-[11.5px] tabular-nums text-muted">
                {bulkProgress.done.toLocaleString()} of {decidable.length.toLocaleString()}
                {bulkProgress.failed > 0 && ` · ${bulkProgress.failed.toLocaleString()} failed`}
              </span>
            </div>
          )}
        </PlanDialog>
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-4 left-1/2 z-[60] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-float',
            toast.kind === 'err' ? 'bg-flag text-white' : 'bg-ink text-white'
          )}
        >
          {toast.text}
          <button type="button" className="opacity-70 hover:opacity-100" aria-label="Dismiss" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
};

/* ---- pieces -------------------------------------------------------------------------------- */

const ScanIcon = () => (
  <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
    <path d="M4 4h5V2H2v7h2zm11-2v2h5v5h2V2zM4 15H2v7h7v-2H4zm16 5h-5v2h7v-7h-2zM7 11h10v2H7z" />
  </svg>
);

const Count: React.FC<{ n: number; light?: boolean }> = ({ n, light }) => (
  <span className={cn('ms-1 rounded-full px-1.5 text-[11px] font-semibold tabular-nums', light ? 'bg-white/25 text-current' : 'bg-panel text-muted')}>
    {n.toLocaleString()}
  </span>
);

const RoleChip: React.FC<{ on: boolean; label: string; all: boolean }> = ({ on, label, all }) =>
  on ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 font-medium text-muted ring-1 ring-inset ring-line"
      title={all ? `${label}: every org unit` : `${label}: your data capture org units`}
    >
      <span className={cn('size-1.5 rounded-full', all ? 'bg-accent' : 'bg-sky-500')} aria-hidden />
      {label} · {all ? 'all org units' : 'my org units'}
    </span>
  ) : null;

const CsvButton: React.FC<{ disabled: boolean; full: number; view: number | null; onFull: () => void; onView: () => void }> = ({
  disabled,
  full,
  view,
  onFull,
  onView,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const icon = (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path d="M11 3v10.6l-3.3-3.3-1.4 1.4L12 17.4l5.7-5.7-1.4-1.4-3.3 3.3V3h-2zM5 19h14v2H5z" />
    </svg>
  );
  if (view === null) {
    return (
      <button type="button" className={btn.secondary} disabled={disabled} onClick={onFull} title="Download the full table as CSV">
        {icon} CSV
      </button>
    );
  }
  const item = 'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13px] text-ink hover:bg-panel2';
  return (
    <div ref={ref} className="relative">
      <button type="button" className={btn.secondary} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon} CSV <span className="text-[10px] text-muted">▾</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 w-60 rounded-xl border border-line bg-panel p-1 shadow-float">
          <button type="button" role="menuitem" className={item} onClick={() => (onFull(), setOpen(false))}>
            Full table <span className="tabular-nums text-muted">{full.toLocaleString()}</span>
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => (onView(), setOpen(false))}>
            Current view <span className="tabular-nums text-muted">{view.toLocaleString()}</span>
          </button>
        </div>
      )}
    </div>
  );
};

const Banners: React.FC<{
  scanError: string | null;
  casesError: string | null;
  missingAttrs: number;
  hiddenByScope: number;
  captureNames: string[];
  pending: number;
  canApprove: boolean;
}> = ({ scanError, casesError, missingAttrs, hiddenByScope, captureNames, pending, canApprove }) => {
  const box = 'rounded-lg px-3 py-2 text-[12.5px] ring-1 ring-inset';
  const items: React.ReactNode[] = [];
  if (scanError)
    items.push(
      <div key="s" className={cn(box, 'bg-rose-50 text-rose-800 ring-rose-200')}>
        The scan stopped: {scanError}
      </div>
    );
  if (casesError)
    items.push(
      <div key="c" className={cn(box, 'bg-rose-50 text-rose-800 ring-rose-200')}>
        Could not load saved duplicates: {casesError}
      </div>
    );
  if (missingAttrs > 0)
    items.push(
      <div key="m" className={cn(box, 'bg-amber-50 text-amber-900 ring-amber-200')}>
        {missingAttrs} of the duplicate-detection attributes {missingAttrs === 1 ? 'is' : 'are'} not part of this programme, so no
        record has {missingAttrs === 1 ? 'it' : 'them'} and nothing can match. Check <strong>Settings → Duplicates</strong>.
      </div>
    );
  if (canApprove && pending > 0)
    items.push(
      <div key="p" className={cn(box, 'bg-violet-50 text-violet-900 ring-violet-200')}>
        <strong>{pending.toLocaleString()}</strong> record(s) are in merges waiting for approval. Open one with <strong>Review</strong>, or accept or
        reject everything in the view at once.
      </div>
    );
  if (hiddenByScope > 0)
    items.push(
      <div key="h" className={cn(box, 'bg-panel2 text-muted ring-line')}>
        {hiddenByScope.toLocaleString()} duplicate(s) outside your data capture org units
        {captureNames.length ? ` (${captureNames.slice(0, 3).join(', ')}${captureNames.length > 3 ? '…' : ''})` : ''} are hidden.
      </div>
    );
  if (!items.length) return null;
  return <div className="flex flex-col gap-2 border-b border-line px-3 py-2.5 sm:px-4">{items}</div>;
};

const Footer: React.FC<{
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  pending: number;
  merged: number;
}> = ({ total, page, pageCount, pageSize, onPage, onPageSize, pending, merged }) => {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const nav =
    'grid size-8 place-items-center rounded-md border border-line bg-panel text-[13px] text-ink hover:border-accent/60 disabled:opacity-40 disabled:hover:border-line';
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-panel2/50 px-3 py-2 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="tabular-nums">
          {from.toLocaleString()}–{to.toLocaleString()} of <strong className="text-ink">{total.toLocaleString()}</strong>
        </span>
        <span className="hidden tabular-nums md:inline">
          {ROW_STATUS_LABEL.PENDING} <strong className="text-ink">{pending.toLocaleString()}</strong>
        </span>
        <span className="hidden tabular-nums md:inline">
          Merged <strong className="text-ink">{merged.toLocaleString()}</strong>
        </span>
        <span className="hidden text-faint xl:inline">↑↓ move · Enter merges · Space opens the profile · double-click a row</span>
      </div>
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1.5">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-md border border-line bg-panel px-1.5 py-1 text-[12px] text-ink outline-none focus:border-accent"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
        {pageCount > 1 && (
          <div className="flex items-center gap-1">
            <button type="button" className={nav} disabled={page === 0} onClick={() => onPage(0)} aria-label="First page">
              «
            </button>
            <button type="button" className={nav} disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
              ‹
            </button>
            <span className="px-1.5 tabular-nums">
              {(page + 1).toLocaleString()} / {pageCount.toLocaleString()}
            </span>
            <button type="button" className={nav} disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)} aria-label="Next page">
              ›
            </button>
            <button type="button" className={nav} disabled={page >= pageCount - 1} onClick={() => onPage(pageCount - 1)} aria-label="Last page">
              »
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const TableSkeleton: React.FC = () => (
  <div className="flex flex-1 flex-col gap-2 p-4" aria-busy aria-label="Loading duplicates">
    <div className="h-9 w-full animate-pulse rounded-md bg-panel2" />
    {Array.from({ length: 8 }, (_, i) => (
      <div key={i} className="flex gap-2">
        <div className="h-10 w-12 animate-pulse rounded-md bg-panel2" />
        <div className="h-10 w-1/4 animate-pulse rounded-md bg-panel2" />
        <div className="h-10 flex-1 animate-pulse rounded-md bg-panel2/70" />
      </div>
    ))}
  </div>
);

const Empty: React.FC<{ title: string; body: React.ReactNode; action?: React.ReactNode }> = ({ title, body, action }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <div className="grid size-12 place-items-center rounded-full bg-panel2 text-xl text-faint" aria-hidden>
      ⧉
    </div>
    <p className="m-0 text-[14px] font-semibold text-ink">{title}</p>
    <p className="m-0 max-w-md text-[13px] text-muted">{body}</p>
    {action && <div className="pt-2">{action}</div>}
  </div>
);

const Intro: React.FC<{ canReview: boolean; canApprove: boolean }> = ({ canReview, canApprove }) => {
  const steps = [
    {
      n: 1,
      title: 'Choose a programme and org unit',
      body: 'Then scan. Every tracked entity below the org unit is compared on the attributes set in Settings, and the result is kept on this device.',
    },
    {
      n: 2,
      title: canReview ? 'Compare, retain or merge' : 'Compare',
      body: canReview
        ? 'Open every record of a group side by side. Retain the ones that are not duplicates; merge the rest into the one you keep — any record’s value, or a correction — and save for approval.'
        : 'Open the full profiles of every record in a group, side by side.',
    },
    {
      n: 3,
      title: canApprove ? 'Accept or reject' : 'Approval',
      body: canApprove
        ? 'Preview each prepared merge. Accept saves it to DHIS2 and deletes the merged records; reject keeps the group marked as duplicates.'
        : 'An approver accepts the merge — saving it to DHIS2 and deleting the merged records — or rejects it.',
    },
  ];
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {steps.map((s) => (
        <div key={s.n} className="flex gap-3 rounded-xl border border-line bg-panel p-4 shadow-card">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[13px] font-bold text-accent">{s.n}</span>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-[13.5px] font-semibold text-ink">{s.title}</p>
            <p className="m-0 text-[12.5px] text-muted">{s.body}</p>
          </div>
        </div>
      ))}
    </section>
  );
};
