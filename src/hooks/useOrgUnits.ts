import { useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Retrieving 50k+ wards by State -> Ward -> facility without melting the
 * browser: we NEVER fetch the whole tree. Each level is fetched on demand,
 * keyed and cached by parent. The UI lazily expands nodes, and the search
 * worker (FlexSearch) handles the "jump straight to a ward" case so users
 * don't have to drill manually.
 */

export interface OrgUnitNode {
  id: string;
  displayName: string;
  level: number;
  leaf: boolean;
  childCount: number;
  geometryType?: string;
}

const fields =
  'id,displayName,level,leaf,children::size,geometry[type]';

export function useOrgUnitChildren(parentId: string | null, enabled = true) {
  const engine = useDataEngine();
  return useQuery({
    queryKey: ['ou-children', parentId],
    enabled: enabled && !!parentId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<OrgUnitNode[]> => {
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
      return (data.ou.organisationUnits ?? []).map((o: any) => ({
        id: o.id,
        displayName: o.displayName,
        level: o.level,
        leaf: o.leaf,
        childCount: o['children'] ?? o.childCount ?? 0,
        geometryType: o.geometry?.type,
      }));
    },
  });
}

/** Top-level (national) roots for the tree. */
export function useOrgUnitRoots() {
  const engine = useDataEngine();
  return useQuery({
    queryKey: ['ou-roots'],
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<OrgUnitNode[]> => {
      const data: any = await engine.query({
        me: { resource: 'me', params: { fields: 'organisationUnits[id,level]' } },
      });
      const roots = data.me.organisationUnits ?? [];
      const detail: any = await engine.query({
        ou: {
          resource: 'organisationUnits',
          params: {
            filter: [`id:in:[${roots.map((r: any) => r.id).join(',')}]`],
            fields,
            paging: 'false',
          },
        },
      });
      return (detail.ou.organisationUnits ?? []).map((o: any) => ({
        id: o.id,
        displayName: o.displayName,
        level: o.level,
        leaf: o.leaf,
        childCount: o['children'] ?? 0,
        geometryType: o.geometry?.type,
      }));
    },
  });
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
