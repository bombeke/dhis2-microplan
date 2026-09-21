import React, { useMemo } from 'react';
import {
  Checkbox,
  CircularLoader,
  NoticeBox,
  SingleSelectField,
  SingleSelectOption,
  Tag,
  Transfer,
} from '@dhis2/ui';
import { MICROPLAN_AUTHORITIES } from '../../lib/microplanSettings';
import type { AppUserGroup } from '../../hooks/useUserGroups';
import type { AppUser } from '../../hooks/useUsers';

/**
 * Per-group access: which microplan authorities a group confers, and which
 * users the app should treat as members of it.
 *
 * Membership here is *additive to* DHIS2, never a replacement for it. Users who
 * are already in the group in DHIS2 metadata appear in the picked column,
 * locked, so an admin can see the full membership in one place without being
 * able to remove someone through a mechanism that couldn't actually remove
 * them. Only the app-level additions are stored in the settings key.
 */

interface Props {
  groups: AppUserGroup[];
  users: AppUser[];
  usersLoading: boolean;
  selectedGroupId: string;
  onSelectGroup: (id: string) => void;
  /** groupId -> authorities granted to members. */
  authorities: Record<string, string[]>;
  onToggleAuthority: (groupId: string, authority: string, checked: boolean) => void;
  /** groupId -> app-level member user ids. */
  members: Record<string, string[]>;
  onChangeMembers: (groupId: string, userIds: string[]) => void;
  disabled?: boolean;
}

export const GroupAccessPanel: React.FC<Props> = ({
  groups,
  users,
  usersLoading,
  selectedGroupId,
  onSelectGroup,
  authorities,
  onToggleAuthority,
  members,
  onChangeMembers,
  disabled,
}) => {
  const group = groups.find((g) => g.id === selectedGroupId);

  const dhis2MemberIds = useMemo(() => new Set(group?.memberIds ?? []), [group]);
  const appMemberIds = useMemo(
    () => (selectedGroupId ? members[selectedGroupId] ?? [] : []),
    [members, selectedGroupId]
  );

  // DHIS2 members are shown as locked picks; the transfer's selection is
  // therefore both lists, and only the difference is handed back to the caller.
  const options = useMemo(
    () =>
      users.map((u) => ({
        value: u.id,
        label: dhis2MemberIds.has(u.id)
          ? `${u.name} (${u.username}) — in DHIS2 group`
          : `${u.name} (${u.username})`,
        disabled: dhis2MemberIds.has(u.id),
      })),
    [users, dhis2MemberIds]
  );

  const selected = useMemo(
    () => Array.from(new Set([...dhis2MemberIds, ...appMemberIds])),
    [dhis2MemberIds, appMemberIds]
  );

  const handleChange = ({ selected: next }: { selected: string[] }) => {
    if (!selectedGroupId) return;
    onChangeMembers(
      selectedGroupId,
      next.filter((id) => !dhis2MemberIds.has(id))
    );
  };

  const granted = selectedGroupId ? authorities[selectedGroupId] ?? [] : [];

  return (
    <div className="groupaccess">
      <SingleSelectField
        label="User group"
        placeholder="Choose a user group"
        selected={selectedGroupId || undefined}
        onChange={({ selected: id }) => onSelectGroup(id)}
        filterable
        noMatchText="No group matches"
        disabled={disabled}
      >
        {groups.map((g) => (
          <SingleSelectOption key={g.id} value={g.id} label={g.name} />
        ))}
      </SingleSelectField>

      {!group && (
        <NoticeBox title="Pick a group to configure">
          Authorities granted here apply to everyone in the selected group — both its
          DHIS2 members and anyone you add below.
        </NoticeBox>
      )}

      {group && (
        <>
          <section className="groupaccess__section">
            <h4>
              Authorities for <strong>{group.name}</strong>
            </h4>
            <p className="muted">
              Members of this group get these microplan authorities in addition to
              whatever their DHIS2 user roles already grant them.
            </p>
            <div className="authgrid">
              {MICROPLAN_AUTHORITIES.map((a) => (
                <label key={a.value} className="authgrid__item">
                  <Checkbox
                    dense
                    disabled={disabled}
                    name={`${group.id}-${a.value}`}
                    checked={granted.includes(a.value)}
                    onChange={({ checked }) => onToggleAuthority(group.id, a.value, !!checked)}
                  />
                  <span>
                    <span className="authgrid__label">{a.label}</span>
                    <span className="authgrid__desc">{a.description}</span>
                    <code className="authgrid__code">{a.value}</code>
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="groupaccess__section">
            <h4>
              Members of <strong>{group.name}</strong>
              {appMemberIds.length > 0 && (
                <Tag neutral>
                  {appMemberIds.length} added here
                </Tag>
              )}
            </h4>
            <p className="muted">
              Users added here count as group members for this app only — DHIS2 group
              metadata is untouched. Members already in the DHIS2 group are listed on the
              right and can't be removed from this screen.
            </p>
            {usersLoading ? (
              <div className="groupaccess__loading">
                <CircularLoader small />
                <span className="muted">Loading users…</span>
              </div>
            ) : (
              <Transfer
                options={options}
                selected={selected}
                onChange={handleChange}
                disabled={disabled}
                filterable
                filterablePicked
                filterPlaceholder="Search users"
                filterPlaceholderPicked="Search members"
                height="320px"
                optionsWidth="360px"
                selectedWidth="360px"
                leftHeader={<h5 className="transfer__head">Available users</h5>}
                rightHeader={<h5 className="transfer__head">Group members</h5>}
                selectedEmptyComponent={
                  <p className="muted transfer__empty">No members yet.</p>
                }
              />
            )}
          </section>
        </>
      )}
    </div>
  );
};
