import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  CircularLoader,
  DropdownButton,
  FlyoutMenu,
  IconDownload24,
  IconFileDocument24,
  IconLock24,
  IconQuestion24,
  IconSettings24,
  IconUpload24,
  IconWorld24,
  MenuDivider,
  MenuItem,
  MenuSectionHeader,
  NoticeBox,
  Tab,
  TabBar,
  UserAvatar,
} from '@dhis2/ui';
import { useRoute, type Route } from '../hooks/useRoute';
import { useSearchWorker } from '../hooks/useSearchWorker';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { GlobalSearch } from '../components/GlobalSearch';
import { MapPage } from './MapPage';
import { UploadPage } from './UploadPage';
import { FilesPage } from './FilesPage';
import { ExportPage } from './ExportPage';
import { GuidePage } from './GuidePage';
import { SettingsPage } from './SettingsPage';
import { Footer } from './Footer';

/**
 * Top-level shell: a branded app bar, a nav row, and a hash-routed page area.
 *
 *  #/map      — filterable coverage map (maplibre-gl layers)
 *  #/files    — catalogue of uploaded microplans
 *  #/upload   — dedicated upload page (parses + saves to dataStore)
 *  #/export   — analytics data download (CSV/JSON)
 *  #/guide    — in-app rendering of docs/USER_GUIDE.md
 *  #/settings — who can do what (F_ADMIN_MICROPLAN only)
 *
 * The nav row carries *destinations you work in*, in the order the job flows:
 * look at the map, manage the plans behind it, add one, take the data out.
 * Administration sits at its far right, separated, because it is a different
 * kind of destination and because it appears and disappears with the user's
 * rights — keeping it out of the run means the four work tabs never shift
 * position between an administrator's screen and a field user's.
 *
 * Help is *not* a destination in that sense: it is something you reach for
 * mid-task and leave again. It lives in the app bar as an icon (and in the
 * account menu), which keeps the nav row down to the tabs that describe the
 * job rather than the tools around it.
 *
 * `program` is the DHIS2 tracker program whose enrollment/event points are
 * drawn on the map. Wire it from app config / a program picker as needed.
 */
const PROGRAM: string | undefined = undefined; // set to your tracker program UID

const APP_TITLE = 'Outreach Microplan & Coverage';

interface NavItem {
  route: Route;
  label: string;
  icon: React.ReactElement;
}

const Brand: React.FC = () => (
  <div className="brand">
    <span aria-hidden className="brand__mark" />
    <div className="brand__text">
      <h1>Outreach Microplan</h1>
      <span className="brand__sub">Coverage &amp; data export</span>
    </div>
  </div>
);

export const AppShell: React.FC = () => {
  const [route, navigate] = useRoute();
  const searchWorker = useSearchWorker();
  const { permissions, isLoading: permLoading } = useUserPermissions();
  const [menuOpen, setMenuOpen] = useState(false);

  // Until /api/me answers we know nothing, so `canView` defaults open and the
  // loader below is what the user actually sees; the rest default closed, so a
  // slow response never briefly exposes a control the user can't use.
  const canView = permissions?.can('F_VIEW_MICROPLAN') ?? true;
  const canAdd = permissions?.can('F_ADD_MICROPLAN') ?? false;
  const canAdmin = permissions?.can('F_ADMIN_MICROPLAN') ?? false;

  const primaryNav: NavItem[] = useMemo(
    () => [
      { route: 'map', label: 'Map', icon: <IconWorld24 /> },
      { route: 'files', label: 'Microplans', icon: <IconFileDocument24 /> },
      ...(canAdd ? [{ route: 'upload' as Route, label: 'Upload', icon: <IconUpload24 /> }] : []),
      { route: 'export', label: 'Export', icon: <IconDownload24 /> },
    ],
    [canAdd]
  );

  const adminNav: NavItem[] = useMemo(
    () =>
      canAdmin ? [{ route: 'settings' as Route, label: 'Settings', icon: <IconSettings24 /> }] : [],
    [canAdmin]
  );

  // Someone without the rights who lands on a gated route directly (bookmark,
  // typed hash, stale link) gets bounced back to the map rather than seeing the
  // page flash before the nav hides it.
  useEffect(() => {
    if (permLoading) return;
    if (route === 'upload' && !canAdd) navigate('map');
    if (route === 'settings' && !canAdmin) navigate('map');
  }, [permLoading, route, canAdd, canAdmin, navigate]);

  if (permLoading) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <header className="app-shell__bar">
          <Brand />
        </header>
        <div className="app-shell__page app-shell__page--center flex-1">
          <CircularLoader large />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <header className="app-shell__bar">
          <Brand />
          <div className="app-shell__spacer" />
          {permissions && <span className="app-shell__user">{permissions.displayName}</span>}
        </header>
        <div className="app-shell__page flex-1">
          <div className="page">
            <NoticeBox error title={`You don't have permission to view ${APP_TITLE}`}>
              Ask your DHIS2 administrator to grant the <code>F_VIEW_MICROPLAN</code> authority to
              your user role, or to add one of your roles or groups on the app's Settings page.
            </NoticeBox>
          </div>
        </div>
      </div>
    );
  }

  const userMenu = (
    <FlyoutMenu>
      <MenuSectionHeader label={permissions?.username ?? 'Signed in'} />
      {permissions?.isSuperuser && (
        <MenuItem dense disabled icon={<IconLock24 />} label="Superuser (ALL)" />
      )}
      {permissions?.userRoles.slice(0, 4).map((r) => (
        <MenuItem key={r.id} dense disabled label={r.name} />
      ))}
      {canAdmin && (
        <>
          <MenuDivider />
          <MenuItem
            dense
            icon={<IconSettings24 />}
            label="Settings"
            onClick={() => {
              setMenuOpen(false);
              navigate('settings');
            }}
          />
        </>
      )}
      <MenuDivider />
      <MenuItem
        dense
        icon={<IconQuestion24 />}
        label="User guide"
        onClick={() => {
          setMenuOpen(false);
          navigate('guide');
        }}
      />
    </FlyoutMenu>
  );

  return (
    // min-h-screen + flex-col so the footer sits at the bottom on short pages
    // but is pushed down by long ones (no fixed positioning over the map).
    <div className="app-shell flex min-h-screen flex-col">
      <header className="app-shell__bar">
        <Brand />
        <div className="app-shell__spacer" />
        {route === 'map' && <GlobalSearch worker={searchWorker} />}
        {/* Icon-only, with `title`/`aria-label` rather than a <Tooltip>: the
            tooltip's node form wraps its child in a focusable span, which would
            put a second, empty tab stop in front of the button. */}
        <Button
          small
          secondary
          icon={<IconQuestion24 />}
          className={route === 'guide' ? 'is-active' : undefined}
          title="User guide"
          aria-label="User guide"
          aria-current={route === 'guide' ? 'page' : undefined}
          onClick={() => navigate('guide')}
        />
        {permissions && (
          // The avatar sits beside the trigger rather than inside it:
          // UserAvatar renders a <div>, which isn't valid content for the
          // <button> DropdownButton wraps its children in.
          <div className="app-shell__account" title={permissions.username}>
            <UserAvatar small name={permissions.displayName} />
            <DropdownButton
              small
              secondary
              open={menuOpen}
              onClick={({ open }: { open: boolean }) => setMenuOpen(open)}
              component={userMenu}
            >
              {permissions.displayName}
            </DropdownButton>
          </div>
        )}
      </header>

      <nav className="app-shell__nav" aria-label="Main">
        <div className="app-shell__nav-group">
          <TabBar>
            {primaryNav.map((item) => (
              <Tab
                key={item.route}
                icon={item.icon}
                selected={route === item.route}
                onClick={() => navigate(item.route)}
              >
                {item.label}
              </Tab>
            ))}
          </TabBar>
        </div>
        {/* An empty TabBar still draws its rule and padding, so the whole
            group is dropped rather than rendered empty for non-administrators. */}
        {adminNav.length > 0 && (
          <div className="app-shell__nav-group app-shell__nav-group--end">
            <TabBar>
              {adminNav.map((item) => (
                <Tab
                  key={item.route}
                  icon={item.icon}
                  selected={route === item.route}
                  onClick={() => navigate(item.route)}
                >
                  {item.label}
                </Tab>
              ))}
            </TabBar>
          </div>
        )}
      </nav>

      <div className="app-shell__page flex-1">
        {route === 'map' && <MapPage program={PROGRAM} />}
        {route === 'upload' && canAdd && <UploadPage />}
        {route === 'files' && <FilesPage />}
        {route === 'export' && <ExportPage />}
        {route === 'guide' && <GuidePage />}
        {route === 'settings' && <SettingsPage />}
      </div>

      <Footer />
    </div>
  );
};
