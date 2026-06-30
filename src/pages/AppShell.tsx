import React from 'react';
import { useRoute } from '../hooks/useRoute';
import { useSearchWorker } from '../hooks/useSearchWorker';
import { useCurrentUser } from '../hooks/useMicroplans';
import { GlobalSearch } from '../components/GlobalSearch';
import { MapPage } from './MapPage';
import { UploadPage } from './UploadPage';
import { FilesPage } from './FilesPage';

/**
 * Top-level shell: a slim nav bar plus a hash-routed page area.
 *
 *  #/map     — filterable coverage map (maplibre-gl layers)
 *  #/upload  — dedicated upload page (parses + saves to dataStore)
 *  #/files   — catalogue of uploaded microplans
 *
 * `program` is the DHIS2 tracker program whose enrollment/event points are
 * drawn on the map. Wire it from app config / a program picker as needed.
 */
const PROGRAM: string | undefined = undefined; // set to your tracker program UID

export const AppShell: React.FC = () => {
  const [route, navigate] = useRoute();
  const searchWorker = useSearchWorker();
  const user = useCurrentUser();

  const NavLink: React.FC<{ to: 'map' | 'upload' | 'files'; children: React.ReactNode }> = ({
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

  return (
    <div className="app-shell">
      <header className="app-shell__bar">
        <h1>Outreach Microplan &amp; Coverage</h1>
        <nav className="nav">
          <NavLink to="map">Map</NavLink>
          <NavLink to="files">Files</NavLink>
          <NavLink to="upload">Upload</NavLink>
        </nav>
        <div className="app-shell__spacer" />
        {route === 'map' && <GlobalSearch worker={searchWorker} />}
        {user && <span className="app-shell__user">{user.name}</span>}
      </header>

      <div className="app-shell__page">
        {route === 'map' && <MapPage program={PROGRAM} />}
        {route === 'upload' && <UploadPage />}
        {route === 'files' && <FilesPage />}
      </div>
    </div>
  );
};
