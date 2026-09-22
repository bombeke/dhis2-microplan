import { useMemo } from 'react';
import { useConfig, useDataEngine } from '@dhis2/app-runtime';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { readOrgUnitLevel, setOrgUnitCacheScope, writeOrgUnitLevel } from '../lib/orgUnitCache';

/**
 * Retrieving 50k+ wards by State -> Ward -> facility without melting the
 * browser: we NEVER fetch the whole tree. Each level is fetched on demand,
 * keyed and cached by parent. The UI lazily expands nodes, and the search
 * worker (FlexSearch) handles the "jump straight to a ward" case so users
 * don't have to drill manually.
 *
 * Speed-ups for the tree picker:
 *  - fields are kept minimal (`children::size` only — no geometry, no `leaf`,
 *    both of which make the server do extra work per unit);
 *  - roots come from one `userOnly` request instead of `me` + a lookup;
 *  - each level is persisted in localStorage (lib/orgUnitCache.ts) and served
 *    as initialData, so repeat visits paint immediately and revalidate quietly;
 *  - prefetchOrgUnitGrandchildren loads the *next* level for a whole set of
 *    siblings in one request, so expanding a node is usually instant.
 */

export interface OrgUnitNode {
  id: string;
  displayName: string;
  level: number;
  leaf: boolean;
  childCount: number;
  geometryType?: string;
}

type Engine = ReturnType<typeof useDataEngine>;

const fields = 'id,displayName,level,children::size';
const LEVEL_STALE = 30 * 60_000;
const LEVEL_GC = 60 * 60_000;

const childrenKey = (parentId: string | null) => ['ou-children', parentId] as const;

const toNode = (o: any): OrgUnitNode => {
  const childCount = o.children ?? o.childCount ?? 0;
  return {
    id: o.id,
    displayName: o.displayName,
    level: o.level,
    leaf: childCount === 0,
    childCount,
  };
};

async function fetchChildren(engine: Engine, parentId: string): Promise<OrgUnitNode[]> {
  const data: any = await engine.query({
    ou: {
      resource: 'organisationUnits',
      params: {
        filter: [`parent.id:eq:${parentId}`],
        fields,
        order: 'displayName:asc',
        paging: 'false',
      },
    },
  });
  const nodes = (data.ou.organisationUnits ?? []).map(toNode);
  writeOrgUnitLevel(`c:${parentId}`, nodes);
  return nodes;
}

function useCacheScope() {
  const { baseUrl } = useConfig();
  setOrgUnitCacheScope(baseUrl ?? '');
}

export function useOrgUnitChildren(parentId: string | null, enabled = true) {
  const engine = useDataEngine();
  useCacheScope();
  // read lazily: React Query only calls these when the query is first created
  const cached = () => (parentId ? readOrgUnitLevel(`c:${parentId}`) : undefined);
  return useQuery({
    queryKey: childrenKey(parentId),
    enabled: enabled && !!parentId,
    staleTime: LEVEL_STALE,
    gcTime: LEVEL_GC,
    initialData: () => cached()?.nodes,
    initialDataUpdatedAt: () => cached()?.updatedAt,
    queryFn: () => fetchChildren(engine, parentId!),
  });
}

/** Top-level roots for the tree: the user's assigned org units, in one request. */
export function useOrgUnitRoots() {
  const engine = useDataEngine();
  useCacheScope();
  return useQuery({
    queryKey: ['ou-roots'],
    staleTime: LEVEL_STALE,
    gcTime: LEVEL_GC,
    initialData: () => readOrgUnitLevel('roots')?.nodes,
    // roots depend on who is logged in: always revalidate cached roots once
    initialDataUpdatedAt: 0,
    queryFn: async (): Promise<OrgUnitNode[]> => {
      const data: any = await engine.query({
        ou: {
          resource: 'organisationUnits',
          params: { userOnly: true, fields, order: 'displayName:asc', paging: 'false' },
        },
      });
      const nodes = (data.ou.organisationUnits ?? []).map(toNode);
      writeOrgUnitLevel('roots', nodes);
      return nodes;
    },
  });
}

/** Warm one node's children (e.g. on hover) so expanding it is instant. */
export function prefetchOrgUnitChildren(qc: QueryClient, engine: Engine, parentId: string) {
  return qc.prefetchQuery({
    queryKey: childrenKey(parentId),
    staleTime: LEVEL_STALE,
    queryFn: () => fetchChildren(engine, parentId),
  });
}

/**
 * Load the children of every node in `parents` in as few requests as possible
 * (`parent.id:in:[…]`, chunked), then split the rows per parent into the same
 * per-parent cache entries useOrgUnitChildren reads. Parents already cached and
 * fresh, or leaves, are skipped; the combined size is capped using the known
 * `childCount`, so a huge level is never pulled in speculatively.
 */
const inFlight = new Set<string>();

export async function prefetchOrgUnitGrandchildren(
  qc: QueryClient,
  engine: Engine,
  parents: OrgUnitNode[],
  maxRows = 3000
) {
  const now = Date.now();
  const todo: OrgUnitNode[] = [];
  let rows = 0;
  for (const p of parents) {
    if (p.childCount === 0 || inFlight.has(p.id)) continue;
    const state = qc.getQueryState(childrenKey(p.id));
    if (state?.data && now - state.dataUpdatedAt < LEVEL_STALE) continue;
    if (rows + p.childCount > maxRows) continue;
    rows += p.childCount;
    todo.push(p);
  }
  if (todo.length === 0) return;
  todo.forEach((p) => inFlight.add(p.id));

  try {
    const chunkSize = 100; // keeps the id list well within URL limits
    await Promise.all(
      Array.from({ length: Math.ceil(todo.length / chunkSize) }, async (_, i) => {
        const chunk = todo.slice(i * chunkSize, (i + 1) * chunkSize);
        const data: any = await engine.query({
          ou: {
            resource: 'organisationUnits',
            params: {
              filter: [`parent.id:in:[${chunk.map((p) => p.id).join(',')}]`],
              fields: `${fields},parent[id]`,
              order: 'displayName:asc',
              paging: 'false',
            },
          },
        });
        const byParent = new Map<string, OrgUnitNode[]>(chunk.map((p) => [p.id, []]));
        for (const o of data.ou.organisationUnits ?? []) {
          byParent.get(o.parent?.id)?.push(toNode(o));
        }
        for (const [parentId, nodes] of byParent) {
          qc.setQueryData(childrenKey(parentId), nodes);
          writeOrgUnitLevel(`c:${parentId}`, nodes);
        }
      })
    );
  } catch {
    // speculative only — a normal fetch happens if the node is expanded
  } finally {
    todo.forEach((p) => inFlight.delete(p.id));
  }
}

/**
 * Bulk-load every ward (level N) once for the search index, paged server-side
 * so we stream rather than block. Yields batches to the caller.
 */
export async function* streamWards(
  engine: ReturnType<typeof useDataEngine>,
  wardLevel: number,
  pageSize = 1000
): AsyncGenerator<OrgUnitNode[]> {
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const data: any = await engine.query({
      ou: {
        resource: 'organisationUnits',
        params: {
          filter: [`level:eq:${wardLevel}`],
          fields: 'id,displayName,level,parent[displayName]',
          order: 'displayName:asc',
          pageSize,
          page,
        },
      },
    });
    const list = data.ou.organisationUnits ?? [];
    if (list.length === 0) break;
    yield list.map((o: any) => ({
      id: o.id,
      displayName: o.displayName,
      level: o.level,
      leaf: false,
      childCount: 0,
    }));
    if (list.length < pageSize) break;
    page += 1;
  }
}

/**
 * Whole-hierarchy org-unit cache.
 *
 * Fetches the entire org-unit tree once (flat, with parent + path + level) and
 * caches it aggressively so the FilterMap org-unit selector never re-hits the
 * server within the cache window. `staleTime` + `gcTime` are set to 10 minutes,
 * satisfying "no server refetching for at least 10 minutes". Pagination streams
 * the full set; for very large hierarchies this is one upfront cost, after which
 * search/selection is entirely client-side (see useFlexFilter / SearchableSelect).
 */
export interface FlatOrgUnit {
  id: string;
  name: string;
  level: number;
  path: string; // /root/.../id
  parentId: string | null;
}

const TEN_MIN = 10 * 60_000;

async function fetchAllOrgUnits(
  engine: ReturnType<typeof useDataEngine>,
  pageSize = 1000
): Promise<FlatOrgUnit[]> {
  const out: FlatOrgUnit[] = [];
  let page = 1;
  // Hard safety cap so a missing pager.pageCount can never loop forever. DHIS2
  // omits pageCount unless totalPages=true, and even then a short page is the
  // authoritative end-of-data signal. 500 * 1000 = 500k units, above any real
  // hierarchy.
  const MAX_PAGES = 500;

  while (page <= MAX_PAGES) {
    const data: any = await engine.query({
      ou: {
        resource: 'organisationUnits',
        params: {
          fields: 'id,displayName,level,path,parent[id]',
          order: 'level:asc,displayName:asc',
          pageSize,
          page,
          totalPages: true,
        },
      },
    });
    const list: any[] = data?.ou?.organisationUnits ?? [];
    for (const o of list) {
      out.push({
        id: o.id,
        name: o.displayName,
        level: o.level,
        path: o.path ?? '',
        parentId: o.parent?.id ?? null,
      });
    }

    // Authoritative stop: a page shorter than pageSize is always the last page.
    if (list.length < pageSize) break;

    // Secondary stop when the server *does* report pageCount.
    const pageCount = data?.ou?.pager?.pageCount;
    if (typeof pageCount === 'number' && page >= pageCount) break;

    page += 1;
  }
  return out;
}

export function useOrgUnitHierarchy(enabled = true) {
  const engine = useDataEngine();
  return useQuery<FlatOrgUnit[]>({
    queryKey: ['ou-hierarchy-all'],
    enabled,
    staleTime: TEN_MIN, // do not consider stale (no refetch) for 10 min
    gcTime: TEN_MIN * 2, // keep in cache well beyond that
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => fetchAllOrgUnits(engine),
  });
}

/** A node in the org-unit tree, built client-side from the cached flat list. */
export interface OrgTreeNode extends FlatOrgUnit {
  children: OrgTreeNode[];
}

/** Build a nested tree from the flat hierarchy (roots = lowest level present). */
export function buildOrgTree(flat: FlatOrgUnit[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const o of flat) byId.set(o.id, { ...o, children: [] });
  const roots: OrgTreeNode[] = [];
  let minLevel = Infinity;
  for (const o of flat) minLevel = Math.min(minLevel, o.level);
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else if (node.level === minLevel || !node.parentId) roots.push(node);
  }
  const sortRec = (nodes: OrgTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/**
 * Returns the whole org-unit hierarchy both as a flat list (for FlexSearch) and
 * as a nested tree (for hierarchy selection). Both derive from the single
 * cached useOrgUnitHierarchy query, so there is no extra fetch and the 10-min
 * cache continues to apply.
 */
export function useOrgUnitTree(enabled = true) {
  const q = useOrgUnitHierarchy(enabled);
  const flat = q.data ?? [];
  const tree = useMemo(() => buildOrgTree(flat), [flat]);
  return { ...q, flat, tree };
}
/**
 * Server-side org-unit search by name, for the lazy tree picker. Avoids loading
 * the whole hierarchy: we ask the API for units whose name matches the query
 * (debounced by the caller), returning each with its `path` and `level` so the
 * picker can show ancestry. Only runs when the query is long enough.
 */
export interface OrgUnitSearchHit {
  id: string;
  name: string;
  level: number;
  path: string;
  parentId: string | null;
}

export function useOrgUnitSearch(query: string, enabled = true) {
  const engine = useDataEngine();
  const q = query.trim();
  return useQuery<OrgUnitSearchHit[]>({
    queryKey: ['ou-search', q],
    enabled: enabled && q.length >= 2,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const data: any = await engine.query({
        ou: {
          resource: 'organisationUnits',
          params: {
            query: q,
            fields: 'id,displayName~rename(name),level,path,parent[id]',
            order: 'level:asc,displayName:asc',
            pageSize: 50,
            page: 1,
          },
        },
      });
      return (data.ou.organisationUnits ?? []).map((o: any) => ({
        id: o.id,
        name: o.name ?? o.displayName,
        level: o.level,
        path: o.path ?? '',
        parentId: o.parent?.id ?? null,
      }));
    },
  });
}

/**
 * Fetch specific org units by id (used to resolve the currently-selected node's
 * label without loading the whole tree).
 */
export function useOrgUnitsByIds(ids: string[]) {
  const engine = useDataEngine();
  const key = ids.slice().sort().join(',');
  return useQuery<Record<string, { id: string; name: string; level: number; path: string }>>({
    queryKey: ['ou-by-ids', key],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const data: any = await engine.query({
        ou: {
          resource: 'organisationUnits',
          params: {
            filter: [`id:in:[${ids.join(',')}]`],
            fields: 'id,displayName~rename(name),level,path',
            paging: 'false',
          },
        },
      });
      const map: Record<string, { id: string; name: string; level: number; path: string }> = {};
      for (const o of data.ou.organisationUnits ?? []) {
        map[o.id] = { id: o.id, name: o.name ?? o.displayName, level: o.level, path: o.path ?? '' };
      }
      return map;
    },
  });
}

/**
 * Resolve just the `path` for a set of org-unit ids (used for descendant-aware
 * filtering without loading the whole hierarchy). Cached; only the ids actually
 * needed (uploaded microplans' org units + the selected unit) are fetched.
 */
export function useOrgUnitPaths(ids: string[]) {
  const engine = useDataEngine();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const key = unique.slice().sort().join(',');
  return useQuery<Map<string, string>>({
    queryKey: ['ou-paths', key],
    enabled: unique.length > 0,
    staleTime: 10 * 60_000,
    gcTime: 20 * 60_000,
    queryFn: async () => {
      const out = new Map<string, string>();
      // chunk to keep the id:in filter within limits
      const chunkSize = 200;
      for (let i = 0; i < unique.length; i += chunkSize) {
        const chunk = unique.slice(i, i + chunkSize);
        const data: any = await engine.query({
          ou: {
            resource: 'organisationUnits',
            params: {
              filter: [`id:in:[${chunk.join(',')}]`],
              fields: 'id,path',
              paging: 'false',
            },
          },
        });
        for (const o of data.ou.organisationUnits ?? []) out.set(o.id, o.path ?? '');
      }
      return out;
    },
  });
}
