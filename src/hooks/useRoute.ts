import { useEffect, useState, useCallback } from 'react';

/**
 * Tiny hash-based router — no react-router dependency. The DHIS2 app-shell is
 * happy with hash routes and this keeps the bundle lean. Routes are simple
 * string paths like '#/map', '#/create', '#/upload', '#/files', '#/export'.
 */
export type Route = 'map' | 'create' | 'upload' | 'files' | 'export' | 'guide' | 'settings';

const ROUTES: Route[] = ['map', 'create', 'upload', 'files', 'export', 'guide', 'settings'];

const parse = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, '').split('/')[0];
  return (ROUTES as string[]).includes(h) ? (h as Route) : 'map';
};

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(parse());

  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    window.location.hash = `#/${r}`;
  }, []);

  return [route, navigate];
}
