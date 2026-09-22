import { openDB, type IDBPDatabase } from 'idb';
import { NAMESPACE, isMissing } from './microplanStore';
import type { UserStamp } from './gpsEditStore';

/**
 * Duplicate tracked entities for the Manage Duplicates page.
 *
 * Detection
 * ---------
 * Two tracked entities are duplicates when every attribute configured in
 * Settings → Duplicates carries the same value on both, after normalising
 * (trim, collapse whitespace, ignore case and accents). Records with any of
 * those attributes empty are never matched — an empty name matching another
 * empty name is not evidence of anything. Matching records form a *group*;
 * the oldest (by `createdAt`) is the original and every other member is
 * listed as a duplicate of it.
 *
 * Detection needs every tracked entity under the org unit, which for a state
 * is hundreds of thousands of rows, so the result of a scan is cached in the
 * browser (IndexedDB) and the page opens on the cached result until someone
 * rescans.
 *
 * Decisions
 * ---------
 * What people *do* about duplicates is shared, so it lives in the dataStore:
 *
 *   dataStore/microplan/dup:<programId>:<orgUnitAtShardLevel>  -> DuplicateShard
 *
 * sharded by the org unit at the configured level (default 3), so reviewers
 * in different districts never write the same key. A shard holds two maps,
 * each merged row by row with a `rev` check like the GPS shards
 * (lib/gpsEditStore.ts):
 *
 *  - `cases`    — one merge per group: every member but one is merged into
 *                 the kept record and deleted once an approver accepts.
 *
 *        (detected) ──prepare──▶ PENDING ──accept──▶ MERGED   (others deleted)
 *             ▲                    │  ▲
 *             │                    │  └── edit (reviewer)
 *             └── prepare again ◀─ FLAGGED ◀── reject
 *
 *    FLAGGED is "rejected — kept as a potential duplicate": the group stays
 *    listed without a rescan and a reviewer can prepare a different merge.
 *    MERGED records are never removed: each keeps a full snapshot of every
 *    member as it was when the merge was prepared, the payload that was sent,
 *    and who prepared, accepted and deleted what — the audit trail.
 *
 *  - `retained` — one mark per tracked entity a reviewer decided is *not* a
 *                 duplicate after all. A retained record is left out of its
 *                 group's merge, and every later scan shows it as retained
 *                 instead of asking for it to be reviewed again.
 */

export const DUP_SHARD_PREFIX = 'dup:';
export const dupShardKey = (programId: string, shardOu: string) =>
  `${DUP_SHARD_PREFIX}${programId}:${shardOu || 'unknown'}`;

type Engine = { query: (q: unknown) => Promise<any>; mutate: (m: unknown) => Promise<any> };

/* ---- detection ----------------------------------------------------------------- */

/** One tracked entity as the scan keeps it — just enough to match and list it. */
export interface ScanEntity {
  id: string;
  ou: string;
  createdAt: string;
  updatedAt: string;
  /** display names of the users who registered / last updated it */
  createdBy?: string;
  updatedBy?: string;
  /** raw values of the configured attributes, in the configured order */
  values: string[];
}

export interface DetectedGroup {
  /** stable id derived from the match key */
  id: string;
  key: string;
  /** oldest first */
  members: ScanEntity[];
}

/** Normalise one value for matching: trim, collapse spaces, drop accents, ignore case. */
export const normaliseValue = (v: string | null | undefined) =>
  (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const SEP = '\u241f';

/** cyrb53 — a 53-bit string hash; collisions are negligible at millions of groups. */
function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const groupIdOf = (key: string) => `g${hash53(key)}`;

/** The normalised match key, or null when any value is empty. */
export function matchKey(values: string[]): string | null {
  if (!values.length) return null;
  let key = '';
  for (let i = 0; i < values.length; i++) {
    const n = normaliseValue(values[i]);
    if (!n) return null;
    key += (i ? SEP : '') + n;
  }
  return key;
}

export const byAge = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * Group entities by the combined key and keep the groups of two or more.
 * O(n) over the entities with one Map — 200 000 rows take well under a second.
 */
export function detectDuplicates(entities: ScanEntity[]): DetectedGroup[] {
  const groups = new Map<string, ScanEntity[]>();
  for (const e of entities) {
    const key = matchKey(e.values);
    if (key === null) continue;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }
  const out: DetectedGroup[] = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    g.sort(byAge);
    out.push({ id: groupIdOf(key), key, members: g });
  }
  return out;
}

/** "First Surname (username)" from a tracker `createdBy` / `updatedBy` object. */
export function userLabel(u: any): string | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const name = [u.firstName, u.surname].filter(Boolean).join(' ').trim();
  if (name && u.username) return `${name} (${u.username})`;
  return name || u.username || undefined;
}

/** Read the configured attributes' values off one tracker API row. */
export function toScanEntity(te: any, attributeIds: string[]): ScanEntity {
  const byId = new Map<string, string>();
  for (const a of te?.attributes ?? []) byId.set(a.attribute, a.value == null ? '' : String(a.value));
  for (const enr of te?.enrollments ?? [])
    for (const a of enr?.attributes ?? []) if (!byId.has(a.attribute)) byId.set(a.attribute, String(a.value ?? ''));
  return {
    id: te.trackedEntity,
    ou: te.orgUnit ?? '',
    createdAt: te.createdAt ?? '',
    updatedAt: te.updatedAt ?? '',
    createdBy: userLabel(te.createdBy),
    updatedBy: userLabel(te.updatedBy),
    values: attributeIds.map((id) => byId.get(id) ?? ''),
  };
}

/* ---- the tracked-entity scan ----------------------------------------------------- */

export interface ServerVersion {
  major?: number;
  minor?: number;
}

/**
 * The org-unit parameters changed name in 2.41 (`orgUnit`/`ouMode` →
 * `orgUnits`/`orgUnitMode`) and the old ones were removed later, so the
 * spelling follows the server.
 */
export const orgUnitParams = (orgUnitId: string, v: ServerVersion | undefined) =>
  (v?.minor ?? 40) >= 41 || (v?.major ?? 2) > 2
    ? { orgUnits: orgUnitId, orgUnitMode: 'DESCENDANTS' }
    : { orgUnit: orgUnitId, ouMode: 'DESCENDANTS' };

const SCAN_PAGE = 1000;
const SCAN_PARALLEL = 4;
export const USER_FIELDS = 'uid,username,firstName,surname';

/**
 * Every tracked entity enrolled in `programId` under `orgUnitId`, reduced to
 * ScanEntity. Pages are fetched four at a time; a short page ends the scan.
 */
export async function scanTrackedEntities(
  engine: Engine,
  opts: {
    programId: string;
    orgUnitId: string;
    attributeIds: string[];
    version?: ServerVersion;
    signal?: AbortSignal;
    onProgress?: (loaded: number) => void;
  }
): Promise<ScanEntity[]> {
  const out: ScanEntity[] = [];
  const fetchPage = async (page: number): Promise<any[]> => {
    const data: any = await engine.query({
      te: {
        resource: 'tracker/trackedEntities',
        params: {
          program: opts.programId,
          ...orgUnitParams(opts.orgUnitId, opts.version),
          fields: `trackedEntity,orgUnit,createdAt,updatedAt,createdBy[${USER_FIELDS}],updatedBy[${USER_FIELDS}],attributes[attribute,value]`,
          order: 'createdAt:asc',
          page,
          pageSize: SCAN_PAGE,
        },
      },
    });
    return data?.te?.trackedEntities ?? data?.te?.instances ?? [];
  };

  let page = 1;
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const pages = Array.from({ length: SCAN_PARALLEL }, (_, i) => page + i);
    const results = await Promise.all(pages.map(fetchPage));
    let done = false;
    for (const rows of results) {
      for (const te of rows) out.push(toScanEntity(te, opts.attributeIds));
      if (rows.length < SCAN_PAGE) {
        done = true;
        break;
      }
    }
    opts.onProgress?.(out.length);
    if (done) break;
    page += SCAN_PARALLEL;
  }
  return out;
}

/* ---- browser cache of scan results ----------------------------------------------- */

export interface CachedScan {
  key: string;
  scannedAt: string;
  scannedBy: string;
  entityCount: number;
  groups: DetectedGroup[];
}

/** `v2` — scans cached before grouping (as pairs) are simply never read again. */
export const scanCacheKey = (programId: string, orgUnitId: string, attributeIds: string[]) =>
  `v2|${programId}|${orgUnitId}|${attributeIds.join(',')}`;

let dbp: Promise<IDBPDatabase> | null = null;
const db = () =>
  (dbp ??= openDB('microplan-duplicates', 1, {
    upgrade(d) {
      d.createObjectStore('scans', { keyPath: 'key' });
    },
  }));

/** The cached scan, or null. Never throws: a blocked IndexedDB just means no cache. */
export async function readCachedScan(key: string): Promise<CachedScan | null> {
  try {
    const s = (await (await db()).get('scans', key)) as CachedScan | undefined;
    return s && Array.isArray(s.groups) ? s : null;
  } catch {
    return null;
  }
}

export async function writeCachedScan(scan: CachedScan): Promise<void> {
  try {
    await (await db()).put('scans', scan);
  } catch {
    /* private window / storage full — the scan still works, it just isn't kept */
  }
}

/* ---- stored decisions ----------------------------------------------------------- */

export type DupStatus = 'PENDING' | 'MERGED' | 'FLAGGED';
/** row status as the table shows it — DETECTED has no stored decision yet */
export type RowStatus = 'DETECTED' | DupStatus | 'RETAINED';

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  DETECTED: 'Detected',
  PENDING: 'Awaiting approval',
  MERGED: 'Merged',
  FLAGGED: 'Kept as duplicate',
  RETAINED: 'Retained',
};

export interface EntityRef {
  id: string;
  orgUnit: string;
  orgUnitName?: string;
  orgUnitPath?: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy?: string;
  values: string[];
}

export interface DupHistoryEntry {
  at: string;
  by: UserStamp;
  action:
    | 'PREPARED'
    | 'EDITED'
    | 'ACCEPTED'
    | 'REJECTED'
    | 'IMPORT_FAILED'
    | 'DELETE_FAILED'
    | 'DELETED'
    | 'INVALIDATED';
  note?: string;
}

/** The body posted to /api/tracker — flat format. */
export interface TrackerPayload {
  trackedEntities: any[];
  enrollments: any[];
  events: any[];
}

/** How one field was resolved: the tracked entity its value came from, or a typed correction. */
export interface Resolved {
  from: string;
  value: string;
}

export interface DuplicateCase {
  /** the group id, or `<groupId>-<n>` for a later merge of a group already merged once */
  id: string;
  /** the group this merge belongs to (groupIdOf(key)) */
  groupId: string;
  programId: string;
  shardKey: string;
  key: string;
  /** attribute ids the key was built from, and their names at the time */
  attributes: { id: string; name: string }[];
  /** every member of the group when the merge was prepared, oldest first */
  members: EntityRef[];

  status: DupStatus;
  keptId: string;
  /** merged into the kept record and deleted on acceptance */
  removedIds: string[];
  /** members left out of this merge because they were retained */
  retainedIds: string[];
  /** removed records already deleted — a retry after a partial failure skips them */
  deletedIds: string[];
  /** field key -> how the reviewer resolved it (audit); `from` is a tracked entity id or 'CUSTOM' */
  resolutions: Record<string, Resolved>;
  /** what Accept posts */
  payload: TrackerPayload | null;
  /** every merged record as it was when the merge was prepared (audit), by id */
  snapshots: Record<string, any>;
  /** cluster keys (see duplicateMerge.ts) of single visits chosen to be copied */
  copied?: string[];
  summary?: { attributes: number; conflicts: number; eventsCopied: number; eventsMerged: number; otherPrograms: number };
  note?: string;
  error?: string;

  rev: number;
  createdAt: string;
  createdBy: UserStamp;
  updatedAt: string;
  updatedBy: UserStamp;
  preparedAt?: string;
  preparedBy?: UserStamp;
  reviewedAt?: string;
  reviewedBy?: UserStamp;
  deletedAt?: string;
  deletedBy?: UserStamp;
  history: DupHistoryEntry[];
}

/** A record a reviewer decided is not a duplicate. */
export interface RetainedMark {
  /** the tracked entity id */
  id: string;
  programId: string;
  shardKey: string;
  key: string;
  groupId: string;
  record: EntityRef;
  /** the record it was listed as a duplicate of */
  original: EntityRef;
  note?: string;
  rev: number;
  retainedAt: string;
  retainedBy: UserStamp;
}

export interface DuplicateShard {
  version: 2;
  key: string;
  updatedAt: string;
  cases: Record<string, DuplicateCase>;
  retained: Record<string, RetainedMark>;
}

const now = () => new Date().toISOString();

/**
 * The shard org unit for a record: the unit at `level` on its path, or the
 * unit itself when it sits above that level.
 */
export function shardOuOf(path: string | undefined, ouId: string, level: number): string {
  const parts = (path ?? '').split('/').filter(Boolean);
  return parts[level - 1] ?? ouId;
}

/** Every duplicate shard key for a programme (one cheap request: keys only). */
export async function listDuplicateShardKeys(engine: Engine, programId: string): Promise<string[]> {
  const prefix = `${DUP_SHARD_PREFIX}${programId}:`;
  try {
    const res: any = await engine.query({ keys: { resource: `dataStore/${NAMESPACE}` } });
    const keys: unknown = res.keys;
    return (Array.isArray(keys) ? keys : []).filter(
      (k): k is string => typeof k === 'string' && k.startsWith(prefix)
    );
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

/** A shard, with anything that isn't a well-formed group case (older pair records) dropped. */
async function readShard(engine: Engine, key: string): Promise<DuplicateShard | null> {
  try {
    const res: any = await engine.query({ s: { resource: `dataStore/${NAMESPACE}/${key}` } });
    const s = res.s;
    if (!s || typeof s !== 'object') return null;
    const cases: Record<string, DuplicateCase> = {};
    for (const [id, c] of Object.entries<any>(s.cases ?? {})) if (Array.isArray(c?.members)) cases[id] = c;
    return { version: 2, key, updatedAt: s.updatedAt ?? '', cases, retained: s.retained ?? {} };
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export interface StoredDecisions {
  cases: Map<string, DuplicateCase>;
  retained: Map<string, RetainedMark>;
}

export async function readDuplicateDecisions(engine: Engine, keys: string[]): Promise<StoredDecisions> {
  const shards = await pool(keys, 6, (k) => readShard(engine, k));
  const out: StoredDecisions = { cases: new Map(), retained: new Map() };
  for (const s of shards) {
    if (!s) continue;
    for (const c of Object.values(s.cases)) out.cases.set(c.id, c);
    for (const r of Object.values(s.retained)) out.retained.set(r.id, r);
  }
  return out;
}

/** One write: a case or a retained mark; `value: null` deletes it. */
export type DecisionWrite =
  | { kind: 'case'; id: string; shardKey: string; value: DuplicateCase | null; baseRev: number }
  | { kind: 'retained'; id: string; shardKey: string; value: RetainedMark | null; baseRev: number };

export interface DecisionSaveResult {
  cases: DuplicateCase[];
  retained: RetainedMark[];
  removedRetained: string[];
  /** the stored versions of items someone else changed since they were loaded */
  conflicts: { cases: DuplicateCase[]; retained: RetainedMark[] };
}

/**
 * Save cases and retained marks merged into their shards. `baseRev` is each
 * item's rev as it was loaded (0 for a new one); an item whose stored rev
 * moved on is not written and comes back as a conflict.
 */
export async function saveDuplicateDecisions(engine: Engine, writes: DecisionWrite[]): Promise<DecisionSaveResult> {
  const byShard = new Map<string, DecisionWrite[]>();
  for (const w of writes) byShard.set(w.shardKey, [...(byShard.get(w.shardKey) ?? []), w]);
  const result: DecisionSaveResult = { cases: [], retained: [], removedRetained: [], conflicts: { cases: [], retained: [] } };
  await pool([...byShard.entries()], 4, async ([key, list]) => {
    const existing = await readShard(engine, key);
    const shard: DuplicateShard = existing ?? { version: 2, key, updatedAt: '', cases: {}, retained: {} };
    let changed = false;
    for (const w of list) {
      const map: Record<string, any> = w.kind === 'case' ? shard.cases : shard.retained;
      const remote = map[w.id];
      if ((remote?.rev ?? 0) !== w.baseRev) {
        if (remote) (w.kind === 'case' ? result.conflicts.cases : result.conflicts.retained).push(remote);
        continue;
      }
      if (w.value === null) {
        if (remote) {
          delete map[w.id];
          changed = true;
        }
        if (w.kind === 'retained') result.removedRetained.push(w.id);
        continue;
      }
      const next = { ...w.value, rev: w.baseRev + 1 };
      map[w.id] = next;
      if (w.kind === 'case') result.cases.push(next as DuplicateCase);
      else result.retained.push(next as RetainedMark);
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

/* ---- workflow transitions --------------------------------------------------------- */

const stamp = (c: DuplicateCase, me: UserStamp, entry: Omit<DupHistoryEntry, 'at' | 'by'>, at = now()) => ({
  updatedAt: at,
  updatedBy: me,
  history: [...c.history, { at, by: me, ...entry }],
});

export function acceptCase(c: DuplicateCase, me: UserStamp, note?: string): DuplicateCase {
  const at = now();
  const base = { ...c, ...stamp(c, me, { action: 'ACCEPTED', note: note || undefined }, at) };
  return {
    ...base,
    status: 'MERGED',
    error: undefined,
    note: note || c.note,
    deletedIds: [...c.removedIds],
    reviewedAt: at,
    reviewedBy: me,
    deletedAt: at,
    deletedBy: me,
    history: [...base.history, { at, by: me, action: 'DELETED', note: `Removed ${c.removedIds.join(', ')}` }],
  };
}

export function rejectCase(c: DuplicateCase, me: UserStamp, note?: string): DuplicateCase {
  const at = now();
  return {
    ...c,
    ...stamp(c, me, { action: 'REJECTED', note: note || undefined }, at),
    status: 'FLAGGED',
    error: undefined,
    note: note || c.note,
    reviewedAt: at,
    reviewedBy: me,
  };
}

/** A prepared merge that can no longer run as prepared (a member was retained). */
export function invalidateCase(c: DuplicateCase, me: UserStamp, reason: string): DuplicateCase {
  return { ...c, ...stamp(c, me, { action: 'INVALIDATED', note: reason }), status: 'FLAGGED', error: reason };
}

export function failCase(
  c: DuplicateCase,
  me: UserStamp,
  action: 'IMPORT_FAILED' | 'DELETE_FAILED',
  error: string,
  deletedIds = c.deletedIds
): DuplicateCase {
  return { ...c, ...stamp(c, me, { action, note: error }), error, deletedIds };
}

/** Has this case's merged record already been saved (a delete failed afterwards)? */
export const importedAlready = (c: DuplicateCase) =>
  c.status === 'PENDING' && c.history[c.history.length - 1]?.action === 'DELETE_FAILED';

/* ---- tracker writes ---------------------------------------------------------------- */

export interface ImportOutcome {
  ok: boolean;
  message: string;
  stats?: { created?: number; updated?: number; deleted?: number; ignored?: number };
}

/** Turn a tracker import report (from a 200 or a 409) into one line a person can read. */
export function readImportReport(report: any): ImportOutcome {
  const r = report?.response ?? report?.details ?? report;
  const status = r?.status;
  const errors: any[] = r?.validationReport?.errorReports ?? [];
  const stats = r?.stats;
  if (status === 'OK' && !errors.length) return { ok: true, message: 'Imported', stats };
  const msg = errors.length
    ? errors
        .slice(0, 3)
        .map((e) => `${e.errorCode ?? ''} ${e.message ?? ''}`.trim())
        .join(' · ') + (errors.length > 3 ? ` (+${errors.length - 3} more)` : '')
    : r?.message ?? `Import ${String(status ?? 'failed').toLowerCase()}`;
  return { ok: false, message: msg, stats };
}

async function postTracker(engine: Engine, data: unknown, importStrategy: string): Promise<ImportOutcome> {
  try {
    const res = await engine.mutate({
      resource: 'tracker',
      type: 'create',
      params: { async: false, importStrategy, atomicMode: 'ALL', reportMode: 'ERRORS' },
      data,
    });
    return readImportReport(res);
  } catch (e: any) {
    // a 409 carries the import report in the error's details
    if (e?.details && (e.details.validationReport || e.details.status)) return readImportReport(e.details);
    return { ok: false, message: e?.message ?? String(e) };
  }
}

/** Save the merged record: `POST /api/tracker?async=false&importStrategy=CREATE_AND_UPDATE`. */
export const importMerge = (engine: Engine, payload: TrackerPayload) =>
  postTracker(engine, payload, 'CREATE_AND_UPDATE');

/** Delete a merged-away record: `POST /api/tracker?async=false&importStrategy=DELETE`. */
export const deleteTrackedEntity = (engine: Engine, id: string) =>
  postTracker(engine, { trackedEntities: [{ trackedEntity: id }] }, 'DELETE');
