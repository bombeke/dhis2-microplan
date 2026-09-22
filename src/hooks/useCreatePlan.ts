import { useDataEngine } from '@dhis2/app-runtime';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  deleteCreatedPlan,
  loadCreatedPlan,
  readCreatedIndex,
  saveCreatedPlan,
  type CreatedPlan,
  type CreatedPlanIndexEntry,
  type OrgUnitRef,
  type UserRef,
} from '../lib/createdPlanStore';
import { fetchWardSettlements, type SettlementOption } from '../lib/settlementCatalog';

/**
 * Data hooks for the Create Microplan page.
 */

const TEN_MIN = 10 * 60_000;
type Engine = ReturnType<typeof useDataEngine>;

export interface PlanFacility extends OrgUnitRef {
  /** root → parent, in level order */
  ancestors: OrgUnitRef[];
}

/**
 * Every org unit under `orgUnitId` (inclusive) that `programId` is assigned
 * to, keeping only the lowest of them: a unit is dropped when another unit in
 * the set sits beneath it. On a normal hierarchy that is the facility level,
 * but it also copes with programmes attached at mixed levels.
 */
async function fetchPlanFacilities(
  engine: Engine,
  orgUnitId: string,
  programId: string
): Promise<PlanFacility[]> {
  const all: PlanFacility[] = [];
  for (let page = 1; page <= 200; page++) {
    const data: any = await engine.query({
      ou: {
        resource: 'organisationUnits',
        params: {
          filter: [`path:like:${orgUnitId}`, `programs.id:eq:${programId}`],
          fields: 'id,displayName,level,ancestors[id,displayName,level]',
          order: 'displayName:asc',
          pageSize: 1000,
          page,
        },
      },
    });
    const list: any[] = data?.ou?.organisationUnits ?? [];
    for (const o of list) {
      all.push({
        id: o.id,
        name: o.name ?? o.displayName ?? o.id,
        level: o.level,
        ancestors: (o.ancestors ?? [])
          .map((a: any) => ({ id: a.id, name: a.name ?? a.displayName ?? a.id, level: a.level }))
          .sort((a: OrgUnitRef, b: OrgUnitRef) => a.level - b.level),
      });
    }
    if (list.length < 1000) break;
  }
  const hasDescendant = new Set<string>();
  for (const f of all) for (const a of f.ancestors) hasDescendant.add(a.id);
  return all.filter((f) => !hasDescendant.has(f.id));
}

export function usePlanFacilities(orgUnitId: string | null, programId: string | null) {
  const engine = useDataEngine();
  return useQuery<PlanFacility[]>({
    queryKey: ['plan-facilities', orgUnitId, programId],
    enabled: !!orgUnitId && !!programId,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: () => fetchPlanFacilities(engine, orgUnitId!, programId!),
  });
}

/**
 * Users whose *capture* org units include a facility directly — assignment to
 * a ward or LGA above it doesn't count, per the brief. Returns facilityId →
 * users, chunked so the `id:in` filter stays well inside URL limits.
 */
export function useFacilityUsers(facilityIds: string[]) {
  const engine = useDataEngine();
  const ids = Array.from(new Set(facilityIds)).sort();
  return useQuery<Map<string, UserRef[]>>({
    queryKey: ['plan-facility-users', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      const wanted = new Set(ids);
      const out = new Map<string, UserRef[]>();
      for (let i = 0; i < ids.length; i += 120) {
        const chunk = ids.slice(i, i + 120);
        const data: any = await engine.query({
          users: {
            resource: 'users',
            params: {
              filter: [`organisationUnits.id:in:[${chunk.join(',')}]`],
              fields:
                'id,displayName~rename(name),username,userCredentials[username],organisationUnits[id]',
              order: 'displayName:asc',
              paging: 'false',
            },
          },
        });
        for (const u of data?.users?.users ?? []) {
          const ref: UserRef = {
            id: u.id,
            name: u.name ?? u.displayName ?? u.id,
            username: u.username ?? u.userCredentials?.username ?? '',
          };
          for (const ou of u.organisationUnits ?? []) {
            if (!wanted.has(ou.id)) continue;
            const list = out.get(ou.id) ?? [];
            if (!list.some((x) => x.id === ref.id)) list.push(ref);
            out.set(ou.id, list);
          }
        }
      }
      return out;
    },
  });
}

export function useCreatedPlanIndex() {
  const engine = useDataEngine();
  return useQuery<CreatedPlanIndexEntry[]>({
    queryKey: ['created-plan-index'],
    queryFn: () => readCreatedIndex(engine as any),
    staleTime: 30_000,
  });
}

export function useCreatedPlan(id: string | null) {
  const engine = useDataEngine();
  return useQuery<CreatedPlan | null>({
    queryKey: ['created-plan', id],
    enabled: !!id,
    staleTime: 0,
    queryFn: () => loadCreatedPlan(engine as any, id!),
  });
}

export function useSaveCreatedPlan() {
  const engine = useDataEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { plan: CreatedPlan; expectedUpdatedAt: string | null; force?: boolean }) =>
      saveCreatedPlan(engine as any, args.plan, args),
    onSuccess: (plan) => {
      qc.setQueryData(['created-plan', plan.id], plan);
      qc.invalidateQueries({ queryKey: ['created-plan-index'] });
    },
  });
}

export function useDeleteCreatedPlan() {
  const engine = useDataEngine();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteCreatedPlan(engine as any, id),
    onSuccess: (_, id) => {
      qc.setQueryData(['created-plan', id], null);
      qc.invalidateQueries({ queryKey: ['created-plan-index'] });
    },
  });
}

/* ---- settlement lists, one per parent org unit --------------------------- */

/** The level above a facility, which scopes that facility's settlement list. */
export interface SettlementScope {
  id: string;
  name: string;
  /** names further up (LGA, state…) to disambiguate same-named wards */
  ancestorNames: string[];
}

export const scopeOf = (ancestors: OrgUnitRef[]): SettlementScope | null => {
  const parent = ancestors[ancestors.length - 1];
  if (!parent) return null;
  return {
    id: parent.id,
    name: parent.name,
    ancestorNames: ancestors.slice(0, -1).map((a) => a.name),
  };
};

const wardQuery = (scope: SettlementScope) => ({
  queryKey: ['ward-settlements', scope.id],
  queryFn: ({ signal }: { signal?: AbortSignal }) =>
    fetchWardSettlements(scope.name, scope.ancestorNames, signal),
  staleTime: 30 * 60_000,
  gcTime: 60 * 60_000,
});

/**
 * Keyed by the parent's id, so every cell of every facility under the same
 * ward reads one cached list and React Query collapses concurrent requests
 * for it into one.
 */
export function useWardSettlements(scope: SettlementScope | null) {
  return useQuery<SettlementOption[]>({
    ...(scope ? wardQuery(scope) : { queryKey: ['ward-settlements', null], queryFn: async () => [] }),
    enabled: !!scope,
  });
}

export function prefetchWardSettlements(qc: QueryClient, scope: SettlementScope) {
  return qc.prefetchQuery(wardQuery(scope));
}

/**
 * Warm the lists for a page of rows, a few at a time so a 500-row page of
 * distinct wards doesn't fire 500 requests at once.
 */
export async function prefetchScopes(qc: QueryClient, scopes: SettlementScope[], concurrency = 3) {
  const queue = scopes.filter((s) => !qc.getQueryData(['ward-settlements', s.id]));
  const worker = async () => {
    while (queue.length) {
      const s = queue.shift()!;
      await prefetchWardSettlements(qc, s).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
}
