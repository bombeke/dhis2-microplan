import { create } from 'zustand';
import type { CreatePlanFilters } from '../components/create/CreatePlanFilterBar';
import type { CellItem, PlanRow } from '../lib/createdPlanStore';
import { periodOptions } from '../lib/planSchedule';

/**
 * State for the Create Microplan page, kept outside the component so that
 * switching to the Map tab and back doesn't throw away the filters or — more
 * importantly — unsaved edits in the grid.
 */
export const initialFilters = (): CreatePlanFilters => ({
  programId: null,
  orgUnitId: null,
  schedule: 'MONTHLY',
  // months are the same in every reporting cycle, so no settings are needed
  period: periodOptions('MONTHLY')[0].id,
});

interface CreatePlanState {
  filters: CreatePlanFilters;
  patchFilters: (patch: Partial<CreatePlanFilters>) => void;
  resetFilters: () => void;

  /** show the list of created microplans instead of the selected plan */
  showList: boolean;
  setShowList: (v: boolean) => void;

  /** the grid being edited, and which plan id it belongs to */
  rows: PlanRow[];
  rowsFor: string | null;
  staleKeys: Set<string>;
  dirty: boolean;
  loadRows: (planId: string, rows: PlanRow[], staleKeys: Set<string>) => void;
  setCell: (rowKey: string, colKey: string, items: CellItem[]) => void;
  setNote: (rowKey: string, note: string) => void;
  markClean: () => void;
}

export const useCreatePlanStore = create<CreatePlanState>((set) => ({
  filters: initialFilters(),
  // choosing a plan in the filters is always a request to look at it
  patchFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch }, showList: false })),
  resetFilters: () => set({ filters: initialFilters(), dirty: false }),

  showList: false,
  setShowList: (showList) => set({ showList }),

  rows: [],
  rowsFor: null,
  staleKeys: new Set(),
  dirty: false,
  loadRows: (planId, rows, staleKeys) => set({ rows, rowsFor: planId, staleKeys, dirty: false }),
  setCell: (rowKey, colKey, items) =>
    set((s) => ({
      dirty: true,
      rows: s.rows.map((r) => (r.key === rowKey ? { ...r, cells: { ...r.cells, [colKey]: items } } : r)),
    })),
  setNote: (rowKey, note) =>
    set((s) => ({
      dirty: true,
      rows: s.rows.map((r) => (r.key === rowKey ? { ...r, note } : r)),
    })),
  markClean: () => set({ dirty: false }),
}));
