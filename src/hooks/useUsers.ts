import { useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { useOrgUnitRoots } from './useOrgUnits';

/**
 * Fetches all users the current user has access to, via
 *   api/users.json?fields=id,displayName~rename(name),userCredentials[username]
 * (falling back to the top-level `username` field on newer DHIS2 where
 * userCredentials is deprecated). Cached for 10 minutes.
 *
 * useMapTeams is the map page's org-unit-scoped variant.
 */

const TEN_MIN = 10 * 60_000;

export interface AppUser {
  id: string;
  name: string;
  username: string;
}

/** A user with the paths of their assigned org units ("/root/.../id"). */
export interface MapTeam extends AppUser {
  orgUnitPaths: string[];
}

type Engine = ReturnType<typeof useDataEngine>;

const USER_FIELDS = 'id,displayName~rename(name),username,userCredentials[username]';

const toUser = (u: any): AppUser => ({
  id: u.id,
  name: u.name ?? u.username ?? u.id,
  username: u.username ?? u.userCredentials?.username ?? '',
});

export function useUsers() {
  const engine = useDataEngine();
  return useQuery<AppUser[]>({
    queryKey: ['users-list'],
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        users: {
          resource: 'users',
          params: { fields: USER_FIELDS, order: 'displayName:asc', paging: 'false' },
        },
      });
      return (data.users.users ?? []).map(toUser);
    },
  });
}

/** True when one of the user's org-unit paths passes through `orgUnitId`. */
const underOrgUnit = (u: MapTeam, orgUnitId: string) =>
  u.orgUnitPaths.some((p) => p.includes(orgUnitId));

/**
 * Every user assigned at or below one data-view root, with their org-unit
 * paths. Read in pages of 1000 (a short page ends it) so no single response is
 * huge.
 */
async function fetchDataViewUsers(engine: Engine, rootIds: string[]): Promise<MapTeam[]> {
  const byId = new Map<string, MapTeam>();
  const pageSize = 150;
  const MAX_PAGES = 500; // safety cap, as in fetchAllOrgUnits
  for (const ou of rootIds) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data: any = await engine.query({
        users: {
          resource: 'users',
          params: {
            ou,
            includeChildren: true,
            fields: `${USER_FIELDS},organisationUnits[path]`,
            order: 'displayName:asc',
            page,
            pageSize,
          },
        },
      });
      const rows: any[] = data.users.users ?? [];
      for (const u of rows) {
        byId.set(u.id, {
          ...toUser(u),
          orgUnitPaths: (u.organisationUnits ?? []).map((o: any) => String(o.path ?? '')),
        });
      }
      if (rows.length < pageSize) break;
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Teams (users) for the map page. The list is fetched ONCE for the current
 * user's data-view org units (the roots the map's org-unit tree starts from)
 * and cached for 10 minutes; selecting an org unit never hits the server —
 * `users` is that cached list filtered client-side to users with an org-unit
 * path through the selected unit (the unit itself or anything below it).
 * With no unit selected, `users` is the whole data-view list.
 */
export function useMapTeams(orgUnitId: string | null) {
  const engine = useDataEngine();
  const { data: roots = [] } = useOrgUnitRoots('dataView');
  const rootIds = useMemo(() => roots.map((r) => r.id).sort(), [roots]);

  const query = useQuery<MapTeam[]>({
    queryKey: ['users-list', 'map-dataview', rootIds.join(',')],
    enabled: rootIds.length > 0,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: () => fetchDataViewUsers(engine, rootIds),
  });

  const allUsers = query.data;
  const users = useMemo(() => {
    const list = allUsers ?? [];
    return orgUnitId ? list.filter((u) => underOrgUnit(u, orgUnitId)) : list;
  }, [allUsers, orgUnitId]);

  return { ...query, users };
}
