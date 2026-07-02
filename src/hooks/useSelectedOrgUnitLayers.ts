import { useDataEngine } from '@dhis2/app-runtime';
import { useQuery } from '@tanstack/react-query';
import { fetchGrid3ByEnvelope, geometryToEnvelope, type Grid3Settlement } from '../lib/grid3';
import { readIndex, loadMicroplan } from '../lib/microplanStore';
import { fetchEventPoints, fetchProgramCoordinatePoints } from '../lib/dhis2Data';
import { usePrograms } from './usePrograms';
import type { CoordinateAnalyticsResult } from '../lib/analyticsEnrollments';
import type { Settlement, TrackerPoint } from '../types';

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
  geometry: GeoJSON.Geometry | null;
  grid3: Grid3Settlement[];
  grid3Truncated: boolean;
  weekSettlements: WeekSettlements[];
  eventPoints: TrackerPoint[];
  // coordinate-analytics: per-dimension points + metaData.items for the overlay
  coordinatePointsByDim: Record<string, TrackerPoint[]>;
  coordinateMetaItems: Record<string, { name?: string; [k: string]: unknown }>;
  coordinateDimensionIds: string[];
}

async function fetchOrgUnitGeometry(
  engine: ReturnType<typeof useDataEngine>,
  orgUnitId: string
): Promise<{ name: string; geometry: GeoJSON.Geometry | null }> {
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
  opts?: { program?: string; grid3Url?: string }
) {
  const engine = useDataEngine();
  const { data: programs = [] } = usePrograms();
  const stages = opts?.program
    ? programs.find((p) => p.id === opts.program)?.programStages.map((s) => ({ id: s.id, name: s.name })) ?? []
    : [];

  return useQuery<SelectedOrgUnitLayers>({
    queryKey: ['selected-ou-layers', orgUnitId, opts?.program, opts?.grid3Url, stages.length],
    enabled: !!orgUnitId,
    staleTime: TEN_MIN,
    gcTime: TEN_MIN * 2,
    queryFn: async () => {
      const id = orgUnitId as string;
      const { name, geometry } = await fetchOrgUnitGeometry(engine, id);

      // ---- Step 1: GRID3 settlements by spatial envelope -------------------
      let grid3: Grid3Settlement[] = [];
      let grid3Truncated = false;
      if (geometry) {
        try {
          const envelope = geometryToEnvelope(geometry);
          const res = await fetchGrid3ByEnvelope(envelope, { url: opts?.grid3Url });
          grid3 = res.settlements;
          grid3Truncated = res.exceededTransferLimit;
        } catch (e) {
          console.warn('GRID3 fetch failed', e);
        }
      }

      // ---- Step 2: uploaded settlements by week ----------------------------
      // find microplans uploaded against this org unit, load them, and group
      // their settlements by the weeks in which each is visited.
      const weekMap = new Map<number, Map<string, Settlement>>();
      try {
        const index = await readIndex(engine as any);
        const forOu = index.filter((e) => e.orgUnitId === id);
        for (const entry of forOu) {
          const plan = await loadMicroplan(engine as any, entry.id);
          if (!plan) continue;
          const settlementById = new Map((plan.settlements ?? []).map((s) => [s.id, s]));
          for (const teamPlan of plan.teamPlans) {
            for (const [settlementId, weeks] of Object.entries(teamPlan.visits)) {
              const s = settlementById.get(settlementId);
              if (!s) continue;
              for (const w of weeks) {
                if (!weekMap.has(w)) weekMap.set(w, new Map());
                weekMap.get(w)!.set(s.id, s);
              }
            }
          }
        }
      } catch (e) {
        console.warn('uploaded settlement lookup failed', e);
      }
      const weekSettlements: WeekSettlements[] = [...weekMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([week, m]) => ({ week, settlements: [...m.values()] }));

      // ---- Step 3 + 4: coordinate-analytics (per-dimension points + meta) ---
      let eventPoints: TrackerPoint[] = [];
      let coordinatePointsByDim: Record<string, TrackerPoint[]> = {};
      let coordinateMetaItems: CoordinateAnalyticsResult['metaDataItems'] = {};
      let coordinateDimensionIds: string[] = [];
      if (opts?.program) {
        try {
          const res = await fetchProgramCoordinatePoints(engine as any, {
            program: opts.program,
            orgUnit: id,
            period: 'THIS_MONTH,LAST_MONTH',
            stages,
          });
          if (res) {
            coordinatePointsByDim = res.pointsByDimension;
            coordinateMetaItems = res.metaDataItems;
            coordinateDimensionIds = res.nonEmptyDimensionIds;
            eventPoints = Object.values(res.pointsByDimension).flat();
          } else {
            // no COORDINATE dimensions on this program → legacy point fetch
            eventPoints = await fetchEventPoints(engine as any, {
              program: opts.program,
              orgUnit: id,
              period: 'LAST_12_MONTHS',
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
      };
    },
  });
}
