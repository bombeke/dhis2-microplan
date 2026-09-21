import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { fetchGrid3ByEnvelope, geometryToEnvelope, type Grid3Settlement } from '../lib/grid3';
import { readIndex, loadMicroplan } from '../lib/microplanStore';
import { weekSettlementsFromTeamPlans } from '../lib/teamSettlements';
import { fetchEventPoints, fetchProgramCoordinatePoints } from '../lib/dhis2Data';
import { usePrograms } from './usePrograms';
import type {
  AnalyticsTable,
  CoordinateAnalyticsResult,
  EntityProfile,
} from '../lib/analyticsEnrollments';
import type { Settlement, TrackerPoint } from '../types';
import { fetchSettlementsByState } from '@/lib/settlementsGeoservice';

/**
 * Assembles the three overlays requested for a SELECTED org unit:
 *  Step 1 — GRID3 v4.0 settlement extents intersecting the unit's geometry
 *           (spatial envelope query; drawn as boundary-line polygons).
 *  Step 2 — settlements referenced in the uploaded microplan(s) for this unit,
 *           grouped by outreach week (highlighted with a per-week colour).
 *  Step 3 — DHIS2 event coordinates for this unit (clustered on the map).
 *
 * Everything keys off the org unit's DHIS2 geometry, so it works for a state,
 * LGA, ward or facility catchment alike.
 */

const TEN_MIN = 10 * 60_000;

export interface WeekSettlements {
  week: number; // 1..5
  settlements: Settlement[];
}

export interface SelectedOrgUnitLayers {
  orgUnitId: string;
  orgUnitName: string;
  geometry: GeoJSON.Geometry | GeoJSON.FeatureCollection | null;
  grid3: Grid3Settlement[];
  grid3Truncated: boolean;
  weekSettlements: WeekSettlements[];
  eventPoints: TrackerPoint[];
  // coordinate-analytics: per-dimension points + metaData.items for the overlay
  coordinatePointsByDim: Record<string, TrackerPoint[]>;
  coordinateMetaItems: Record<string, { name?: string; [k: string]: unknown }>;
  coordinateDimensionIds: string[];
  tableResult: AnalyticsTable;
  /**
   * profileId -> the tracked entity's profile, pivoted from the same analytics
   * row that produced its point. The map popup looks entities up here first and
   * only then fetches the full tracker profile.
   */
  profilesById: Record<string, EntityProfile>;
}

export async function fetchOrgUnitGeometry(
  engine: ReturnType<typeof useDataEngine>,
  orgUnitId: string
): Promise<{ name: string; geometry: GeoJSON.Geometry | GeoJSON.FeatureCollection | any | null }> {
  const data: any = await engine.query({
    ou: {
      resource: `organisationUnits/${orgUnitId}`,
      params: { fields: 'id,displayName,geometry' },
    },
  });
  return { name: data.ou.displayName, geometry: data.ou.geometry ?? null };
}

export function useSelectedOrgUnitLayers(
  orgUnitId: string | null,
  opts?: {
    program?: string;
    grid3Url?: string;
    selectedDimensionIds?: string[];
    userFilter?: string | null;
    analyticsPeriod?: string | null;
    analyticsPeriodType?: string | null;
    uploadedById?: string | null;
    // when set, restrict the by-week settlement extraction to this team code
    // (a team's code IS its username). null/undefined → all teams in the plans.
    teamCode?: string | null;
  }
) {
  const engine = useDataEngine();
  const { data: programs = [] } = usePrograms();
  const stages = opts?.program
    ? programs.find((p) => p.id === opts.program)?.programStages.map((s) => ({ id: s.id, name: s.name })) ?? []
    : [];

  // stable key for the selected-dimension set so the query refetches (and
  // re-caches) whenever the user changes their attribute/data-element picks.
  const selectedKey = (opts?.selectedDimensionIds ?? []).slice().sort().join(',');

  return useQuery<SelectedOrgUnitLayers>({
    queryKey: [
      'selected-ou-layers',
      orgUnitId,
      opts?.program,
      opts?.grid3Url,
      stages.length,
      selectedKey,
      opts?.userFilter ?? '',
      opts?.analyticsPeriod ?? '',
      opts?.uploadedById ?? '',
      opts?.teamCode ?? '',
    ],
    enabled: !!orgUnitId && !!opts?.program && !!opts?.uploadedById && !!opts?.analyticsPeriod,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {

      const id = orgUnitId as string;
      const { name, geometry } = await fetchOrgUnitGeometry(engine, id);

      // ---- Step 1: GRID3 settlements by spatial envelope -------------------
      let grid3: Grid3Settlement[] | any = [];
      let grid3Truncated = false;
      // Temporarirly disabled
      if (geometry) {
        try {
          //const envelope = geometryToEnvelope(geometry);
          //const res = await fetchGrid3ByEnvelope(envelope, { url: opts?.grid3Url });
          //grid3 = res.settlements;
          //grid3Truncated = res.exceededTransferLimit;
          const cleanName = name?.replace(/\s*State$/i, '')?.replace(/\s+/g, '');
          const { features } = await fetchSettlementsByState(cleanName);
          grid3 = features;
          
        } catch (e) {
          console.warn('GRID3 fetch failed', e);
        }
      }

      // ---- Step 2: uploaded settlements by week ----------------------------
      // Find microplans uploaded against this org unit, load them, extract the
      // settlement NAMES from each team's visit keys (handling the unresolved
      // `name:<settlement>` keys the real data uses — see teamSettlements.ts),
      // and group them by outreach week. When a team code is supplied the
      // extraction is restricted to that team. Names are deduped per week and
      // fed downstream to the geoservice, which resolves them to boundaries.
      // Depreceated
      let weekSettlements: WeekSettlements[] = [];
      /*try {
        const index = await readIndex(engine as any);
        // filter uploads to this org unit, and (when a user is selected) to
        // microplans uploaded by that user — "for a selected user".
        const forOu = index.filter(
          (e) =>
           // e.orgUnitId === id &&
            (!opts?.uploadedById || e.uploadedById === opts.uploadedById)
        );
        const weekMap = new Map<number, Map<string, Settlement>>();
        for (const entry of forOu) {
          const plan = await loadMicroplan(engine as any, entry.id);
          if (!plan) continue;
          const settlementById = new Map((plan.settlements ?? []).map((s) => [s.id, s]));
          // Name-aware, team-filtered week grouping. Returns lightweight
          // name-only Settlement stubs (geometry filled in by the geoservice).
          const perPlan = weekSettlementsFromTeamPlans(plan.teamPlans, {
            teamCode: opts?.teamCode ?? null,
            settlementById,
          });
          for (const ws of perPlan) {
            if (!weekMap.has(ws.week)) weekMap.set(ws.week, new Map());
            const bucket = weekMap.get(ws.week)!;
            for (const s of ws.settlements) bucket.set(s.name.toLowerCase(), s);
          }
        }
        weekSettlements = [...weekMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([week, m]) => ({ week, settlements: [...m.values()] }));
      } catch (e) {
        console.warn('uploaded settlement lookup failed', e);
      }
      */
      // ---- Step 3 + 4: coordinate-analytics (per-dimension points + meta) ---
      let eventPoints: TrackerPoint[] = [];
      let coordinatePointsByDim: Record<string, TrackerPoint[]> = {};
      let coordinateMetaItems: CoordinateAnalyticsResult['metaDataItems'] = {};
      let coordinateDimensionIds: string[] = [];
      let tableResult: AnalyticsTable = { columns: [], columnGroups: [], rows: [], total: 0 };
      let profilesById: Record<string, EntityProfile> = {};

      if (opts?.program && id && opts?.uploadedById && opts?.analyticsPeriod) {

        try {
          
          const res = await fetchProgramCoordinatePoints(engine as any, {
            program: opts.program,
            orgUnit: id,
            // selected relative period drives analytics lastUpdated; default to
            // this+last month when the user hasn't picked one.
            period: opts.analyticsPeriod || 'THIS_MONTH,LAST_MONTH',
            periodType: opts.analyticsPeriodType,
            stages,
            selectedDimensionIds: opts.selectedDimensionIds,
            userFilter: opts.userFilter,
          });
          if (res) {
            coordinatePointsByDim = res.pointsByDimension;
            coordinateMetaItems = res.metaDataItems;
            coordinateDimensionIds = res.nonEmptyDimensionIds;
            eventPoints = Object.values(res.pointsByDimension).flat();
            tableResult = res.table;
            profilesById = res.profilesById;
          } 
          else {
            // no COORDINATE dimensions on this program → legacy point fetch
            eventPoints = await fetchEventPoints(engine as any, {
              program: opts.program,
              orgUnit: id,
              period: opts.analyticsPeriod || 'THIS_MONTH',
            });
          }
        } catch (e) {
          console.warn('coordinate-analytics fetch failed', e);
        }
      }

      return {
        orgUnitId: id,
        orgUnitName: name,
        geometry,
        grid3,
        grid3Truncated,
        weekSettlements,
        eventPoints,
        coordinatePointsByDim,
        coordinateMetaItems,
        coordinateDimensionIds,
        tableResult,
        profilesById,
      };
    },
  });
}
