import React from 'react';
import { Tag } from '@dhis2/ui';
import { MICROPLAN_AUTHORITIES } from '../../lib/microplanSettings';
import type { UserPermissions } from '../../hooks/useUserPermissions';
import type { AppUserGroup } from '../../hooks/useUserGroups';

/**
 * Read-only account of how the signed-in admin's own access resolves.
 *
 * The point isn't vanity: the grant table is a fallback layer, so "why can this
 * person do that?" is a question with three possible answers, and an admin
 * debugging someone's access needs to see the shape of the answer on a user
 * they can verify — themselves — before they trust it for anyone else.
 */

interface Props {
  permissions: UserPermissions;
  groups: AppUserGroup[];
}

const SOURCE_TAG: Record<string, { label: string; tone: 'positive' | 'neutral' }> = {
  superuser: { label: 'Superuser (ALL)', tone: 'positive' },
  dhis2: { label: 'DHIS2 user role', tone: 'positive' },
  settings: { label: 'App settings', tone: 'neutral' },
};

export const AccessSummary: React.FC<Props> = ({ permissions, groups }) => {
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;
  const dhis2GroupIds = new Set(permissions.userGroups.map((g) => g.id));

  return (
    <div className="access">
      <dl className="access__facts">
        <div>
          <dt>Signed in as</dt>
          <dd>
            {permissions.displayName}{' '}
            <span className="muted">({permissions.username})</span>
          </dd>
        </div>
        <div>
          <dt>User roles</dt>
          <dd>
            {permissions.userRoles.length
              ? permissions.userRoles.map((r) => <Tag key={r.id}>{r.name}</Tag>)
              : <span className="muted">None reported by DHIS2</span>}
          </dd>
        </div>
        <div>
          <dt>User groups</dt>
          <dd>
            {permissions.effectiveGroupIds.length ? (
              permissions.effectiveGroupIds.map((id) => (
                <Tag key={id} neutral={!dhis2GroupIds.has(id)}>
                  {groupName(id)}
                  {!dhis2GroupIds.has(id) && ' · added here'}
                </Tag>
              ))
            ) : (
              <span className="muted">None</span>
            )}
          </dd>
        </div>
      </dl>

      <table className="access__table">
        <thead>
          <tr>
            <th>Authority</th>
            <th>Granted by</th>
          </tr>
        </thead>
        <tbody>
          {MICROPLAN_AUTHORITIES.map((a) => {
            const source = permissions.source(a.value);
            const tag = source ? SOURCE_TAG[source] : null;
            return (
              <tr key={a.value}>
                <td>
                  <span className="access__auth">{a.label}</span>
                  <code>{a.value}</code>
                </td>
                <td>
                  {tag ? (
                    <Tag positive={tag.tone === 'positive'} neutral={tag.tone === 'neutral'}>
                      {tag.label}
                    </Tag>
                  ) : (
                    <span className="muted">Not granted</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
