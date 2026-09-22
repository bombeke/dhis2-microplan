import { create } from 'zustand';
import type { GpsEdit } from '../lib/gpsEditStore';

/**
 * State for the Manage Settlements page, kept outside the component so that
 * switching tabs doesn't lose the selected org unit or unsaved edits.
 *
 * `dirty` holds the records changed locally since the last save, keyed by
 * settlement id; a `null` value means "delete the stored record". `baseRev`
 * remembers each dirty row's stored `rev` from the moment it was first
 * touched, which is what the save compares against to detect that someone
 * else saved the same row in the meantime. `shardKey` remembers which
 * dataStore shard each dirty row belongs to, because unsaved changes outlive
 * a switch to another org unit, when the row itself is no longer loaded.
 */
interface SettlementState {
  orgUnitId: string | null;
  setOrgUnitId: (id: string | null) => void;

  dirty: Map<string, GpsEdit | null>;
  baseRev: Map<string, number>;
  shardKey: Map<string, string>;
  /** stage one or many records (null = delete); `rev` is the stored rev, 0 if none */
  stage: (items: { id: string; edit: GpsEdit | null; rev: number; key: string }[]) => void;
  /** forget local changes for these ids (after a save, or a discarded draft) */
  unstage: (ids: string[]) => void;
  clear: () => void;
}

export const useSettlementStore = create<SettlementState>((set) => ({
  orgUnitId: null,
  setOrgUnitId: (orgUnitId) => set({ orgUnitId }),

  dirty: new Map(),
  baseRev: new Map(),
  shardKey: new Map(),
  stage: (items) =>
    set((s) => {
      const dirty = new Map(s.dirty);
      const baseRev = new Map(s.baseRev);
      const shardKey = new Map(s.shardKey);
      for (const { id, edit, rev, key } of items) {
        dirty.set(id, edit);
        shardKey.set(id, key);
        if (!baseRev.has(id)) baseRev.set(id, rev);
      }
      return { dirty, baseRev, shardKey };
    }),
  unstage: (ids) =>
    set((s) => {
      if (!ids.length) return s;
      const dirty = new Map(s.dirty);
      const baseRev = new Map(s.baseRev);
      const shardKey = new Map(s.shardKey);
      for (const id of ids) {
        dirty.delete(id);
        baseRev.delete(id);
        shardKey.delete(id);
      }
      return { dirty, baseRev, shardKey };
    }),
  clear: () => set({ dirty: new Map(), baseRev: new Map(), shardKey: new Map() }),
}));
