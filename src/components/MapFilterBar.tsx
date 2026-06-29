import React, { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { RELATIVE_PERIODS } from '../lib/periods';
import type { MicroplanIndexEntry } from '../lib/microplanStore';

/**
 * Filters the uploaded-microplan catalogue by user, period (month), org-unit
 * level, and organisation unit. Options are derived from the catalogue itself
 * so only values that actually exist are offered.
 */
export const MapFilterBar: React.FC<{ index: MicroplanIndexEntry[] }> = ({ index }) => {
  const { mapFilters, setMapFilter, resetMapFilters } = useStore();

  const { users, periods, levels, orgUnits } = useMemo(() => {
    const users = new Map<string, string>();
    const periods = new Set<string>();
    const levels = new Set<number>();
    const orgUnits = new Map<string, string>();
    for (const e of index) {
      users.set(e.uploadedById, e.uploadedBy);
      periods.add(e.period);
      levels.add(e.level);
      orgUnits.set(e.orgUnitId, e.orgUnitName);
    }
    return { users, periods, levels, orgUnits };
  }, [index]);

  const periodName = (id: string) => RELATIVE_PERIODS.find((p) => p.id === id)?.name ?? id;
  const active =
    mapFilters.uploadedById || mapFilters.period || mapFilters.level || mapFilters.orgUnitId;

  return (
    <div className="filterbar">
      <span className="filterbar__label">Filter map</span>

      <select
        value={mapFilters.uploadedById ?? ''}
        onChange={(e) => setMapFilter('uploadedById', e.target.value || null)}
      >
        <option value="">All users</option>
        {[...users.entries()].map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>

      <select
        value={mapFilters.period ?? ''}
        onChange={(e) => setMapFilter('period', e.target.value || null)}
      >
        <option value="">All periods</option>
        {[...periods].map((p) => (
          <option key={p} value={p}>{periodName(p)}</option>
        ))}
      </select>

      <select
        value={mapFilters.level ?? ''}
        onChange={(e) => setMapFilter('level', e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">All levels</option>
        {[...levels].sort((a, b) => a - b).map((l) => (
          <option key={l} value={l}>Level {l}</option>
        ))}
      </select>

      <select
        value={mapFilters.orgUnitId ?? ''}
        onChange={(e) => setMapFilter('orgUnitId', e.target.value || null)}
      >
        <option value="">All org units</option>
        {[...orgUnits.entries()].map(([id, name]) => (
          <option key={id} value={id}>{name}</option>
        ))}
      </select>

      {active && (
        <button className="filterbar__reset" onClick={resetMapFilters}>Clear</button>
      )}
    </div>
  );
};

/** Pure filter predicate shared by the map page. */
export function filterIndex(
  index: MicroplanIndexEntry[],
  f: ReturnType<typeof useStore.getState>['mapFilters']
): MicroplanIndexEntry[] {
  return index.filter((e) => {
    if (f.uploadedById && e.uploadedById !== f.uploadedById) return false;
    if (f.period && e.period !== f.period) return false;
    if (f.level != null && e.level !== f.level) return false;
    if (f.orgUnitId && e.orgUnitId !== f.orgUnitId) return false;
    return true;
  });
}
