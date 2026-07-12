import React, { useEffect, useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQueries } from '@tanstack/react-query';
import { useStore } from '../store/useStore';
import { useMicroplanIndex } from '../hooks/useMicroplans';
import { loadMicroplan } from '../lib/microplanStore';
import type { StoredMicroplan } from '../lib/microplanStore';
import { weekSettlementsFromTeamPlans } from '../lib/teamSettlements';
import type { FlagResult, Settlement, TeamPlan } from '../types';
import { MapFilterBar, filterIndex, getLatestMicroPlan } from '../components/MapFilterBar';
import { Dhis2Map, type MicroplanLayerData } from '../components/Dhis2Map';
import { LayerControl } from '../components/LayerControl';
import { CoordinateLayerControl } from '../components/CoordinateLayerControl';
import { AnalyticsDataPanel } from '../components/AnalyticsDataPanel';
import { getBasemap } from '../lib/basemaps';
import { fetchEnrollmentPoints, fetchEventPoints } from '../lib/dhis2Data';
import { flagPoints, assignedByTeamFrom } from '../lib/flagging';
import { useOrgUnitPaths } from '../hooks/useOrgUnits';
import { useSelectedOrgUnitLayers } from '../hooks/useSelectedOrgUnitLayers';
import { useSettlementGeoservice } from '../hooks/useSettlementGeoservice';
import { useUsers } from '../hooks/useUsers';

/**
 * Map page. The catalogue is filtered (user/period/level/org unit); the
 * resulting microplans are loaded in full and, for each, we pull DHIS2
 * tracker/event points for its org unit + period and flag them against the
 * microplan's own assigned settlements. Everything is handed to Dhis2Map,
 * which renders one set of maplibre-gl layers per microplan.
 */
export const MapPage: React.FC<{ program?: string }> = ({ program: programProp }) => {
  const engine = useDataEngine();
  const { data: index = [] } = useMicroplanIndex();
  const { mapFilters, activeMicroplanIds, setActiveMicroplanIds, basemapId, overlays,
    hiddenCoordinateDims, selectedDimensions } = useStore();
  const { data: accessibleUsers = [] } = useUsers();

  // The program the map draws events for comes from the FilterMap program
  // field; fall back to any program passed in by the shell.
  const program = mapFilters.programId ?? programProp;

  // Step 1 — when a user is selected, resolve the username to filter analytics
  // rows by (created/last-updated-by). No selection → no user filtering.
  const userFilter = useMemo(() => {
    if (!mapFilters.uploadedById) return null;
    const u = accessibleUsers.find((x) => x.id === mapFilters.uploadedById);
    // fall back to extracting from a "Name (username)" label if needed
    return u?.username?.toLowerCase() || null;
  }, [mapFilters.uploadedById, accessibleUsers]);

  // The selected TEAM CODE is the selected user's username — e.g. a user shown
  // as "kabad (DHK-ID)" yields team code "DHK-ID". Preserve original case so it
  // matches teamPlans[].teamCode; matching itself is case-insensitive.
  const selectedTeamCode = useMemo(() => {
    if (!mapFilters.uploadedById) return null;
    const u = accessibleUsers.find((x) => x.id === mapFilters.uploadedById);
    return u?.username || null;
  }, [mapFilters.uploadedById, accessibleUsers]);

  // Descendant-aware org filtering needs the path of each uploaded microplan's
  // org unit (plus the selected unit) - a small, targeted fetch.
  const pathIds = useMemo(() => {
    const ids = index.map((e) => e.orgUnitId);
    if (mapFilters.orgUnitId) ids.push(mapFilters.orgUnitId);
    return ids;
  }, [index, mapFilters.orgUnitId]);
  const { data: orgUnitPaths = new Map<string, string>() } = useOrgUnitPaths(pathIds);

  // Selected-org-unit overlays: GRID3 settlements (spatial), uploaded
  // settlements highlighted by week, and DHIS2 event coordinates (clustered).
  const { data: selectedLayers, isFetching: selectedFetching } = useSelectedOrgUnitLayers(
    mapFilters.orgUnitId,
    {
      program,
      selectedDimensionIds: selectedDimensions,
      userFilter,
      analyticsPeriod: mapFilters.period,
      uploadedById: mapFilters.uploadedById,
      teamCode: selectedTeamCode,
    }
  );

  // Step 1+2: for the selected user's week settlements, fetch their geojson
  // from the Settlements_in_Nigeria geoservice (searched by name) and merge
  // into one FeatureCollection for the map's fill layer.
  // Depreceated
  const { data: weekGeojson } = useSettlementGeoservice(selectedLayers?.weekSettlements);
  const settlementGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = (weekGeojson ?? []).flatMap((w) => w.geojson.features);
    return { type: 'FeatureCollection', features };
  }, [weekGeojson]);

  // Apply the coordinate-layer overlay toggles: keep only points from
  // dimensions the user hasn't hidden. Also count points per dimension for the
  // overlay labels.
  const { visibleSelected, coordCounts } = useMemo(() => {
    if (!selectedLayers) return { visibleSelected: selectedLayers, coordCounts: {} as Record<string, number> };
    const counts: Record<string, number> = {};
    const visiblePoints = [] as typeof selectedLayers.eventPoints;
    for (const [dimId, pts] of Object.entries(selectedLayers.coordinatePointsByDim)) {
      counts[dimId] = pts.length;
      if (!hiddenCoordinateDims.includes(dimId)) visiblePoints.push(...pts);
    }
    // if the program had no coordinate dimensions, fall back to eventPoints
    const eventPoints =
      selectedLayers.coordinateDimensionIds.length > 0 ? visiblePoints : selectedLayers.eventPoints;
    return {
      visibleSelected: { ...selectedLayers, eventPoints },
      coordCounts: counts,
    };
  }, [selectedLayers, hiddenCoordinateDims]);

  // catalogue after filters
  const filtered = useMemo(
    () => filterIndex(index, mapFilters, orgUnitPaths),
    [index, mapFilters, orgUnitPaths]
  );

  // default: when nothing explicitly toggled, show everything that passes filters
  useEffect(() => {
    if (activeMicroplanIds.length === 0 && filtered.length > 0) {
      setActiveMicroplanIds(filtered.map((e) => e.id));
    }
  }, [filtered, activeMicroplanIds.length, setActiveMicroplanIds]);

  const idsToShow = filtered
    .map((e) => e.id)
    .filter((id) => activeMicroplanIds.length === 0 || activeMicroplanIds.includes(id));

  const latestMicroplan = getLatestMicroPlan(index, mapFilters);
  console.log("latest: Plan::", latestMicroplan)

  // load each active microplan in full (cached per id)
  const planQueries = useQueries({
    queries: latestMicroplan.map((e) => ({
      queryKey: ['microplan', e.id],
      queryFn: () => loadMicroplan(engine as any, e.id),
      staleTime: 60_000,
    })),
  });


  // for each loaded plan, fetch + flag points
  /*const pointQueries = useQueries({
    queries: idsToShow.map((id) => {
      const meta = index.find((e) => e.id === id);
      return {
        queryKey: ['microplan-points', id, program, meta?.period, meta?.orgUnitId],
        enabled: !!program && !!meta,
        staleTime: 60_000,
        queryFn: async () => {
          if (!program || !meta) return [];
          const [enroll, events] = await Promise.all([
            fetchEnrollmentPoints(engine as any, {
              program,
              orgUnit: meta.orgUnitId,
              period: meta.period,
            }),
            fetchEventPoints(engine as any, {
              program,
              orgUnit: meta.orgUnitId,
              period: meta.period,
            }),
          ]);
          return [...enroll, ...events];
        },
      };
    }),
  });
  */

  const microplans: MicroplanLayerData[] = useMemo(() => {
    return latestMicroplan.map((e, i) => {
      const plan = planQueries[i]?.data;
      /*const points = (pointQueries[i]?.data ?? []) as ReturnType<typeof flagPoints> extends never
        ? never
        : any[];
        */
      console.log("Points:",visibleSelected)

      const settlements: Settlement[] = plan?.settlements ?? [];
      //const settlementMap = new Map(settlements.map((s) => [s.id, s]));
      //const assigned = assignedByTeamFrom(plan?.teamPlans ?? []);
      
      //const flags = points.length ? flagPoints(points as any, settlementMap, assigned) : [];
      const flags: FlagResult[] = [];
      return { id: e.id, settlements, flags };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    latestMicroplan.join(','), 
    planQueries.map((q) => q?.data?.uploadedAt).join(','), 
    //pointQueries.map((q) => q.dataUpdatedAt).join(',')
  ]);

  // Aggregate team plans across the loaded microplans → team-code options for
  // the "All Teams" field, and the week-grouped settlement NAMES for the
  // selected team (settlement names are extracted from the visit keys).
  const allTeamPlans = useMemo(() => {
    const plans: TeamPlan[] = [];
    for (const q of planQueries) {
      const p = q?.data as StoredMicroplan | undefined;
      if (p?.teamPlans) plans.push(...p.teamPlans);
    }
    return plans;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planQueries.map((q) => q?.data?.uploadedAt).join(',')]);

  const teamWeekSettlements = useMemo(
    () =>
      selectedTeamCode
        ? weekSettlementsFromTeamPlans(allTeamPlans, { teamCode: selectedTeamCode })
        : [],
    [allTeamPlans, selectedTeamCode]
  );

  // fetch geoservice geojson for the team-derived settlement names, then merge
  const { data: teamWeekGeojson } = useSettlementGeoservice(teamWeekSettlements);
  const teamSettlementGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = (teamWeekGeojson ?? []).flatMap((w) => w.geojson.features);
    return { type: 'FeatureCollection', features };
  }, [teamWeekGeojson]);

 // const loading = planQueries.some((q) => q.isLoading) || pointQueries.some((q) => q.isLoading) || selectedFetching;
  const loading = planQueries.some((q) => q.isLoading) || selectedFetching;

  return (
    <div className="page page--map">
      <MapFilterBar index={index} />
      <div className="mapwrap">
        <Dhis2Map
          microplans={microplans}
          basemap={getBasemap(basemapId)}
          overlays={overlays}
          loading={loading}
          selected={visibleSelected}
          settlementGeojson={settlementGeojson}
          teamSettlementGeojson={teamSettlementGeojson}
          orgUnitGeojson={selectedLayers?.geometry ?? null}
        />
        <div className="map-controls">
          <LayerControl />
          {selectedLayers && selectedLayers.coordinateDimensionIds.length > 0 && (
            <CoordinateLayerControl
              dimensionIds={selectedLayers.coordinateDimensionIds}
              metaItems={selectedLayers.coordinateMetaItems}
              countsByDim={coordCounts}
            />
          )}
        </div>
        {loading && <div className="mapwrap__loading">Loading map layers…</div>}
        <div className="mapwrap__legend">
          <strong>{microplans.length}</strong> microplan(s) ·{' '}
          {microplans.reduce((n, m) => n + m.flags.filter((f) => !f.inside).length, 0)} flagged
          {selectedLayers && (
            <>
              {' '}· <strong>{selectedLayers.grid3.length}</strong> GRID3
              {selectedLayers.grid3Truncated ? '+' : ''} ·{' '}
              <strong>{selectedLayers.eventPoints.length}</strong> events
            </>
          )}
          {selectedTeamCode && teamSettlementGeojson.features.length > 0 && (
            <>
              {' '}· <strong>{teamSettlementGeojson.features.length}</strong> team settlements
              {' '}(vs <strong>{settlementGeojson.features.length}</strong> user)
            </>
          )}
        </div>
        {selectedLayers && selectedLayers.weekSettlements.length > 0 && (
          <div className="mapwrap__weeks">
            <span className="mapwrap__weeks-title">Outreach weeks</span>
            {selectedLayers.weekSettlements.map((ws) => (
              <span key={ws.week} className="weekchip">
                <span
                  className="weekchip__dot"
                  style={{ background: WEEK_LEGEND_COLORS[ws.week] ?? '#f59e0b' }}
                />
                W{ws.week} ({ws.settlements.length})
              </span>
            ))}
          </div>
        )}
        <AnalyticsDataPanel
          program={program}
          orgUnitId={mapFilters.orgUnitId}
          period={mapFilters.period}
          userFilter={userFilter}
          tableResult={ selectedLayers?.tableResult}
        />
      </div>
    </div>
  );
};

const WEEK_LEGEND_COLORS: Record<number, string> = {
  1: '#f97316',
  2: '#22c55e',
  3: '#3b82f6',
  4: '#a855f7',
  5: '#ec4899',
};
