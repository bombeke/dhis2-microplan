import type { Coord, TrackerPoint } from '../types';
import type { CoordinateDimension } from './programCoordinates';
import {
  BIO_GROUP_KEY,
  BIO_GROUP_LABEL,
  ENROLLMENT_GROUP_KEY,
  ENROLLMENT_GROUP_LABEL,
  type DimensionOption,
} from './programDimensions';

/**
 * The enrollments analytics endpoint, used for three things in one pass:
 *
 *   /api/analytics/enrollments/query/{program}
 *     ?dimension=<coordinate dims>,<extra dims>,ou:<orgUnit>
 *     &headers=pi,tei,ouname,…,<same dims>
 *     &outputType=ENROLLMENT
 *     &includeMetadataDetails=true
 *
 *  1. **Map points** — every COORDINATE dimension becomes its own point set
 *     (one per enrollment row with a value in that column), so the UI can
 *     toggle each layer independently.
 *  2. **The data table** — the raw rows, with each column tagged with the group it
 *     belongs to (enrollment, bio data, or a program stage) so the table can
 *     render a grouped header instead of a wall of UIDs.
 *  3. **A profile per tracked entity** — the same row, pivoted into bio-data
 *     fields plus one section per program stage, which is what the map popup
 *     shows when a point is hovered or clicked.
 *
 * `extraDimensions` are the attributes / data elements the user picked in the
 * map filter bar. They carry no coordinates, so they never produce points —
 * they only widen the table and fill out the profile.
 */

type Engine = { query: (q: unknown) => Promise<any> };

export interface CoordinateAnalyticsResult {
  /** points grouped by the dimension id that produced them */
  pointsByDimension: Record<string, TrackerPoint[]>;
  /** analytics metaData.items (id -> { name, ... }) for labelling the overlay */
  metaDataItems: Record<string, { name?: string; [k: string]: unknown }>;
  /** the dimensions that actually yielded ≥1 point */
  nonEmptyDimensionIds: string[];
  table: AnalyticsTable;
  /** profileId (tracked entity, else enrollment) -> pivoted profile */
  profilesById: Record<string, EntityProfile>;
}

export type ColumnKind = 'identification' | 'attribute' | 'stageDataElement';

export interface AnalyticsTableColumn {
  name: string; // dimension/column id, e.g. "jJ82mWtkUW5" or "pi"
  label: string; // human label (from program metadata or metaData.items)
  /** group key: 'enrollment', 'attributes', or the program-stage id */
  groupKey: string;
  /** group label: 'Enrollment', 'Bio data', or the stage name */
  group: string;
  kind: ColumnKind;
  valueType?: string;
}

/** A contiguous run of columns sharing a group — drives the grouped header. */
export interface AnalyticsColumnGroup {
  key: string;
  label: string;
  kind: ColumnKind;
  /** index into `columns` where the run starts */
  start: number;
  span: number;
}

export interface AnalyticsTable {
  columns: AnalyticsTableColumn[];
  columnGroups: AnalyticsColumnGroup[];
  rows: string[][];
  total: number;
  /** true when the page cap was hit and more rows exist server-side */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Per-tracked-entity profile
// ---------------------------------------------------------------------------

export interface ProfileField {
  id: string;
  label: string;
  value: string;
  kind: ColumnKind;
  valueType?: string;
  stageId?: string;
}

export interface ProfileStageSection {
  id: string;
  name: string;
  fields: ProfileField[];
  /** how many of this section's fields actually carry a value */
  filled: number;
}

export interface EntityProfile {
  /** tracked entity id when analytics returns one, else the enrollment id */
  id: string;
  trackedEntity?: string;
  enrollment?: string;
  orgUnitName?: string;
  enrolledAt?: string;
  lastUpdated?: string;
  createdBy?: string;
  lastUpdatedBy?: string;
  status?: string;
  /** enrollment-level columns (org unit, dates, who recorded it) */
  identification: ProfileField[];
  /** tracked-entity attributes */
  bio: ProfileField[];
  /** one section per program stage present in the response */
  stages: ProfileStageSection[];
}

/**
 * Friendly labels for the enrollment columns.
 *
 * This maps what a response *may* contain, which is a wider set than what we
 * ask for: `enrollment` and `trackedentity` are the names some DHIS2 versions
 * report `pi` and `tei` under in the response grid. Labelling them costs
 * nothing — requesting them does not (see REQUESTED_BASE_HEADERS).
 */
const BASE_HEADER_LABELS: Record<string, string> = {
  pi: 'Enrollment',
  enrollment: 'Enrollment',
  tei: 'Tracked entity',
  trackedentity: 'Tracked entity',
  ouname: 'Organisation unit',
  enrollmentdate: 'Enrolled',
  lastupdated: 'Last updated',
  createdbydisplayname: 'Recorded by',
  lastupdatedbydisplayname: 'Last updated by',
  programstatus: 'Status',
};

/**
 * The enrollment columns we actually put in `headers=`. Order is the table
 * order.
 *
 * Only the canonical names belong here. DHIS2 validates `headers=` strictly:
 * an entry that is not a column of the enrollment grid fails the whole request
 * with `409 E7230 "Header param \`x\` does not exist"` rather than being
 * ignored — so listing `enrollment`/`trackedentity` alongside `pi`/`tei` as
 * version-insurance broke every request instead of covering both spellings.
 * The response-side aliases above still let us read either name back.
 */
const REQUESTED_BASE_HEADERS = [
  'pi',
  'tei',
  'ouname',
  'enrollmentdate',
  'lastupdated',
  'createdbydisplayname',
  'lastupdatedbydisplayname',
  'programstatus',
];

/** Every header name we can label, for resolving a response's columns. */
const KNOWN_BASE_HEADERS = Object.keys(BASE_HEADER_LABELS);

/** Identity columns: needed to key a profile, never worth showing in one. */
const ID_HEADERS = new Set(['pi', 'enrollment', 'tei', 'trackedentity']);

/**
 * Which enrollment columns exist still varies across the versions this app
 * supports (2.40+), and a single unknown one rejects the entire query. Rather
 * than pin a version matrix that will drift, read the offending name out of
 * the error and retry without it — the map degrades by one column instead of
 * going blank.
 */
const UNKNOWN_HEADER_RE = /header param\s*[`'"]?([\w.]+)[`'"]?\s*does not exist/i;

/** The header set this app shipped with for years — the last-resort fallback. */
const MINIMAL_BASE_HEADERS = [
  'ouname',
  'createdbydisplayname',
  'lastupdatedbydisplayname',
  'lastupdated',
];

type HeaderRejection = { kind: 'named'; header: string } | { kind: 'unknown' } | null;

function headerRejection(error: unknown): HeaderRejection {
  const e = error as any;
  // @dhis2/app-runtime puts the parsed error body on `details`
  const body = e?.details ?? e;
  const message = String(body?.message ?? e?.message ?? '');
  const match = message.match(UNKNOWN_HEADER_RE);
  if (match) return { kind: 'named', header: match[1] };
  // E7230 is "header param does not exist" — if the wording changes and the
  // name can't be read out, we still know the header set is what it objects to.
  return body?.errorCode === 'E7230' ? { kind: 'unknown' } : null;
}

/**
 * The order the table shows columns in, as indexes into `columns`, with
 * duplicates removed.
 *
 * Order — **bio data, then the program stages, then the enrollment columns**:
 *
 *  - *Bio data* first, because that is who the row is about, and it is what a
 *    reader scans to recognise a record. The analytics response leads with the
 *    enrollment's own columns instead, which is the least interesting end.
 *  - *Stages* next, in the order they first appear, which is the programme's
 *    own stage order. Coordinate columns are attributes or stage data elements
 *    like any other, so they land inside whichever of these groups owns them
 *    rather than forming a group of their own.
 *  - *Enrollment* (org unit, dates, who recorded it) last: it describes the
 *    record rather than the person, and it is hidden by default anyway.
 *
 * Two kinds of duplicate are dropped, keeping the first occurrence:
 *  - the same dimension id appearing twice (metadata that lists an attribute
 *    more than once, or a header echoed by the server), and
 *  - two columns with the same label inside one group — the "ID" case, where a
 *    picked field repeats one already present. Labels are only compared within
 *    a group, because two stages legitimately having a "Dose given" each are
 *    different columns, not a duplicate.
 *
 * Indexes are returned rather than columns because the row arrays are
 * positional: dropping or reordering `columns` itself would silently
 * mis-align every cell.
 */
export function displayColumnOrder(columns: AnalyticsTableColumn[]): number[] {
  const seenName = new Set<string>();
  const seenLabel = new Set<string>();
  const byGroup = new Map<string, number[]>();

  columns.forEach((c, i) => {
    if (seenName.has(c.name)) return;
    const labelKey = `${c.groupKey}\u0000${c.label.trim().toLowerCase()}`;
    if (seenLabel.has(labelKey)) return;
    seenName.add(c.name);
    seenLabel.add(labelKey);
    if (!byGroup.has(c.groupKey)) byGroup.set(c.groupKey, []);
    byGroup.get(c.groupKey)!.push(i);
  });

  const bio = byGroup.get(BIO_GROUP_KEY) ?? [];
  const enrollment = byGroup.get(ENROLLMENT_GROUP_KEY) ?? [];
  const stages = [...byGroup.entries()]
    .filter(([key]) => key !== BIO_GROUP_KEY && key !== ENROLLMENT_GROUP_KEY)
    .flatMap(([, indexes]) => indexes);

  return [...bio, ...stages, ...enrollment];
}

/** Parse a DHIS2 analytics COORDINATE cell into [lng,lat]. */
export function parseCoordinateCell(value: unknown): Coord | null {
  if (value == null || value === '') return null;
  // COORDINATE values arrive as "[lng,lat]" or "lng,lat" (occasionally an array)
  if (Array.isArray(value) && value.length >= 2) {
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }
  const s = String(value).trim().replace(/^\[/, '').replace(/\]$/, '');
  const parts = s.split(',').map((p) => Number(p.trim()));
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1]];
  }
  return null;
}

/**
 * Extract the username enclosed in the LAST parentheses of a display value.
 * DHIS2 "…byDisplayName" columns look like "John Golla (golla)"; the "All users"
 * option label is likewise "Name (username)". Returns the inner text lowercased,
 * or null when there are no parentheses.
 */
export function extractParenValue(value: unknown): string | null {
  if (value == null) return null;
  const m = String(value).match(/\(([^)]*)\)\s*$/);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Collapse the per-column group tags into the runs a grouped header needs. */
export function buildColumnGroups(columns: AnalyticsTableColumn[]): AnalyticsColumnGroup[] {
  const groups: AnalyticsColumnGroup[] = [];
  columns.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.key === c.groupKey) last.span += 1;
    else groups.push({ key: c.groupKey, label: c.group, kind: c.kind, start: i, span: 1 });
  });
  return groups;
}

/** A coordinate dimension, described as a plain dimension option. */
function optionFromCoordinateDimension(d: CoordinateDimension): DimensionOption {
  return {
    id: d.dimensionId,
    name: d.name,
    valueType: 'COORDINATE',
    kind: d.kind,
    elementId: d.dataElementId ?? d.attributeId ?? d.dimensionId,
    stageId: d.programStageId,
    stageName: d.programStageName,
    sortOrder: 0,
  };
}

/**
 * Single pass over the enrollments analytics endpoint that produces the
 * per-dimension coordinate points, the grouped table, and a profile per
 * tracked entity.
 */
export async function fetchEnrollmentAnalytics(
  engine: Engine,
  opts: {
    program: string;
    orgUnit: string;
    /** COORDINATE dimensions — these produce the map points */
    dimensions: CoordinateDimension[];
    /** attributes / data elements the user picked: extra columns only */
    extraDimensions?: DimensionOption[];
    /** dimension id -> metadata, for labelling and grouping columns */
    dimensionLookup?: Map<string, DimensionOption>;
    period?: string;
    periodType?: string | null;
    userFilter?: string | null;
    pageSize?: number;
    maxPages?: number;
  }
): Promise<CoordinateAnalyticsResult> {
  const coordDims = opts.dimensions;
  const pointsByDimension: Record<string, TrackerPoint[]> = {};
  for (const d of coordDims) pointsByDimension[d.dimensionId] = [];

  let metaDataItems: CoordinateAnalyticsResult['metaDataItems'] = {};
  let columns: AnalyticsTableColumn[] = [];
  const tableRows: string[][] = [];
  const profilesById: Record<string, EntityProfile> = {};

  const emptyTable = (): AnalyticsTable => ({
    columns,
    columnGroups: buildColumnGroups(columns),
    rows: tableRows,
    total: 0,
  });

  // The picked dimensions are requested alongside the coordinate ones; a
  // dimension the user picked that *is* a coordinate dimension must not be
  // requested twice, hence the dedupe by dimension id.
  const seen = new Set<string>();
  const requested: DimensionOption[] = [];
  for (const d of coordDims) {
    if (seen.has(d.dimensionId)) continue;
    seen.add(d.dimensionId);
    requested.push(optionFromCoordinateDimension(d));
  }
  for (const d of opts.extraDimensions ?? []) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    requested.push(d);
  }

  if (requested.length === 0) {
    return {
      pointsByDimension,
      metaDataItems,
      nonEmptyDimensionIds: [],
      table: emptyTable(),
      profilesById,
    };
  }

  let period: any = opts.period ? { lastUpdated: opts.period } : {};
  if (opts?.periodType === 'RANGE' && opts.period?.includes('_')) {
    period = opts.period ? { lastUpdated: opts.period } : {};
  }
  const userFilter = opts.userFilter ? opts.userFilter.toLowerCase() : null;

  const dimHeaders = requested.map((d) => d.id);
  const dimensionParam = [...dimHeaders, `ou:${opts.orgUnit}`].join(',');

  // The map and the data table draw from this one response, so the ceiling is
  // how much of a selection either can show. 100×20 capped it at 2,000 rows,
  // which a single ward's month can exceed — the table then silently showed a
  // fraction of what was there. 500×40 raises the ceiling to 20,000 for the
  // same number of round trips; the loop still stops at the first short page,
  // so a small selection costs exactly one request.
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 40;

  const lookup = opts.dimensionLookup;
  /** column index of each requested dimension, resolved from page 1's headers */
  const colIndex: Record<string, number> = {};
  const baseIndex: Record<string, number> = {};
  let truncated = false;

  /**
   * Enrollment columns still being asked for. A header the server rejects is
   * removed here on the first page and stays removed for the rest of the run,
   * so the negotiation costs at most one extra request per missing column.
   */
  let activeBaseHeaders = [...REQUESTED_BASE_HEADERS];
  let triedMinimalHeaders = false;

  const queryPage = async (page: number): Promise<any> => {
    // Bounded: each retry strictly shrinks the header set, plus one last
    // attempt with the minimal set.
    for (let attempt = 0; attempt <= REQUESTED_BASE_HEADERS.length + 1; attempt++) {
      try {
        const data: any = await engine.query({
          a: {
            resource: `analytics/enrollments/query/${opts.program}`,
            params: {
              dimension: dimensionParam,
              headers: [...activeBaseHeaders, ...dimHeaders].join(','),
              outputType: 'ENROLLMENT',
              displayProperty: 'NAME',
              totalPages: 'false',
              rowContext: 'true',
              includeMetadataDetails: 'true',
              ...period,
              pageSize,
              page,
            },
          },
        });
        return data.a;
      } catch (error) {
        const rejection = headerRejection(error);
        if (!rejection) throw error;

        if (rejection.kind === 'named') {
          // A rejected *dimension* is the caller's problem, not ours to patch
          // around — only enrollment columns are negotiable here.
          if (!activeBaseHeaders.includes(rejection.header)) throw error;
          console.warn(
            `[analytics] this DHIS2 has no "${rejection.header}" enrollment header; continuing without it`
          );
          activeBaseHeaders = activeBaseHeaders.filter((h) => h !== rejection.header);
          continue;
        }

        if (triedMinimalHeaders) throw error;
        triedMinimalHeaders = true;
        console.warn('[analytics] header set rejected; falling back to the minimal set');
        activeBaseHeaders = [...MINIMAL_BASE_HEADERS];
      }
    }
    throw new Error(
      'analytics/enrollments/query: could not agree a set of enrollment headers with the server'
    );
  };

  for (let page = 1; page <= maxPages; page++) {
    const resp = await queryPage(page);
    const respHeaders: any[] = resp?.headers ?? [];
    const rows: any[][] = resp?.rows ?? [];

    if (page === 1) {
      metaDataItems = resp?.metaData?.items ?? {};
      columns = respHeaders.map((h) => describeColumn(h, lookup, metaDataItems));
      for (const d of requested) {
        const idx = respHeaders.findIndex((h) => h.name === d.id || h.column === d.id);
        if (idx >= 0) colIndex[d.id] = idx;
      }
      // Resolve against every name we can label, not just the ones we asked
      // for: a server that answers `pi` under the name `enrollment` still gets
      // read correctly by the alias pass below.
      for (const name of KNOWN_BASE_HEADERS) {
        const idx = respHeaders.findIndex((h) => h.name === name || h.column === name);
        if (idx >= 0) baseIndex[name] = idx;
      }
      // Whichever spelling the server answered with becomes the canonical one,
      // so the row readers below only ever ask for `pi` and `tei`.
      if (baseIndex.pi == null && baseIndex.enrollment != null) {
        baseIndex.pi = baseIndex.enrollment;
      }
      if (baseIndex.tei == null && baseIndex.trackedentity != null) {
        baseIndex.tei = baseIndex.trackedentity;
      }
    }

    if (rows.length === 0) break;

    const cell = (row: any[], name: string): string => {
      const i = baseIndex[name];
      if (i == null) return '';
      const v = row[i];
      return v == null ? '' : String(v);
    };

    rows.forEach((row, r) => {
      if (userFilter) {
        const createdBy = extractParenValue(cell(row, 'createdbydisplayname'));
        const lastUpdatedBy = extractParenValue(cell(row, 'lastupdatedbydisplayname'));
        if (createdBy !== userFilter && lastUpdatedBy !== userFilter) return;
      }

      tableRows.push(row.map((v) => (v == null ? '' : String(v))));

      const enrollmentId = cell(row, 'pi') || `r${page}-${r}`;
      const trackedEntity = cell(row, 'tei') || undefined;
      const profileId = trackedEntity || enrollmentId;

      profilesById[profileId] = buildProfile({
        profileId,
        trackedEntity,
        enrollment: cell(row, 'pi') || undefined,
        orgUnitName: cell(row, 'ouname') || undefined,
        enrolledAt: cell(row, 'enrollmentdate') || undefined,
        lastUpdated: cell(row, 'lastupdated') || undefined,
        createdBy: cell(row, 'createdbydisplayname') || undefined,
        lastUpdatedBy: cell(row, 'lastupdatedbydisplayname') || undefined,
        status: cell(row, 'programstatus') || undefined,
        columns,
        row,
      });

      for (const d of coordDims) {
        const ci = colIndex[d.dimensionId];
        if (ci == null) continue;
        const coordinate = parseCoordinateCell(row[ci]);
        if (!coordinate) continue;
        pointsByDimension[d.dimensionId].push({
          id: `${d.dimensionId}:${enrollmentId}`,
          kind: d.kind === 'attribute' ? 'enrollment' : 'event',
          programStage: d.programStageId,
          programStageName: d.programStageName,
          coordinate,
          name: d.name,
          value: 1,
          trackedEntity,
          enrollment: cell(row, 'pi') || undefined,
          profileId,
          orgUnitName: cell(row, 'ouname') || undefined,
        });
      }
    });

    if (rows.length < pageSize) break;
    if (page === maxPages) truncated = true;
  }

  const nonEmptyDimensionIds = coordDims
    .map((d) => d.dimensionId)
    .filter((id) => pointsByDimension[id].length > 0);

  return {
    pointsByDimension,
    metaDataItems,
    nonEmptyDimensionIds,
    table: {
      columns,
      columnGroups: buildColumnGroups(columns),
      rows: tableRows,
      total: tableRows.length,
      truncated,
    },
    profilesById,
  };
}

/** Tag one analytics response header with its label, group and kind. */
function describeColumn(
  header: any,
  lookup: Map<string, DimensionOption> | undefined,
  metaDataItems: Record<string, { name?: string; [k: string]: unknown }>
): AnalyticsTableColumn {
  const name: string = header?.name ?? header?.column ?? '';

  const base = BASE_HEADER_LABELS[name];
  if (base) {
    return {
      name,
      label: base,
      groupKey: ENROLLMENT_GROUP_KEY,
      group: ENROLLMENT_GROUP_LABEL,
      kind: 'identification',
    };
  }

  const option = lookup?.get(name);
  if (option) {
    return {
      name,
      label: option.name,
      groupKey: option.kind === 'attribute' ? BIO_GROUP_KEY : option.stageId ?? BIO_GROUP_KEY,
      group: option.kind === 'attribute' ? BIO_GROUP_LABEL : option.stageName ?? 'Stage',
      kind: option.kind,
      valueType: option.valueType,
    };
  }

  // Unknown column: label it from the analytics metadata, and place stage
  // data elements ("stageId.deId") under their stage when the metadata names it.
  if (name.includes('.')) {
    const [stageId, elementId] = name.split('.');
    const de = (metaDataItems[elementId] as any)?.name ?? elementId;
    const stage = (metaDataItems[stageId] as any)?.name as string | undefined;
    return {
      name,
      label: de,
      groupKey: stageId,
      group: stage ?? 'Stage',
      kind: 'stageDataElement',
    };
  }

  return {
    name,
    label: (metaDataItems[name] as any)?.name ?? header?.column ?? name,
    groupKey: BIO_GROUP_KEY,
    group: BIO_GROUP_LABEL,
    kind: 'attribute',
  };
}

/** Pivot one analytics row into a grouped profile. */
function buildProfile(args: {
  profileId: string;
  trackedEntity?: string;
  enrollment?: string;
  orgUnitName?: string;
  enrolledAt?: string;
  lastUpdated?: string;
  createdBy?: string;
  lastUpdatedBy?: string;
  status?: string;
  columns: AnalyticsTableColumn[];
  row: any[];
}): EntityProfile {
  const identification: ProfileField[] = [];
  const bio: ProfileField[] = [];
  const stageMap = new Map<string, ProfileStageSection>();

  args.columns.forEach((c, i) => {
    const raw = args.row[i];
    const value = raw == null ? '' : String(raw);
    const field: ProfileField = {
      id: c.name,
      label: c.label,
      value,
      kind: c.kind,
      valueType: c.valueType,
      stageId: c.kind === 'stageDataElement' ? c.groupKey : undefined,
    };
    if (c.kind === 'identification') {
      // the ids themselves are plumbing, not something to show in a popup
      if (ID_HEADERS.has(c.name)) return;
      identification.push(field);
    } else if (c.kind === 'attribute') {
      bio.push(field);
    } else {
      let section = stageMap.get(c.groupKey);
      if (!section) {
        section = { id: c.groupKey, name: c.group, fields: [], filled: 0 };
        stageMap.set(c.groupKey, section);
      }
      section.fields.push(field);
      if (value !== '') section.filled += 1;
    }
  });

  return {
    id: args.profileId,
    trackedEntity: args.trackedEntity,
    enrollment: args.enrollment,
    orgUnitName: args.orgUnitName,
    enrolledAt: args.enrolledAt,
    lastUpdated: args.lastUpdated,
    createdBy: args.createdBy,
    lastUpdatedBy: args.lastUpdatedBy,
    status: args.status,
    identification,
    bio,
    stages: [...stageMap.values()],
  };
}
