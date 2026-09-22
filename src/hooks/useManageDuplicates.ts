import { useCallback, useMemo, useRef, useState } from 'react';
import { useConfig, useDataEngine } from '@dhis2/app-runtime';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUserPermissions } from './useUserPermissions';
import { useMicroplanSettings } from './useMicroplanSettings';
import { DEFAULT_DUPLICATE_SETTINGS, type DuplicateSettings } from '../lib/microplanSettings';
import {
  DUP_SHARD_PREFIX,
  detectDuplicates,
  listDuplicateShardKeys,
  readCachedScan,
  readDuplicateDecisions,
  scanCacheKey,
  scanTrackedEntities,
  writeCachedScan,
  type CachedScan,
  type StoredDecisions,
} from '../lib/duplicateStore';
import { fetchProgramMeta, fetchTrackedEntity, type ProgramMeta } from '../lib/duplicateMerge';

/**
 * Data and access hooks for the Manage Duplicates page.
 */

const TEN_MIN = 10 * 60_000;

/* ---- access ------------------------------------------------------------------------ */

export const DUPLICATE_AUTHORITIES = [
  'F_REVIEW_DUPLICATES_MICROPLAN',
  'F_APPROVE_DUPLICATES_MICROPLAN',
  'F_REVIEW_DUPLICATES_ALL_MICROPLAN',
  'F_APPROVE_DUPLICATES_ALL_MICROPLAN',
];

export interface DuplicateAccess {
  loading: boolean;
  settings: DuplicateSettings;
  canView: boolean;
  /** may view profiles and prepare merges */
  canReview: boolean;
  /** may accept / reject prepared merges */
  canApprove: boolean;
  reviewAll: boolean;
  approveAll: boolean;
  /** is an org unit path inside the review / approve scope */
  reviewIn: (path: string | undefined) => boolean;
  approveIn: (path: string | undefined) => boolean;
  captureNames: string[];
}

/**
 * Who may review and approve which duplicates.
 *
 * Both are limited to the user's data capture org units (and everything
 * below) unless the matching F_*_DUPLICATES_ALL_MICROPLAN authority is held
 * *and* its switch is on in Settings → Duplicates. Superusers are not
 * restricted — the same rule `canCaptureIn` applies everywhere else.
 */
export function useDuplicateAccess(): DuplicateAccess {
  const { permissions, isLoading } = useUserPermissions();
  const { data: raw } = useMicroplanSettings();
  const settings = raw?.duplicates ?? DEFAULT_DUPLICATE_SETTINGS;

  return useMemo<DuplicateAccess>(() => {
    const can = (a: string) => permissions?.can(a) ?? false;
    const canReview = can('F_REVIEW_DUPLICATES_MICROPLAN') || can('F_REVIEW_DUPLICATES_ALL_MICROPLAN');
    const canApprove = can('F_APPROVE_DUPLICATES_MICROPLAN') || can('F_APPROVE_DUPLICATES_ALL_MICROPLAN');
    const superuser = !!permissions?.isSuperuser;
    const reviewAll = superuser || (can('F_REVIEW_DUPLICATES_ALL_MICROPLAN') && settings.allowReviewAll);
    const approveAll = superuser || (can('F_APPROVE_DUPLICATES_ALL_MICROPLAN') && settings.allowApproveAll);
    const capture = (permissions?.organisationUnits ?? []).map((o) => o.id);
    const inCapture = (path: string | undefined) => !!path && capture.some((id) => path.includes(`/${id}`));
    return {
      loading: isLoading,
      settings,
      canView: canReview || canApprove,
      canReview,
      canApprove,
      reviewAll,
      approveAll,
      reviewIn: (p) => canReview && (reviewAll || inCapture(p)),
      approveIn: (p) => canApprove && (approveAll || inCapture(p)),
      captureNames: (permissions?.organisationUnits ?? []).map((o) => o.name),
    };
  }, [permissions, settings, isLoading]);
}

/* ---- org units under the selection --------------------------------------------------- */

export interface OuInfo {
  id: string;
  name: string;
  path: string;
  level: number;
}

export interface OuIndex {
  selected: OuInfo;
  byId: Map<string, OuInfo>;
  /** names of every unit in the selection and every ancestor above it */
  names: Map<string, string>;
}

/** "Country › State › LGA › Ward › Facility" for a path. */
export function hierarchyOf(index: OuIndex | undefined, path: string | undefined, sep = ' › '): string {
  if (!path) return '';
  return path
    .split('/')
    .filter(Boolean)
    .map((id) => index?.names.get(id) ?? id)
    .join(sep);
}

/**
 * The selected org unit and everything under it, id → name/path. Tracker rows
 * only carry an org unit id; this is what names them, places them in the
 * user's scope and picks their dataStore shard.
 */
export function useOrgUnitIndex(orgUnitId: string | null) {
  const engine = useDataEngine();
  return useQuery<OuIndex>({
    queryKey: ['dup-ou-index', orgUnitId],
    enabled: !!orgUnitId,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      const data: any = await engine.query({
        self: {
          resource: `organisationUnits/${orgUnitId}`,
          params: { fields: 'id,displayName,path,level,ancestors[id,displayName]' },
        },
        below: {
          resource: 'organisationUnits',
          params: { filter: `path:like:${orgUnitId}`, fields: 'id,displayName,path,level', paging: 'false' },
        },
      });
      const toInfo = (o: any): OuInfo => ({ id: o.id, name: o.displayName ?? o.id, path: o.path ?? `/${o.id}`, level: o.level ?? 0 });
      const byId = new Map<string, OuInfo>();
      for (const o of data.below?.organisationUnits ?? []) byId.set(o.id, toInfo(o));
      const selected = toInfo(data.self);
      byId.set(selected.id, selected);
      const names = new Map<string, string>();
      for (const a of data.self?.ancestors ?? []) names.set(a.id, a.displayName ?? a.id);
      for (const o of byId.values()) names.set(o.id, o.name);
      return { selected, byId, names };
    },
  });
}

/* ---- programme metadata ---------------------------------------------------------------- */

export function useProgramMeta(programId: string | null) {
  const engine = useDataEngine();
  return useQuery<ProgramMeta>({
    queryKey: ['dup-program-meta', programId],
    enabled: !!programId,
    staleTime: TEN_MIN,
    queryFn: () => fetchProgramMeta(engine as any, programId!),
  });
}

/* ---- the scan --------------------------------------------------------------------------- */

/**
 * The detected duplicates for (programme, org unit, attributes). The query
 * itself only reads the browser cache — it never scans on its own, because a
 * scan of a state is hundreds of requests. `scan()` runs one, with progress
 * and cancel, and replaces the cached result.
 */
export function useDuplicateScan(
  programId: string | null,
  orgUnitId: string | null,
  attributeIds: string[],
  username: string
) {
  const engine = useDataEngine();
  const { serverVersion } = useConfig();
  const qc = useQueryClient();
  const key = programId && orgUnitId && attributeIds.length ? scanCacheKey(programId, orgUnitId, attributeIds) : null;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const cached = useQuery<CachedScan | null>({
    queryKey: ['dup-scan', key],
    enabled: !!key,
    staleTime: Infinity,
    gcTime: TEN_MIN * 3,
    queryFn: () => readCachedScan(key!),
  });

  const scan = useCallback(async () => {
    if (!key || !programId || !orgUnitId) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    setProgress(0);
    try {
      const entities = await scanTrackedEntities(engine as any, {
        programId,
        orgUnitId,
        attributeIds,
        version: serverVersion as any,
        signal: ctrl.signal,
        onProgress: setProgress,
      });
      const result: CachedScan = {
        key,
        scannedAt: new Date().toISOString(),
        scannedBy: username,
        entityCount: entities.length,
        groups: detectDuplicates(entities),
      };
      await writeCachedScan(result);
      qc.setQueryData(['dup-scan', key], result);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setError(e?.message ?? String(e));
    } finally {
      if (abort.current === ctrl) {
        abort.current = null;
        setProgress(null);
      }
    }
  }, [key, programId, orgUnitId, attributeIds, engine, serverVersion, username, qc]);

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { cached: cached.data ?? null, cacheLoading: cached.isLoading, scan, cancel, progress, error };
}

/* ---- stored decisions -------------------------------------------------------------------- */

export const decisionsQueryKey = (programId: string | null, orgUnitId: string | null) => ['dup-decisions', programId, orgUnitId];

const inside = (path: string | undefined, sel: string) => !!path && path.includes(sel);

/**
 * Every stored merge and retained mark under the selected org unit: shards
 * whose org unit is inside the selection or above it, filtered to records
 * that sit under it.
 */
export function useDuplicateDecisions(programId: string | null, index: OuIndex | undefined) {
  const engine = useDataEngine();
  return useQuery<StoredDecisions>({
    queryKey: decisionsQueryKey(programId, index?.selected.id ?? null),
    enabled: !!programId && !!index,
    staleTime: 30_000,
    queryFn: async () => {
      const prefix = `${DUP_SHARD_PREFIX}${programId}:`;
      const keys = (await listDuplicateShardKeys(engine as any, programId!)).filter((k) => {
        const ou = k.slice(prefix.length);
        return index!.byId.has(ou) || index!.selected.path.includes(`/${ou}`);
      });
      const all = await readDuplicateDecisions(engine as any, keys);
      const sel = `/${index!.selected.id}`;
      const pathOf = (ref: { orgUnit: string; orgUnitPath?: string }) => ref.orgUnitPath ?? index!.byId.get(ref.orgUnit)?.path;
      for (const [id, c] of all.cases) if (!c.members.some((m) => inside(pathOf(m), sel))) all.cases.delete(id);
      for (const [id, r] of all.retained) if (!inside(pathOf(r.record), sel)) all.retained.delete(id);
      return all;
    },
  });
}

/* ---- one whole tracked entity ------------------------------------------------------------ */

/** A tracked entity with every enrollment and event; `null` once it has been deleted. */
export function useTrackedEntityRaw(id: string | null | undefined) {
  const engine = useDataEngine();
  return useQuery<any | null>({
    queryKey: ['dup-te', id],
    enabled: !!id,
    staleTime: 30_000,
    retry: 0,
    refetchOnWindowFocus: false,
    queryFn: () => fetchTrackedEntity(engine as any, id!),
  });
}

/** Several tracked entities at once — one query each, so they share the per-id cache. */
export function useTrackedEntitiesRaw(ids: string[]) {
  const engine = useDataEngine();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ['dup-te', id],
      staleTime: 30_000,
      retry: 0,
      refetchOnWindowFocus: false,
      queryFn: () => fetchTrackedEntity(engine as any, id),
    })),
  });
}
