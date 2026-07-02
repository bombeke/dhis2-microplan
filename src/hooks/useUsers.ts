import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Fetches all users the current user has access to, via
 *   api/users.json?fields=id,displayName~rename(name),userCredentials[username]
 * (falling back to the top-level `username` field on newer DHIS2 where
 * userCredentials is deprecated). Cached for 10 minutes. Used by the FilterMap
 * "All users" selector so it lists everyone accessible, not only those who have
 * uploaded a microplan.
 */

const TEN_MIN = 10 * 60_000;

export interface AppUser {
  id: string;
  name: string;
  username: string;
}

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
          params: {
            fields: 'id,displayName~rename(name),username,userCredentials[username]',
            order: 'displayName:asc',
            paging: 'false',
          },
        },
      });
      return (data.users.users ?? []).map((u: any) => ({
        id: u.id,
        name: u.name ?? u.username ?? u.id,
        username: u.username ?? u.userCredentials?.username ?? '',
      }));
    },
  });
}
