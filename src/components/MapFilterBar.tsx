import React, { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { SearchableSelect } from './SearchableSelect';
import { PeriodSelect } from './PeriodSelect';
import { OrgUnitLazyTreeSelect } from './OrgUnitLazyTreeSelect';
import { ProgramSelect } from './ProgramSelect';
import { GroupedMultiSelect } from './GroupedMultiSelect';
import { useProgramDimensions } from '../hooks/useProgramDimensions';
import { useUsers } from '../hooks/useUsers';
import { useOrgUnitLevels } from '../hooks/useOrgUnitLevels';
import type { SearchOption } from '../hooks/useFlexFilter';
import type { MicroplanIndexEntry } from '../lib/microplanStore';

/**
 * Filters the uploaded-microplan catalogue by user, period (month), org-unit
 * level, and organisation unit.
 *
 * Org units use a lazy tree picker (loads roots, then children on demand,
 * server-side name search) so there is no upfront whole-hierarchy download.
 * Levels come from the organisationUnitLevels metadata.
 */
export const MapFilterBar: React.FC<{
  index: MicroplanIndexEntry[];
}> = ({ index }) => {
  const { mapFilters, setMapFilter, resetMapFilters, selectedDimensions, setSelectedDimensions } =
    useStore();
  const { data: dimensionGroups = [], isLoading: dimsLoading } = useProgramDimensions(
    mapFilters.programId
  );
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const { data: levelNames = [] } = useOrgUnitLevels();

  // "All users": everyone the current user can access, shown as "Name (username)"
  // and searchable by either. Username lives in sublabel so FlexSearch indexes it.
  const userOptions: SearchOption[] = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.name, sublabel: u.username })),
    [users]
  );

  // Levels present in the hierarchy, labelled with their level name when known.

  const levelOptions: SearchOption[] = useMemo(() => {
    return [...levelNames]
      .sort((a, b) => a.level - b.level)
      .map((l) => ({
        id: String(l.level),
        label: l.name ?? `Level ${l.level}`,
        sublabel: `Level ${l.level}`,
      }));
  }, [levelNames]);

  const active =
    mapFilters.uploadedById ||
    mapFilters.period ||
   // mapFilters.level ||
    mapFilters.orgUnitId ||
    mapFilters.programId;

  return (
    <div className="filterbar">
      <span className="filterbar__label">Filter map</span>

      <ProgramSelect
        value={mapFilters.programId}
        onChange={(id) => {
          setMapFilter('programId', id);
          setSelectedDimensions([]); // reset dimension picks for the new program
        }}
      />
      
      <OrgUnitLazyTreeSelect
        value={mapFilters.orgUnitId}
        onChange={(id) => setMapFilter('orgUnitId', id)}
      />

      { mapFilters.programId && mapFilters.orgUnitId && (
        <SearchableSelect
          options={userOptions}
          value={mapFilters.uploadedById}
          allLabel={usersLoading ? 'Loading teams…' : 'Teams'}
          placeholder="Search name or username…"
          bracketSublabel
          onChange={(id) => setMapFilter('uploadedById', id)}
        />
      )}

      { mapFilters.programId && mapFilters.orgUnitId && (
        <GroupedMultiSelect
          groups={dimensionGroups}
          selected={selectedDimensions}
          onChange={setSelectedDimensions}
          loading={dimsLoading}
        />
      )}
       
      { mapFilters.programId && mapFilters.orgUnitId && (
      <PeriodSelect
        value={mapFilters.period}
        onChange={(id, type) =>{
          if( type === "RANGE"){
            setMapFilter('periodType',type)
            return setMapFilter('period', id)
          }
           return setMapFilter('period', id)
        }}
      />
      )}
      {/*
      <SearchableSelect
        options={levelOptions}
        value={mapFilters.level != null ? String(mapFilters.level) : null}
        allLabel="All levels"
        placeholder="Search levels…"
        bracketSublabel
        onChange={(id) => setMapFilter('level', id ? Number(id) : null)}
      />
      */}
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
    //if (f.uploadedById && e.uploadedById !== f.uploadedById) return false;
    if (f.programId && e.programId !== f.programId) return false;
    //if (f.period && e.period !== f.period) return false;
    //if (f.level != null && e.level !== f.level) return false;
    if (f.orgUnitId) {
      if (orgUnitPaths) {
        const path = orgUnitPaths.get(e.orgUnitId) ?? '';
        // match if the microplan's org unit is, or is under, the selected unit
        if (e.orgUnitId !== f.orgUnitId && !path.includes(`/${f.orgUnitId}`)) return false;
      } 
      else if (e.orgUnitId !== f.orgUnitId) {
        return false;
      }
    }
    return true;
  });
}

export const getLatestMicroPlan = (data: MicroplanIndexEntry[], f: ReturnType<typeof useStore.getState>['mapFilters'] ): MicroplanIndexEntry[] => {
  
  const latest = Object.values(
    data.reduce((acc, cur) => {
       if (!f.orgUnitId || !f.programId) return acc;
      if(f.orgUnitId === cur.orgUnitId && f.programId === cur.programId){
        const key = `${cur.orgUnitId}|${cur.programId}`;
        if (!acc[key] || new Date(cur.uploadedAt) > new Date(acc[key].uploadedAt)) {
          acc[key] = cur;
        }
      }
      return acc;
    }, {} as Record<string, MicroplanIndexEntry>)
  ).filter(Boolean).filter(String);
  return latest;
};