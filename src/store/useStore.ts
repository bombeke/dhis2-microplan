import { create } from 'zustand';
import type {
  Settlement,
  TeamPlan,
  TrackerPoint,
  FlagResult,
  GeoSourceConfig,
} from '../types';
import {
  DEFAULT_BASEMAP_ID,
  DEFAULT_OVERLAYS,
  type OverlayToggles,
} from '../lib/basemaps';

interface AppState {
  // ingestion
  teamPlans: TeamPlan[];
  setTeamPlans: (p: TeamPlan[]) => void;

  // geometry
  settlements: Map<string, Settlement>;
  upsertSettlements: (s: Settlement[]) => void;

  // dhis2 data
  points: TrackerPoint[];
  setPoints: (p: TrackerPoint[]) => void;

  // flagging
  flags: FlagResult[];
  setFlags: (f: FlagResult[]) => void;

  // selection
  selectedTeam: string | null;
  selectTeam: (t: string | null) => void;
  selectedWard: string | null;
  selectWard: (w: string | null) => void;

  // config
  geoSource: GeoSourceConfig;
  setGeoSource: (c: GeoSourceConfig) => void;
  period: string;
  setPeriod: (p: string) => void;

  // map filters (drive which uploaded microplans render on the map)
  mapFilters: MapFilters;
  setMapFilter: <K extends keyof MapFilters>(key: K, value: MapFilters[K]) => void;
  resetMapFilters: () => void;

  // which uploaded microplans are active on the map
  activeMicroplanIds: string[];
  setActiveMicroplanIds: (ids: string[]) => void;
  toggleMicroplan: (id: string) => void;

  // map layer choices (basemap + overlay toggles), like the DHIS2 Maps app
  basemapId: string;
  setBasemapId: (id: string) => void;
  overlays: OverlayToggles;
  toggleOverlay: (key: keyof OverlayToggles) => void;

  // which coordinate-analytics dimensions (attribute / stage.dataElement) are
  // shown on the map. Empty set convention: when nothing has been explicitly
  // toggled we show all; `hiddenCoordinateDims` tracks the ones turned OFF.
  hiddenCoordinateDims: string[];
  toggleCoordinateDim: (dimensionId: string) => void;
  setHiddenCoordinateDims: (ids: string[]) => void;

  // FilterMap: attribute / data-element dimensions the user picked to focus on
  selectedDimensions: string[];
  setSelectedDimensions: (ids: string[]) => void;
}

/** Filters applied to the uploaded-microplan catalogue on the map page. */
export interface MapFilters {
  uploadedById: string | null; // by user
  period: string | null; // by month/period
  level: number | null; // by org unit level
  orgUnitId: string | null; // by organisation unit
  programId: string | null; // by DHIS2 program (activity)
}

const EMPTY_FILTERS: MapFilters = {
  uploadedById: null,
  period: null,
  level: null,
  orgUnitId: null,
  programId: null,
};

export const useStore = create<AppState>((set) => ({
  teamPlans: [],
  setTeamPlans: (teamPlans) => set({ teamPlans }),

  settlements: new Map(),
  upsertSettlements: (list) =>
    set((s) => {
      const next = new Map(s.settlements);
      for (const item of list) next.set(item.id, item);
      return { settlements: next };
    }),

  points: [],
  setPoints: (points) => set({ points }),

  flags: [],
  setFlags: (flags) => set({ flags }),

  selectedTeam: null,
  selectTeam: (selectedTeam) => set({ selectedTeam }),
  selectedWard: null,
  selectWard: (selectedWard) => set({ selectedWard }),

  geoSource: { kind: 'grid3', label: 'GRID3 (ArcGIS)' },
  setGeoSource: (geoSource) => set({ geoSource }),
  period: 'THIS_MONTH',
  setPeriod: (period) => set({ period }),

  mapFilters: EMPTY_FILTERS,
  setMapFilter: (key, value) =>
    set((s) => ({ mapFilters: { ...s.mapFilters, [key]: value } })),
  resetMapFilters: () => set({ mapFilters: EMPTY_FILTERS }),

  activeMicroplanIds: [],
  setActiveMicroplanIds: (activeMicroplanIds) => set({ activeMicroplanIds }),
  toggleMicroplan: (id) =>
    set((s) => ({
      activeMicroplanIds: s.activeMicroplanIds.includes(id)
        ? s.activeMicroplanIds.filter((x) => x !== id)
        : [...s.activeMicroplanIds, id],
    })),

  basemapId: DEFAULT_BASEMAP_ID,
  setBasemapId: (basemapId) => set({ basemapId }),
  overlays: DEFAULT_OVERLAYS,
  toggleOverlay: (key) =>
    set((s) => ({ overlays: { ...s.overlays, [key]: !s.overlays[key] } })),

  hiddenCoordinateDims: [],
  toggleCoordinateDim: (dimensionId) =>
    set((s) => ({
      hiddenCoordinateDims: s.hiddenCoordinateDims.includes(dimensionId)
        ? s.hiddenCoordinateDims.filter((d) => d !== dimensionId)
        : [...s.hiddenCoordinateDims, dimensionId],
    })),
  setHiddenCoordinateDims: (ids) => set({ hiddenCoordinateDims: ids }),

  selectedDimensions: [],
  setSelectedDimensions: (ids) => set({ selectedDimensions: ids }),
}));
