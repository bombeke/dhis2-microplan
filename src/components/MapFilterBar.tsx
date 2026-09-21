import React, { useMemo } from 'react';
import { Button, Chip, IconFilter24, Tooltip } from '@dhis2/ui';
import { useStore } from '../store/useStore';
import { SearchableSelect } from './SearchableSelect';
import { PeriodSelect } from './PeriodSelect';
import { OrgUnitLazyTreeSelect } from './OrgUnitLazyTreeSelect';
import { ProgramSelect } from './ProgramSelect';
import { GroupedMultiSelect } from './GroupedMultiSelect';
import { useProgramDimensions } from '../hooks/useProgramDimensions';
import { useUsers } from '../hooks/useUsers';
import { usePrograms } from '../hooks/usePrograms';
import { flattenDimensionGroups } from '../lib/programDimensions';
import type { SearchOption } from '../hooks/useFlexFilter';
import type { MicroplanIndexEntry } from '../lib/microplanStore';

/**
 * The map's filter toolbar.
 *
 * It is deliberately staged rather than flat. A programme and an organisation
 * unit are what every downstream query needs, so they come first and are always
 * visible; team, period and the extra data columns only appear once those two
 * are answered, because until then they have nothing to filter. That keeps the
 * first screen a user meets down to two decisions instead of five, and means an
 * empty map always has an obvious next step rather than five equally plausible
 * ones.
 *
 * Everything is left-aligned and wraps: the controls read as one sentence from
 * the left edge, and nothing is pushed to the far right where it would drift
 * away from the fields it belongs to as the window widens. On phones each
 * control takes the full width and they stack in the same order.
 */

/** One labelled control in the toolbar. */
const Field: React.FC<{
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}> = ({ label, hint, required, children }) => (
  <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
    <span className="inline-flex items-center gap-1 text-[11px] tracking-[0.01em] text-muted">
      {label}
      {required && (
        <span className="text-flag" aria-hidden>
          *
        </span>
      )}
      {hint && (
        <Tooltip content={hint}>
          <span
            className="inline-grid size-3.5 cursor-help place-items-center rounded-full bg-panel2 text-[9px] font-bold text-muted"
            aria-label={hint}
          >
            ?
          </span>
        </Tooltip>
      )}
    </span>
    {children}
  </div>
);

export const MapFilterBar: React.FC<{
  index: MicroplanIndexEntry[];
}> = ({ index }) => {
  const { mapFilters, setMapFilter, resetMapFilters, selectedDimensions, setSelectedDimensions } =
    useStore();
  const { data: dimensionGroups = [], isLoading: dimsLoading } = useProgramDimensions(
    mapFilters.programId
  );
  const { data: users = [], isLoading: usersLoading } = useUsers();
  const { data: programs = [] } = usePrograms();

  // "All users": everyone the current user can access, shown as "Name (username)"
  // and searchable by either. Username lives in sublabel so FlexSearch indexes it.
  const userOptions: SearchOption[] = useMemo(
    () => users.map((u) => ({ id: u.id, label: u.name, sublabel: u.username })),
    [users]
  );

  const ready = !!mapFilters.programId && !!mapFilters.orgUnitId;

  const active =
    mapFilters.uploadedById ||
    mapFilters.period ||
    mapFilters.orgUnitId ||
    mapFilters.programId ||
    selectedDimensions.length > 0;

  // The chip row restates the current selection in words. On a map, the
  // controls themselves are often scrolled past or covered by the data sheet,
  // so a one-line answer to "what am I looking at?" earns its space.
  const summary = useMemo(() => {
    const chips: { key: string; label: string; onRemove?: () => void }[] = [];
    if (mapFilters.programId) {
      const p = programs.find((x) => x.id === mapFilters.programId);
      chips.push({
        key: 'program',
        label: p?.name ?? 'Programme',
        onRemove: () => {
          setMapFilter('programId', null);
          setSelectedDimensions([]);
        },
      });
    }
    if (mapFilters.uploadedById) {
      const u = users.find((x) => x.id === mapFilters.uploadedById);
      chips.push({
        key: 'team',
        label: u ? `Team ${u.username ?? u.name}` : 'Team',
        onRemove: () => setMapFilter('uploadedById', null),
      });
    }
    if (mapFilters.period) {
      chips.push({
        key: 'period',
        label:
          mapFilters.period.includes('_') && mapFilters.periodType === 'RANGE'
            ? mapFilters.period.replace('_', ' → ')
            : mapFilters.period.replace(/_/g, ' ').toLowerCase(),
        onRemove: () => setMapFilter('period', null),
      });
    }
    if (selectedDimensions.length) {
      const all = flattenDimensionGroups(dimensionGroups);
      const names = selectedDimensions
        .map((id) => all.find((o) => o.id === id)?.name)
        .filter(Boolean) as string[];
      chips.push({
        key: 'dims',
        label: names.length === 1 ? names[0] : `${selectedDimensions.length} extra column(s)`,
        onRemove: () => setSelectedDimensions([]),
      });
    }
    return chips;
  }, [
    mapFilters,
    programs,
    users,
    selectedDimensions,
    dimensionGroups,
    setMapFilter,
    setSelectedDimensions,
  ]);

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 shadow-card sm:p-3.5">
      <div className="flex flex-col items-stretch justify-start gap-x-3 gap-y-3 sm:flex-row sm:flex-wrap sm:items-end">
        <span className="inline-flex items-center gap-1.5 self-start text-[11px] font-semibold uppercase tracking-wider text-muted sm:self-center [&_svg]:size-4 [&_svg]:fill-muted">
          <IconFilter24 />
          Filter map
        </span>

        <Field label="Programme" required>
          <ProgramSelect
            value={mapFilters.programId}
            onChange={(id) => {
              setMapFilter('programId', id);
              setSelectedDimensions([]); // reset dimension picks for the new program
            }}
          />
        </Field>

        <Field label="Organisation unit" required>
          <OrgUnitLazyTreeSelect
            value={mapFilters.orgUnitId}
            onChange={(id) => setMapFilter('orgUnitId', id)}
          />
        </Field>

        {ready && (
          <>
            {/* Hairline between "what am I looking at" and "how am I narrowing
                it". Only drawn from `sm` up, where the two groups sit on one
                row; stacked, the order already says it. */}
            <span className="hidden w-px self-stretch bg-line sm:block" aria-hidden />

            <Field label="Team">
              <SearchableSelect
                options={userOptions}
                value={mapFilters.uploadedById}
                allLabel={usersLoading ? 'Loading teams…' : 'Teams'}
                placeholder="Search name or username…"
                bracketSublabel
                onChange={(id) => setMapFilter('uploadedById', id)}
              />
            </Field>

            <Field label="Period">
              <PeriodSelect
                value={mapFilters.period}
                onChange={(id, type) => {
                  if (type === 'RANGE') {
                    setMapFilter('periodType', type);
                    return setMapFilter('period', id);
                  }
                  return setMapFilter('period', id);
                }}
              />
            </Field>

            <Field
              label="Data columns"
              hint="Attributes and program-stage data elements to add to the data table and to each tracked entity's profile."
            >
              <GroupedMultiSelect
                groups={dimensionGroups}
                selected={selectedDimensions}
                onChange={setSelectedDimensions}
                loading={dimsLoading}
              />
            </Field>
          </>
        )}

        {active && (
          <div className="self-start sm:self-end sm:pb-0.5">
            <Button small secondary onClick={resetMapFilters}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {!ready ? (
        <p className="m-0 text-[12.5px] text-muted">
          Choose a <strong className="font-semibold text-ink">programme</strong> and an{' '}
          <strong className="font-semibold text-ink">organisation unit</strong> to load the map.
        </p>
      ) : (
        summary.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 [&>*]:!m-0">
            {summary.map((c) => (
              <Chip key={c.key} dense onRemove={c.onRemove}>
                {c.label}
              </Chip>
            ))}
          </div>
        )
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