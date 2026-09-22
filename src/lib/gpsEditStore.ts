import { NAMESPACE, isMissing } from './microplanStore';
import { placeKey, type Polygonal, type SettlementRecord } from './settlementRegistry';

/**
 * Staged settlement GPS / polygon updates for the Manage Settlements page.
 *
 * The settlement register (`ng_settlements`) is read-only to this app until
 * its create/update/merge endpoint exists, so every change is *staged* in the
 * DHIS2 dataStore first and pushed to the register later by "Sync". One record
 * per settlement that anyone has touched; untouched settlements have none.
 *
 * Storage is sharded by state + LGA:
 *
 *   dataStore/microplan/gps:<state>:<lga>   -> GpsShard
 *
 * so that partial updates by different people in different places never
 * write the same key, and a save touches only the LGAs it changed. Within a
 * shard, writes are merged row by row: each record carries a `rev`, and a row
 * that someone else has saved since you loaded it is refused (reported as a
 * conflict) rather than overwritten, while your other rows still save.
 *
 * Workflow, per settlement:
 *
 *   (none) ──edit──▶ DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED  (accepted)
 *                     ▲                    │                  REJECTED  (rejected)
 *                     └──── SENT_BACK ◀────┘ send back
 *
 * DRAFT and SENT_BACK rows are editable by F_CREATE_GPS_MICROPLAN holders
 * whose scope covers the row. SUBMITTED rows are read-only except for the
 * reviewer's accept/reject decision and note (F_APPROVE_GPS_MICROPLAN). A
 * reviewer can also accept or reject a row nobody has edited — confirming or
 * blanking the coordinate the register already holds.
 *
 * APPROVED rows (and REJECTED rows whose coordinates were blanked) are queued
 * for sync; once synced they carry `syncedAt/syncedBy` and can be edited again,
 * which starts a new cycle from the approved values.
 */

export const GPS_SHARD_PREFIX = 'gps:';

export const gpsShardKey = (state: string, lga: string) =>
  `${GPS_SHARD_PREFIX}${placeKey(state) || 'unknown'}:${placeKey(lga) || 'unknown'}`;

export const shardKeyOf = (r: Pick<SettlementRecord, 'state' | 'lga'>) => gpsShardKey(r.state, r.lga);

export type GpsStatus = 'DRAFT' | 'SUBMITTED' | 'SENT_BACK' | 'APPROVED' | 'REJECTED';
export type GpsDecision = 'ACCEPTED' | 'REJECTED';
export type RejectAction = 'BLANK' | 'KEEP';
export type GpsMethod = 'MANUAL' | 'MAP_POINT' | 'MAP_POLYGON' | 'DEVICE';
export type SyncState = 'NOT_READY' | 'PENDING' | 'SYNCED' | 'FAILED' | 'NOT_REQUIRED';

export const GPS_STATUS_LABEL: Record<GpsStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'In review',
  SENT_BACK: 'Sent back',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

export const METHOD_LABEL: Record<GpsMethod, string> = {
  MANUAL: 'Typed in',
  MAP_POINT: 'Picked on map',
  MAP_POLYGON: 'Drawn on map',
  DEVICE: 'Device location',
};

export const SYNC_LABEL: Record<SyncState, string> = {
  NOT_READY: '—',
  PENDING: 'Pending sync',
  SYNCED: 'Synced',
  FAILED: 'Sync failed',
  NOT_REQUIRED: 'No change',
};

export interface UserStamp {
  id: string;
  username: string;
  name: string;
}

export interface GeoValue {
  lat: number | null;
  lon: number | null;
  polygon: Polygonal | null;
}

export interface GpsHistoryEntry {
  at: string;
  by: UserStamp;
  action:
    | 'EDITED'
    | 'REVERTED'
    | 'SUBMITTED'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'APPROVED'
    | 'SENT_BACK'
    | 'SYNCED'
    | 'SYNC_FAILED';
  note?: string;
}

export interface GpsEdit {
  /** settlement id in ng_settlements */
  id: string;
  /** snapshot of the register row, so the record reads on its own */
  name: string;
  ward: string;
  lga: string;
  state: string;
  /** what the register held when this cycle started */
  original: GeoValue;
  /** the proposed values; null = no change proposed (a review of the existing value) */
  proposed: GeoValue | null;
  method?: GpsMethod;
  status: GpsStatus;
  decision?: GpsDecision | null;
  rejectAction?: RejectAction | null;
  /** reviewer's note for this row */
  note?: string;
  /** the values to write to the register, fixed at approval */
  final?: GeoValue | null;

  /** optimistic-concurrency counter, bumped on every write */
  rev: number;
  createdAt: string;
  createdBy: UserStamp;
  updatedAt: string;
  updatedBy: UserStamp;
  submittedAt?: string;
  submittedBy?: UserStamp;
  reviewedAt?: string;
  reviewedBy?: UserStamp;

  sync: SyncState;
  syncedAt?: string;
  syncedBy?: UserStamp;
  syncError?: string;

  history: GpsHistoryEntry[];
}

export interface GpsShard {
  version: 1;
  key: string;
  updatedAt: string;
  edits: Record<string, GpsEdit>;
}

type Engine = { query: (q: unknown) => Promise<any>; mutate: (m: unknown) => Promise<any> };

/* ---- predicates ---------------------------------------------------------------- */

export const isEditableGps = (e: GpsEdit | undefined) =>
  !e ||
  e.status === 'DRAFT' ||
  e.status === 'SENT_BACK' ||
  // a finished cycle can start again once its result has left the building
  ((e.status === 'APPROVED' || e.status === 'REJECTED') &&
    (e.sync === 'SYNCED' || e.sync === 'NOT_REQUIRED'));

export const isReviewableGps = (e: GpsEdit | undefined) =>
  !e ||
  e.status === 'SUBMITTED' ||
  ((e.status === 'APPROVED' || e.status === 'REJECTED') &&
    (e.sync === 'SYNCED' || e.sync === 'NOT_REQUIRED'));

/** Would Submit pick this row up? */
export const isSubmittable = (e: GpsEdit | undefined) =>
  !!e && ((e.status === 'DRAFT' && !!e.proposed) || e.status === 'SENT_BACK');

export const isPendingSync = (e: GpsEdit | undefined) =>
  !!e && (e.sync === 'PENDING' || e.sync === 'FAILED');

/** Is a cycle in progress, i.e. do the proposed values matter right now? */
export const isOpenCycle = (e: GpsEdit | undefined) =>
  !!e && (e.status === 'DRAFT' || e.status === 'SUBMITTED' || e.status === 'SENT_BACK');

export const originalOf = (r: SettlementRecord): GeoValue => ({
  lat: r.lat,
  lon: r.lon,
  polygon: r.polygon,
});

/**
 * The value a row should *display* as current: what was approved (and not yet
 * superseded by the register) or what the register holds.
 */
export function currentOf(r: SettlementRecord, e: GpsEdit | undefined): GeoValue {
  if (e && (e.status === 'APPROVED' || e.status === 'REJECTED') && e.final) return e.final;
  return originalOf(r);
}

/** The value being proposed in an open cycle, if any. */
export const proposedOf = (e: GpsEdit | undefined): GeoValue | null =>
  isOpenCycle(e) ? e!.proposed : null;

const sameGeo = (a: GeoValue | null, b: GeoValue | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/* ---- transitions (pure: they return a new record) --------------------------------- */

const now = () => new Date().toISOString();

const push = (e: GpsEdit, entry: Omit<GpsHistoryEntry, 'at'>, at: string): GpsHistoryEntry[] =>
  [...e.history, { at, ...entry }].slice(-50);

function fresh(r: SettlementRecord, prev: GpsEdit | undefined, me: UserStamp, at: string): GpsEdit {
  // a new cycle starts from whatever is current, carrying the audit trail over
  return {
    id: r.id,
    name: r.name,
    ward: r.ward,
    lga: r.lga,
    state: r.state,
    original: currentOf(r, prev),
    proposed: null,
    status: 'DRAFT',
    decision: null,
    rejectAction: null,
    note: undefined,
    final: null,
    rev: prev?.rev ?? 0,
    createdAt: prev && isOpenCycle(prev) ? prev.createdAt : at,
    createdBy: prev && isOpenCycle(prev) ? prev.createdBy : me,
    updatedAt: at,
    updatedBy: me,
    sync: 'NOT_READY',
    history: prev?.history ?? [],
  };
}

/** Propose new values for a row (creator). */
export function proposeGps(
  r: SettlementRecord,
  prev: GpsEdit | undefined,
  value: GeoValue,
  method: GpsMethod,
  me: UserStamp
): GpsEdit {
  const at = now();
  const base = prev && isOpenCycle(prev) ? { ...prev } : fresh(r, prev, me, at);
  return {
    ...base,
    proposed: value,
    method,
    status: base.status === 'SENT_BACK' ? 'SENT_BACK' : 'DRAFT',
    updatedAt: at,
    updatedBy: me,
    history: push(base, { by: me, action: 'EDITED', note: METHOD_LABEL[method] }, at),
  };
}

/**
 * Drop the proposal on an editable row. Returns null when the record itself
 * should go: a draft with no earlier finished cycle holds nothing worth
 * keeping. A sent-back row, or one with an approved history, keeps its record
 * (and audit trail) with no proposal.
 */
export function revertGps(prev: GpsEdit, me: UserStamp): GpsEdit | null {
  const at = now();
  if (prev.status === 'DRAFT' && !prev.history.some((h) => h.action === 'APPROVED')) return null;
  return {
    ...prev,
    proposed: null,
    method: undefined,
    updatedAt: at,
    updatedBy: me,
    history: push(prev, { by: me, action: 'REVERTED' }, at),
  };
}

export function submitGps(prev: GpsEdit, me: UserStamp): GpsEdit {
  const at = now();
  return {
    ...prev,
    status: 'SUBMITTED',
    decision: null,
    rejectAction: null,
    submittedAt: at,
    submittedBy: me,
    history: push(prev, { by: me, action: 'SUBMITTED' }, at),
  };
}

/** A reviewer's per-row decision. On a row nobody edited it opens a review-only record. */
export function decideGps(
  r: SettlementRecord,
  prev: GpsEdit | undefined,
  decision: GpsDecision | null,
  rejectAction: RejectAction | null,
  me: UserStamp
): GpsEdit {
  const at = now();
  let base: GpsEdit;
  if (prev && prev.status === 'SUBMITTED') base = { ...prev };
  else {
    base = { ...fresh(r, prev, me, at), status: 'SUBMITTED', submittedAt: at, submittedBy: me };
  }
  return {
    ...base,
    decision,
    rejectAction: decision === 'REJECTED' ? rejectAction ?? 'KEEP' : null,
    reviewedAt: at,
    reviewedBy: me,
    history: decision
      ? push(
          base,
          {
            by: me,
            action: decision,
            note:
              decision === 'REJECTED'
                ? rejectAction === 'BLANK'
                  ? 'GPS to be blanked'
                  : 'Current GPS kept'
                : undefined,
          },
          at
        )
      : base.history,
  };
}

export function noteGps(prev: GpsEdit, note: string, me: UserStamp): GpsEdit {
  return { ...prev, note: note.trim() || undefined, reviewedAt: now(), reviewedBy: me };
}

/**
 * Finalise a submitted row. Undecided rows are accepted. The values that will
 * go to the register are fixed here, so later display never has to re-derive
 * them from the decision.
 */
export function approveGps(prev: GpsEdit, me: UserStamp, comment?: string): GpsEdit {
  const at = now();
  const decision = prev.decision ?? 'ACCEPTED';
  let final: GeoValue;
  let status: GpsStatus;
  let sync: SyncState;
  if (decision === 'ACCEPTED') {
    final = prev.proposed ?? prev.original;
    status = 'APPROVED';
    // accepting the value already in the register still records a verification
    sync = 'PENDING';
  } else if (prev.rejectAction === 'BLANK') {
    final = { lat: null, lon: null, polygon: null };
    status = 'REJECTED';
    sync = sameGeo(final, prev.original) ? 'NOT_REQUIRED' : 'PENDING';
  } else {
    final = prev.original;
    status = 'REJECTED';
    sync = 'NOT_REQUIRED';
  }
  return {
    ...prev,
    decision,
    status,
    final,
    sync,
    syncError: undefined,
    reviewedAt: at,
    reviewedBy: me,
    history: push(prev, { by: me, action: 'APPROVED', note: comment || undefined }, at),
  };
}

export function sendBackGps(prev: GpsEdit, me: UserStamp, comment?: string): GpsEdit {
  const at = now();
  return {
    ...prev,
    status: 'SENT_BACK',
    reviewedAt: at,
    reviewedBy: me,
    history: push(prev, { by: me, action: 'SENT_BACK', note: comment || undefined }, at),
  };
}

/* ---- dataStore ------------------------------------------------------------------- */

/** Every gps shard key in the namespace (one cheap request: keys only). */
export async function listGpsShardKeys(engine: Engine): Promise<Set<string>> {
  try {
    const res: any = await engine.query({ keys: { resource: `dataStore/${NAMESPACE}` } });
    const keys: unknown = res.keys;
    return new Set(
      (Array.isArray(keys) ? keys : []).filter(
        (k): k is string => typeof k === 'string' && k.startsWith(GPS_SHARD_PREFIX)
      )
    );
  } catch (e) {
    if (isMissing(e)) return new Set();
    throw e;
  }
}

async function readShard(engine: Engine, key: string): Promise<GpsShard | null> {
  try {
    const res: any = await engine.query({ s: { resource: `dataStore/${NAMESPACE}/${key}` } });
    const s = res.s;
    if (!s || typeof s !== 'object' || typeof s.edits !== 'object') return null;
    return s as GpsShard;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Read the given shards, keeping only the ones that exist. */
export async function readGpsEdits(engine: Engine, keys: string[]): Promise<Map<string, GpsEdit>> {
  const shards = await pool(keys, 6, (k) => readShard(engine, k));
  const out = new Map<string, GpsEdit>();
  for (const s of shards) if (s) for (const e of Object.values(s.edits)) out.set(e.id, e);
  return out;
}

export interface SaveResult {
  saved: GpsEdit[];
  /** the stored versions of rows someone else changed after we loaded them */
  conflicts: GpsEdit[];
  /** ids whose record was deleted (a never-submitted draft that was reverted) */
  removed: string[];
}

/**
 * Save records, merged into their shards row by row. `baseRev` is the rev of
 * each row as it was when the user started editing it (0 for a row with no
 * stored record). `null` in `edits` deletes the stored record.
 */
export async function saveGpsEdits(
  engine: Engine,
  edits: { key: string; edit: GpsEdit | null; id: string }[],
  baseRev: Map<string, number>
): Promise<SaveResult> {
  const byShard = new Map<string, { edit: GpsEdit | null; id: string }[]>();
  for (const e of edits) {
    const list = byShard.get(e.key) ?? [];
    list.push(e);
    byShard.set(e.key, list);
  }

  const result: SaveResult = { saved: [], conflicts: [], removed: [] };
  await pool([...byShard.entries()], 4, async ([key, list]) => {
    const existing = await readShard(engine, key);
    const shard: GpsShard = existing ?? { version: 1, key, updatedAt: '', edits: {} };
    let changed = false;
    for (const { edit, id } of list) {
      const remote = shard.edits[id];
      const expected = baseRev.get(id) ?? 0;
      if ((remote?.rev ?? 0) !== expected) {
        if (remote) result.conflicts.push(remote);
        continue;
      }
      if (edit === null) {
        if (remote) {
          delete shard.edits[id];
          changed = true;
        }
        result.removed.push(id);
        continue;
      }
      const next = { ...edit, rev: expected + 1 };
      shard.edits[id] = next;
      result.saved.push(next);
      changed = true;
    }
    if (!changed) return;
    shard.updatedAt = now();
    await engine.mutate({
      resource: `dataStore/${NAMESPACE}/${key}`,
      type: existing ? 'update' : 'create',
      data: shard,
    });
  });
  return result;
}

/* ---- sync to ng_settlements -------------------------------------------------------- */

/**
 * One staged update as it will be posted to the register's create/update/merge
 * endpoint. The audit fields travel with every row so the register can record
 * who proposed, who approved and who synced each change.
 */
export interface SettlementSyncRecord {
  id: string;
  settlement: string;
  ward: string;
  lga: string;
  state: string;
  operation: 'UPDATE' | 'CLEAR' | 'VERIFY';
  latitude: number | null;
  longitude: number | null;
  geometry: Polygonal | null;
  previous: { latitude: number | null; longitude: number | null; geometry: Polygonal | null };
  method: GpsMethod | null;
  decision: GpsDecision;
  reviewNote: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  syncedAt: string;
  syncedBy: string;
}

export function toSyncRecord(e: GpsEdit, me: UserStamp, at: string): SettlementSyncRecord {
  const final = e.final ?? e.original;
  const operation: SettlementSyncRecord['operation'] =
    e.decision === 'REJECTED' ? 'CLEAR' : sameGeo(final, e.original) ? 'VERIFY' : 'UPDATE';
  return {
    id: e.id,
    settlement: e.name,
    ward: e.ward,
    lga: e.lga,
    state: e.state,
    operation,
    latitude: final.lat,
    longitude: final.lon,
    geometry: final.polygon,
    previous: { latitude: e.original.lat, longitude: e.original.lon, geometry: e.original.polygon },
    method: e.method ?? null,
    decision: e.decision ?? 'ACCEPTED',
    reviewNote: e.note ?? null,
    createdAt: e.createdAt,
    createdBy: e.createdBy.username,
    updatedAt: e.updatedAt,
    updatedBy: e.updatedBy.username,
    submittedAt: e.submittedAt ?? null,
    submittedBy: e.submittedBy?.username ?? null,
    approvedAt: e.reviewedAt ?? null,
    approvedBy: e.reviewedBy?.username ?? null,
    syncedAt: at,
    syncedBy: me.username,
  };
}

/**
 * POST staged updates to the register in batches of 500. Returns, per record,
 * whether its batch was accepted. The endpoint is expected to answer 2xx for
 * a batch it has stored; anything else fails the whole batch.
 */
export async function postSyncBatches(
  endpoint: string,
  records: SettlementSyncRecord[],
  onProgress?: (done: number) => void
): Promise<{ ok: Set<string>; failed: Map<string, string> }> {
  const ok = new Set<string>();
  const failed = new Map<string, string>();
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ updates: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const r of batch) ok.add(r.id);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      for (const r of batch) failed.set(r.id, msg);
    }
    onProgress?.(Math.min(records.length, i + batch.length));
  }
  return { ok, failed };
}

export function markSynced(e: GpsEdit, me: UserStamp, at: string): GpsEdit {
  return {
    ...e,
    sync: 'SYNCED',
    syncedAt: at,
    syncedBy: me,
    syncError: undefined,
    history: push(e, { by: me, action: 'SYNCED' }, at),
  };
}

export function markSyncFailed(e: GpsEdit, me: UserStamp, error: string): GpsEdit {
  const at = now();
  return {
    ...e,
    sync: 'FAILED',
    syncError: error,
    history: push(e, { by: me, action: 'SYNC_FAILED', note: error }, at),
  };
}
