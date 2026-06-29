import { fileURLToPath, URL } from 'node:url'

/**
 * Vite config extension, merged into @dhis2/cli-app-scripts' own Vite config
 * (App Platform v12+). The exported object must satisfy Vite's UserConfig
 * interface.
 *
 * We intentionally avoid importing anything from `vite` (not even a type):
 * under pnpm's isolated node_modules, `vite` belongs to cli-app-scripts, not
 * to this app, so a project-root import won't resolve and the platform's
 * config loader (esbuild) chokes on it. A plain object is all that's needed.
 * The JSDoc `@type` gives editors the same IntelliSense a type import would,
 * with no runtime or resolution cost.
 *
 * Why each piece is here:
 *  - worker.format 'es': the search index runs in a module worker created with
 *    `new Worker(new URL('…', import.meta.url), { type: 'module' })`. Vite needs
 *    the ES worker format to emit it correctly in the production build.
 *  - resolve.alias: lets source import from '@/lib/…' instead of long relative
 *    paths. Keep this in sync with tsconfig's paths.
 *  - optimizeDeps.include: pre-bundle the heavier ESM map/geo libs so the dev
 *    server doesn't pay a re-optimize cost on first navigation.
 *  - assetsInclude: ship .pmtiles archives placed under the app as static
 *    assets if you bundle a local copy (remote URLs are unaffected).
 *
 * @type {import('vite').UserConfig}
 */
const config = {
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: [
      'maplibre-gl',
      'pmtiles',
      'supercluster',
      'flexsearch',
      'comlink',
      '@turf/boolean-point-in-polygon',
      '@turf/bbox',
      '@turf/centroid',
    ],
  },
  assetsInclude: ['**/*.pmtiles'],
}

export default config
