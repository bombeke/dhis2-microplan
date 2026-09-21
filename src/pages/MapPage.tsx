import React, { useEffect, useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQueries } from '@tanstack/react-query';
import { Checkbox } from '@dhis2/ui';
import { useStore } from '../store/useStore';
import { useMicroplanIndex } from '../hooks/useMicroplans';
import { loadMicroplan } from '../lib/microplanStore';
import type { StoredMicroplan } from '../lib/microplanStore';
import { weekSettlementsFromTeamPlans } from '../lib/teamSettlements';
import type { FlagResult, TeamPlan } from '../types';
import { MapFilterBar, filterIndex, getLatestMicroPlan } from '../components/MapFilterBar';
import { Dhis2Map, type MicroplanLayerData } from '../components/Dhis2Map';
import { LayerControl } from '../components/LayerControl';
import { CoordinateLayerControl } from '../components/CoordinateLayerControl';
import { AnalyticsDataPanel } from '../components/AnalyticsDataPanel';
import { getBasemap } from '../lib/basemaps';
import { flagPoints,  settlementsFrom } from '../lib/flagging';
import { useOrgUnitPaths } from '../hooks/useOrgUnits';
import { useSelectedOrgUnitLayers } from '../hooks/useSelectedOrgUnitLayers';
import { useSettlementGeoservice } from '../hooks/useSettlementGeoservice';
import { useUsers } from '../hooks/useUsers';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { cn } from '../lib/ui';

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
    hiddenCoordinateDims, selectedDimensions, hiddenWeeks, toggleWeek } = useStore();
  const { data: accessibleUsers = [] } = useUsers();
  // Phone-sized screens get the layer cards collapsed: open, they would cover
  // most of the map they exist to control.
  const isNarrow = useIsNarrow();

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
      analyticsPeriodType: mapFilters.periodType,
      uploadedById: mapFilters.uploadedById,
      teamCode: selectedTeamCode,
    }
  );

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

  const latestMicroplan = useMemo(
    () => getLatestMicroPlan(index, mapFilters),
    [index, mapFilters]
  );

  // load each active microplan in full (cached per id)
  const planQueries = useQueries({
    queries: latestMicroplan.map((e) => ({
      queryKey: ['microplan', e.id],
      queryFn: () => loadMicroplan(engine as any, e.id),
      staleTime: 60_000,
    })),
  });


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
  // — excluding weeks the user has toggled off in the "Outreach weeks" legend.
  const { data: teamWeekGeojson } = useSettlementGeoservice(teamWeekSettlements);
  const teamSettlementGeojson = useMemo<GeoJSON.FeatureCollection>(() => {
    const features = (teamWeekGeojson ?? [])
      .filter((w) => !hiddenWeeks.includes(w.week))
      .flatMap((w) => w.geojson.features);
    return { type: 'FeatureCollection', features };
  }, [teamWeekGeojson, hiddenWeeks]);

  const eventPoints =  visibleSelected?.eventPoints;

  // settlementsFrom does turf centroid + bbox per feature — hoist it out of the
  // map so it runs once, not once per microplan.
  const settlements = useMemo(
    () => settlementsFrom(teamSettlementGeojson),
    [teamSettlementGeojson]
  );

  // Stable empty team map — flagging is unassigned here (points carry no
  // teamCode), so every point is tested against every settlement.
  const noTeams = useMemo(() => new Map<string, Set<string>>(), []);

  const flags: FlagResult[] = useMemo(
    () => (eventPoints ? flagPoints(eventPoints, settlements, noTeams) : []),
    [eventPoints, settlements, noTeams]
  );
  const microplanIds = useMemo(
      () => latestMicroplan.map((e) => e.id).join(','),
      [latestMicroplan]
    );
  const microplans: MicroplanLayerData[] = useMemo(
    () => latestMicroplan.map((e) => ({ 
      id: e.id, 
      flags 
    })),
    [microplanIds, flags]
  );
 
  const loading = planQueries.some((q) => q.isLoading) || selectedFetching;

  const flaggedCount = useMemo(
    () => microplans.reduce((n, m) => n + m.flags.filter((f) => !f.inside).length, 0),
    [microplans]
  );

  // The numbers that answer "is this map worth acting on?" — above the map
  // rather than floating inside it, where they fought the scale bar and were
  // covered by the data sheet the moment anyone opened it.
  const stats: { label: string; value: string; tone?: 'flag' | 'accent' }[] = useMemo(() => {
    const out: { label: string; value: string; tone?: 'flag' | 'accent' }[] = [];
    out.push({ label: 'Microplans', value: String(microplans.length) });
    out.push({
      label: 'Flagged visits',
      value: flaggedCount.toLocaleString(),
      tone: flaggedCount > 0 ? 'flag' : undefined,
    });
    if (selectedLayers) {
      out.push({
        label: 'Visits recorded',
        value: selectedLayers.eventPoints.length.toLocaleString(),
        tone: 'accent',
      });
      out.push({
        label: 'Settlements',
        value: `${selectedLayers.grid3.length.toLocaleString()}${
          selectedLayers.grid3Truncated ? '+' : ''
        }`,
      });
    }
    if (selectedTeamCode && teamSettlementGeojson.features.length > 0) {
      out.push({
        label: `Visited by ${selectedTeamCode}`,
        value: teamSettlementGeojson.features.length.toLocaleString(),
      });
    }
    return out;
  }, [microplans, flaggedCount, selectedLayers, selectedTeamCode, teamSettlementGeojson]);

  const showStats = !!mapFilters.programId && !!mapFilters.orgUnitId;

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 lg:p-5">
      <MapFilterBar index={index} />

      {showStats && (
        /* Scrolls sideways on a phone instead of wrapping into four rows that
           would push the map itself below the fold. */
        <div
          className="-mx-3 flex items-stretch gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
          role="group"
          aria-label="Map summary"
        >
          {stats.map((s) => (
            <div
              key={s.label}
              className={cn(
                'flex min-w-[6.75rem] shrink-0 flex-col gap-px rounded-lg border border-line border-s-[3px] bg-panel px-3 py-2 shadow-card sm:shrink',
                s.tone === 'flag' && 'border-s-flag',
                s.tone === 'accent' && 'border-s-accent',
                !s.tone && 'border-s-line'
              )}
            >
              <span
                className={cn(
                  'text-lg font-semibold leading-none tabular-nums tracking-tight',
                  s.tone === 'flag' && 'text-flag'
                )}
              >
                {s.value}
              </span>
              <span className="text-[11px] text-muted">{s.label}</span>
            </div>
          ))}
          {loading && (
            <span className="self-center whitespace-nowrap px-1 text-xs italic text-muted">
              Loading map layers…
            </span>
          )}
        </div>
      )}

      {/* The map takes the height the chrome doesn't, clamped at both ends:
          never so short that clusters overlap the legend on a laptop, never so
          tall that the data sheet has nowhere to open on a large monitor. */}
      <div className="relative h-[clamp(22rem,calc(100vh-24rem),60rem)] overflow-hidden rounded-xl border border-line sm:h-[clamp(26rem,calc(100vh-22rem),60rem)]">
        <Dhis2Map
          microplans={microplans}
          basemap={getBasemap(basemapId)}
          overlays={overlays}
          loading={loading}
          selectedTeamCode={selectedTeamCode}
          selected={visibleSelected}
          teamSettlementGeojson={teamSettlementGeojson}
          orgUnitGeojson={selectedLayers?.geometry ?? null}
          program={program ?? null}
          profilesById={selectedLayers?.profilesById}
        />

        {/* Layer cards: collapsed by default on phones, where an open card
            would cover most of the map it is meant to control. */}
        <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[13rem] flex-col gap-2 overflow-y-auto sm:w-[16.5rem]">
          <LayerControl defaultOpen={!isNarrow} />
          {selectedLayers && selectedLayers.coordinateDimensionIds.length > 0 && (
            <CoordinateLayerControl
              dimensionIds={selectedLayers.coordinateDimensionIds}
              metaItems={selectedLayers.coordinateMetaItems}
              countsByDim={coordCounts}
              defaultOpen={!isNarrow}
            />
          )}
        </div>

        {teamWeekSettlements && teamWeekSettlements.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-line bg-panel/92 px-2.5 py-1.5 shadow-card backdrop-blur-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              Outreach weeks
            </span>
            {teamWeekSettlements.map((ws) => (
              <label key={ws.week} className="inline-flex cursor-pointer items-center gap-1 text-xs">
                <Checkbox
                  dense
                  checked={!hiddenWeeks.includes(ws.week)}
                  onChange={() => toggleWeek(ws.week)}
                />
                <span
                  className="inline-block size-2.5 rounded-sm"
                  style={{ background: WEEK_LEGEND_COLORS[ws.week] ?? '#f59e0b' }}
                />
                W{ws.week} ({ws.settlements.length})
              </label>
            ))}
          </div>
        )}

        <AnalyticsDataPanel
          program={program}
          orgUnitId={mapFilters.orgUnitId}
          period={mapFilters.period}
          userFilter={userFilter}
          tableResult={selectedLayers?.tableResult}
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
