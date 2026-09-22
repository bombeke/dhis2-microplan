import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQueryClient } from '@tanstack/react-query';
import { SettlementFilterBar } from '../components/settlements/SettlementFilterBar';
import { SettlementTable, accessFor, type TableHandlers } from '../components/settlements/SettlementTable';
import { ManualGpsDialog, RejectDialog, SettlementMapDialog } from '../components/settlements/SettlementDialogs';
import type { ContextSettlement } from '../components/settlements/SettlementMap';
import { PlanDialog, btn, textareaCls } from '../components/create/PlanDialog';
import { useSettlementStore } from '../store/useSettlementStore';
import { useUserPermissions } from '../hooks/useUserPermissions';
import {
  inScope,
  useGpsAccess,
  useGpsEdits,
  useOrgUnitWithAncestors,
  useSettlementRegister,
} from '../hooks/useManageSettlements';
import {
  GPS_STATUS_LABEL,
  approveGps,
  currentOf,
  decideGps,
  isEditableGps,
  isPendingSync,
  isSubmittable,
  markSyncFailed,
  markSynced,
  noteGps,
  postSyncBatches,
  proposeGps,
  proposedOf,
  revertGps,
  saveGpsEdits,
  sendBackGps,
  shardKeyOf,
  submitGps,
  toSyncRecord,
  type GeoValue,
  type GpsEdit,
  type GpsMethod,
  type RejectAction,
  type UserStamp,
} from '../lib/gpsEditStore';
import type { SettlementRecord } from '../lib/settlementRegistry';
import {
  ROW_FILTER_LABEL,
  filterRows,
  hasGps,
  settlementsToCsv,
  shownGeo,
  sortRows,
  type RowFilter,
  type SortKey,
  type SortState,
} from '../lib/settlementRows';
import { downloadText, safeFileName } from '../lib/planRows';
import { cn } from '../lib/ui';

/**
 * Manage Settlements (#/settlements).
 *
 * Pick an org unit and the page lists every settlement the register
 * (ng_settlements) holds under it: coordinates, polygon, source, estimated
 * households — with anything missing called out. From each row you can see it
 * on a map, add or correct its GPS (typed in, or picked on a map as a point or
 * a freehand area), and — as a reviewer — accept or reject it.
 *
 * Workflow (lib/gpsEditStore.ts): changes are staged locally, saved to the
 * dataStore as drafts, and submitted; a reviewer accepts or rejects rows,
 * adds notes, and approves or sends back what is in review; approved changes
 * wait in a sync queue for the register's update endpoint. Every action
 * applies to the rows *in the current view*, which is what makes partial
 * updates natural: filter to a ward, submit that ward.
 *
 * Access (hooks/useManageSettlements.ts): viewing, editing and reviewing are
 * each limited to the user's data-capture org units unless an
 * F_*_GPS_ALL_MICROPLAN authority and its Settings switch both say otherwise.
 */

// The grid is virtualised, so a page's size only changes how many rows are
// sliced into it, never how many are drawn — 50 000 costs the same to render as 50.
const PAGE_SIZES = [25, 50, 100, 250, 500, 1000, 5000, 10000, 50000];
const FILTERS: RowFilter[] = [
  'ALL',
  'MISSING_GPS',
  'MISSING_POLYGON',
  'UNSAVED',
  'DRAFT',
  'SUBMITTED',
  'SENT_BACK',
  'APPROVED',
  'REJECTED',
  'PENDING_SYNC',
];

type Dialog =
  | { kind: 'map'; r: SettlementRecord; mode: 'view' | 'pick' }
  | { kind: 'manual'; r: SettlementRecord }
  | { kind: 'reject'; r: SettlementRecord }
  | { kind: 'submit' | 'approve' | 'sendBack' | 'sync' | 'discard' }
  | null;

export const ManageSettlementsPage: React.FC = () => {
  const engine = useDataEngine();
  const qc = useQueryClient();
  const { permissions } = useUserPermissions();
  const access = useGpsAccess();
  const me: UserStamp | null = useMemo(
    () => (permissions ? { id: permissions.id, username: permissions.username, name: permissions.displayName } : null),
    [permissions]
  );

  const { orgUnitId, setOrgUnitId, dirty, baseRev, shardKey, stage, unstage, clear } = useSettlementStore();

  // ---- data ------------------------------------------------------------------
  const ouQ = useOrgUnitWithAncestors(orgUnitId);
  const reg = useSettlementRegister(ouQ.data, access.settings);
  const allRows = reg.data?.rows;
  const visibleRows = useMemo(
    () => (allRows ?? []).filter((r) => inScope(access.viewScope, r)),
    [allRows, access.viewScope]
  );
  const editsQ = useGpsEdits(allRows);
  const saved = useMemo(() => editsQ.data ?? new Map<string, GpsEdit>(), [editsQ.data]);

  const editOf = useCallback(
    (id: string): GpsEdit | undefined => (dirty.has(id) ? dirty.get(id) ?? undefined : saved.get(id)),
    [dirty, saved]
  );
  const isDirty = useCallback((id: string) => dirty.has(id), [dirty]);
  const editOfRef = useRef(editOf);
  editOfRef.current = editOf;

  // Row actions wait for the saved changes: an edit made before they arrive
  // would be based on the wrong revision and be refused at save time.
  const editsReady = editsQ.isSuccess;
  const accessOf = useCallback(
    (r: SettlementRecord) =>
      accessFor(
        editsReady && access.canCreate && inScope(access.createScope, r),
        editsReady && access.canApprove && inScope(access.approveScope, r)
      ),
    [access, editsReady]
  );

  // ---- search, filter, sort, paging --------------------------------------------
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [sort, setSort] = useState<SortState | null>(null);
  const [pageSize, setPageSize] = useState(100);
  const [page, setPage] = useState(0);

  // Like a spreadsheet filter, the row set is re-applied when the filter, the
  // search or the saved data changes — not on every local edit, so a row you
  // just fixed doesn't vanish from under the cursor in "Missing GPS".
  const filtered = useMemo(
    () =>
      filterRows(visibleRows, editOfRef.current, {
        query: deferredQuery,
        filter,
        isDirty: (id) => dirty.has(id),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleRows, deferredQuery, filter, saved, filter === 'UNSAVED' ? dirty : null]
  );
  const sorted = useMemo(() => sortRows(filtered, editOfRef.current, sort), [filtered, sort]);

  useEffect(() => setPage(0), [deferredQuery, filter, sort, pageSize, orgUnitId]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [sorted, safePage, pageSize]
  );

  const onSort = useCallback(
    (key: SortKey) =>
      setSort((s) => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null)),
    []
  );

  // ---- counts (one pass) ----------------------------------------------------------
  const counts = useMemo(() => {
    const c: Record<RowFilter, number> = {
      ALL: visibleRows.length,
      MISSING_GPS: 0,
      MISSING_POLYGON: 0,
      UNSAVED: 0,
      DRAFT: 0,
      SUBMITTED: 0,
      SENT_BACK: 0,
      APPROVED: 0,
      REJECTED: 0,
      PENDING_SYNC: 0,
    };
    let households = 0;
    for (const r of visibleRows) {
      const e = dirty.has(r.id) ? dirty.get(r.id) ?? undefined : saved.get(r.id);
      const g = shownGeo(r, e);
      if (!hasGps(g)) c.MISSING_GPS++;
      if (!g.polygon) c.MISSING_POLYGON++;
      if (dirty.has(r.id)) c.UNSAVED++;
      if (e) c[e.status]++;
      if (isPendingSync(e)) c.PENDING_SYNC++;
      if (r.households) households += r.households;
    }
    return { ...c, households };
  }, [visibleRows, dirty, saved]);

  // ---- workflow targets in the current view ------------------------------------------
  const targets = useMemo(() => {
    const submit: SettlementRecord[] = [];
    const review: SettlementRecord[] = [];
    const rejected: SettlementRecord[] = [];
    const sync: SettlementRecord[] = [];
    for (const r of sorted) {
      const e = editOf(r.id);
      if (!e) continue;
      const a = accessOf(r);
      if (a.edit && isSubmittable(e)) submit.push(r);
      if (a.review && e.status === 'SUBMITTED') {
        review.push(r);
        if (e.decision === 'REJECTED') rejected.push(r);
      }
    }
    // the sync queue is the whole loaded table, not just the view
    for (const r of visibleRows) if (isPendingSync(editOf(r.id)) && accessOf(r).review) sync.push(r);
    return { submit, review, rejected, sync };
  }, [sorted, visibleRows, editOf, accessOf]);

  // ---- feedback -----------------------------------------------------------------------
  const [dialog, setDialog] = useState<Dialog>(null);
  const [comment, setComment] = useState('');
  const [onlyRejected, setOnlyRejected] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'err' ? 9000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!dirty.size) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.size]);

  // ---- staging helpers ------------------------------------------------------------------
  const stageOne = useCallback(
    (r: SettlementRecord, next: GpsEdit | null) => {
      const stored = saved.get(r.id);
      if (next === null && !stored) unstage([r.id]);
      else stage([{ id: r.id, edit: next, rev: stored?.rev ?? 0, key: shardKeyOf(r) }]);
    },
    [saved, stage, unstage]
  );

  /**
   * Save everything staged, plus `extra` (records produced by a workflow
   * action), in one merged write per shard. Rows someone else saved in the
   * meantime are not written; their stored version replaces ours and the user
   * is told how many.
   */
  const commit = useCallback(
    async (extra: GpsEdit[], okText: string) => {
      const batch = new Map<string, GpsEdit | null>(dirty);
      const revs = new Map(baseRev);
      for (const e of extra) {
        batch.set(e.id, e);
        if (!revs.has(e.id)) revs.set(e.id, saved.get(e.id)?.rev ?? 0);
      }
      if (!batch.size) return true;
      const items = [...batch.entries()].map(([id, edit]) => ({
        id,
        edit,
        key: shardKey.get(id) ?? shardKeyOf((edit ?? saved.get(id))!),
      }));
      try {
        const res = await saveGpsEdits(engine as any, items, revs);
        qc.setQueriesData<Map<string, GpsEdit>>({ queryKey: ['gps-edits'] }, (old) => {
          if (!old) return old;
          const next = new Map(old);
          for (const e of res.saved) next.set(e.id, e);
          for (const id of res.removed) next.delete(id);
          for (const e of res.conflicts) next.set(e.id, e);
          return next;
        });
        unstage([...batch.keys()]);
        if (res.conflicts.length) {
          setToast({
            kind: 'err',
            text: `${okText} ${res.conflicts.length.toLocaleString()} row(s) had been changed by someone else and were not saved — their version is now shown.`,
          });
        } else {
          setToast({ kind: 'ok', text: okText });
        }
        return true;
      } catch (e) {
        setToast({ kind: 'err', text: `Could not save: ${(e as Error)?.message ?? e}` });
        return false;
      }
    },
    [dirty, baseRev, shardKey, saved, engine, qc, unstage]
  );

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  // ---- row handlers -------------------------------------------------------------------------
  const handlers: TableHandlers = {
    onView: (r) => setDialog({ kind: 'map', r, mode: 'view' }),
    onPick: (r) => setDialog({ kind: 'map', r, mode: 'pick' }),
    onManual: (r) => setDialog({ kind: 'manual', r }),
    onRevert: (r) => {
      const prev = editOf(r.id);
      if (!prev || !me) return;
      stageOne(r, revertGps(prev, me));
    },
    onAccept: (r) => me && stageOne(r, decideGps(r, editOf(r.id), 'ACCEPTED', null, me)),
    onReject: (r) => setDialog({ kind: 'reject', r }),
    onClearDecision: (r) => {
      if (!me) return;
      const stored = saved.get(r.id);
      // a decision on a row that wasn't in review only exists locally — just drop it
      if (!stored || stored.status !== 'SUBMITTED') unstage([r.id]);
      else stageOne(r, decideGps(r, editOf(r.id), null, null, me));
    },
    onNote: (r, note) => {
      const prev = editOf(r.id);
      if (prev && me) stageOne(r, noteGps(prev, note, me));
    },
  };

  const applyProposal = (r: SettlementRecord, value: GeoValue, method: GpsMethod) => {
    if (!me) return;
    stageOne(r, proposeGps(r, editOf(r.id), value, method, me));
    setDialog(null);
    setToast({ kind: 'info', text: `GPS for ${r.name || 'the settlement'} staged. Save to keep it as a draft.` });
  };

  const applyReject = (r: SettlementRecord, action: RejectAction, note: string) => {
    if (!me) return;
    let next = decideGps(r, editOf(r.id), 'REJECTED', action, me);
    if (note.trim() !== (next.note ?? '')) next = noteGps(next, note, me);
    stageOne(r, next);
    setDialog(null);
  };

  // ---- bulk actions ---------------------------------------------------------------------------
  const onSave = () => run('save', () => commit([], `Saved ${dirty.size.toLocaleString()} change(s).`));

  const onSubmit = () =>
    run('submit', async () => {
      if (!me) return;
      const next = targets.submit.map((r) => submitGps(editOf(r.id)!, me));
      if (await commit(next, `Submitted ${next.length.toLocaleString()} settlement(s) for review.`)) setDialog(null);
    });

  const onApprove = () =>
    run('approve', async () => {
      if (!me) return;
      const next = targets.review.map((r) => approveGps(editOf(r.id)!, me, comment.trim()));
      if (await commit(next, `Approved ${next.length.toLocaleString()} settlement(s).`)) {
        setDialog(null);
        setComment('');
      }
    });

  const onSendBack = () =>
    run('sendBack', async () => {
      if (!me) return;
      const rows = onlyRejected && targets.rejected.length ? targets.rejected : targets.review;
      const next = rows.map((r) => sendBackGps(editOf(r.id)!, me, comment.trim()));
      if (await commit(next, `Sent back ${next.length.toLocaleString()} settlement(s).`)) {
        setDialog(null);
        setComment('');
      }
    });

  const syncEndpoint = access.settings.syncEndpoint;
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  const onSync = () =>
    run('sync', async () => {
      if (!me || !syncEndpoint) return;
      const at = new Date().toISOString();
      const edits = targets.sync.map((r) => editOf(r.id)!);
      setSyncProgress(0);
      const { ok, failed } = await postSyncBatches(
        syncEndpoint,
        edits.map((e) => toSyncRecord(e, me, at)),
        setSyncProgress
      );
      setSyncProgress(null);
      const next = edits.map((e) =>
        ok.has(e.id) ? markSynced(e, me, at) : markSyncFailed(e, me, failed.get(e.id) ?? 'Not sent')
      );
      await commit(
        next,
        failed.size
          ? `Synced ${ok.size.toLocaleString()}; ${failed.size.toLocaleString()} failed and stay in the queue.`
          : `Synced ${ok.size.toLocaleString()} update(s) to the settlement register.`
      );
      setDialog(null);
    });

  const onDownloadQueue = () => {
    if (!me) return;
    const at = new Date().toISOString();
    const payload = { generatedAt: at, updates: targets.sync.map((r) => toSyncRecord(editOf(r.id)!, me, at)) };
    downloadText(JSON.stringify(payload, null, 2), `${safeFileName(`settlement-sync ${ouQ.data?.name ?? ''}`)}.json`, 'application/json');
  };

  const onCsv = (rows: SettlementRecord[], label: string) => {
    const csv = settlementsToCsv(rows, editOf);
    downloadText(csv, `${safeFileName(`settlements ${ouQ.data?.name ?? ''} ${label}`)}.csv`);
  };

  // ---- the map dialog's context -------------------------------------------------------------------
  const mapContext = useMemo<ContextSettlement[]>(() => {
    if (dialog?.kind !== 'map') return [];
    const f = dialog.r;
    const out: ContextSettlement[] = [];
    for (const r of visibleRows) {
      if (r.wk !== f.wk || r.lk !== f.lk || r.sk !== f.sk) continue;
      const e = editOf(r.id);
      out.push({ record: r, geo: currentOf(r, e), status: e ? GPS_STATUS_LABEL[e.status] : 'Not edited' });
      if (out.length >= 5000) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, visibleRows]);

  // ---- render ---------------------------------------------------------------------------------------
  const ouName = ouQ.data?.name;
  const loadingRegister = !!orgUnitId && (access.loading || ouQ.isLoading || reg.isLoading);
  const restricted = !access.viewScope.all;
  const hiddenByScope = (allRows?.length ?? 0) - visibleRows.length;
  const viewFiltered = sorted.length !== visibleRows.length;

  if (!access.loading && !access.canView) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 ring-1 ring-inset ring-rose-200">
          Manage Settlements needs one of <code>F_READ_GPS_MICROPLAN</code>, <code>F_CREATE_GPS_MICROPLAN</code> or{' '}
          <code>F_APPROVE_GPS_MICROPLAN</code>. Ask an administrator to grant it on the app’s Settings page.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold tracking-tight text-ink sm:text-[22px]">Manage settlements</h2>
          <p className="m-0 max-w-[80ch] text-[13px] text-muted">
            Check every settlement’s GPS and polygon, fill the gaps from a map or by hand, and send the
            changes for review. Approved changes are queued to update the settlement register.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          <RoleChip on={access.canCreate} label="Edit" all={access.createScope.all} />
          <RoleChip on={access.canApprove} label="Review" all={access.approveScope.all} />
          <RoleChip on label="View" all={access.viewScope.all} />
        </div>
      </header>

      <SettlementFilterBar
        orgUnitId={orgUnitId}
        onOrgUnitChange={setOrgUnitId}
        scope={reg.scope}
        orgUnitName={ouName}
        counts={allRows ? { total: allRows.length, visible: visibleRows.length } : null}
        captureNames={access.captureNames}
        restricted={restricted}
      />

      {!orgUnitId ? (
        <Intro canCreate={access.canCreate} canApprove={access.canApprove} />
      ) : (
        <section className="flex h-[calc(100dvh-13rem)] min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          {/* ---- title + actions ---- */}
          <div className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:px-4 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 truncate text-[15px] font-semibold text-ink">{ouName ?? '…'}</h3>
                {dirty.size > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                    <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />
                    {dirty.size.toLocaleString()} unsaved
                  </span>
                )}
              </div>
              <p className="m-0 text-[12px] text-muted">
                {allRows
                  ? `${visibleRows.length.toLocaleString()} settlements · ${counts.MISSING_GPS.toLocaleString()} missing GPS · ${counts.MISSING_POLYGON.toLocaleString()} missing polygon`
                  : loadingRegister
                    ? 'Loading the settlement register…'
                    : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {dirty.size > 0 && (
                <button type="button" className={btn.ghost} disabled={!!busy} onClick={() => setDialog({ kind: 'discard' })}>
                  Discard
                </button>
              )}
              <CsvButton
                disabled={!visibleRows.length}
                full={visibleRows.length}
                view={viewFiltered ? sorted.length : null}
                onFull={() => onCsv(visibleRows, 'full')}
                onView={() => onCsv(sorted, 'view')}
              />
              {(dirty.size > 0 || access.canCreate || access.canApprove) && (
                <button type="button" className={btn.secondary} disabled={!!busy || !dirty.size} onClick={onSave}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
              )}
              {access.canCreate && (
                <button
                  type="button"
                  className={btn.primary}
                  disabled={!!busy || !targets.submit.length}
                  title={targets.submit.length ? undefined : 'Nothing to submit in this view — edit a settlement’s GPS first'}
                  onClick={() => setDialog({ kind: 'submit' })}
                >
                  Submit{targets.submit.length > 0 && <Count n={targets.submit.length} light />}
                </button>
              )}
              {access.canApprove && (
                <>
                  <button
                    type="button"
                    className={btn.warn}
                    disabled={!!busy || !targets.review.length}
                    onClick={() => {
                      setComment('');
                      setOnlyRejected(targets.rejected.length > 0);
                      setDialog({ kind: 'sendBack' });
                    }}
                  >
                    Send back
                  </button>
                  <button
                    type="button"
                    className={btn.success}
                    disabled={!!busy || !targets.review.length}
                    onClick={() => {
                      setComment('');
                      setDialog({ kind: 'approve' });
                    }}
                  >
                    Approve{targets.review.length > 0 && <Count n={targets.review.length} light />}
                  </button>
                  <button
                    type="button"
                    className={btn.secondary}
                    disabled={!!busy || !targets.sync.length}
                    title={targets.sync.length ? undefined : 'No approved updates waiting to sync'}
                    onClick={() => setDialog({ kind: 'sync' })}
                  >
                    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
                      <path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 5.7 7.9l1.5 1.5A8 8 0 0 0 12 4zm0 14a6 6 0 0 1-5.7-7.9L4.8 8.6A8 8 0 0 0 12 20v3l4-4-4-4v3z" />
                    </svg>
                    Sync{targets.sync.length > 0 && <Count n={targets.sync.length} />}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ---- banners ---- */}
          <Banners
            hiddenByScope={hiddenByScope}
            captureNames={access.captureNames}
            widened={!!reg.data?.widened}
            sentBack={access.canCreate ? counts.SENT_BACK : 0}
            inReview={access.canApprove ? targets.review.length : 0}
            editsError={editsQ.isError ? (editsQ.error as Error)?.message : null}
          />

          {/* ---- filters ---- */}
          <div className="flex flex-col gap-2 border-b border-line bg-panel2/40 px-3 py-2.5 sm:px-4 lg:flex-row lg:items-center">
            <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-0.5" role="radiogroup" aria-label="Show">
              {FILTERS.filter((f) => f === 'ALL' || f === 'MISSING_GPS' || f === 'MISSING_POLYGON' || counts[f] > 0 || filter === f).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition',
                    filter === f ? 'bg-ink text-white ring-ink' : 'bg-panel text-muted ring-line hover:text-ink'
                  )}
                >
                  {ROW_FILTER_LABEL[f]}
                  <span className="ms-1.5 tabular-nums opacity-60">{counts[f].toLocaleString()}</span>
                </button>
              ))}
            </div>
            <div className="relative lg:w-72">
              <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 fill-faint" aria-hidden>
                <path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settlement, ward, LGA or ID…"
                className="w-full rounded-lg border border-line bg-panel py-1.5 pl-8 pr-2.5 text-[13px] text-ink shadow-card outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
              />
            </div>
          </div>

          {/* ---- table ---- */}
          {loadingRegister ? (
            <TableSkeleton loaded={reg.loaded} />
          ) : reg.isError || ouQ.isError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
              <p className="m-0 text-[13px] text-flag">
                Could not load settlements: {((reg.error || ouQ.error) as Error)?.message}
              </p>
              <button type="button" className={btn.secondary} onClick={() => reg.refetch()}>
                Try again
              </button>
            </div>
          ) : !allRows?.length ? (
            <Empty
              title="No settlements found"
              body={
                <>
                  The settlement register has no settlements for <strong>{ouName}</strong>. Check the org unit’s
                  name matches the register’s state, LGA and ward names, or that the hierarchy levels in
                  Settings → GPS places are right.
                </>
              }
            />
          ) : !visibleRows.length ? (
            <Empty
              title="None of these settlements are in your org units"
              body={
                <>
                  You can view settlements in {access.captureNames.join(', ') || 'your data capture org units'} only. Pick
                  an org unit inside them, or ask an administrator about view-all access.
                </>
              }
            />
          ) : (
            <>
              <SettlementTable
                rows={pageRows}
                offset={safePage * pageSize}
                editOf={editOf}
                isDirty={isDirty}
                accessOf={accessOf}
                sort={sort}
                onSort={onSort}
                handlers={handlers}
                resetKey={`${orgUnitId}|${safePage}|${pageSize}|${filter}|${deferredQuery}|${sort?.key}${sort?.dir}`}
              />
              {sorted.length === 0 && (
                <p className="m-0 border-t border-line px-4 py-6 text-center text-[13px] text-muted">
                  No settlements match.{' '}
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
                missingGps={counts.MISSING_GPS}
                households={counts.households}
                loadingEdits={editsQ.isLoading}
              />
            </>
          )}
        </section>
      )}

      {/* ---- dialogs ---- */}
      {dialog?.kind === 'map' && (
        <SettlementMapDialog
          key={`${dialog.r.id}:${dialog.mode}`}
          record={dialog.r}
          current={currentOf(dialog.r, editOf(dialog.r.id))}
          proposed={proposedOf(editOf(dialog.r.id))}
          status={editOf(dialog.r.id) ? GPS_STATUS_LABEL[editOf(dialog.r.id)!.status] : 'Not edited'}
          context={mapContext}
          mode={dialog.mode}
          onClose={() => setDialog(null)}
          onSave={(v, m) => applyProposal(dialog.r, v, m)}
          onStartPick={
            accessOf(dialog.r).edit && isEditableGps(editOf(dialog.r.id))
              ? () => setDialog({ kind: 'map', r: dialog.r, mode: 'pick' })
              : undefined
          }
        />
      )}

      {dialog?.kind === 'manual' && (
        <ManualGpsDialog
          record={dialog.r}
          initial={proposedOf(editOf(dialog.r.id)) ?? currentOf(dialog.r, editOf(dialog.r.id))}
          onClose={() => setDialog(null)}
          onSave={(v) => applyProposal(dialog.r, v, 'MANUAL')}
          onPickOnMap={() => setDialog({ kind: 'map', r: dialog.r, mode: 'pick' })}
        />
      )}

      {dialog?.kind === 'reject' && (
        <RejectDialog
          record={dialog.r}
          hasProposal={!!proposedOf(editOf(dialog.r.id))}
          initialNote={editOf(dialog.r.id)?.note ?? ''}
          onClose={() => setDialog(null)}
          onConfirm={(action, note) => applyReject(dialog.r, action, note)}
        />
      )}

      {dialog?.kind === 'submit' && (
        <PlanDialog
          title="Submit for review"
          description={`${targets.submit.length.toLocaleString()} settlement(s) in the current view will be submitted. They become read-only until a reviewer approves them or sends them back.`}
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className={btn.primary} disabled={!!busy} onClick={onSubmit}>
                {busy === 'submit' ? 'Submitting…' : `Submit ${targets.submit.length.toLocaleString()}`}
              </button>
            </>
          }
        >
          {dirty.size > 0 && (
            <p className="m-0 text-[12.5px] text-muted">Your other unsaved changes are saved at the same time.</p>
          )}
          {viewFiltered && (
            <p className="m-0 rounded-lg bg-sky-50 px-3 py-2 text-[12.5px] text-sky-900 ring-1 ring-inset ring-sky-200">
              Only the rows matching your search and filter are included. Clear them to submit everything you have edited
              here.
            </p>
          )}
        </PlanDialog>
      )}

      {dialog?.kind === 'approve' && (
        <DecisionDialog
          title="Approve settlements in review"
          description={
            <>
              {targets.review.length.toLocaleString()} settlement(s) in the current view are in review.{' '}
              <strong className="text-ink">Accepted</strong> and undecided rows are approved with their proposed GPS;{' '}
              <strong className="text-ink">rejected</strong> rows are closed as rejected, with their GPS blanked or kept as
              you chose. Approved changes join the sync queue.
            </>
          }
          summary={reviewSummary(targets.review, editOf)}
          comment={comment}
          setComment={setComment}
          commentLabel="Comment (optional)"
          onClose={() => setDialog(null)}
          action={
            <button type="button" className={btn.success} disabled={!!busy} onClick={onApprove}>
              {busy === 'approve' ? 'Approving…' : `Approve ${targets.review.length.toLocaleString()}`}
            </button>
          }
        />
      )}

      {dialog?.kind === 'sendBack' && (
        <DecisionDialog
          title="Send back for changes"
          description="The settlements return to draft so they can be corrected and re-submitted. Your row notes stay visible."
          summary={reviewSummary(targets.review, editOf)}
          comment={comment}
          setComment={setComment}
          commentLabel="Message to the editors (optional)"
          onClose={() => setDialog(null)}
          extra={
            targets.rejected.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={onlyRejected}
                  onChange={(e) => setOnlyRejected(e.target.checked)}
                />
                Only the {targets.rejected.length.toLocaleString()} rejected row(s)
              </label>
            )
          }
          action={
            <button type="button" className={btn.warn} disabled={!!busy} onClick={onSendBack}>
              {busy === 'sendBack'
                ? 'Sending…'
                : `Send back ${(onlyRejected && targets.rejected.length ? targets.rejected.length : targets.review.length).toLocaleString()}`}
            </button>
          }
        />
      )}

      {dialog?.kind === 'sync' && (
        <PlanDialog
          title="Sync to the settlement register"
          description={`${targets.sync.length.toLocaleString()} approved update(s) are waiting. Each carries its audit trail — who proposed, approved and synced it, and when.`}
          onClose={() => !busy && setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} disabled={!!busy} onClick={() => setDialog(null)}>
                Close
              </button>
              <button type="button" className={btn.secondary} onClick={onDownloadQueue}>
                Download queue (JSON)
              </button>
              <button type="button" className={btn.primary} disabled={!!busy || !syncEndpoint} onClick={onSync}>
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
            </>
          }
        >
          {!syncEndpoint ? (
            <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 ring-1 ring-inset ring-amber-200">
              The register’s update endpoint isn’t configured yet. Updates stay safely queued in DHIS2 until an administrator
              sets it in <strong>Settings → GPS places</strong>. You can download the queue meanwhile.
            </p>
          ) : (
            <p className="m-0 break-all text-[12px] text-muted">
              Endpoint: <code>{syncEndpoint}</code>
            </p>
          )}
          {syncProgress !== null && (
            <div className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${(syncProgress / Math.max(1, targets.sync.length)) * 100}%` }}
                />
              </div>
              <span className="text-[11.5px] tabular-nums text-muted">
                {syncProgress.toLocaleString()} of {targets.sync.length.toLocaleString()}
              </span>
            </div>
          )}
        </PlanDialog>
      )}

      {dialog?.kind === 'discard' && (
        <PlanDialog
          title="Discard unsaved changes?"
          description={`${dirty.size.toLocaleString()} unsaved change(s) will be thrown away. Saved drafts are not affected.`}
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className={btn.warn}
                onClick={() => {
                  clear();
                  setDialog(null);
                  setToast({ kind: 'ok', text: 'Unsaved changes discarded.' });
                }}
              >
                Discard
              </button>
            </>
          }
        />
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

/* ---- pieces ------------------------------------------------------------------------------ */

function reviewSummary(rows: SettlementRecord[], editOf: (id: string) => GpsEdit | undefined) {
  let accepted = 0;
  let rejected = 0;
  let undecided = 0;
  for (const r of rows) {
    const d = editOf(r.id)?.decision;
    if (d === 'ACCEPTED') accepted++;
    else if (d === 'REJECTED') rejected++;
    else undecided++;
  }
  return { accepted, rejected, undecided };
}

const Count: React.FC<{ n: number; light?: boolean }> = ({ n, light }) => (
  <span
    className={cn(
      'ms-1 rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
      light ? 'bg-white/25 text-current' : 'bg-panel2 text-muted'
    )}
  >
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

const DecisionDialog: React.FC<{
  title: string;
  description: React.ReactNode;
  summary: { accepted: number; rejected: number; undecided: number };
  comment: string;
  setComment: (s: string) => void;
  commentLabel: string;
  onClose: () => void;
  action: React.ReactNode;
  extra?: React.ReactNode;
}> = ({ title, description, summary, comment, setComment, commentLabel, onClose, action, extra }) => (
  <PlanDialog
    title={title}
    description={description}
    onClose={onClose}
    actions={
      <>
        <button type="button" className={btn.ghost} onClick={onClose}>
          Cancel
        </button>
        {action}
      </>
    }
  >
    <div className="grid grid-cols-3 gap-2 text-center">
      {[
        ['Accepted', summary.accepted, 'text-emerald-700 bg-emerald-50 ring-emerald-200'],
        ['Rejected', summary.rejected, 'text-rose-700 bg-rose-50 ring-rose-200'],
        ['Undecided', summary.undecided, 'text-muted bg-panel2 ring-line'],
      ].map(([label, n, cls]) => (
        <div key={label as string} className={cn('rounded-lg px-2 py-2 ring-1 ring-inset', cls as string)}>
          <div className="text-[18px] font-semibold tabular-nums">{(n as number).toLocaleString()}</div>
          <div className="text-[11px] font-medium uppercase tracking-wider">{label as string}</div>
        </div>
      ))}
    </div>
    {extra}
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">{commentLabel}</span>
      <textarea rows={3} className={textareaCls} value={comment} onChange={(e) => setComment(e.target.value)} />
    </label>
  </PlanDialog>
);

const CsvButton: React.FC<{
  disabled: boolean;
  full: number;
  view: number | null;
  onFull: () => void;
  onView: () => void;
}> = ({ disabled, full, view, onFull, onView }) => {
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
  hiddenByScope: number;
  captureNames: string[];
  widened: boolean;
  sentBack: number;
  inReview: number;
  editsError: string | null;
}> = ({ hiddenByScope, captureNames, widened, sentBack, inReview, editsError }) => {
  const box = 'rounded-lg px-3 py-2 text-[12.5px] ring-1 ring-inset';
  const items: React.ReactNode[] = [];
  if (editsError)
    items.push(
      <div key="err" className={cn(box, 'bg-rose-50 text-rose-800 ring-rose-200')}>
        Could not load saved changes: {editsError}
      </div>
    );
  if (inReview > 0)
    items.push(
      <div key="rev" className={cn(box, 'bg-violet-50 text-violet-900 ring-violet-200')}>
        <strong>{inReview.toLocaleString()}</strong> settlement(s) in this view are waiting for your review. Accept or reject
        each, add notes where needed, then <strong>Approve</strong> or <strong>Send back</strong>.
      </div>
    );
  if (sentBack > 0)
    items.push(
      <div key="sb" className={cn(box, 'bg-amber-50 text-amber-900 ring-amber-200')}>
        <strong>{sentBack.toLocaleString()}</strong> settlement(s) were sent back. Filter by <em>Sent back</em>, read the
        review notes, correct them and submit again.
      </div>
    );
  if (hiddenByScope > 0)
    items.push(
      <div key="scope" className={cn(box, 'bg-panel2 text-muted ring-line')}>
        {hiddenByScope.toLocaleString()} settlement(s) outside your data capture org units
        {captureNames.length ? ` (${captureNames.slice(0, 3).join(', ')}${captureNames.length > 3 ? '…' : ''})` : ''} are
        hidden.
      </div>
    );
  if (widened)
    items.push(
      <div key="wide" className={cn(box, 'bg-sky-50 text-sky-900 ring-sky-200')}>
        The register has no exact name match for this org unit, so the nearest wider area is listed. Check the org unit’s
        spelling against the register.
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
  missingGps: number;
  households: number;
  loadingEdits: boolean;
}> = ({ total, page, pageCount, pageSize, onPage, onPageSize, missingGps, households, loadingEdits }) => {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const nav =
    'grid size-8 place-items-center rounded-md border border-line bg-panel text-[13px] text-ink hover:border-accent/60 disabled:opacity-40 disabled:hover:border-line';
  return (
    <div className="flex flex-col gap-2 border-t border-line bg-panel2/50 px-3 py-2 text-[12px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-4">
      {/* Excel-style status bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="tabular-nums">
          {from.toLocaleString()}–{to.toLocaleString()} of <strong className="text-ink">{total.toLocaleString()}</strong>
        </span>
        <span className="hidden tabular-nums md:inline">
          Missing GPS <strong className="text-ink">{missingGps.toLocaleString()}</strong>
        </span>
        <span className="hidden tabular-nums md:inline">
          Σ households <strong className="text-ink">{households.toLocaleString()}</strong>
        </span>
        {loadingEdits && <span className="animate-pulse">Loading saved changes…</span>}
        <span className="hidden text-faint xl:inline">↑↓ move · Enter opens map · double-click a row</span>
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

const TableSkeleton: React.FC<{ loaded: number }> = ({ loaded }) => (
  <div className="flex flex-1 flex-col gap-2 p-4" aria-busy aria-label="Loading settlements">
    <div className="h-9 w-full animate-pulse rounded-md bg-panel2" />
    {Array.from({ length: 8 }, (_, i) => (
      <div key={i} className="flex gap-2">
        <div className="h-10 w-12 animate-pulse rounded-md bg-panel2" />
        <div className="h-10 w-1/4 animate-pulse rounded-md bg-panel2" />
        <div className="h-10 flex-1 animate-pulse rounded-md bg-panel2/70" />
      </div>
    ))}
    <p className="m-0 pt-1 text-center text-[12px] tabular-nums text-muted">
      Loading the settlement register{loaded > 0 && ` — ${loaded.toLocaleString()} rows so far`}…
    </p>
  </div>
);

const Empty: React.FC<{ title: string; body: React.ReactNode }> = ({ title, body }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-14 text-center">
    <div className="grid size-12 place-items-center rounded-full bg-panel2 text-xl text-faint" aria-hidden>
      ∅
    </div>
    <p className="m-0 text-[14px] font-semibold text-ink">{title}</p>
    <p className="m-0 max-w-md text-[13px] text-muted">{body}</p>
  </div>
);

const Intro: React.FC<{ canCreate: boolean; canApprove: boolean }> = ({ canCreate, canApprove }) => {
  const steps = [
    {
      n: 1,
      title: 'Choose an org unit',
      body: 'A state, LGA or ward. Every settlement the register holds there is listed, with missing GPS and polygons flagged.',
    },
    {
      n: 2,
      title: canCreate ? 'Fill the gaps' : 'Inspect',
      body: canCreate
        ? 'Use GPS on a row to type coordinates or pick them on the map — a point, or the area drawn freehand. Save as you go, then submit.'
        : 'Open any row on the map to see its point, its polygon and the other settlements around it.',
    },
    {
      n: 3,
      title: canApprove ? 'Review and sync' : 'Review',
      body: canApprove
        ? 'Accept or reject each submitted row, add notes, then approve or send back. Approved changes are synced to the register.'
        : 'A reviewer accepts or rejects each row. Rows sent back come back to you with notes.',
    },
  ];
  return (
    <section className="grid gap-3 md:grid-cols-3">
      {steps.map((s) => (
        <div key={s.n} className="flex gap-3 rounded-xl border border-line bg-panel p-4 shadow-card">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent/10 text-[13px] font-bold text-accent">
            {s.n}
          </span>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-[13.5px] font-semibold text-ink">{s.title}</p>
            <p className="m-0 text-[12.5px] text-muted">{s.body}</p>
          </div>
        </div>
      ))}
    </section>
  );
};
