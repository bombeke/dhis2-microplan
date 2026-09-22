/**
 * Browser-persisted snapshot of the lazily loaded org-unit tree.
 *
 * The hierarchy changes rarely, but the picker used to start from nothing on
 * every page load. Each fetched level (roots + one entry per parent) is kept in
 * localStorage in a compact tuple form and handed to React Query as
 * `initialData` with its saved timestamp, so the tree paints instantly from the
 * last session and revalidates in the background once it is stale
 * (stale-while-revalidate). Storage failures (private mode, quota) are ignored —
 * the cache is purely an accelerator.
 */

/** [id, displayName, level, childCount] */
type Row = [string, string, number, number];

interface Entry {
  t: number; // saved at (ms)
  r: Row[];
}

interface Snapshot {
  v: 1;
  e: Record<string, Entry>;
}

export interface CachedNode {
  id: string;
  displayName: string;
  level: number;
  leaf: boolean;
  childCount: number;
}

const MAX_ENTRIES = 400;
const MAX_BYTES = 2_500_000;
const WRITE_DELAY = 800;

let storageKey = 'microplan:ou-tree';
let snapshot: Snapshot | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/** Scope the cache to a DHIS2 instance so two servers never share a tree. */
export function setOrgUnitCacheScope(baseUrl: string) {
  const key = `microplan:ou-tree:${baseUrl}`;
  if (key !== storageKey) {
    storageKey = key;
    snapshot = null;
  }
}

function load(): Snapshot {
  if (snapshot) return snapshot;
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    snapshot = parsed?.v === 1 && parsed.e ? parsed : { v: 1, e: {} };
  } catch {
    snapshot = { v: 1, e: {} };
  }
  return snapshot!;
}

function flush() {
  writeTimer = null;
  const snap = load();
  const keys = Object.keys(snap.e).sort((a, b) => snap.e[b].t - snap.e[a].t);
  // drop the oldest entries beyond the cap
  for (const k of keys.slice(MAX_ENTRIES)) delete snap.e[k];
  for (let i = Math.min(keys.length, MAX_ENTRIES); i > 0; i--) {
    try {
      const json = JSON.stringify(snap);
      if (json.length > MAX_BYTES) throw new Error('too big');
      localStorage.setItem(storageKey, json);
      return;
    } catch {
      // over quota: shed the oldest remaining entry and retry
      delete snap.e[keys[i - 1]];
    }
  }
}

const toRow = (n: CachedNode): Row => [n.id, n.displayName, n.level, n.childCount];
const fromRow = ([id, displayName, level, childCount]: Row): CachedNode => ({
  id,
  displayName,
  level,
  childCount,
  leaf: childCount === 0,
});

export function readOrgUnitLevel(key: string): { nodes: CachedNode[]; updatedAt: number } | undefined {
  const entry = load().e[key];
  return entry ? { nodes: entry.r.map(fromRow), updatedAt: entry.t } : undefined;
}

export function writeOrgUnitLevel(key: string, nodes: CachedNode[]) {
  load().e[key] = { t: Date.now(), r: nodes.map(toRow) };
  if (!writeTimer) writeTimer = setTimeout(flush, WRITE_DELAY);
}
