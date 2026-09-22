import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertBar,
  AlertStack,
  Button,
  ButtonStrip,
  CircularLoader,
  IconCalendar24,
  IconLock24,
  IconSettings24,
  IconUser24,
  IconUserGroup24,
  NoticeBox,
  Tab,
  TabBar,
} from '@dhis2/ui';
import { useMicroplanSettings, useSaveMicroplanSettings } from '../hooks/useMicroplanSettings';
import { useUserRoles } from '../hooks/useUserRoles';
import { useUserGroups } from '../hooks/useUserGroups';
import { useUsers } from '../hooks/useUsers';
import { useUserPermissions } from '../hooks/useUserPermissions';
import {
  emptySettings,
  SETTINGS_KEY,
  type MicroplanSettings,
} from '../lib/microplanSettings';
import { NAMESPACE } from '../lib/microplanStore';
import { RoleAuthorityTable } from '../components/settings/RoleAuthorityTable';
import { GroupAccessPanel } from '../components/settings/GroupAccessPanel';
import { AccessSummary } from '../components/settings/AccessSummary';
import { ReportingCyclePanel } from '../components/settings/ReportingCyclePanel';

/**
 * Administration page, reachable only with F_ADMIN_MICROPLAN (or ALL).
 *
 * Everything on this page edits one draft object and writes it back to
 * dataStore/microplan/settings in a single mutation. Editing a local draft
 * rather than saving each checkbox is what lets an admin reorganise several
 * roles and groups as one coherent change, and see an explicit unsaved-changes
 * state instead of half-applying a rethink.
 *
 * The page is gated twice over — the tab is hidden without the authority, and
 * the route bounces — but it also renders its own refusal, because a hidden
 * tab is not access control and a direct #/settings link has to land somewhere
 * honest.
 */

type Section = 'roles' | 'groups' | 'cycle' | 'access';

const SECTIONS: { id: Section; label: string; icon: React.ReactElement }[] = [
  { id: 'roles', label: 'Role authorities', icon: <IconLock24 /> },
  { id: 'groups', label: 'User groups', icon: <IconUserGroup24 /> },
  { id: 'cycle', label: 'Reporting cycle', icon: <IconCalendar24 /> },
  { id: 'access', label: 'Your access', icon: <IconUser24 /> },
];

/** Stable stringify so a reordered-but-identical draft doesn't read as dirty. */
const fingerprint = (s: MicroplanSettings): string => {
  const maps = (m: Record<string, string[]>) =>
    Object.entries(m)
      .filter(([, v]) => v.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, [...v].sort()] as const);
  return JSON.stringify([
    maps(s.roleAuthorities),
    maps(s.groupAuthorities),
    maps(s.groupMembers),
    s.reportingCycle,
  ]);
};

/** Add/remove one value in a map-of-lists, dropping the key when it empties. */
const toggleIn = (
  map: Record<string, string[]>,
  key: string,
  value: string,
  on: boolean
): Record<string, string[]> => {
  const current = map[key] ?? [];
  const next = on ? Array.from(new Set([...current, value])) : current.filter((v) => v !== value);
  const out = { ...map };
  if (next.length) out[key] = next;
  else delete out[key];
  return out;
};

export const SettingsPage: React.FC = () => {
  const { permissions, isLoading: permLoading } = useUserPermissions();
  const canAdmin = permissions?.can('F_ADMIN_MICROPLAN') ?? false;

  const settingsQuery = useMicroplanSettings();
  const save = useSaveMicroplanSettings();
  const roles = useUserRoles();
  const groups = useUserGroups();
  const users = useUsers();

  const [section, setSection] = useState<Section>('roles');
  const [draft, setDraft] = useState<MicroplanSettings>(emptySettings);
  const [groupId, setGroupId] = useState('');
  const [alert, setAlert] = useState<{ tone: 'success' | 'critical'; text: string } | null>(null);

  const server = settingsQuery.data;
  // The draft only re-seeds when the *server* value changes, not on every
  // render — otherwise a background refetch would silently wipe edits in
  // progress.
  const seededFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!server) return;
    const fp = fingerprint(server);
    if (seededFrom.current === fp) return;
    seededFrom.current = fp;
    setDraft(server);
  }, [server]);

  const dirty = useMemo(
    () => (server ? fingerprint(draft) !== fingerprint(server) : false),
    [draft, server]
  );

  // Browsers only honour a leave prompt when a beforeunload listener is
  // attached, so it goes on and comes off with the dirty state.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const toggleRoleAuthority = useCallback(
    (roleId: string, authority: string, checked: boolean) =>
      setDraft((d) => ({
        ...d,
        roleAuthorities: toggleIn(d.roleAuthorities, roleId, authority, checked),
      })),
    []
  );

  const toggleGroupAuthority = useCallback(
    (gid: string, authority: string, checked: boolean) =>
      setDraft((d) => ({
        ...d,
        groupAuthorities: toggleIn(d.groupAuthorities, gid, authority, checked),
      })),
    []
  );

  const setGroupMembers = useCallback(
    (gid: string, userIds: string[]) =>
      setDraft((d) => {
        const groupMembers = { ...d.groupMembers };
        if (userIds.length) groupMembers[gid] = userIds;
        else delete groupMembers[gid];
        return { ...d, groupMembers };
      }),
    []
  );

  const onSave = () => {
    save.mutate(
      { settings: draft, updatedBy: permissions?.username ?? '' },
      {
        onSuccess: (saved) => {
          seededFrom.current = fingerprint(saved);
          setDraft(saved);
          setAlert({ tone: 'success', text: 'Settings saved.' });
        },
        onError: (e) =>
          setAlert({
            tone: 'critical',
            text: `Could not save settings: ${(e as Error).message}`,
          }),
      }
    );
  };

  const onDiscard = () => {
    if (server) setDraft(server);
  };

  if (permLoading) {
    return (
      <div className="page page--settings page--center">
        <CircularLoader large />
      </div>
    );
  }

  if (!canAdmin) {
    return (
      <div className="page page--settings">
        <NoticeBox error title="Administrator access required">
          This page changes who can use the microplan app, so it needs the{' '}
          <code>F_ADMIN_MICROPLAN</code> authority (or <code>ALL</code>). Ask a DHIS2
          administrator to add it to your user role.
        </NoticeBox>
      </div>
    );
  }

  const loadError = settingsQuery.error ?? roles.error ?? groups.error;

  return (
    <div className="page page--settings">
      <div className="page__head">
        <div>
          <h2>
            <IconSettings24 /> Settings
          </h2>
          <p className="page__lead">
            Grant microplan authorities to DHIS2 user roles and user groups when editing
            the roles themselves isn't an option. These grants are additive — they never
            remove access someone already has in DHIS2. The reporting cycle sets how
            microplan years and quarters are counted.
          </p>
        </div>
        <ButtonStrip>
          <Button secondary disabled={!dirty || save.isPending} onClick={onDiscard}>
            Discard changes
          </Button>
          <Button primary disabled={!dirty} loading={save.isPending} onClick={onSave}>
            Save settings
          </Button>
        </ButtonStrip>
      </div>

      {loadError && (
        <NoticeBox error title="Couldn't load everything this page needs">
          {(loadError as Error).message}
        </NoticeBox>
      )}

      {dirty && (
        <div className="savebar">
          <span className="savebar__dot" aria-hidden />
          You have unsaved changes. Nothing takes effect until you save.
        </div>
      )}

      <nav className="settings__nav" aria-label="Settings sections">
        <TabBar>
          {SECTIONS.map((s) => (
            <Tab
              key={s.id}
              icon={s.icon}
              selected={section === s.id}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </Tab>
          ))}
        </TabBar>
      </nav>

      <div className="card">
        <div className="card__body">
          {section === 'roles' &&
            (roles.isLoading ? (
              <div className="card__center">
                <CircularLoader />
              </div>
            ) : (
              <RoleAuthorityTable
                roles={roles.data ?? []}
                value={draft.roleAuthorities}
                onToggle={toggleRoleAuthority}
                disabled={save.isPending}
              />
            ))}

          {section === 'groups' &&
            (groups.isLoading ? (
              <div className="card__center">
                <CircularLoader />
              </div>
            ) : (
              <GroupAccessPanel
                groups={groups.data ?? []}
                users={users.data ?? []}
                usersLoading={users.isLoading}
                selectedGroupId={groupId}
                onSelectGroup={setGroupId}
                authorities={draft.groupAuthorities}
                onToggleAuthority={toggleGroupAuthority}
                members={draft.groupMembers}
                onChangeMembers={setGroupMembers}
                disabled={save.isPending}
              />
            ))}

          {section === 'cycle' && (
            <ReportingCyclePanel
              value={draft.reportingCycle}
              onChange={(reportingCycle) => setDraft((d) => ({ ...d, reportingCycle }))}
              disabled={save.isPending}
            />
          )}

          {section === 'access' && permissions && (
            <AccessSummary permissions={permissions} groups={groups.data ?? []} />
          )}
        </div>
      </div>

      <p className="settings__provenance muted">
        
        {server?.updatedAt && (
          <>
            {' '}Last saved {new Date(server.updatedAt).toLocaleString()}
            {server.updatedBy && ` by ${server.updatedBy}`}.
          </>
        )}
      </p>

      {alert && (
        <AlertStack>
          <AlertBar
            success={alert.tone === 'success'}
            critical={alert.tone === 'critical'}
            duration={6000}
            onHidden={() => setAlert(null)}
          >
            {alert.text}
          </AlertBar>
        </AlertStack>
      )}
    </div>
  );
};
