import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Every DHIS2 user role the current user can see, for the Settings page's
 * role → authority grant table.
 *
 * `authorities` comes back too so the table can show which roles already hold
 * a microplan authority for real — those cells are the ones an admin should
 * leave alone, because a settings grant on top of them changes nothing.
 */

const TEN_MIN = 10 * 60_000;

export interface AppUserRole {
  id: string;
  name: string;
  /** Authorities the role genuinely holds in DHIS2 metadata. */
  authorities: string[];
}

export function useUserRoles() {
  const engine = useDataEngine();
  return useQuery<AppUserRole[]>({
    queryKey: ['user-roles'],
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const data: any = await engine.query({
        roles: {
          resource: 'userRoles',
          params: {
            fields: 'id,displayName~rename(name),authorities',
            order: 'displayName:asc',
            paging: 'false',
          },
        },
      });
      return (data.roles?.userRoles ?? []).map((r: any) => ({
        id: r.id,
        name: r.name ?? r.id,
        authorities: Array.isArray(r.authorities) ? r.authorities : [],
      }));
    },
  });
}
