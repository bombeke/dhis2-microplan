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

/**
 * The app bar. Sticky and translucent so the page reads as scrolling *under*
 * the chrome; `h-bar` is the same token the nav's sticky offset uses, so the
 * two can't fall out of step.
 */
const barCls =
  'app-bar sticky top-0 z-30 flex min-h-bar items-center gap-3 border-b border-line ' +
  'bg-panel/90 px-3 py-2 backdrop-blur-md backdrop-saturate-150 sm:gap-4 sm:px-6';

const Brand: React.FC = () => (
  <div className="flex min-w-0 items-center gap-3">
    <span
      aria-hidden
      className="h-8 w-1.5 shrink-0 rounded-full bg-gradient-to-b from-accent to-sky-500"
    />
    <div className="min-w-0 leading-tight">
      <h1 className="m-0 truncate text-[15px] font-semibold tracking-tight">
        Outreach Microplan
      </h1>
      {/* Dropped on phones: the name alone identifies the app, and the strapline
          is what pushes the account control off a narrow bar. */}
      <span className="hidden text-[11px] uppercase tracking-wider text-faint sm:inline">
        Coverage &amp; data export
      </span>
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
      <div className="flex min-h-screen flex-col">
        <header className={barCls}>
          <Brand />
        </header>
        <div className="grid flex-1 place-items-center bg-canvas p-12">
          <CircularLoader large />
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="flex min-h-screen flex-col">
        <header className={barCls}>
          <Brand />
          <div className="flex-1" />
          {permissions && (
            <span className="truncate text-[13px] font-medium">{permissions.displayName}</span>
          )}
        </header>
        <div className="flex-1 overflow-auto bg-canvas">
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
    <div className="flex min-h-screen flex-col">
      <header className={barCls}>
        <Brand />
        <div className="flex-1" />
        {/* From `md` up the settlement search sits in the bar; below that the
            bar has no room for it and it moves to its own row under the tabs,
            where it gets the full width a search field actually needs. */}
        {route === 'map' && (
          <div className="hidden md:block">
            <GlobalSearch worker={searchWorker} />
          </div>
        )}
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
          <div
            className="flex min-w-0 items-center gap-2 [&_[data-test='dhis2-uicore-dropdownbutton-toggle']]:max-w-[13rem] [&_[data-test='dhis2-uicore-dropdownbutton-toggle']]:truncate"
            title={permissions.username}
          >
            <UserAvatar small name={permissions.displayName} />
            {/* One button, with the *label* responsive rather than the button:
                two DropdownButtons sharing `menuOpen` would both portal their
                flyout to the body when open, and `display:none` on a wrapper
                doesn't reach a portal — so the hidden one's menu would appear
                too. On a narrow bar the avatar carries the identity and the
                trigger is just the caret. */}
            <DropdownButton
              small
              secondary
              open={menuOpen}
              onClick={({ open }: { open: boolean }) => setMenuOpen(open)}
              component={userMenu}
            >
              <span className="hidden sm:inline">{permissions.displayName}</span>
            </DropdownButton>
          </div>
        )}
      </header>

      <nav
        className="sticky top-bar z-20 flex items-stretch justify-between gap-4 overflow-x-auto border-b border-line bg-panel px-2 sm:px-4 [&_[data-test='dhis2-uicore-tab']]:border-b-transparent"
        aria-label="Main"
      >
        <div className="flex min-w-0">
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
          <div className="flex min-w-0 ms-auto">
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

      {route === 'map' && (
        <div className="border-b border-line bg-panel px-3 py-2 md:hidden">
          <GlobalSearch worker={searchWorker} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-canvas">
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
