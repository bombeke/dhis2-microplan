/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import FlexSearch from 'flexsearch';
import { openDB, type IDBPDatabase } from 'idb';

/**
 * Off-main-thread search index. Holding 260k settlements + 50k wards in a
 * FlexSearch Document index on the worker keeps the UI thread free for map
 * rendering. The serialised index is cached in IndexedDB so subsequent loads
 * skip the (expensive) re-tokenisation step and the app works offline.
 */

interface IndexedDoc {
  id: string;
  name: string;
  ward: string;
  state: string;
  kind: 'settlement' | 'ward' | 'facility';
}

const DB_NAME = 'microplan-search';
const STORE = 'index';
const META = 'meta';

let db: IDBPDatabase | null = null;
let docs = new Map<string, IndexedDoc>();

// Document index with field-weighted, partial-match tokenisation.
let index = new FlexSearch.Document<IndexedDoc, true>({
  document: {
    id: 'id',
    index: [
      { field: 'name', tokenize: 'forward' },
      { field: 'ward', tokenize: 'forward' },
      { field: 'state', tokenize: 'forward' },
    ],
    store: true,
  },
  cache: 100,
});

async function getDb() {
  if (db) return db;
  db = await openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
      d.createObjectStore(META);
    },
  });
  return d_b_ensure();
}
function d_b_ensure() {
  return db as IDBPDatabase;
}

const api = {
  /** Ingest a batch of documents. Call repeatedly while streaming large sets. */
  async addBatch(batch: IndexedDoc[]) {
    for (const doc of batch) {
      docs.set(doc.id, doc);
      index.add(doc);
    }
    return docs.size;
  },

  /** Persist the current index + docs to IndexedDB under a dataset signature. */
  async persist(signature: string) {
    const d = await getDb();
    const exported: Record<string, string> = {};
    await new Promise<void>((resolve) => {
      (index.export as unknown as (cb: (key: unknown, data: unknown) => void) => void)(
        (key, data) => {
          exported[String(key)] = data as string;
          // FlexSearch calls this once per shard; resolve on the final tick.
          queueMicrotask(resolve);
        }
      );
    });
    const tx = d.transaction([STORE, META], 'readwrite');
    await tx.objectStore(STORE).put(exported, 'flexsearch');
    await tx.objectStore(STORE).put(Array.from(docs.entries()), 'docs');
    await tx.objectStore(META).put(signature, 'signature');
    await tx.done;
  },

  /** Attempt to hydrate from IndexedDB. Returns true if cache matched. */
  async hydrate(signature: string): Promise<boolean> {
    const d = await getDb();
    const stored = await d.get(META, 'signature');
    if (stored !== signature) return false;
    const exported = (await d.get(STORE, 'flexsearch')) as Record<string, string>;
    const docEntries = (await d.get(STORE, 'docs')) as [string, IndexedDoc][];
    if (!exported || !docEntries) return false;
    for (const [key, data] of Object.entries(exported)) {
      await (index.import as unknown as (key: string, data: string) => Promise<void>)(key, data);
    }
    docs = new Map(docEntries);
    return true;
  },

  /** Ranked search. limit defaults small for snappy type-ahead. */
  async search(query: string, opts?: { limit?: number; kind?: IndexedDoc['kind'] }) {
    const limit = opts?.limit ?? 30;
    if (!query.trim()) return [];
    const raw = index.search(query, { limit: limit * 3, enrich: true });
    const seen = new Set<string>();
    const results: IndexedDoc[] = [];
    for (const field of raw) {
      for (const r of field.result as unknown as { id: string; doc: IndexedDoc }[]) {
        if (seen.has(r.id)) continue;
        if (opts?.kind && r.doc.kind !== opts.kind) continue;
        seen.add(r.id);
        results.push(r.doc);
        if (results.length >= limit) break;
      }
      if (results.length >= limit) break;
    }
    return results;
  },

  async size() {
    return docs.size;
  },

  async clear() {
    docs.clear();
    index = new FlexSearch.Document<IndexedDoc, true>({
      document: {
        id: 'id',
        index: [
          { field: 'name', tokenize: 'forward' },
          { field: 'ward', tokenize: 'forward' },
          { field: 'state', tokenize: 'forward' },
        ],
        store: true,
      },
      cache: 100,
    });
  },
};

export type SearchWorkerApi = typeof api;
Comlink.expose(api);
