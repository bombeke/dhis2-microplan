import { create } from 'zustand';

/**
 * Selection for the Manage Duplicates page, kept outside the component so
 * switching tabs doesn't lose it. `programId` null means "use the programme
 * configured in Settings → Duplicates".
 */
interface DuplicateState {
  programId: string | null;
  orgUnitId: string | null;
  setProgramId: (id: string | null) => void;
  setOrgUnitId: (id: string | null) => void;
}

export const useDuplicateStore = create<DuplicateState>((set) => ({
  programId: null,
  orgUnitId: null,
  setProgramId: (programId) => set({ programId }),
  setOrgUnitId: (orgUnitId) => set({ orgUnitId }),
}));
