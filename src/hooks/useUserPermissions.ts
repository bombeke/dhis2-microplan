import { useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { useMicroplanSettings } from './useMicroplanSettings';
import {
  effectiveGroupIds,
  grantedAuthorities,
  type GrantSubject,
  type MicroplanSettings,
} from '../lib/microplanSettings';

/**
 * Current-user identity + authorities, resolved from /api/me and widened by
 * the app's own grant table in dataStore/microplan/settings.
 *
 * DHIS2 does not expose a "can I do X?" endpoint — you get a flat list of
 * authority strings and are expected to test membership yourself. Three rules
 * matter and are easy to get wrong:
 *
 *  1. ALL is a superuser wildcard. A user with ALL has every authority even
 *     though the string for that authority is absent from the list. Every
 *     check must short-circuit on it.
 *  2. Authorities live under authorities[] on newer versions and under
 *     userCredentials.userRoles[].authorities[] on older ones. We union both
 *     so the hook works across the 2.36→2.42 range.
 *  3. DHIS2 is checked first; the settings key is only a *fallback*. It can
 *     add an authority the user doesn't hold, never remove one they do. See
 *     lib/microplanSettings.ts for why that table exists at all.
 *
 * `source(auth)` reports which of the two granted an authority, which is what
 * the Settings page uses to tell an admin that a role already holds something
 * in DHIS2 and doesn't need a fallback grant.
 */
/**
 * usage:
    const { permissions, isLoading } = useUserPermissions();

    if (isLoading || !permissions) return <Spinner />;

    const canUpload = permissions.can('F_ADD_MICROPLAN');
    const canSeeTracker = permissions.canAny(['F_TRACKED_ENTITY_INSTANCE_SEARCH', 'ALL']);

    return (
    <>
        {canUpload && <NavLink to="upload">Upload</NavLink>}
        {permissions.canCaptureIn(mapFilters.orgUnitId) && <EditButton />}
    </>
    );
 */

export interface NamedRef {
  id: string;
  name: string;
}

export interface Me {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  organisationUnits: { id: string; name: string; path: string; level: number }[];
  dataViewOrganisationUnits: { id: string; name: string; path: string; level: number }[];
  authorities: Set<string>;
  userRoles: NamedRef[];
  userGroups: NamedRef[];
  isSuperuser: boolean;
}

/** Where a granted authority came from. `null` means it wasn't granted. */
export type AuthoritySource = 'superuser' | 'dhis2' | 'settings' | null;

export interface UserPermissions extends Me {
  /** true when the user holds `auth` in DHIS2, via app settings, or holds ALL. */
  can: (auth: string) => boolean;
  /** true when the user holds at least one of `auths`. */
  canAny: (auths: string[]) => boolean;
  /** true when the user holds every one of `auths`. */
  canAll: (auths: string[]) => boolean;
  /** true when `orgUnitId` is inside one of the user's capture org units. */
  canCaptureIn: (orgUnitId: string, path?: string) => boolean;
  /** Which layer granted `auth` — for explaining access, not for gating it. */
  source: (auth: string) => AuthoritySource;
  /** Authorities picked up from the settings key rather than from DHIS2. */
  grantedBySettings: Set<string>;
  /** Groups the user counts as a member of, DHIS2 membership plus app-level. */
  effectiveGroupIds: string[];
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
        'userRoles[id,displayName]',
        'userGroups[id,displayName]',
        'userCredentials[userRoles[id,name,authorities]]',
      ].join(','),
    },
  },
};

const toRefs = (list: any): NamedRef[] =>
  (Array.isArray(list) ? list : []).map((r: any) => ({
    id: r?.id ?? '',
    name: r?.displayName ?? r?.name ?? r?.id ?? '',
  }));

function normalise(raw: any): Me {
  const authorities = new Set<string>(raw?.authorities ?? []);

  // 2.36-era fallback — union the role authorities in.
  for (const role of raw?.userCredentials?.userRoles ?? []) {
    for (const a of role?.authorities ?? []) authorities.add(a);
  }

  // Roles moved from userCredentials to the top level around 2.38; take
  // whichever the server answered with, de-duplicated by id.
  const roles = new Map<string, NamedRef>();
  for (const ref of [...toRefs(raw?.userRoles), ...toRefs(raw?.userCredentials?.userRoles)]) {
    if (ref.id) roles.set(ref.id, ref);
  }

  return {
    id: raw?.id ?? '',
    username: raw?.username ?? '',
    displayName: raw?.displayName ?? raw?.username ?? '',
    email: raw?.email,
    organisationUnits: raw?.organisationUnits ?? [],
    dataViewOrganisationUnits: raw?.dataViewOrganisationUnits ?? [],
    authorities,
    userRoles: Array.from(roles.values()),
    userGroups: toRefs(raw?.userGroups),
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

  const settingsQuery = useMicroplanSettings();
  const settings = settingsQuery.data as MicroplanSettings | undefined;

  const me = query.data;

  const permissions = useMemo<UserPermissions | undefined>(() => {
    if (!me) return undefined;

    const subject: GrantSubject = {
      userId: me.id,
      roleIds: me.userRoles.map((r) => r.id),
      groupIds: me.userGroups.map((g) => g.id),
    };

    const fallback = settings ? grantedAuthorities(settings, subject) : new Set<string>();
    const groupIds = settings ? effectiveGroupIds(settings, subject) : subject.groupIds;

    const can = (auth: string) =>
      me.isSuperuser || me.authorities.has(auth) || fallback.has(auth);

    const source = (auth: string): AuthoritySource => {
      if (me.isSuperuser) return 'superuser';
      if (me.authorities.has(auth)) return 'dhis2';
      if (fallback.has(auth)) return 'settings';
      return null;
    };

    return {
      ...me,
      can,
      canAny: (auths) => auths.some(can),
      canAll: (auths) => auths.every(can),
      canCaptureIn: (orgUnitId, path) => {
        if (me.isSuperuser) return true;
        // A capture unit grants access to itself and everything below it, so
        // compare on path prefixes rather than ids.
        const target = path ?? `/${orgUnitId}`;
        return me.organisationUnits.some(
          (ou) => ou.id === orgUnitId || target.includes(`/${ou.id}`)
        );
      },
      source,
      grantedBySettings: fallback,
      effectiveGroupIds: groupIds,
    };
  }, [me, settings]);

  return {
    permissions,
    // The settings key is part of the answer, so the shell must not decide
    // what to render until both halves have landed — otherwise a user whose
    // only grant is a settings grant sees the "no permission" screen flash.
    isLoading: query.isLoading || settingsQuery.isLoading,
    isError: query.isError,
    error: query.error as Error | undefined,
    refetch: query.refetch,
  };
}
