import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CreatePlanFilterBar, type CreatePlanFilters } from '../components/create/CreatePlanFilterBar';
import { MicroplanGrid, type GridMode, type LevelColumn } from '../components/create/MicroplanGrid';
import { PlanDialog, btn, textareaCls } from '../components/create/PlanDialog';
import { SearchableSelect } from '../components/SearchableSelect';
import { useCreatePlanStore } from '../store/useCreatePlanStore';
import { useUserPermissions } from '../hooks/useUserPermissions';
import { usePrograms } from '../hooks/usePrograms';
import { useUsers } from '../hooks/useUsers';
import { useOrgUnitLevels } from '../hooks/useOrgUnitLevels';
import { useOrgUnitsByIds } from '../hooks/useOrgUnits';
import {
  prefetchScopes,
  scopeOf,
  useCreatedPlan,
  useCreatedPlanIndex,
  useDeleteCreatedPlan,
  useFacilityUsers,
  usePlanFacilities,
  useSaveCreatedPlan,
  type SettlementScope,
} from '../hooks/useCreatePlan';
import {
  PlanConflictError,
  STATUS_LABEL,
  createdPlanId,
  isEditableStatus,
  type CreatedPlan,
  type CreatedPlanIndexEntry,
  type HistoryEntry,
  type PlanStatus,
  type UserRef,
} from '../lib/createdPlanStore';
import { compactRows, downloadText, mergeRows, rowsToCsv, safeFileName } from '../lib/planRows';
import { DEFAULT_REPORTING_CYCLE, periodLabel, planColumns, scheduleOf } from '../lib/planSchedule';
import { useMicroplanSettings } from '../hooks/useMicroplanSettings';
import { cn } from '../lib/ui';

/**
 * Create Microplan (#/create).
 *
 * Pick programme × org unit × schedule × period, and the page lays out every
 * facility the programme is assigned to under that unit — one row per person
 * assigned to it — against the weeks (or months) of the period. Each cell is a
 * searchable multi-select of the settlements in the facility's ward.
 *
 * Workflow (see lib/createdPlanStore.ts): a planner with F_CREATE_MICROPLAN
 * saves drafts and submits to a named reviewer; the reviewer, holding
 * F_APPROVE_MICROPLAN, adds per-row notes and approves or sends it back. A
 * plan that has been sent back is editable again until it is re-submitted.
 */

const PAGE_SIZES = [25, 50, 100, 250, 500];

const STATUS_STYLE: Record<PlanStatus | 'NEW', string> = {
  NEW: 'bg-panel2 text-muted ring-line',
  DRAFT: 'bg-sky-50 text-sky-700 ring-sky-200',
  SUBMITTED: 'bg-violet-50 text-violet-700 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SENT_BACK: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const StatusPill: React.FC<{ status: PlanStatus | undefined; className?: string }> = ({
  status,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset',
      STATUS_STYLE[status ?? 'NEW'],
      className
    )}
  >
    <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden />
    {status ? STATUS_LABEL[status] : 'Not started'}
  </span>
);

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

type Dialog = 'submit' | 'approve' | 'sendBack' | 'discardPlan' | 'discardChanges' | null;

export const CreateMicroplanPage: React.FC = () => {
  const qc = useQueryClient();
  const { permissions } = useUserPermissions();
  const canCreate = permissions?.can('F_CREATE_MICROPLAN') ?? false;
  const canApprove = permissions?.can('F_APPROVE_MICROPLAN') ?? false;
  const me: UserRef | null = useMemo(
    () =>
      permissions
        ? { id: permissions.id, username: permissions.username, name: permissions.displayName }
        : null,
    [permissions]
  );

  const {
    filters,
    patchFilters,
    resetFilters,
    showList,
    setShowList,
    rows,
    rowsFor,
    staleKeys,
    dirty,
    loadRows,
    setCell,
    setNote,
    markClean,
  } = useCreatePlanStore();
  const { data: settings } = useMicroplanSettings();
  const cycle = settings?.reportingCycle ?? DEFAULT_REPORTING_CYCLE;
  const { data: planIndex = [] } = useCreatedPlanIndex();
  const { programId, orgUnitId, schedule, period } = filters;

  // Moving to another plan replaces the grid, so don't let that happen to
  // unsaved edits without asking.
  const changeFilters = useCallback(
    (patch: Partial<CreatePlanFilters>) => {
      const next = { ...filters, ...patch };
      const samePlan =
        next.programId === filters.programId &&
        next.orgUnitId === filters.orgUnitId &&
        next.period === filters.period;
      if (
        dirty &&
        !samePlan &&
        !window.confirm('You have unsaved changes to this microplan. Discard them and open another?')
      ) {
        return;
      }
      if (dirty && !samePlan) markClean();
      patchFilters(patch);
    },
    [filters, dirty, markClean, patchFilters]
  );

  const onResetFilters = () => {
    if (
      dirty &&
      !window.confirm('You have unsaved changes to this microplan. Discard them and reset the filters?')
    ) {
      return;
    }
    resetFilters();
  };
  const ready = !!(programId && orgUnitId && period);
  const planId = ready ? createdPlanId(programId!, orgUnitId!, period!) : null;

  // ---- data ----------------------------------------------------------------
  const facilitiesQ = usePlanFacilities(ready ? orgUnitId : null, programId);
  const facilities = useMemo(() => facilitiesQ.data ?? [], [facilitiesQ.data]);
  const facilityIds = useMemo(() => facilities.map((f) => f.id), [facilities]);
  const usersQ = useFacilityUsers(facilityIds);
  const planQ = useCreatedPlan(planId);
  const plan = planQ.data ?? null;
  const save = useSaveCreatedPlan();

  const { data: programs = [] } = usePrograms();
  const { data: ouLevels = [] } = useOrgUnitLevels();
  const { data: ouById = {} } = useOrgUnitsByIds(orgUnitId ? [orgUnitId] : []);
  const programName = programs.find((p) => p.id === programId)?.name ?? plan?.programName ?? '';
  const orgUnit = orgUnitId ? ouById[orgUnitId] : undefined;
  const orgUnitName = orgUnit?.name ?? plan?.orgUnitName ?? '';

  const columns = useMemo(
    () => plan?.columns ?? (ready ? planColumns(period!) : []),
    [plan?.columns, ready, period]
  );

  const status = plan?.status;
  const editable = isEditableStatus(status);
  const isAssignedReviewer =
    !!plan &&
    status === 'SUBMITTED' &&
    canApprove &&
    (!!permissions?.isSuperuser || !plan.reviewer || plan.reviewer.id === me?.id);

  // ---- rows: merge live assignments with the saved plan ---------------------
  const liveReady =
    ready &&
    facilitiesQ.isSuccess &&
    (facilities.length === 0 || usersQ.isSuccess) &&
    planQ.isSuccess;
  const lastMerged = useRef<string | null>(null);
  const mergeSig = `${planId}|${plan?.updatedAt ?? '-'}|${facilitiesQ.dataUpdatedAt}|${usersQ.dataUpdatedAt}`;

  useEffect(() => {
    if (!liveReady || !planId) return;
    // Unsaved edits for this same plan (e.g. after switching tabs) win over a
    // background refetch; only a new plan, or a save, replaces them.
    if (rowsFor === planId && dirty) return;
    if (lastMerged.current === mergeSig && rowsFor === planId) return;
    lastMerged.current = mergeSig;
    const merged = mergeRows(facilities, usersQ.data ?? new Map(), plan);
    loadRows(planId, merged.rows, merged.staleKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveReady, mergeSig, planId, dirty]);

  const gridRows = rowsFor === planId ? rows : [];
  const loading = ready && (!liveReady || rowsFor !== planId);

  // unsaved-changes guard for closing the tab
  useEffect(() => {
    if (!dirty) return;
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [dirty]);

  // ---- columns & mode --------------------------------------------------------
  const levelName = useCallback(
    (level: number) => ouLevels.find((l) => l.level === level)?.name ?? `Level ${level}`,
    [ouLevels]
  );

  // Keyed on a string so editing a cell (a new rows array) doesn't hand the
  // grid a new `levels` array and re-render every memoised row.
  const levelKey = useMemo(() => {
    const set = new Set<number>();
    for (const r of gridRows) for (const a of r.ancestors) set.add(a.level);
    return [...set].sort((a, b) => a - b).join(',');
  }, [gridRows]);
  const allLevels: LevelColumn[] = useMemo(
    () =>
      levelKey
        ? levelKey.split(',').map(Number).map((level) => ({ level, name: levelName(level) }))
        : [],
    [levelKey, levelName]
  );

  // In the grid, only the levels from the chosen unit down — the ones above it
  // are the same on every row. The CSV keeps them all.
  const gridLevels = useMemo(
    () => allLevels.filter((l) => l.level >= (orgUnit?.level ?? 0)),
    [allLevels, orgUnit?.level]
  );

  const hasNotes = gridRows.some((r) => r.note);
  const mode: GridMode = useMemo(
    () => ({
      editCells: canCreate && editable,
      editNotes: isAssignedReviewer,
      showNotes: isAssignedReviewer || hasNotes || (!!status && status !== 'DRAFT'),
    }),
    [canCreate, editable, isAssignedReviewer, hasNotes, status]
  );

  // ---- search, filter, paging ------------------------------------------------
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return gridRows.filter((r) => {
      if (onlyEmpty && columns.every((c) => (r.cells[c.key] ?? []).length > 0)) return false;
      if (!q) return true;
      return (
        r.facility.name.toLowerCase().includes(q) ||
        (r.user?.name.toLowerCase().includes(q) ?? false) ||
        (r.user?.username.toLowerCase().includes(q) ?? false) ||
        r.ancestors.some((a) => a.name.toLowerCase().includes(q))
      );
    });
  }, [gridRows, deferredSearch, onlyEmpty, columns]);

  useEffect(() => setPage(0), [deferredSearch, onlyEmpty, pageSize, planId]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => filtered.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [filtered, safePage, pageSize]
  );

  // Warm the settlement lists for the wards on this page, a few at a time, so
  // the first cell a planner opens is already loaded.
  useEffect(() => {
    if (!mode.editCells || !pageRows.length) return;
    const seen = new Map<string, SettlementScope>();
    for (const r of pageRows) {
      const s = scopeOf(r.ancestors);
      if (s && !seen.has(s.id)) seen.set(s.id, s);
    }
    const t = setTimeout(() => void prefetchScopes(qc, [...seen.values()].slice(0, 25)), 400);
    return () => clearTimeout(t);
  }, [pageRows, mode.editCells, qc]);

  // ---- stats -------------------------------------------------------------------
  const stats = useMemo(() => {
    let filled = 0;
    const settlements = new Set<string>();
    for (const r of gridRows) {
      for (const c of columns) {
        const items = r.cells[c.key] ?? [];
        if (items.length) filled++;
        for (const i of items) settlements.add(i.id);
      }
    }
    return {
      rows: gridRows.length,
      facilities: new Set(gridRows.map((r) => r.facility.id)).size,
      cells: gridRows.length * columns.length,
      filled,
      settlements: settlements.size,
      unassigned: gridRows.filter((r) => !r.user).length,
    };
  }, [gridRows, columns]);
  const pct = stats.cells ? Math.round((stats.filled / stats.cells) * 100) : 0;

  // ---- persistence -------------------------------------------------------------
  const [dialog, setDialog] = useState<Dialog>(null);
  const [comment, setComment] = useState('');
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ plan: CreatedPlan; remote: CreatedPlan } | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'ok' ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const { data: allUsers = [], isLoading: usersLoading } = useUsers();
  const userOptions = useMemo(
    () => allUsers.filter((u) => u.id !== me?.id).map((u) => ({ id: u.id, label: u.name, sublabel: u.username })),
    [allUsers, me?.id]
  );

  const buildPlan = (
    patch: Partial<CreatedPlan>,
    action: HistoryEntry['action'],
    note?: string
  ): CreatedPlan => {
    const now = new Date().toISOString();
    const history: HistoryEntry[] = [...(plan?.history ?? [])];
    if (!plan) history.push({ at: now, by: me!, action: 'CREATED' });
    history.push({ at: now, by: me!, action, ...(note ? { comment: note } : {}) });
    return {
      version: 1,
      id: planId!,
      programId: programId!,
      programName,
      orgUnitId: orgUnitId!,
      orgUnitName,
      schedule: plan?.schedule ?? scheduleOf(period!) ?? schedule,
      period: period!,
      status: plan?.status ?? 'DRAFT',
      createdBy: plan?.createdBy ?? me!,
      createdAt: plan?.createdAt ?? now,
      updatedAt: now,
      updatedBy: me!,
      reviewer: plan?.reviewer ?? null,
      rowCount: gridRows.length,
      columns,
      rows: compactRows(gridRows),
      history: history.slice(-200),
      ...patch,
    };
  };

  const persist = async (next: CreatedPlan, okText: string, force = false) => {
    try {
      await save.mutateAsync({ plan: next, expectedUpdatedAt: plan?.updatedAt ?? null, force });
      markClean();
      setDialog(null);
      setConflict(null);
      setComment('');
      setToast({ kind: 'ok', text: okText });
    } catch (e) {
      if (e instanceof PlanConflictError) {
        setDialog(null);
        setConflict({ plan: next, remote: e.remote });
      } else {
        setToast({ kind: 'err', text: `Could not save: ${(e as Error)?.message ?? e}` });
      }
    }
  };

  const onSave = () =>
    persist(buildPlan({}, 'SAVED'), isAssignedReviewer ? 'Review notes saved.' : 'Draft saved.');

  const onSubmit = () => {
    const reviewer = allUsers.find((u) => u.id === reviewerId);
    if (!reviewer) return;
    void persist(
      buildPlan(
        { status: 'SUBMITTED', reviewer: { id: reviewer.id, name: reviewer.name, username: reviewer.username } },
        'SUBMITTED',
        comment.trim()
      ),
      `Submitted to ${reviewer.name} for review.`
    );
  };

  const onDecide = (decision: 'APPROVED' | 'SENT_BACK') =>
    persist(
      buildPlan({ status: decision }, decision, comment.trim()),
      decision === 'APPROVED' ? 'Microplan approved.' : 'Microplan sent back for changes.'
    );

  const onReloadTheirs = async () => {
    setConflict(null);
    markClean();
    lastMerged.current = null;
    await planQ.refetch();
  };

  const onCsv = () => {
    const csv = rowsToCsv(gridRows, columns, allLevels, {
      includeNotes: mode.showNotes,
      status: status ? STATUS_LABEL[status] : 'Not started',
      period: periodLabel(period ?? ''),
    });
    downloadText(csv, `${safeFileName(`microplan ${programName} ${orgUnitName} ${period}`)}.csv`);
  };

  const lastSendBack = useMemo(
    () => [...(plan?.history ?? [])].reverse().find((h) => h.action === 'SENT_BACK'),
    [plan?.history]
  );
  const lastSubmit = useMemo(
    () => [...(plan?.history ?? [])].reverse().find((h) => h.action === 'SUBMITTED'),
    [plan?.history]
  );

  // ---- discarding ------------------------------------------------------------
  const del = useDeleteCreatedPlan();

  /** Throw away unsaved edits: reload the grid from the saved plan (or blank). */
  const onDiscardChanges = () => {
    markClean();
    lastMerged.current = null;
    setDialog(null);
    setToast({ kind: 'ok', text: 'Unsaved changes discarded.' });
  };

  /** Delete the whole draft from the dataStore and go back to the list. */
  const onDiscardPlan = async () => {
    if (!planId) return;
    try {
      await del.mutateAsync(planId);
      markClean();
      lastMerged.current = null;
      setDialog(null);
      setShowList(true);
      setToast({ kind: 'ok', text: 'Microplan discarded.' });
    } catch (e) {
      setToast({ kind: 'err', text: `Could not discard: ${(e as Error)?.message ?? e}` });
    }
  };

  const busy = save.isPending || del.isPending;
  const listView = !ready || showList;

  // ---- render --------------------------------------------------------------------
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-3 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 flex items-center gap-2 text-xl font-semibold tracking-tight text-ink sm:text-[22px]">
            Create microplan
          </h2>
          <p className="m-0 max-w-[75ch] text-[13px] text-muted">
            Plan which settlements each facility team visits, week by week. Save as you go, then
            submit for review.
          </p>
        </div>
        {/* The way back to every created plan, from wherever you are. */}
        <div className="flex shrink-0 gap-2">
          {listView && ready && (
            <button type="button" className={btn.secondary} onClick={() => setShowList(false)}>
              ← Back to {orgUnitName || 'plan'} · {periodLabel(period!)}
            </button>
          )}
          {!listView && (
            <button type="button" className={btn.secondary} onClick={() => setShowList(true)}>
              <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
                <path d="M4 5h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zM4 17h2v2H4zm4 0h12v2H8z" />
              </svg>
              All microplans
              {planIndex.length > 0 && (
                <span className="rounded-full bg-panel2 px-1.5 text-[11px] font-semibold text-muted">
                  {planIndex.length}
                </span>
              )}
            </button>
          )}
        </div>
      </header>

      <CreatePlanFilterBar
        value={filters}
        onChange={changeFilters}
        onReset={onResetFilters}
        cycle={cycle}
      />

      {listView && (
        <PlanCatalogue me={me} canApprove={canApprove} onOpen={changeFilters} currentId={planId} />
      )}

      {!listView && (
        <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          {/* ---- title + workflow actions ---- */}
          <div className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:px-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 truncate text-[15px] font-semibold text-ink">
                  {orgUnitName || '…'} · {periodLabel(period!)}
                </h3>
                <StatusPill status={status} />
                {dirty && (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-amber-700">
                    <span className="size-1.5 rounded-full bg-amber-500" aria-hidden /> Unsaved changes
                  </span>
                )}
              </div>
              <p className="m-0 truncate text-[12px] text-muted">
                {programName}
                {plan && (
                  <>
                    {' · '}Last saved {when(plan.updatedAt)} by {plan.updatedBy.name}
                  </>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {dirty && (
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={busy}
                  onClick={() => setDialog('discardChanges')}
                >
                  Discard changes
                </button>
              )}
              {plan && canCreate && editable && (
                <button
                  type="button"
                  className={cn(btn.ghost, 'text-flag hover:bg-flag/10 hover:text-flag')}
                  disabled={busy}
                  onClick={() => setDialog('discardPlan')}
                >
                  Discard microplan
                </button>
              )}
              <button type="button" className={btn.secondary} onClick={onCsv} disabled={!gridRows.length}>
                <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
                  <path d="M12 3v10.6l3.3-3.3 1.4 1.4L12 16.4l-4.7-4.7 1.4-1.4 3.3 3.3V3h2zM5 19h14v2H5z" transform="translate(-1 0)" />
                </svg>
                CSV
              </button>
              {mode.editCells && (
                <>
                  <button type="button" className={btn.secondary} onClick={onSave} disabled={busy || !dirty}>
                    {busy ? 'Saving…' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    className={btn.primary}
                    disabled={busy || !gridRows.length}
                    onClick={() => {
                      setComment('');
                      setReviewerId(plan?.reviewer?.id ?? null);
                      setDialog('submit');
                    }}
                  >
                    {status === 'SENT_BACK' ? 'Re-submit' : 'Submit for review'}
                  </button>
                </>
              )}
              {isAssignedReviewer && (
                <>
                  <button type="button" className={btn.secondary} onClick={onSave} disabled={busy || !dirty}>
                    Save notes
                  </button>
                  <button
                    type="button"
                    className={btn.warn}
                    disabled={busy}
                    onClick={() => {
                      setComment('');
                      setDialog('sendBack');
                    }}
                  >
                    Send back
                  </button>
                  <button
                    type="button"
                    className={btn.success}
                    disabled={busy}
                    onClick={() => {
                      setComment('');
                      setDialog('approve');
                    }}
                  >
                    Approve
                  </button>
                </>
              )}
            </div>
          </div>

          {/* ---- status banner ---- */}
          <StatusBanner
            plan={plan}
            canCreate={canCreate}
            isAssignedReviewer={isAssignedReviewer}
            lastSendBack={lastSendBack}
            lastSubmit={lastSubmit}
            loading={loading}
          />

          {/* ---- progress + grid tools ---- */}
          {!loading && gridRows.length > 0 && (
            <div className="flex flex-col gap-3 border-b border-line bg-panel2/40 px-3 py-2.5 sm:px-4 md:flex-row md:items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
                <span>
                  <strong className="font-semibold text-ink">{stats.facilities.toLocaleString()}</strong> facilities
                </span>
                <span>
                  <strong className="font-semibold text-ink">{stats.rows.toLocaleString()}</strong> rows
                </span>
                <span>
                  <strong className="font-semibold text-ink">{stats.settlements.toLocaleString()}</strong> settlements planned
                </span>
                {stats.unassigned > 0 && (
                  <span className="text-amber-700">{stats.unassigned} without an assigned user</span>
                )}
                <span className="flex items-center gap-2" title={`${stats.filled} of ${stats.cells} cells planned`}>
                  <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="tabular-nums">{pct}% planned</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center md:justify-end">
                <label className="inline-flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-muted">
                  <input
                    type="checkbox"
                    checked={onlyEmpty}
                    onChange={(e) => setOnlyEmpty(e.target.checked)}
                    className="size-4 accent-accent"
                  />
                  Rows with gaps only
                </label>
                <div className="relative sm:w-64">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-faint" aria-hidden>
                    ⌕
                  </span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find facility, ward or person…"
                    className="w-full rounded-lg border border-line bg-panel py-1.5 pl-7 pr-2.5 text-[13px] text-ink shadow-card outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ---- grid ---- */}
          {loading ? (
            <GridSkeleton />
          ) : facilitiesQ.isError || usersQ.isError || planQ.isError ? (
            <p className="m-0 px-4 py-10 text-center text-[13px] text-flag">
              Could not load this microplan:{' '}
              {((facilitiesQ.error || usersQ.error || planQ.error) as Error)?.message}
            </p>
          ) : gridRows.length === 0 ? (
            <EmptyState orgUnitName={orgUnitName} programName={programName} />
          ) : (
            <>
              <div className="max-h-[calc(100vh-18rem)] min-h-[16rem] overflow-auto overscroll-contain">
                <MicroplanGrid
                  rows={pageRows}
                  offset={safePage * pageSize}
                  columns={columns}
                  levels={gridLevels}
                  mode={mode}
                  staleKeys={staleKeys}
                  onCellChange={setCell}
                  onNoteChange={setNote}
                />
                {filtered.length === 0 && (
                  <p className="m-0 px-4 py-8 text-center text-[13px] text-muted">No rows match.</p>
                )}
              </div>
              <Pager
                total={filtered.length}
                page={safePage}
                pageCount={pageCount}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={setPageSize}
              />
            </>
          )}
        </section>
      )}

      {/* ---- dialogs ---- */}
      {dialog === 'submit' && (
        <PlanDialog
          title={status === 'SENT_BACK' ? 'Re-submit for review' : 'Submit for review'}
          description="Once submitted, the plan is read-only until the reviewer approves it or sends it back."
          allowOverflow
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button type="button" className={btn.primary} disabled={!reviewerId || busy} onClick={onSubmit}>
                {busy ? 'Submitting…' : 'Submit'}
              </button>
            </>
          }
        >
          {stats.filled < stats.cells && (
            <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 ring-1 ring-inset ring-amber-200">
              {(stats.cells - stats.filled).toLocaleString()} of {stats.cells.toLocaleString()} cells are still
              empty. You can submit anyway.
            </p>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">
              Reviewer <span className="text-flag">*</span>
            </span>
            <SearchableSelect
              options={userOptions}
              value={reviewerId}
              allLabel={usersLoading ? 'Loading users…' : 'Choose a reviewer'}
              placeholder="Search name or username…"
              bracketSublabel
              onChange={setReviewerId}
            />
            <span className="text-[11.5px] text-faint">
              The reviewer needs the <code>F_APPROVE_MICROPLAN</code> authority.
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Message (optional)</span>
            <textarea
              rows={3}
              className={textareaCls}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Anything the reviewer should know…"
            />
          </label>
        </PlanDialog>
      )}

      {(dialog === 'approve' || dialog === 'sendBack') && (
        <PlanDialog
          title={dialog === 'approve' ? 'Approve microplan' : 'Send back for changes'}
          description={
            dialog === 'approve'
              ? 'The plan becomes final and read-only for everyone.'
              : 'The planner can edit the plan again and re-submit it. Your row notes stay visible to them.'
          }
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Cancel
              </button>
              {dialog === 'approve' ? (
                <button type="button" className={btn.success} disabled={busy} onClick={() => onDecide('APPROVED')}>
                  {busy ? 'Approving…' : 'Approve'}
                </button>
              ) : (
                <button
                  type="button"
                  className={btn.warn}
                  disabled={busy || !comment.trim()}
                  onClick={() => onDecide('SENT_BACK')}
                >
                  {busy ? 'Sending…' : 'Send back'}
                </button>
              )}
            </>
          }
        >
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">
              {dialog === 'approve' ? 'Comment (optional)' : 'What needs to change?'}
              {dialog === 'sendBack' && <span className="text-flag"> *</span>}
            </span>
            <textarea
              rows={3}
              autoFocus
              className={textareaCls}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={dialog === 'approve' ? 'Optional comment…' : 'Summarise the changes you need…'}
            />
          </label>
        </PlanDialog>
      )}

      {dialog === 'discardChanges' && (
        <PlanDialog
          title="Discard unsaved changes?"
          description={
            plan
              ? `The grid goes back to what was last saved (${when(plan.updatedAt)} by ${plan.updatedBy.name}).`
              : 'Nothing has been saved for this microplan yet, so the grid goes back to empty.'
          }
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Keep editing
              </button>
              <button type="button" className={btn.warn} onClick={onDiscardChanges}>
                Discard changes
              </button>
            </>
          }
        />
      )}

      {dialog === 'discardPlan' && (
        <PlanDialog
          title="Discard this microplan?"
          description={
            <>
              This permanently deletes the {status === 'SENT_BACK' ? 'sent-back' : 'draft'} microplan for{' '}
              <strong>{orgUnitName}</strong> · {periodLabel(period!)} — every planned settlement, review
              note and its history — for everyone. It can't be undone.
            </>
          }
          onClose={() => setDialog(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={cn(btn.primary, 'bg-flag focus-visible:ring-flag/50')}
                disabled={busy}
                onClick={onDiscardPlan}
              >
                {del.isPending ? 'Discarding…' : 'Discard microplan'}
              </button>
            </>
          }
        />
      )}

      {conflict && (
        <PlanDialog
          title="Someone else saved this microplan"
          description={`${conflict.remote.updatedBy.name} saved it at ${when(conflict.remote.updatedAt)}, after you opened it. Saving now would replace their changes.`}
          onClose={() => setConflict(null)}
          actions={
            <>
              <button type="button" className={btn.ghost} onClick={() => setConflict(null)}>
                Cancel
              </button>
              <button type="button" className={btn.secondary} onClick={onReloadTheirs}>
                Discard mine, load theirs
              </button>
              <button
                type="button"
                className={btn.warn}
                disabled={busy}
                onClick={() => persist(conflict.plan, 'Saved over the other version.', true)}
              >
                Overwrite with mine
              </button>
            </>
          }
        />
      )}

      {toast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-float',
            toast.kind === 'ok' ? 'bg-ink text-white' : 'bg-flag text-white'
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

/* ---- pieces --------------------------------------------------------------- */

const StatusBanner: React.FC<{
  plan: CreatedPlan | null;
  canCreate: boolean;
  isAssignedReviewer: boolean;
  lastSendBack?: HistoryEntry;
  lastSubmit?: HistoryEntry;
  loading: boolean;
}> = ({ plan, canCreate, isAssignedReviewer, lastSendBack, lastSubmit, loading }) => {
  if (loading) return null;
  const box = 'm-3 mb-0 rounded-lg px-3.5 py-2.5 text-[12.5px] ring-1 ring-inset sm:mx-4';

  if (!plan) {
    return canCreate ? null : (
      <div className={cn(box, 'mb-3 bg-panel2 text-muted ring-line')}>
        No microplan has been started for this selection yet. It can be created by someone with the{' '}
        <code>F_CREATE_MICROPLAN</code> authority.
      </div>
    );
  }
  if (plan.status === 'SUBMITTED') {
    return (
      <div className={cn(box, 'mb-3 bg-violet-50 text-violet-800 ring-violet-200')}>
        Submitted by <strong>{lastSubmit?.by.name ?? plan.updatedBy.name}</strong> on {when(lastSubmit?.at)}
        {plan.reviewer && (
          <>
            {' '}· awaiting review by <strong>{plan.reviewer.name}</strong>
          </>
        )}
        .{' '}
        {isAssignedReviewer
          ? 'Add a note to any row that needs attention, then approve or send it back.'
          : 'The plan is read-only while it is in review.'}
        {lastSubmit?.comment && <p className="m-0 mt-1 italic">“{lastSubmit.comment}”</p>}
      </div>
    );
  }
  if (plan.status === 'SENT_BACK') {
    return (
      <div className={cn(box, 'mb-3 bg-amber-50 text-amber-900 ring-amber-200')}>
        Sent back by <strong>{lastSendBack?.by.name}</strong> on {when(lastSendBack?.at)}. Row notes are in
        the last column — make the changes and re-submit.
        {lastSendBack?.comment && <p className="m-0 mt-1 italic">“{lastSendBack.comment}”</p>}
      </div>
    );
  }
  if (plan.status === 'APPROVED') {
    const approved = [...plan.history].reverse().find((h) => h.action === 'APPROVED');
    return (
      <div className={cn(box, 'mb-3 bg-emerald-50 text-emerald-800 ring-emerald-200')}>
        Approved by <strong>{approved?.by.name}</strong> on {when(approved?.at)}. This microplan is final.
        {approved?.comment && <p className="m-0 mt-1 italic">“{approved.comment}”</p>}
      </div>
    );
  }
  return null;
};

const Pager: React.FC<{
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
}> = ({ total, page, pageCount, pageSize, onPage, onPageSize }) => {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  const nav =
    'grid size-8 place-items-center rounded-md border border-line bg-panel text-[13px] text-ink hover:border-accent/60 disabled:opacity-40 disabled:hover:border-line';
  return (
    <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 text-[12.5px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} rows
      </span>
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1.5">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            className="rounded-md border border-line bg-panel px-1.5 py-1 text-[12.5px] text-ink outline-none focus:border-accent"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
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
            <span className="px-2 tabular-nums">
              {page + 1} / {pageCount}
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

const GridSkeleton: React.FC = () => (
  <div className="flex flex-col gap-2 p-4" aria-busy aria-label="Loading facilities and assignments">
    <div className="h-8 w-full animate-pulse rounded-md bg-panel2" />
    {Array.from({ length: 7 }, (_, i) => (
      <div key={i} className="flex gap-2">
        <div className="h-9 w-1/4 animate-pulse rounded-md bg-panel2" />
        <div className="h-9 w-1/6 animate-pulse rounded-md bg-panel2" />
        <div className="h-9 flex-1 animate-pulse rounded-md bg-panel2/70" />
      </div>
    ))}
    <p className="m-0 pt-1 text-center text-[12px] text-muted">Loading facilities and assigned users…</p>
  </div>
);

const EmptyState: React.FC<{ orgUnitName: string; programName: string }> = ({ orgUnitName, programName }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    <div className="grid size-12 place-items-center rounded-full bg-panel2 text-xl text-faint" aria-hidden>
      ∅
    </div>
    <p className="m-0 text-[14px] font-semibold text-ink">No facilities to plan</p>
    <p className="m-0 max-w-md text-[13px] text-muted">
      <strong>{programName || 'This programme'}</strong> isn't assigned to any org unit in{' '}
      <strong>{orgUnitName || 'this unit'}</strong>. Pick another unit, or ask an administrator to
      assign the programme to its facilities.
    </p>
  </div>
);

/**
 * Every created microplan — the reviewer's inbox, the planner's own, and the
 * rest — with a search box and status filter. Shown until a selection is
 * made, and whenever "All microplans" is pressed.
 */
const STATUS_FILTERS: (PlanStatus | 'ALL')[] = ['ALL', 'DRAFT', 'SUBMITTED', 'SENT_BACK', 'APPROVED'];

const PlanCatalogue: React.FC<{
  me: UserRef | null;
  canApprove: boolean;
  onOpen: (patch: Partial<CreatePlanFilters>) => void;
  currentId: string | null;
}> = ({ me, canApprove, onOpen, currentId }) => {
  const { data: index = [], isLoading, isError, error } = useCreatedPlanIndex();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<PlanStatus | 'ALL'>('ALL');

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: index.length };
    for (const e of index) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [index]);

  const sorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...index]
      .filter((e) => statusFilter === 'ALL' || e.status === statusFilter)
      .filter(
        (e) =>
          !needle ||
          [e.orgUnitName, e.programName, periodLabel(e.period), e.createdBy.name, e.reviewer?.name ?? '']
            .join(' ')
            .toLowerCase()
            .includes(needle)
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [index, q, statusFilter]);

  const inbox = sorted.filter(
    (e) => canApprove && e.status === 'SUBMITTED' && (!e.reviewer || e.reviewer.id === me?.id)
  );
  const mine = sorted.filter(
    (e) => !inbox.includes(e) && (e.createdBy.id === me?.id || e.updatedBy.id === me?.id)
  );
  const others = sorted.filter((e) => !inbox.includes(e) && !mine.includes(e));

  const open = (e: CreatedPlanIndexEntry) =>
    onOpen({
      programId: e.programId,
      orgUnitId: e.orgUnitId,
      schedule: scheduleOf(e.period) ?? e.schedule,
      period: e.period,
    });

  if (isLoading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-panel2" />
        ))}
      </div>
    );
  }
  if (isError) {
    return <p className="m-0 text-[13px] text-flag">Could not load microplans: {(error as Error)?.message}</p>;
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-3 shadow-card sm:p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h3 className="m-0 text-[15px] font-semibold text-ink">
          Microplans <span className="font-normal text-muted">({index.length.toLocaleString()})</span>
        </h3>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Filter by status">
            {STATUS_FILTERS.map((st) => (
              <button
                key={st}
                type="button"
                role="radio"
                aria-checked={statusFilter === st}
                onClick={() => setStatusFilter(st)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition',
                  statusFilter === st
                    ? 'bg-ink text-white ring-ink'
                    : 'bg-panel text-muted ring-line hover:text-ink'
                )}
              >
                {st === 'ALL' ? 'All' : STATUS_LABEL[st]}
                <span className="ms-1 opacity-60">{counts[st] ?? 0}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search org unit, programme, period, person…"
            className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-72"
          />
        </div>
      </div>

      {index.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13px] text-muted">
          No microplans have been created yet. Choose a programme, org unit and period above to
          start one.
        </p>
      ) : sorted.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13px] text-muted">No microplans match.</p>
      ) : (
        <>
          <CatalogueList title="Awaiting your review" items={inbox} onOpen={open} currentId={currentId} accent />
          <CatalogueList title="Your microplans" items={mine} onOpen={open} currentId={currentId} />
          <CatalogueList title="Other microplans" items={others} onOpen={open} currentId={currentId} />
        </>
      )}
    </section>
  );
};

const CatalogueList: React.FC<{
  title: string;
  items: CreatedPlanIndexEntry[];
  accent?: boolean;
  currentId: string | null;
  onOpen: (e: CreatedPlanIndexEntry) => void;
}> = ({ title, items, accent, currentId, onOpen }) =>
  items.length ? (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
        <span className={cn('rounded-full px-1.5 text-[10.5px]', accent ? 'bg-violet-600 text-white' : 'bg-panel2')}>
          {items.length}
        </span>
      </h3>
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onOpen(e)}
              aria-current={e.id === currentId ? 'true' : undefined}
              className={cn(
                'flex w-full flex-col gap-1.5 rounded-xl border bg-panel p-3 text-left shadow-card transition hover:border-accent/60 hover:shadow-float focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                e.id === currentId ? 'border-accent ring-1 ring-accent' : 'border-line'
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{e.orgUnitName}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {periodLabel(e.period)} · {e.programName}
                  </span>
                </span>
                <StatusPill status={e.status} />
              </span>
              <span className="text-[11.5px] text-faint">
                {e.rowCount.toLocaleString()} rows · updated {when(e.updatedAt)} by {e.updatedBy.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ) : null;
