import { useMemo, useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { useUserPermissions } from './useUserPermissions';
import { useMicroplanSettings } from './useMicroplanSettings';
import { DEFAULT_GPS_SETTINGS, type GpsSettings } from '../lib/microplanSettings';
import {
  fetchSettlementRegister,
  matcherOf,
  matches,
  placeScopeOf,
  type OrgUnitWithAncestors,
  type PlaceMatcher,
  type PlaceScope,
  type SettlementRecord,
} from '../lib/settlementRegistry';
import { listGpsShardKeys, readGpsEdits, shardKeyOf, type GpsEdit } from '../lib/gpsEditStore';

/**
 * Data and access hooks for the Manage Settlements page.
 */

const TEN_MIN = 10 * 60_000;
type Engine = ReturnType<typeof useDataEngine>;

async function fetchWithAncestors(engine: Engine, ids: string[]): Promise<OrgUnitWithAncestors[]> {
  const out: OrgUnitWithAncestors[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150);
    const data: any = await engine.query({
      ou: {
        resource: 'organisationUnits',
        params: {
          filter: [`id:in:[${chunk.join(',')}]`],
          fields: 'id,displayName,level,ancestors[id,displayName,level]',
          paging: 'false',
        },
      },
    });
    for (const o of data?.ou?.organisationUnits ?? []) {
      out.push({
        id: o.id,
        name: o.displayName ?? o.id,
        level: o.level,
        ancestors: (o.ancestors ?? []).map((a: any) => ({
          id: a.id,
          name: a.displayName ?? a.id,
          level: a.level,
        })),
      });
    }
  }
  return out;
}

/** The selected org unit with its ancestors' names — what the register filter is built from. */
export function useOrgUnitWithAncestors(id: string | null) {
  const engine = useDataEngine();
  return useQuery<OrgUnitWithAncestors | null>({
    queryKey: ['ou-with-ancestors', id],
    enabled: !!id,
    staleTime: TEN_MIN,
    queryFn: async () => (await fetchWithAncestors(engine, [id!]))[0] ?? null,
  });
}

/* ---- access -------------------------------------------------------------------- */

export interface GpsScope {
  /** no org-unit restriction */
  all: boolean;
  matchers: PlaceMatcher[];
}

export const inScope = (s: GpsScope, r: Pick<SettlementRecord, 'sk' | 'lk' | 'wk'>) =>
  s.all || s.matchers.some((m) => matches(m, r));

export interface GpsAccess {
  loading: boolean;
  settings: GpsSettings;
  /** may open the page at all */
  canView: boolean;
  canCreate: boolean;
  canApprove: boolean;
  viewScope: GpsScope;
  createScope: GpsScope;
  approveScope: GpsScope;
  /** the user's data-capture org units, for explaining the restriction */
  captureNames: string[];
}

export const GPS_VIEW_AUTHORITIES = [
  'F_READ_GPS_MICROPLAN',
  'F_CREATE_GPS_MICROPLAN',
  'F_APPROVE_GPS_MICROPLAN',
  'F_VIEW_GPS_ALL_MICROPLAN',
  'F_CREATE_GPS_ALL_MICROPLAN',
  'F_APPROVE_GPS_ALL_MICROPLAN',
];

/**
 * Who may view, edit and review which settlements.
 *
 * By default each of the three is limited to the user's data-capture org
 * units (and everything under them). The F_*_GPS_ALL_MICROPLAN authorities
 * lift that limit, but only while the matching "Allow to … all GPS places"
 * switch is on in Settings — both keys are needed. Anyone who may edit or
 * review everywhere may also *see* everywhere, or the lifted limit would be
 * useless.
 *
 * The settlement register knows places by name, so a capture org unit is
 * turned into a state / LGA / ward name matcher (see settlementRegistry.ts).
 */
export function useGpsAccess(): GpsAccess {
  const engine = useDataEngine();
  const { permissions, isLoading } = useUserPermissions();
  const { data: rawSettings } = useMicroplanSettings();
  const settings = rawSettings?.gps ?? DEFAULT_GPS_SETTINGS;

  const captureIds = useMemo(
    () => (permissions?.organisationUnits ?? []).map((o) => o.id).sort(),
    [permissions]
  );
  const captureQ = useQuery<OrgUnitWithAncestors[]>({
    queryKey: ['gps-capture-units', captureIds.join(',')],
    enabled: captureIds.length > 0,
    staleTime: Infinity,
    queryFn: () => fetchWithAncestors(engine, captureIds),
  });

  return useMemo<GpsAccess>(() => {
    const can = (a: string) => permissions?.can(a) ?? false;
    const canView = GPS_VIEW_AUTHORITIES.some(can);
    const canCreate = can('F_CREATE_GPS_MICROPLAN') || can('F_CREATE_GPS_ALL_MICROPLAN');
    const canApprove = can('F_APPROVE_GPS_MICROPLAN') || can('F_APPROVE_GPS_ALL_MICROPLAN');

    const createAll = can('F_CREATE_GPS_ALL_MICROPLAN') && settings.allowCreateAll;
    const approveAll = can('F_APPROVE_GPS_ALL_MICROPLAN') && settings.allowApproveAll;
    const viewAll =
      (can('F_VIEW_GPS_ALL_MICROPLAN') && settings.allowViewAll) || createAll || approveAll;

    const units = captureQ.data ?? [];
    // a capture unit above the state level (the country) covers everything
    const national = units.some((u) => u.level < settings.stateLevel);
    const matchers = national
      ? []
      : units.map((u) => matcherOf(placeScopeOf(u, settings) as PlaceScope));
    const restricted: GpsScope = { all: national, matchers };

    return {
      loading: isLoading || (captureIds.length > 0 && captureQ.isLoading),
      settings,
      canView,
      canCreate,
      canApprove,
      viewScope: viewAll ? { all: true, matchers: [] } : restricted,
      createScope: createAll ? { all: true, matchers: [] } : restricted,
      approveScope: approveAll ? { all: true, matchers: [] } : restricted,
      captureNames: units.map((u) => u.name),
    };
  }, [permissions, settings, captureQ.data, captureQ.isLoading, captureIds.length, isLoading]);
}

/* ---- the register --------------------------------------------------------------- */

/** Every settlement under the selected org unit, with a live row counter while loading. */
export function useSettlementRegister(ou: OrgUnitWithAncestors | null | undefined, settings: GpsSettings) {
  const [loaded, setLoaded] = useState(0);
  const scope = ou ? placeScopeOf(ou, settings) : null;
  const key = scope ? [scope.state ?? '', scope.lga ?? '', scope.ward ?? ''].join('|') : null;
  const query = useQuery({
    queryKey: ['settlement-register', key],
    enabled: !!scope,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 1.5,
    queryFn: ({ signal }) => {
      setLoaded(0);
      return fetchSettlementRegister(scope!, { signal, onProgress: setLoaded });
    },
  });
  return { ...query, scope, loaded };
}

/**
 * The staged records for every shard the loaded rows fall in. One request
 * lists the namespace's keys, so shards nobody has written are never fetched.
 */
export function useGpsEdits(rows: SettlementRecord[] | undefined) {
  const engine = useDataEngine();
  const shardKeys = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows ?? []) s.add(shardKeyOf(r));
    return [...s].sort();
  }, [rows]);
  return useQuery<Map<string, GpsEdit>>({
    queryKey: ['gps-edits', shardKeys.join(',')],
    enabled: !!rows,
    staleTime: 30_000,
    queryFn: async () => {
      const existing = await listGpsShardKeys(engine as any);
      return readGpsEdits(
        engine as any,
        shardKeys.filter((k) => existing.has(k))
      );
    },
  });
}
