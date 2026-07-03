import React, { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { SearchableSelect } from './SearchableSelect';
import { PeriodSelect } from './PeriodSelect';
import { OrgUnitTreeSelect } from './OrgUnitTreeSelect';
import { ProgramSelect } from './ProgramSelect';
import { GroupedMultiSelect } from './GroupedMultiSelect';
import { useOrgUnitHierarchy } from '../hooks/useOrgUnits';
import { useProgramDimensions } from '../hooks/useProgramDimensions';
import { useUsers } from '../hooks/useUsers';
import { useOrgUnitLevels } from '../hooks/useOrgUnitLevels';
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
  const { mapFilters, setMapFilter, resetMapFilters, selectedDimensions, setSelectedDimensions } =
    useStore();
  const { data: dimensionGroups = [], isLoading: dimsLoading } = useProgramDimensions(
    mapFilters.programId
  );
  const { data: hierarchy = [] } = useOrgUnitHierarchy();
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const { data: levelNames = [] } = useOrgUnitLevels();

  // "All users": everyone the current user can access, shown as "Name (username)"
  // and searchable by either. Username lives in sublabel so FlexSearch indexes it.
  const userOptions: SearchOption[] = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.name, sublabel: u.username })),
    [users]
  );

  // Levels present in the hierarchy, labelled with their level name when known.
  const levelName = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of levelNames) m.set(l.level, l.name);
    return m;
  }, [levelNames]);

  const levelOptions: SearchOption[] = useMemo(() => {
    const set = new Set<number>();
    //for (const o of hierarchy) set.add(o.level);
    for (const o of levelNames) set.add(o.level);
    return [...set]
      .sort((a, b) => a - b)
      .map((l) => ({
        id: String(l),
        label: levelName.get(l) ?? `Level ${l}`,
        sublabel: `Level ${l}`,
      }));
  }, [hierarchy, levelName]);

  const active =
    mapFilters.uploadedById ||
    mapFilters.period ||
    mapFilters.level ||
    mapFilters.orgUnitId ||
    mapFilters.programId;

  return (
    <div className="filterbar">
      <span className="filterbar__label">Filter map</span>

      <SearchableSelect
        options={userOptions}
        value={mapFilters.uploadedById}
        allLabel={usersLoading ? 'Loading teams…' : 'Teams'}
        placeholder="Search name or username…"
        bracketSublabel
        onChange={(id) => setMapFilter('uploadedById', id)}
      />

      <PeriodSelect
        value={mapFilters.period}
        onChange={(id) => setMapFilter('period', id)}
      />

      <SearchableSelect
        options={levelOptions}
        value={mapFilters.level != null ? String(mapFilters.level) : null}
        allLabel="All levels"
        placeholder="Search levels…"
        bracketSublabel
        onChange={(id) => setMapFilter('level', id ? Number(id) : null)}
      />

      <OrgUnitTreeSelect
        value={mapFilters.orgUnitId}
        onChange={(id) => setMapFilter('orgUnitId', id)}
      />

      <ProgramSelect
        value={mapFilters.programId}
        onChange={(id) => {
          setMapFilter('programId', id);
          setSelectedDimensions([]); // reset dimension picks for the new program
        }}
      />

      {mapFilters.programId && (
        <GroupedMultiSelect
          groups={dimensionGroups}
          selected={selectedDimensions}
          onChange={setSelectedDimensions}
          loading={dimsLoading}
        />
      )}

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
    if (f.programId && e.programId !== f.programId) return false;
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
