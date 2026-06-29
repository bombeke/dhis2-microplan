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
}

/** Filters applied to the uploaded-microplan catalogue on the map page. */
export interface MapFilters {
  uploadedById: string | null; // by user
  period: string | null; // by month/period
  level: number | null; // by org unit level
  orgUnitId: string | null; // by organisation unit
}

const EMPTY_FILTERS: MapFilters = {
  uploadedById: null,
  period: null,
  level: null,
  orgUnitId: null,
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
}));
