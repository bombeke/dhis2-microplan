import type { TeamPlan, Settlement } from '../types';

/**
 * Persistence for uploaded microplans in the DHIS2 dataStore.
 *
 * Layout (namespace: `microplan`):
 *   index            -> MicroplanIndexEntry[]  (lightweight catalogue for lists)
 *   plan:<id>        -> StoredMicroplan        (full payload, fetched on demand)
 *
 * We keep a small `index` key so the "uploaded files" list and the map filters
 * load fast without pulling every full plan. The heavy per-file payload lives
 * under its own `plan:<id>` key and is only fetched when a file is opened or
 * activated on the map. dataStore values are JSON and namespace+key is unique.
 */

export const NAMESPACE = 'microplan';
export const INDEX_KEY = 'index';
export const planKey = (id: string) => `plan:${id}`;

type Engine = { query: (q: unknown) => Promise<any>; mutate: (m: unknown) => Promise<any> };

/** Catalogue row — everything the list view and map filters need, no geometry. */
export interface MicroplanIndexEntry {
  id: string;
  fileName: string;
  uploadedBy: string; // username
  uploadedById: string; // user id
  uploadedAt: string; // ISO
  period: string; // DHIS2 period id, e.g. THIS_MONTH or 202506
  orgUnitId: string;
  orgUnitName: string;
  level: number; // org unit level the upload targets
  state: string;
  rowCount: number;
  teamCount: number;
  settlementCount: number;
}

/** Full payload stored under plan:<id>. */
export interface StoredMicroplan extends MicroplanIndexEntry {
  teamPlans: TeamPlan[];
  // Settlement geometry is optional: large GRID3 polygon sets can be re-fetched
  // from the geo source instead of stored. When present we cache centroids +
  // light metadata so the map can render without a round-trip.
  settlements?: Settlement[];
}

const isMissing = (e: any) =>
  e?.details?.httpStatusCode === 404 || /not found|404/i.test(e?.message ?? '');

/** Read the catalogue. Returns [] when the namespace/key doesn't exist yet. */
export async function readIndex(engine: Engine): Promise<MicroplanIndexEntry[]> {
  try {
    const res: any = await engine.query({
      idx: { resource: `dataStore/${NAMESPACE}/${INDEX_KEY}` },
    });
    return Array.isArray(res.idx) ? res.idx : [];
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

async function writeIndex(engine: Engine, entries: MicroplanIndexEntry[], create: boolean) {
  await engine.mutate({
    resource: `dataStore/${NAMESPACE}/${INDEX_KEY}`,
    type: create ? 'create' : 'update',
    data: entries,
  });
}

/** Create or replace a key, transparently choosing create vs update. */
async function putKey(engine: Engine, key: string, data: unknown) {
  // Probe existence to pick the right verb (dataStore create fails if exists,
  // update fails if absent).
  let exists = true;
  try {
    await engine.query({ k: { resource: `dataStore/${NAMESPACE}/${key}` } });
  } catch (e) {
    if (isMissing(e)) exists = false;
    else throw e;
  }
  await engine.mutate({
    resource: `dataStore/${NAMESPACE}/${key}`,
    type: exists ? 'update' : 'create',
    data,
  });
  return exists;
}

/** Save an uploaded microplan: full payload + catalogue entry. */
export async function saveMicroplan(engine: Engine, plan: StoredMicroplan): Promise<void> {
  await putKey(engine, planKey(plan.id), plan);

  const index = await readIndex(engine);
  const existed = index.some((e) => e.id === plan.id);
  const entry: MicroplanIndexEntry = {
    id: plan.id,
    fileName: plan.fileName,
    uploadedBy: plan.uploadedBy,
    uploadedById: plan.uploadedById,
    uploadedAt: plan.uploadedAt,
    period: plan.period,
    orgUnitId: plan.orgUnitId,
    orgUnitName: plan.orgUnitName,
    level: plan.level,
    state: plan.state,
    rowCount: plan.rowCount,
    teamCount: plan.teamCount,
    settlementCount: plan.settlementCount,
  };
  const next = existed
    ? index.map((e) => (e.id === plan.id ? entry : e))
    : [entry, ...index];

  // The very first write to the namespace must use create for the index key.
  const indexExisted = await readIndex(engine)
    .then((i) => i.length > 0)
    .catch(() => false);
  await writeIndex(engine, next, !indexExisted && !existed);
}

/** Load one full microplan by id. */
export async function loadMicroplan(
  engine: Engine,
  id: string
): Promise<StoredMicroplan | null> {
  try {
    const res: any = await engine.query({
      p: { resource: `dataStore/${NAMESPACE}/${planKey(id)}` },
    });
    return res.p as StoredMicroplan;
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

/** Delete a microplan and drop it from the catalogue. */
export async function deleteMicroplan(engine: Engine, id: string): Promise<void> {
  try {
    await engine.mutate({
      resource: `dataStore/${NAMESPACE}/${planKey(id)}`,
      type: 'delete',
      id: undefined as never,
    } as any);
  } catch (e) {
    if (!isMissing(e)) throw e;
  }
  const index = await readIndex(engine);
  await writeIndex(engine, index.filter((e) => e.id !== id), false);
}
