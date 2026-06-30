import React, { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { RELATIVE_PERIODS } from '../lib/periods';
import { SearchableSelect } from './SearchableSelect';
import { useOrgUnitHierarchy } from '../hooks/useOrgUnits';
import type { SearchOption } from '../hooks/useFlexFilter';
import type { MicroplanIndexEntry } from '../lib/microplanStore';

/**
 * Filters the uploaded-microplan catalogue by user, period (month), org-unit
 * level, and organisation unit.
 *
 * Org units come from the WHOLE org-unit hierarchy (cached for 10 min via
 * useOrgUnitHierarchy, no server refetch within that window), not just the org
 * units that happen to appear in uploads — so you can filter the map down to
 * any unit in the tree. Levels are likewise derived from the full hierarchy.
 * The high-cardinality user + org-unit pickers use the FlexSearch-backed
 * SearchableSelect so they stay fast over large trees; period stays a plain
 * select.
 */
export const MapFilterBar: React.FC<{ index: MicroplanIndexEntry[] }> = ({ index }) => {
  const { mapFilters, setMapFilter, resetMapFilters } = useStore();
  const { data: hierarchy = [], isLoading: ouLoading } = useOrgUnitHierarchy();

  const { userOptions, periods } = useMemo(() => {
    const users = new Map<string, string>();
    const periods = new Set<string>();
    for (const e of index) {
      users.set(e.uploadedById, e.uploadedBy);
      periods.add(e.period);
    }
    const userOptions: SearchOption[] = [...users.entries()].map(([id, label]) => ({ id, label }));
    return { userOptions, periods };
  }, [index]);

  // org-unit options + available levels come from the full cached hierarchy
  const { orgUnitOptions, levels } = useMemo(() => {
    const levels = new Set<number>();
    const orgUnitOptions: SearchOption[] = hierarchy.map((o) => {
      levels.add(o.level);
      return { id: o.id, label: o.name, sublabel: `level ${o.level}` };
    });
    return { orgUnitOptions, levels };
  }, [hierarchy]);

  const periodName = (id: string) => RELATIVE_PERIODS.find((p) => p.id === id)?.name ?? id;
  const active =
    mapFilters.uploadedById || mapFilters.period || mapFilters.level || mapFilters.orgUnitId;

  return (
    <div className="filterbar">
      <span className="filterbar__label">Filter map</span>

      <SearchableSelect
        options={userOptions}
        value={mapFilters.uploadedById}
        allLabel="All users"
        placeholder="Search users…"
        onChange={(id) => setMapFilter('uploadedById', id)}
      />

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

      <SearchableSelect
        options={orgUnitOptions}
        value={mapFilters.orgUnitId}
        allLabel={ouLoading ? 'Loading org units…' : 'All org units'}
        placeholder="Search org units…"
        onChange={(id) => setMapFilter('orgUnitId', id)}
      />

      {active && (
        <button className="filterbar__reset" onClick={resetMapFilters}>Clear</button>
      )}
    </div>
  );
};

/**
 * Pure filter predicate shared by the map page.
 *
 * When `orgUnitPaths` is supplied (id -> "/root/.../id" path from the cached
 * hierarchy), an org-unit filter matches a microplan whose org unit is the
 * selected unit OR any descendant of it — so filtering by a State shows every
 * ward beneath it. Without the map it falls back to exact-id matching.
 */
export function filterIndex(
  index: MicroplanIndexEntry[],
  f: ReturnType<typeof useStore.getState>['mapFilters'],
  orgUnitPaths?: Map<string, string>
): MicroplanIndexEntry[] {
  return index.filter((e) => {
    if (f.uploadedById && e.uploadedById !== f.uploadedById) return false;
    if (f.period && e.period !== f.period) return false;
    if (f.level != null && e.level !== f.level) return false;
    if (f.orgUnitId) {
      if (orgUnitPaths) {
        const path = orgUnitPaths.get(e.orgUnitId) ?? '';
        // match if the microplan's org unit is, or is under, the selected unit
        if (e.orgUnitId !== f.orgUnitId && !path.includes(`/${f.orgUnitId}`)) return false;
      } else if (e.orgUnitId !== f.orgUnitId) {
        return false;
      }
    }
    return true;
  });
}
