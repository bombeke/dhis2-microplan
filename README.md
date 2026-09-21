# Outreach Microplan & Coverage — DHIS2 App

A production-oriented DHIS2 application for routine-immunisation / outreach
microplanning in Nigeria. It ingests team microplans, maps the settlements each
team is assigned, pulls georeferenced tracker & event data from DHIS2, and flags
any data point that falls outside a team's assigned settlements.

Built on the **Vite-based DHIS2 App Platform** (`@dhis2/cli-app-scripts` v12+,
which replaced Create React App with Vite + React 18) using `@dhis2/app-runtime`,
`@dhis2/ui`, `@dhis2/analytics`, MapLibre GL, Supercluster, FlexSearch, Turf,
and React Query / Zustand.

---

## Running

Requires Node 24+ and pnpm 11+ (both pinned via `.nvmrc` / `.tool-versions`
and the `packageManager` field). With Corepack you don't install pnpm globally:

```bash
corepack enable                 # activates the pinned pnpm 11.9.0
nvm use                         # or: mise install — picks up Node 24
pnpm install
pnpm start            # Vite dev server via d2-app-scripts, proxies to DHIS2
pnpm build            # production bundle (.zip installable in App Management)
```

On first run the dev server asks for your DHIS2 base URL and credentials; nothing
is hard-coded. `d2.config.js` declares the app manifest and `minDHIS2Version`.

The production build has been verified end to end: `pnpm build` runs the
platform's Vite 5 pipeline, emits the search worker as its own ES-module chunk
(`assets/search.worker-*.js`), bundles the app-shell, and produces an installable
`build/bundle/microplan-<version>.zip`.

### Build tooling notes (Vite + pnpm 11)

A few things that are easy to get wrong with this stack, already handled here:

- **Vite is the platform's build tool, not ours.** App Platform v12 uses Vite
  under the hood; `vite` is a dependency of `@dhis2/cli-app-scripts`, not of this
  app. `vite.config.extensions.mts` therefore avoids importing `vite` at runtime
  (it uses a JSDoc `@type {import('vite').UserConfig}` for editor hints) and is
  merged in via `viteConfigExtensions` in `d2.config.js`.
- **Flat node_modules is required.** The bootstrapped app-shell imports packages
  like `typeface-roboto` from the project root, which pnpm's isolated layout
  hides. `shamefullyHoist: true` (in `pnpm-workspace.yaml`) flattens the tree so
  the Vite/Rollup build resolves them.
- **pnpm 11 reads settings from `pnpm-workspace.yaml`, not `.npmrc`.** Hoisting,
  `engineStrict`, `preferFrozenLockfile`, peer-dependency rules, and build-script
  approvals all live there as camelCase keys. The kebab-case `.npmrc` equivalents
  are silently ignored by pnpm 11.
- **Build-script approvals.** pnpm 10+ blocks lifecycle scripts by default;
  `esbuild`, `core-js`, `core-js-pure`, and `@dhis2/cli-helpers-engine` are
  pre-approved under `onlyBuiltDependencies` / `allowBuilds`.

---

## How each requirement is met

**1. Upload CSV/Excel microplan.**
`src/lib/ingest.ts` parses CSV (PapaParse) and Excel (SheetJS) and maps messy
real-world headers onto canonical fields via an alias table. Each week column is
interpreted as an "active this week" flag (date, tick, or X all count).
`buildTeamPlans` collapses rows into per-team plans, supporting *one team → many
settlements per week* and *settlement-within-ward* containment.

**2. Team codes by ward + per-team settlement map.**
`components/TeamWardList.tsx` groups teams under their ward; hover/click reveals
the settlements that team visits with name, population, and visit weeks, and
selects the team. `components/MapView.tsx` draws those settlements as polygons.

**2b. Extra data columns, the data table, and per-entity profiles.**
`src/lib/programDimensions.ts` resolves a programme's tracked-entity attributes
and program-stage data elements once, grouped as *Bio data* plus one group per
stage, and is shared by the filter bar's picker, the analytics request, the
table's grouped header and the map popup. `src/lib/analyticsEnrollments.ts`
makes one `analytics/enrollments/query` pass serve three purposes: coordinate
columns become map points, every column is tagged with its group for the table,
and each row is pivoted into an `EntityProfile`. Coordinate dimensions and all
bio-data attributes are always requested; stage data elements are opt-in via the
filter bar, so a many-stage programme doesn't turn each pan into a 300-column
query. `src/hooks/useTrackedEntityProfile.ts` then fetches the *complete*
record (`tracker/trackedEntities/{id}`) on demand when a popup is opened, which
is what fills in repeated stage events analytics flattens away.

**3. Tracker / analytics extraction + clustering.**
`src/lib/dhis2Data.ts` pulls enrollment geometry (`tracker/enrollments`),
program-stage event geometry (`tracker/events`), and an analytics-events fallback
(`analytics/events/query`). `src/lib/clustering.ts` builds a Supercluster index
per layer — enrollments, each program stage, and flagged points — so counts are
rendered by stage and remain smooth at 100k+ points. Out-of-bounds points get a
distinct red cluster layer.

**4. Retrieve 50k+ wards by State → Ward → facility.**
`src/hooks/useOrgUnits.ts` never loads the full tree. Each level is fetched on
demand and cached by parent (React Query). `streamWards` pages the full ward set
server-side to feed the search index. The org-unit tree stays responsive because
expansion and search are decoupled.

**5. DHIS2 periods.**
`src/lib/periods.ts` models the common relative periods and resolves each to a
concrete ISO range that drives both analytics (`pe`) and tracker
(`occurredAfter/Before`) queries. `components/PeriodCard.tsx` is a lightweight,
instant-switching card (we deliberately avoid the heavier analytics
PeriodDimension widget for snappiness).

**6. Settlement GeoJSON from GRID3 / ArcGIS / PMTiles / orgUnit + 260k search.**
`src/lib/geoSources.ts` is a pluggable provider interface with three
implementations: GRID3/ArcGIS FeatureServer (attribute-filtered, ward-bounded
GeoJSON), PMTiles (locally hosted vector tiles streamed straight into MapLibre),
and DHIS2 orgUnit geometry. Search over 260k settlements + 50k wards runs in a
**web worker** (`src/workers/search.worker.ts`) using FlexSearch, with the index
serialised to **IndexedDB** so reloads are instant and the app works offline.
`components/GlobalSearch.tsx` is debounced type-ahead against that worker.

**7. Flag out-of-bounds data points.**
`src/lib/flagging.ts` runs Turf point-in-polygon for every point against the
*assigned* settlements of that point's team. In-bounds points pass; outsiders are
flagged and annotated with the nearest assigned settlement and its distance
(Haversine) for triage. Flagged points appear both as a red map layer
(MapView) and in a virtualised side table (`components/FlagTable.tsx`,
`@tanstack/react-virtual`) that stays light at tens of thousands of rows.

**8. Export analytics data (CSV/JSON).**
`src/lib/visualizations.ts` lists favourites from **both** metadata resources —
`/api/visualizations` (Data Visualizer) and `/api/eventVisualizations` (Line
Listing) — with server-side `name:ilike` search and paging, and groups them for
the UI as *Aggregated* vs *Events / Line list* (an eventVisualization's
`dataType` decides, not the resource it came from). It then rebuilds each
favourite's analytics query from its stored `columns`/`rows`/`filters`, folding
in the org-unit selections DHIS2 keeps beside `items` (`LEVEL-n`,
`OU_GROUP-uid`, `USER_ORGUNIT*`) and the legacy `relativePeriods` flags.

The metadata resource is *not* the download endpoint, and each endpoint
qualifies data dimensions differently — that mapping is the module's real job:

| Favourite | Endpoint | Dimension form |
|---|---|---|
| visualization (any type) | `analytics` | `dx:a;b` |
| eventVisualization, `EVENTS` + `EVENT` | `analytics/events/query/{program}` | bare uid, stage via `stage=` |
| eventVisualization, `EVENTS` + `ENROLLMENT` | `analytics/enrollments/query/{program}` | `{stage}[{idx}].{de}` |
| eventVisualization, `EVENTS` + `TRACKED_ENTITY_INSTANCE` | `analytics/trackedEntities/query/{tetype}` | `{program}.{stage}[{idx}].{de}` |
| eventVisualization, `AGGREGATED_VALUES` | `analytics/events/aggregate/{program}` | bare uid + `outputType` |

`src/lib/exportRange.ts` resolves the user's range — *since a date*, or *last N
days/weeks/months/years* for any N — into explicit `startDate`/`endDate`, which
replace the favourite's `pe` dimension (the tracked-entity endpoint has no
start/end pair, so the range lands on `enrollmentDate` as a custom period).
`src/lib/analyticsExport.ts` pages whichever endpoint the request names, **500
rows per chunk** under one `AbortSignal` (query endpoints need `totalPages=true`
before they report a page count), resolves dimension uids to names via
`metaData.items`, and serialises to CSV (PapaParse) or JSON.
`pages/ExportPage.tsx` is the two-column UI — a sticky picker beside the
four-step configuration — and the Export button unlocks only once every chunk
has landed.

---

## Styling

Tailwind v4 (`@tailwindcss/vite`), with the palette declared once in
`src/styles.css` under `@theme` — `bg-panel`, `text-muted`, `border-line`,
`shadow-float` and friends all resolve from there. Tailwind v4 also emits every
`@theme` entry as a `:root` custom property, so the remaining hand-written CSS
reads the same values and the two cannot drift.

The map workspace — filter bar, the four filter dropdowns, layer cards, the
profile card, the analytics sheet, the map page and the app shell — is styled
with utilities on the elements themselves; `src/lib/ui.ts` holds the shared
recipes so four near-identical popovers stay identical. The older pages
(Upload, Microplans, Export, Settings, Guide) keep their hand-written CSS in
`src/styles.css`.

What deliberately stays in CSS is markup this app doesn't render: the `<th>`
inside `@dhis2/ui`'s `DataTable`, maplibre's popup chrome, and the `is-active`
state of a DHIS2 `Button`.

## Performance posture

- Search index lives off the main thread (worker) and persists to IndexedDB.
- Map clustering is recomputed on `moveend` against the visible bbox only.
- Org-unit retrieval is lazy + parent-cached; wards are paged, never bulk-loaded
  into the DOM.
- Long lists (flag table, settlement results) are virtualised.
- Server-state (React Query) and UI-state (Zustand) are kept separate.

## Project layout

```
src/
  lib/        ui (shared Tailwind recipes),
              ingest, geoSources, flagging, clustering, periods, dhis2Data,
              programDimensions + programCoordinates + analyticsEnrollments
              (program metadata -> analytics request -> points, table, profiles),
              visualizations + analyticsExport + exportRange (analytics export),
              microplanStore + microplanSettings (dataStore persistence)
  hooks/      useOrgUnits (lazy tree), useSearchWorker (Comlink), useVisualizations,
              useProgramDimensions, useSelectedOrgUnitLayers, useTrackedEntityProfile,
              useUserPermissions, useMicroplanSettings, useUserRoles, useUserGroups
  workers/    search.worker (FlexSearch + IndexedDB)
  components/ UploadPanel, TeamWardList, Dhis2Map, MapFilterBar, GroupedMultiSelect,
              TrackedEntityProfileCard, MapFloatingCard, AnalyticsDataPanel,
              LayerControl, GlobalSearch, ExportDateRange, settings/ (admin screens)
  pages/      AppShell (orchestration), Map/Files/Upload/Export/Guide/Settings pages
  docs/       USER_GUIDE.md (rendered in-app from the app bar's ? button)
  store/      Zustand store
  types/      shared domain types

d2.config.js                 app manifest + viteConfigExtensions pointer
vite.config.extensions.mts   Vite overrides (es worker, @/ alias, dep prebundle)
pnpm-workspace.yaml          pnpm 11 settings (hoist, engine, build approvals)
.nvmrc / .tool-versions      Node 24 pin (nvm / asdf / mise)
```

## Access control

Microplan authorities (`F_VIEW_MICROPLAN`, `F_ADD_MICROPLAN`,
`F_DELETE_MICROPLAN`, `F_DOWNLOAD_MICROPLAN`, `F_READ_GPS_MICROPLAN`,
`F_ADMIN_MICROPLAN`) are declared as `customAuthorities` in `d2.config.js` and
resolved by `hooks/useUserPermissions.ts` in two layers:

1. The user's real DHIS2 authorities from `/api/me` (`ALL` short-circuits
   everything).
2. A fallback grant table at `dataStore/microplan/settings`, mapping those
   authorities onto DHIS2 user roles and user groups, plus app-level group
   membership. Edited from the in-app **Settings** page, which itself requires
   `F_ADMIN_MICROPLAN`.

The fallback is strictly additive — it can widen access but never revoke an
authority DHIS2 grants, so the DHIS2 permission model stays authoritative. It
exists because granting a custom authority the proper way needs rights over
DHIS2 user roles that microplan programme staff often don't hold. See
`lib/microplanSettings.ts` for the stored shape and `src/docs/USER_GUIDE.md`
§7 for the administrator-facing documentation.

Bootstrapping is deliberately not possible from inside the app: the first
`F_ADMIN_MICROPLAN` has to come from a DHIS2 user role.

## Configuration notes

- **GRID3/ArcGIS**: set the FeatureServer layer URL in Settings; the provider
  filters by `ward_name`. Adjust the field names to your layer's schema.
- **PMTiles**: host the `.pmtiles` archive on your CDN; set its URL and
  `sourceLayer`. MapLibre reads it via the `pmtiles://` protocol handler.
- **orgUnit geometry**: set the settlement org-unit level; polygons come from the
  org-unit `geometry` field.
