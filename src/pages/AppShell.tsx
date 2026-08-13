import React, { useEffect } from 'react';
import { useRoute } from '../hooks/useRoute';
import { useSearchWorker } from '../hooks/useSearchWorker';
import { useCurrentUser } from '../hooks/useMicroplans';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { GlobalSearch } from '../components/GlobalSearch';
import { MapPage } from './MapPage';
import { UploadPage } from './UploadPage';
import { FilesPage } from './FilesPage';
import { GuidePage } from './GuidePage';
import { Footer } from './Footer';
import { CircularLoader } from '@dhis2/ui';

/**
 * Top-level shell: a slim nav bar plus a hash-routed page area.
 *
 *  #/map     — filterable coverage map (maplibre-gl layers)
 *  #/upload  — dedicated upload page (parses + saves to dataStore)
 *  #/files   — catalogue of uploaded microplans
 *  #/guide   — in-app rendering of docs/USER_GUIDE.md
 *
 * `program` is the DHIS2 tracker program whose enrollment/event points are
 * drawn on the map. Wire it from app config / a program picker as needed.
 */
const PROGRAM: string | undefined = undefined; // set to your tracker program UID

export const AppShell: React.FC = () => {
  const [route, navigate] = useRoute();
  const searchWorker = useSearchWorker();
  const user = useCurrentUser();
  const { permissions, isLoading: permLoading } = useUserPermissions();

  const canView = permissions?.canAny(['F_VIEW_MICROPLAN', 'ALL']) ?? true;
  const canAdd = permissions?.canAny(['F_ADD_MICROPLAN', 'ALL']) ?? false;

  // Someone without upload rights who lands on #/upload directly (bookmark,
  // typed hash, stale link) gets bounced back to the map rather than seeing
  // the upload form flash before the nav hides it.
  useEffect(() => {
    if (!permLoading && route === 'upload' && !canAdd) navigate('map');
  }, [permLoading, route, canAdd, navigate]);

  const NavLink: React.FC<{ to: 'map' | 'upload' | 'files' | 'guide'; children: React.ReactNode }> = ({
    to,
    children,
  }) => (
    <button
      className={`nav__link ${route === to ? 'is-active' : ''}`}
      onClick={() => navigate(to)}
    >
      {children}
    </button>
  );

  if (permLoading) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <header className="app-shell__bar">
          <h1>Outreach Microplan &amp; Coverage</h1>
        </header>
        <div className="app-shell__page flex-1">
          <CircularLoader large/>
        </div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="app-shell flex min-h-screen flex-col">
        <header className="app-shell__bar">
          <h1>Outreach Microplan &amp; Coverage</h1>
          <div className="app-shell__spacer" />
          {user && <span className="app-shell__user">{user.name}</span>}
        </header>
        <div className="app-shell__page flex-1">
          <p className="error" style={{ padding: 24 }}>
            You don't have permission to view this app. Ask your DHIS2 administrator to grant
            the <code>F_VIEW_MICROPLAN</code> authority.
          </p>
        </div>
      </div>
    );
  }

  return (
    // min-h-screen + flex-col so the footer sits at the bottom on short pages
    // but is pushed down by long ones (no fixed positioning over the map).
    <div className="app-shell flex min-h-screen flex-col">
      <header className="app-shell__bar">
        <h1>Outreach Microplan &amp; Coverage</h1>
        <nav className="nav">
          <NavLink to="map">Map</NavLink>
          <NavLink to="files">Files</NavLink>
          {canAdd && <NavLink to="upload">Upload</NavLink>}
          <NavLink to="guide">User Guide</NavLink>
        </nav>
        <div className="app-shell__spacer" />
        {route === 'map' && <GlobalSearch worker={searchWorker} />}
        {user && <span className="app-shell__user">{user.name}</span>}
      </header>

      <div className="app-shell__page flex-1">
        {route === 'map' && <MapPage program={PROGRAM} />}
        {route === 'upload' && canAdd && <UploadPage />}
        {route === 'files' && <FilesPage />}
        {route === 'guide' && <GuidePage />}
      </div>

      <Footer/>
    </div>
  );
};