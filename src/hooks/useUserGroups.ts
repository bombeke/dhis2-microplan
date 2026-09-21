import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Every DHIS2 user group the current user can see, with its real membership.
 *
 * The Settings page needs the DHIS2 members as well as the ids so it can show
 * an admin which users are already in a group before they add app-level ones —
 * otherwise the transfer list looks like the group is empty when it isn't.
 */

const TEN_MIN = 10 * 60_000;

export interface AppUserGroup {
  id: string;
  name: string;
  /** User ids that belong to the group in DHIS2 metadata. */
  memberIds: string[];
}

export function useUserGroups() {
  const engine = useDataEngine();
  return useQuery<AppUserGroup[]>({
    queryKey: ['user-groups'],
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        groups: {
          resource: 'userGroups',
          params: {
            fields: 'id,displayName~rename(name),users[id]',
            order: 'displayName:asc',
            paging: 'false',
          },
        },
      });
      return (data.groups?.userGroups ?? []).map((g: any) => ({
        id: g.id,
        name: g.name ?? g.id,
        // `users` is the member collection; older builds called it `members`.
        memberIds: (g.users ?? g.members ?? []).map((u: any) => u.id),
      }));
    },
  });
}
