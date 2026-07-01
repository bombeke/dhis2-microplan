import React, { useEffect, useMemo } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import { useQueries } from '@tanstack/react-query';
import { useStore } from '../store/useStore';
import { useMicroplanIndex } from '../hooks/useMicroplans';
import { loadMicroplan } from '../lib/microplanStore';
import { MapFilterBar, filterIndex } from '../components/MapFilterBar';
import { Dhis2Map, type MicroplanLayerData } from '../components/Dhis2Map';
import { LayerControl } from '../components/LayerControl';
import { getBasemap } from '../lib/basemaps';
import { fetchEnrollmentPoints, fetchEventPoints } from '../lib/dhis2Data';
import { flagPoints, assignedByTeamFrom } from '../lib/flagging';
import { useOrgUnitHierarchy } from '../hooks/useOrgUnits';
import { useSelectedOrgUnitLayers } from '../hooks/useSelectedOrgUnitLayers';
import type { Settlement } from '../types';

/**
 * Map page. The catalogue is filtered (user/period/level/org unit); the
 * resulting microplans are loaded in full and, for each, we pull DHIS2
 * tracker/event points for its org unit + period and flag them against the
 * microplan's own assigned settlements. Everything is handed to Dhis2Map,
 * which renders one set of maplibre-gl layers per microplan.
 */
export const MapPage: React.FC<{ program?: string }> = ({ program }) => {
  const engine = useDataEngine();
  const { data: index = [] } = useMicroplanIndex();
  const { mapFilters, activeMicroplanIds, setActiveMicroplanIds, basemapId, overlays } =
    useStore();
  const { data: hierarchy = [] } = useOrgUnitHierarchy();

  // id -> path map from the cached hierarchy, for descendant-aware org filtering
  const orgUnitPaths = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of hierarchy) m.set(o.id, o.path);
    return m;
  }, [hierarchy]);

  // Selected-org-unit overlays: GRID3 settlements (spatial), uploaded
  // settlements highlighted by week, and DHIS2 event coordinates (clustered).
  const { data: selectedLayers, isFetching: selectedFetching } = useSelectedOrgUnitLayers(
    mapFilters.orgUnitId,
    { program }
  );

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

  // load each active microplan in full (cached per id)
  const planQueries = useQueries({
    queries: idsToShow.map((id) => ({
      queryKey: ['microplan', id],
      queryFn: () => loadMicroplan(engine as any, id),
      staleTime: 60_000,
    })),
  });

  // for each loaded plan, fetch + flag points
  const pointQueries = useQueries({
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

  const microplans: MicroplanLayerData[] = useMemo(() => {
    return idsToShow.map((id, i) => {
      const plan = planQueries[i]?.data;
      const points = (pointQueries[i]?.data ?? []) as ReturnType<typeof flagPoints> extends never
        ? never
        : any[];
      const settlements: Settlement[] = plan?.settlements ?? [];
      const settlementMap = new Map(settlements.map((s) => [s.id, s]));
      const assigned = assignedByTeamFrom(plan?.teamPlans ?? []);
      const flags = points.length ? flagPoints(points as any, settlementMap, assigned) : [];
      return { id, settlements, flags };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsToShow.join(','), planQueries.map((q) => q.dataUpdatedAt).join(','), pointQueries.map((q) => q.dataUpdatedAt).join(',')]);

  const loading =
    planQueries.some((q) => q.isLoading) || pointQueries.some((q) => q.isLoading) || selectedFetching;

  return (
    <div className="page page--map">
      <MapFilterBar index={index} />
      <div className="mapwrap">
        <Dhis2Map
          microplans={microplans}
          basemap={getBasemap(basemapId)}
          overlays={overlays}
          loading={loading}
          selected={selectedLayers}
        />
        <LayerControl />
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
