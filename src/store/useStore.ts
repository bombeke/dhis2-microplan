import { create } from 'zustand';
import type {
  Settlement,
  TeamPlan,
  TrackerPoint,
  FlagResult,
  GeoSourceConfig,
} from '../types';

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
}

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
}));
