import React, { useMemo } from 'react';
import { usePrograms } from '../hooks/usePrograms';
import { SearchableSelect } from './SearchableSelect';
import type { SearchOption } from '../hooks/useFlexFilter';

/**
 * Searchable program (activity) selector shared by the map filter bar and the
 * upload page. Options come from usePrograms (cached) and are searched via the
 * FlexSearch-backed SearchableSelect, so it scales when an instance has many
 * programs. Shows the program code as a sub-label when present.
 */
export const ProgramSelect: React.FC<{
  value: string | null;
  onChange: (id: string | null) => void;
  allLabel?: string;
  placeholder?: string;
}> = ({ value, onChange, allLabel = 'All programs', placeholder = 'Search programs…' }) => {
  const { data: programs = [], isLoading } = usePrograms();

  const options: SearchOption[] = useMemo(
    () =>
      programs.map((p) => ({
        id: p.id,
        label: p.name,
        sublabel: p.code ? `${p.code} · ${p.programStages.length} stage(s)` : `${p.programStages.length} stage(s)`,
      })),
    [programs]
  );

  return (
    <SearchableSelect
      options={options}
      value={value}
      allLabel={isLoading ? 'Loading programs…' : allLabel}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
};
