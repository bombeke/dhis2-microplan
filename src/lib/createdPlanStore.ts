import { NAMESPACE, isMissing, putKey } from './microplanStore';
import type { PlanColumn, Schedule } from './planSchedule';

/**
 * Persistence and workflow for microplans *created in the app* (the Create
 * Microplan page), as opposed to uploaded ones (microplanStore.ts). Same
 * dataStore namespace, separate keys so the two catalogues never collide:
 *
 *   dataStore/microplan/created-index      -> CreatedPlanIndexEntry[]
 *   dataStore/microplan/created:<id>       -> CreatedPlan
 *
 * One plan exists per programme × org unit × period, so its id is derived from
 * those three and choosing the same filters again always reopens the same plan
 * rather than starting a duplicate.
 *
 * Workflow:
 *
 *   DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
 *     ▲                   │
 *     └──── SENT_BACK ◀───┘ send back
 *
 * A plan that is still a DRAFT or SENT_BACK can also be discarded (deleted);
 * one that is in review or approved cannot.
 *
 * DRAFT and SENT_BACK are editable by F_CREATE_MICROPLAN holders; SUBMITTED is
 * read-only except for the per-row review notes, which only the assigned
 * reviewer (F_APPROVE_MICROPLAN) can write; APPROVED is read-only for everyone.
 */

export const CREATED_INDEX_KEY = 'created-index';
export const createdKey = (id: string) => `created:${id}`;
export const createdPlanId = (programId: string, orgUnitId: string, period: string) =>
  `${programId}_${orgUnitId}_${period}`;

export type PlanStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'SENT_BACK';

export const STATUS_LABEL: Record<PlanStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Awaiting review',
  APPROVED: 'Approved',
  SENT_BACK: 'Sent back',
};

export interface UserRef {
  id: string;
  username: string;
  name: string;
}

export interface OrgUnitRef {
  id: string;
  name: string;
  level: number;
}

/** One settlement chosen in a cell. The name is kept so no lookup is needed to show it. */
export interface CellItem {
  id: string;
  name: string;
}

/**
 * One grid row: a facility and one of the users assigned to it (a facility
 * with three users is three rows; with none, one row with `user: null`).
 */
export interface PlanRow {
  key: string; // `${facilityId}|${userId ?? '-'}`
  facility: OrgUnitRef;
  /** ancestors from the root down to the facility's parent */
  ancestors: OrgUnitRef[];
  user: UserRef | null;
  cells: Record<string, CellItem[]>; // column key -> settlements
  note?: string; // reviewer's note
}

export interface HistoryEntry {
  at: string;
  by: UserRef;
  action: 'CREATED' | 'SAVED' | 'SUBMITTED' | 'APPROVED' | 'SENT_BACK';
  comment?: string;
}

export interface CreatedPlanIndexEntry {
  id: string;
  programId: string;
  programName: string;
  orgUnitId: string;
  orgUnitName: string;
  schedule: Schedule;
  period: string;
  status: PlanStatus;
  createdBy: UserRef;
  updatedAt: string;
  updatedBy: UserRef;
  reviewer?: UserRef | null;
  rowCount: number;
}

export interface CreatedPlan extends CreatedPlanIndexEntry {
  version: 1;
  createdAt: string;
  columns: PlanColumn[];
  rows: PlanRow[];
  history: HistoryEntry[];
}

type Engine = { query: (q: unknown) => Promise<any>; mutate: (m: unknown) => Promise<any> };

export const rowKey = (facilityId: string, userId: string | null) =>
  `${facilityId}|${userId ?? '-'}`;

export const isEditableStatus = (s: PlanStatus | undefined) =>
  !s || s === 'DRAFT' || s === 'SENT_BACK';

export async function readCreatedIndex(engine: Engine): Promise<CreatedPlanIndexEntry[]> {
  try {
    const res: any = await engine.query({
      idx: { resource: `dataStore/${NAMESPACE}/${CREATED_INDEX_KEY}` },
    });
    return Array.isArray(res.idx) ? res.idx : [];
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

export async function loadCreatedPlan(engine: Engine, id: string): Promise<CreatedPlan | null> {
  try {
    const res: any = await engine.query({
      p: { resource: `dataStore/${NAMESPACE}/${createdKey(id)}` },
    });
    return (res.p as CreatedPlan) ?? null;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

const toIndexEntry = (p: CreatedPlan): CreatedPlanIndexEntry => ({
  id: p.id,
  programId: p.programId,
  programName: p.programName,
  orgUnitId: p.orgUnitId,
  orgUnitName: p.orgUnitName,
  schedule: p.schedule,
  period: p.period,
  status: p.status,
  createdBy: p.createdBy,
  updatedAt: p.updatedAt,
  updatedBy: p.updatedBy,
  reviewer: p.reviewer ?? null,
  rowCount: p.rows.length,
});

/** Thrown when someone else saved the plan after we loaded it. */
export class PlanConflictError extends Error {
  constructor(public remote: CreatedPlan) {
    super(`${remote.updatedBy.name} saved this microplan at ${new Date(remote.updatedAt).toLocaleString()} after you opened it.`);
  }
}

/**
 * Write a plan and its catalogue row. `expectedUpdatedAt` is the `updatedAt`
 * of the copy the user was editing: if the stored copy has moved on since, we
 * refuse rather than silently overwrite a colleague's work (pass `force` once
 * the user has confirmed).
 */
export async function saveCreatedPlan(
  engine: Engine,
  plan: CreatedPlan,
  opts: { expectedUpdatedAt: string | null; force?: boolean }
): Promise<CreatedPlan> {
  if (!opts.force) {
    const remote = await loadCreatedPlan(engine, plan.id);
    if (remote && remote.updatedAt !== opts.expectedUpdatedAt) throw new PlanConflictError(remote);
  }
  await putKey(engine, createdKey(plan.id), plan);

  const index = await readCreatedIndex(engine);
  const entry = toIndexEntry(plan);
  const next = index.some((e) => e.id === plan.id)
    ? index.map((e) => (e.id === plan.id ? entry : e))
    : [entry, ...index];
  await putKey(engine, CREATED_INDEX_KEY, next);
  return plan;
}

/** Delete a plan and drop it from the catalogue. Only drafts should get here. */
export async function deleteCreatedPlan(engine: Engine, id: string): Promise<void> {
  try {
    await engine.mutate({
      resource: `dataStore/${NAMESPACE}/${createdKey(id)}`,
      type: 'delete',
    });
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  const index = await readCreatedIndex(engine);
  if (index.some((e) => e.id === id)) {
    await putKey(engine, CREATED_INDEX_KEY, index.filter((e) => e.id !== id));
  }
}
