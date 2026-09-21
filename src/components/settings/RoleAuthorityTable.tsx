import React, { useMemo, useState } from 'react';
import {
  Checkbox,
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableColumnHeader,
  DataTableHead,
  DataTableRow,
  Input,
  Tag,
  Tooltip,
} from '@dhis2/ui';
import { MICROPLAN_AUTHORITIES } from '../../lib/microplanSettings';
import type { AppUserRole } from '../../hooks/useUserRoles';

/**
 * Grant table: DHIS2 user roles down the side, microplan authorities across
 * the top.
 *
 * The header row and the role column are pinned from styles.css rather than
 * with DataTable's own `fixed` prop: `fixed` needs matching `left`/`top`
 * offsets on every cell of the frozen row *and* column, and the two overlap
 * awkwardly at the corner. Two CSS rules do the same job without that
 * bookkeeping.
 *
 * A cell is disabled when the role already holds that authority in DHIS2
 * metadata (or holds ALL). Ticking it would be a no-op — the real authority
 * already wins the check in useUserPermissions — and leaving it tickable would
 * invite an admin to "grant" something and then wonder why removing it later
 * changed nothing. The cell shows a DHIS2 tag instead, so the state is legible
 * rather than mysteriously greyed out.
 */

interface Props {
  roles: AppUserRole[];
  /** roleId -> authorities granted by the settings key (the editable half). */
  value: Record<string, string[]>;
  onToggle: (roleId: string, authority: string, checked: boolean) => void;
  disabled?: boolean;
}

export const RoleAuthorityTable: React.FC<Props> = ({ roles, value, onToggle, disabled }) => {
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q));
  }, [roles, filter]);

  return (
    <div className="grants">
      <div className="grants__filter">
        <Input
          dense
          name="role-filter"
          placeholder="Filter roles by name…"
          value={filter}
          onChange={({ value: v }) => setFilter(v ?? '')}
        />
        <span className="muted grants__count">
          {shown.length} of {roles.length} role{roles.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grants__scroll">
        <DataTable layout="fixed">
          <DataTableHead>
            <DataTableRow>
              <DataTableColumnHeader width="240px">User role</DataTableColumnHeader>
              {MICROPLAN_AUTHORITIES.map((a) => (
                <DataTableColumnHeader key={a.value}>
                  <Tooltip content={`${a.value} — ${a.description}`}>
                    <span className="grants__col">{a.label}</span>
                  </Tooltip>
                </DataTableColumnHeader>
              ))}
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {shown.map((role) => {
              const granted = value[role.id] ?? [];
              const isSuper = role.authorities.includes('ALL');
              return (
                <DataTableRow key={role.id}>
                  <DataTableCell width="240px">
                    <span className="grants__role">{role.name}</span>
                    {isSuper && (
                      <Tag neutral>Superuser</Tag>
                    )}
                  </DataTableCell>
                  {MICROPLAN_AUTHORITIES.map((a) => {
                    const inDhis2 = isSuper || role.authorities.includes(a.value);
                    return (
                      <DataTableCell key={a.value}>
                        {inDhis2 ? (
                          <Tooltip content="Already granted by the DHIS2 user role itself.">
                            <Tag positive>DHIS2</Tag>
                          </Tooltip>
                        ) : (
                          <Checkbox
                            dense
                            disabled={disabled}
                            name={`${role.id}-${a.value}`}
                            checked={granted.includes(a.value)}
                            onChange={({ checked }) => onToggle(role.id, a.value, !!checked)}
                          />
                        )}
                      </DataTableCell>
                    );
                  })}
                </DataTableRow>
              );
            })}
          </DataTableBody>
        </DataTable>

        {shown.length === 0 && (
          <p className="muted grants__empty">No user role matches “{filter}”.</p>
        )}
      </div>
    </div>
  );
};
