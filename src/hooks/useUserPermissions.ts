import { useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';

/**
 * Current-user identity + authorities, resolved once from /api/me.
 *
 * DHIS2 does not expose a "can I do X?" endpoint — you get a flat list of
 * authority strings and are expected to test membership yourself. Two rules
 * matter and are easy to get wrong:
 *
 *  1. ALL is a superuser wildcard. A user with ALL has every authority even
 *     though the string for that authority is absent from the list. Every
 *     check must short-circuit on it.
 *  2. Authorities live under authorities[] on newer versions and under
 *     userCredentials.userRoles[].authorities[] on older ones. We union both
 *     so the hook works across the 2.36→2.42 range.
 */
/**
 * usage:
    const { permissions, isLoading } = useUserPermissions();

    if (isLoading || !permissions) return <Spinner />;

    const canUpload = permissions.can('F_METADATA_IMPORT');
    const canSeeTracker = permissions.canAny(['F_TRACKED_ENTITY_INSTANCE_SEARCH', 'ALL']);

    return (
    <>
        {canUpload && <NavLink to="upload">Upload</NavLink>}
        {permissions.canCaptureIn(mapFilters.orgUnitId) && <EditButton />}
    </>
    );
 */

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  organisationUnits: { id: string; name: string; path: string; level: number }[];
  dataViewOrganisationUnits: { id: string; name: string; path: string; level: number }[];
  authorities: Set<string>;
  isSuperuser: boolean;
}

export interface UserPermissions extends Me {
  /** true when the user holds `auth`, or holds ALL. */
  can: (auth: string) => boolean;
  /** true when the user holds at least one of `auths`. */
  canAny: (auths: string[]) => boolean;
  /** true when the user holds every one of `auths`. */
  canAll: (auths: string[]) => boolean;
  /** true when `orgUnitId` is inside one of the user's capture org units. */
  canCaptureIn: (orgUnitId: string, path?: string) => boolean;
}

const ME_QUERY = {
  me: {
    resource: 'me',
    params: {
      fields: [
        'id',
        'username',
        'displayName',
        'email',
        'authorities',
        'organisationUnits[id,name,path,level]',
        'dataViewOrganisationUnits[id,name,path,level]',
        'userCredentials[userRoles[id,name,authorities]]',
      ].join(','),
    },
  },
};

function normalise(raw: any): Me {
  const authorities = new Set<string>(raw?.authorities ?? []);

  // 2.36-era fallback — union the role authorities in.
  for (const role of raw?.userCredentials?.userRoles ?? []) {
    for (const a of role?.authorities ?? []) authorities.add(a);
  }

  return {
    id: raw?.id ?? '',
    username: raw?.username ?? '',
    displayName: raw?.displayName ?? raw?.username ?? '',
    email: raw?.email,
    organisationUnits: raw?.organisationUnits ?? [],
    dataViewOrganisationUnits: raw?.dataViewOrganisationUnits ?? [],
    authorities,
    isSuperuser: authorities.has('ALL'),
  };
}

export function useUserPermissions() {
  const engine = useDataEngine();

  const query = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: async () => {
      const data: any = await engine.query(ME_QUERY);
      return normalise(data.me);
    },
    staleTime: Infinity, // identity doesn't change mid-session
    gcTime: Infinity,
    retry: 1,
  });

  const me = query.data;

  const permissions = useMemo<UserPermissions | undefined>(() => {
    if (!me) return undefined;

    const can = (auth: string) => me.isSuperuser || me.authorities.has(auth);

    return {
      ...me,
      can,
      canAny: (auths) => me.isSuperuser || auths.some((a) => me.authorities.has(a)),
      canAll: (auths) => me.isSuperuser || auths.every((a) => me.authorities.has(a)),
      canCaptureIn: (orgUnitId, path) => {
        if (me.isSuperuser) return true;
        // A capture unit grants access to itself and everything below it, so
        // compare on path prefixes rather than ids.
        const target = path ?? `/${orgUnitId}`;
        return me.organisationUnits.some(
          (ou) => ou.id === orgUnitId || target.includes(`/${ou.id}`)
        );
      },
    };
  }, [me]);

  return {
    permissions,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | undefined,
    refetch: query.refetch,
  };
}