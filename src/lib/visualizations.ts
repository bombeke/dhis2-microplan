import type { ResolvedDateRange } from './exportRange';

/**
 * Reading DHIS2 saved analytical objects and turning one into the analytics
 * request that reproduces it.
 *
 * Two metadata resources are covered, because DHIS2 splits saved favourites
 * across them:
 *
 *  - `/api/visualizations`      — Data Visualizer favourites (pivot tables and
 *                                 charts). Always *aggregated* data.
 *  - `/api/eventVisualizations` — Event Visualizer / Line Listing favourites.
 *    These carry a `dataType`: `EVENTS` (a line list — one row per event,
 *    enrollment or tracked entity) or `AGGREGATED_VALUES` (counts/averages over
 *    event data).
 *
 * That split is also the grouping the Export page shows: **Aggregated** vs
 * **Events / Line list**.
 *
 * The *metadata* resource a favourite lives in is not the *analytics* endpoint
 * that returns its data — this is the trap the Export page exists to hide:
 *
 * | Favourite                                 | Analytics endpoint                             |
 * |-------------------------------------------|------------------------------------------------|
 * | visualization (any type)                  | `/api/analytics`                               |
 * | eventVisualization, EVENTS, EVENT         | `/api/analytics/events/query/{program}`        |
 * | eventVisualization, EVENTS, ENROLLMENT    | `/api/analytics/enrollments/query/{program}`   |
 * | eventVisualization, EVENTS, TRACKED_ENTITY_INSTANCE | `/api/analytics/trackedEntities/query/{type}` |
 * | eventVisualization, AGGREGATED_VALUES     | `/api/analytics/events/aggregate/{program}`    |
 *
 * Each of those takes a different set of parameters and qualifies its data
 * dimensions differently (see `eventDimensionParams`), which is why the request
 * builder returns a whole `AnalyticsRequest` — resource path included — rather
 * than just a list of dimensions.
 */
type Engine = { query: (q: unknown, opts?: { signal?: AbortSignal }) => Promise<any> };

/** Which metadata resource a favourite was read from. */
export type VisualizationSource = 'visualization' | 'eventVisualization';

/** How the Export page groups favourites in its list. */
export type VisualizationGroup = 'aggregated' | 'lineList';

export type EventOutputType = 'EVENT' | 'ENROLLMENT' | 'TRACKED_ENTITY_INSTANCE';
export type EventDataType = 'EVENTS' | 'AGGREGATED_VALUES';

export interface NamedRef {
  id: string;
  name?: string;
}

export interface VisualizationSummary {
  id: string;
  name: string;
  /** PIVOT_TABLE, LINE_LIST, COLUMN, … */
  type: string;
  source: VisualizationSource;
  group: VisualizationGroup;
  lastUpdated?: string;
  created?: string;
  description?: string;
  /** eventVisualizations only */
  outputType?: EventOutputType;
  dataType?: EventDataType;
  program?: NamedRef;
}

export interface VisualizationDimension {
  dimension: string;
  items?: { id: string; name?: string; displayName?: string }[];
  /** multi-program eventVisualizations qualify each dimension individually */
  program?: NamedRef;
  programStage?: NamedRef;
  /** repeatable-stage event selection, e.g. `{ indexes: [1, -1, 0] }` */
  repetition?: { indexes?: number[] };
}

export interface VisualizationDetail extends VisualizationSummary {
  columns?: VisualizationDimension[];
  rows?: VisualizationDimension[];
  filters?: VisualizationDimension[];
  /** org-unit selections DHIS2 stores outside `items` on older payloads */
  organisationUnitLevels?: number[];
  itemOrganisationUnitGroups?: { id: string }[];
  userOrganisationUnit?: boolean;
  userOrganisationUnitChildren?: boolean;
  userOrganisationUnitGrandChildren?: boolean;
  /** legacy relative-period flags (`{ lastMonth: true, … }`) */
  relativePeriods?: Record<string, boolean>;
  aggregationType?: string;
  skipRounding?: boolean;
  /** eventVisualizations only */
  programStage?: NamedRef;
  trackedEntityType?: NamedRef;
  programStatus?: string;
  eventStatus?: string;
  /** the favourite's own saved date window, used when no range is chosen */
  startDate?: string;
  endDate?: string;
}

export interface Pager {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
}

/* ------------------------------------------------------------------------- */
/* Metadata: listing and reading favourites                                   */
/* ------------------------------------------------------------------------- */

const LIST_FIELDS: Record<VisualizationSource, string> = {
  visualization: 'id,displayName~rename(name),type,lastUpdated,created,description',
  eventVisualization: [
    'id',
    'displayName~rename(name)',
    'type',
    'outputType',
    'dataType',
    'lastUpdated',
    'created',
    'description',
    'program[id,displayName~rename(name)]',
  ].join(','),
};

const SHARED_DETAIL_FIELDS = [
  'id',
  'displayName~rename(name)',
  'type',
  'lastUpdated',
  'created',
  'description',
  'columns[dimension,items[id,displayName~rename(name)],program[id,displayName~rename(name)],programStage[id,displayName~rename(name)],repetition[indexes]]',
  'rows[dimension,items[id,displayName~rename(name)],program[id,displayName~rename(name)],programStage[id,displayName~rename(name)],repetition[indexes]]',
  'filters[dimension,items[id,displayName~rename(name)],program[id,displayName~rename(name)],programStage[id,displayName~rename(name)],repetition[indexes]]',
  'organisationUnitLevels',
  'itemOrganisationUnitGroups[id]',
  'userOrganisationUnit',
  'userOrganisationUnitChildren',
  'userOrganisationUnitGrandChildren',
  'relativePeriods',
  'aggregationType',
];

const VISUALIZATION_DETAIL_FIELDS = [...SHARED_DETAIL_FIELDS, 'skipRounding'].join(',');

const EVENT_DETAIL_FIELDS = [
  ...SHARED_DETAIL_FIELDS,
  'outputType',
  'dataType',
  'program[id,displayName~rename(name)]',
  'programStage[id,displayName~rename(name)]',
  'programStatus',
  'eventStatus',
  'startDate',
  'endDate',
].join(',');

/**
 * `trackedEntityType` only exists on eventVisualization from the DHIS2 version
 * that introduced tracked-entity line lists. Asking an older server for it
 * fails the whole request with a 409, so it is requested separately and the
 * detail read falls back to the base field list when the server rejects it.
 */
const EVENT_DETAIL_FIELDS_WITH_TET = `${EVENT_DETAIL_FIELDS},trackedEntityType[id,displayName~rename(name)]`;

const RESOURCE: Record<VisualizationSource, string> = {
  visualization: 'visualizations',
  eventVisualization: 'eventVisualizations',
};

/**
 * Which group a favourite belongs to.
 *
 * `dataType` is the authority — an eventVisualization saved as
 * `AGGREGATED_VALUES` genuinely produces aggregate numbers and belongs beside
 * the pivot tables. Older payloads may omit it, so `LINE_LIST` is the fallback
 * signal.
 */
export function visualizationGroup(
  source: VisualizationSource,
  type?: string,
  dataType?: EventDataType
): VisualizationGroup {
  if (source === 'visualization') return 'aggregated';
  if (dataType === 'AGGREGATED_VALUES') return 'aggregated';
  if (dataType === 'EVENTS') return 'lineList';
  return type === 'LINE_LIST' ? 'lineList' : 'aggregated';
}

export const GROUP_LABEL: Record<VisualizationGroup, string> = {
  aggregated: 'Aggregated',
  lineList: 'Events / Line list',
};

/**
 * One page of saved favourites from one metadata resource, optionally narrowed
 * by name.
 *
 * The name filter is applied server-side (`name:ilike`) rather than over a
 * downloaded list: instances routinely hold thousands of favourites and the
 * app should never pull all of them just to search.
 */
export async function fetchVisualizationPage(
  engine: Engine,
  source: VisualizationSource,
  opts: { search?: string; page?: number; pageSize?: number; signal?: AbortSignal } = {}
): Promise<{ items: VisualizationSummary[]; pager: Pager }> {
  const search = opts.search?.trim();
  const pageSize = opts.pageSize ?? 10;
  const params: Record<string, unknown> = {
    fields: LIST_FIELDS[source],
    order: 'displayName:asc',
    page: opts.page ?? 1,
    pageSize,
  };
  if (search) params.filter = [`name:ilike:${search}`];

  const data: any = await engine.query(
    { list: { resource: RESOURCE[source], params } },
    { signal: opts.signal }
  );

  const res = data.list ?? {};
  const raw: any[] = res[RESOURCE[source]] ?? [];

  return {
    items: raw.map((v) => ({
      ...v,
      source,
      group: visualizationGroup(source, v.type, v.dataType),
    })),
    pager: res.pager ?? { page: 1, pageCount: 1, total: raw.length, pageSize },
  };
}

/** The full definition of one favourite, including its dimension items. */
export async function fetchVisualizationDetail(
  engine: Engine,
  source: VisualizationSource,
  id: string,
  signal?: AbortSignal
): Promise<VisualizationDetail> {
  const read = async (fields: string) => {
    const data: any = await engine.query(
      { v: { resource: `${RESOURCE[source]}/${id}`, params: { fields } } },
      { signal }
    );
    return data.v;
  };

  let raw: any;
  if (source === 'visualization') {
    raw = await read(VISUALIZATION_DETAIL_FIELDS);
  } else {
    try {
      raw = await read(EVENT_DETAIL_FIELDS_WITH_TET);
    } catch {
      // Older DHIS2: no trackedEntityType on eventVisualization. Tracked-entity
      // line lists can't exist there either, so nothing is lost by dropping it.
      raw = await read(EVENT_DETAIL_FIELDS);
    }
  }

  return { ...raw, source, group: visualizationGroup(source, raw?.type, raw?.dataType) };
}

/* ------------------------------------------------------------------------- */
/* Dimension items                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Legacy `relativePeriods` flags → the relative-period keywords the analytics
 * `pe` dimension understands. Visualizations saved by older DHIS2 versions (or
 * by the API directly) carry the period selection here instead of in
 * `rows/columns/filters[].items`, and would otherwise export as an empty grid.
 */
const RELATIVE_PERIOD_FLAGS: Record<string, string> = {
  thisDay: 'TODAY',
  yesterday: 'YESTERDAY',
  last3Days: 'LAST_3_DAYS',
  last7Days: 'LAST_7_DAYS',
  last14Days: 'LAST_14_DAYS',
  last30Days: 'LAST_30_DAYS',
  last60Days: 'LAST_60_DAYS',
  last90Days: 'LAST_90_DAYS',
  last180Days: 'LAST_180_DAYS',
  thisWeek: 'THIS_WEEK',
  lastWeek: 'LAST_WEEK',
  last4Weeks: 'LAST_4_WEEKS',
  last12Weeks: 'LAST_12_WEEKS',
  last52Weeks: 'LAST_52_WEEKS',
  weeksThisYear: 'WEEKS_THIS_YEAR',
  thisBiWeek: 'THIS_BIWEEK',
  lastBiWeek: 'LAST_BIWEEK',
  last4BiWeeks: 'LAST_4_BIWEEKS',
  thisMonth: 'THIS_MONTH',
  lastMonth: 'LAST_MONTH',
  last3Months: 'LAST_3_MONTHS',
  last6Months: 'LAST_6_MONTHS',
  last12Months: 'LAST_12_MONTHS',
  monthsThisYear: 'MONTHS_THIS_YEAR',
  thisBimonth: 'THIS_BIMONTH',
  lastBimonth: 'LAST_BIMONTH',
  last6BiMonths: 'LAST_6_BIMONTHS',
  biMonthsThisYear: 'BIMONTHS_THIS_YEAR',
  thisQuarter: 'THIS_QUARTER',
  lastQuarter: 'LAST_QUARTER',
  last4Quarters: 'LAST_4_QUARTERS',
  quartersThisYear: 'QUARTERS_THIS_YEAR',
  thisSixMonth: 'THIS_SIX_MONTH',
  lastSixMonth: 'LAST_SIX_MONTH',
  last2SixMonths: 'LAST_2_SIXMONTHS',
  thisYear: 'THIS_YEAR',
  lastYear: 'LAST_YEAR',
  last5Years: 'LAST_5_YEARS',
  last10Years: 'LAST_10_YEARS',
  thisFinancialYear: 'THIS_FINANCIAL_YEAR',
  lastFinancialYear: 'LAST_FINANCIAL_YEAR',
  last5FinancialYears: 'LAST_5_FINANCIAL_YEARS',
};

const relativePeriodKeywords = (flags?: Record<string, boolean>): string[] =>
  Object.entries(flags ?? {})
    .filter(([key, on]) => on && RELATIVE_PERIOD_FLAGS[key])
    .map(([key]) => RELATIVE_PERIOD_FLAGS[key]);

/**
 * Item ids for one stored dimension, folding in the org-unit selections DHIS2
 * keeps in sibling properties (`LEVEL-n`, `OU_GROUP-uid`, `USER_ORGUNIT*`).
 */
function itemIds(dim: VisualizationDimension, vis: VisualizationDetail): string[] {
  const ids = (dim.items ?? []).map((i) => i.id).filter(Boolean);

  if (dim.dimension === 'ou') {
    if (vis.userOrganisationUnit && !ids.includes('USER_ORGUNIT')) ids.push('USER_ORGUNIT');
    if (vis.userOrganisationUnitChildren && !ids.includes('USER_ORGUNIT_CHILDREN'))
      ids.push('USER_ORGUNIT_CHILDREN');
    if (vis.userOrganisationUnitGrandChildren && !ids.includes('USER_ORGUNIT_GRANDCHILDREN'))
      ids.push('USER_ORGUNIT_GRANDCHILDREN');
    for (const level of vis.organisationUnitLevels ?? []) {
      const token = `LEVEL-${level}`;
      if (!ids.includes(token)) ids.push(token);
    }
    for (const group of vis.itemOrganisationUnitGroups ?? []) {
      const token = `OU_GROUP-${group.id}`;
      if (!ids.includes(token)) ids.push(token);
    }
  }

  if (dim.dimension === 'pe') {
    for (const keyword of relativePeriodKeywords(vis.relativePeriods)) {
      if (!ids.includes(keyword)) ids.push(keyword);
    }
  }

  return ids;
}

/* ------------------------------------------------------------------------- */
/* Request building                                                           */
/* ------------------------------------------------------------------------- */

export interface AnalyticsRequest {
  /** app-runtime resource path, e.g. `analytics/events/query/IpHINAT79UW` */
  resource: string;
  /** repeated `dimension=` params, e.g. `['dx:a;b', 'ou:LEVEL-3']` */
  dimension: string[];
  /** repeated `filter=` params */
  filter: string[];
  /** endpoint-specific params merged into every page request */
  params: Record<string, string | number | boolean>;
  /** the visualization's own period was dropped for an explicit date range */
  replacedPeriod: boolean;
  /**
   * Query endpoints (events / enrollments / trackedEntities) only report a
   * `pageCount` when asked, and they do not accept `paging`.
   */
  totalPages: boolean;
  /** what the user is about to hit, shown on the page */
  endpointLabel: string;
  /** set when the favourite cannot be exported at all; nothing else is valid */
  error?: string;
}

/**
 * Dimensions that are not data items and must never be qualified with a
 * program or program stage. `ou`/`pe` are shared with aggregate analytics; the
 * rest are the event-specific pseudo-dimensions the Line Listing app saves.
 */
const PASSTHROUGH_DIMENSIONS = new Set([
  'ou',
  'pe',
  'dx',
  'co',
  'ao',
  'eventDate',
  'enrollmentDate',
  'incidentDate',
  'scheduledDate',
  'occurredDate',
  'completedDate',
  'lastUpdated',
  'created',
  'createdBy',
  'lastUpdatedBy',
]);

/**
 * Stored status dimensions use the object-model spelling; analytics documents
 * them in upper snake case (`dimension=PROGRAM_STATUS:ACTIVE`).
 */
const STATUS_DIMENSION_ALIAS: Record<string, string> = {
  eventStatus: 'EVENT_STATUS',
  programStatus: 'PROGRAM_STATUS',
};

const asParam = (name: string, ids: string[]): string =>
  ids.length ? `${name}:${ids.join(';')}` : name;

/**
 * Dimensions that put a time window on an event/enrollment query. One of these
 * (with items) or an explicit start/end date is required — without either, the
 * query endpoints reject the request, and a named reason beats a raw 409.
 */
const TIME_DIMENSIONS = new Set([
  'pe',
  'eventDate',
  'enrollmentDate',
  'incidentDate',
  'scheduledDate',
  'occurredDate',
  'completedDate',
  'lastUpdated',
  'created',
  'EVENT_DATE',
  'SCHEDULED_DATE',
  'CREATED',
  'COMPLETED',
]);

/** True when at least one built parameter constrains time and selects something. */
const constrainsTime = (params: string[]): boolean =>
  params.some((p) => {
    const [name, ...rest] = p.split(':');
    return rest.length > 0 && TIME_DIMENSIONS.has(name.split('.').pop() ?? name);
  });

/**
 * Qualify one stored event dimension for a given analytics endpoint, returning
 * one parameter value per repetition index.
 *
 * The qualification rules differ per endpoint and are the main reason a saved
 * line list cannot simply be replayed as-is:
 *
 *  - **events**        — data elements belong to the one program stage already
 *    named by `stage=`, so they stay bare (`vANAXwtLwcT`).
 *  - **enrollments**   — a data element *must* carry its stage
 *    (`edqlbukwRfQ.vANAXwtLwcT`); attributes stay bare. Repeatable stages index
 *    with brackets: `edqlbukwRfQ[-1].vANAXwtLwcT`.
 *  - **trackedEntities** — everything below the tracked entity carries its
 *    program too (`IpHINAT79UW.ZzYYXq4fJie.GQY2lXrypjO`).
 */
function eventDimensionParams(
  dim: VisualizationDimension,
  vis: VisualizationDetail,
  kind: EndpointKind
): string[] {
  const ids = itemIds(dim, vis);
  const alias = STATUS_DIMENSION_ALIAS[dim.dimension];
  if (alias) return [asParam(alias, ids)];
  // Already qualified by whoever saved it, or not a data item at all.
  if (PASSTHROUGH_DIMENSIONS.has(dim.dimension) || dim.dimension.includes('.'))
    return [asParam(dim.dimension, ids)];

  if (kind === 'eventQuery' || kind === 'eventAggregate') return [asParam(dim.dimension, ids)];

  const stage = dim.programStage?.id;
  const program = kind === 'trackedEntityQuery' ? (dim.program?.id ?? vis.program?.id) : undefined;

  // Indexes address repetitions of a repeatable stage; without a stage there is
  // nothing to index, and one bare parameter is the whole dimension.
  const indexes = stage ? (dim.repetition?.indexes ?? []) : [];
  const stageTokens = indexes.length ? indexes.map((i) => `${stage}[${i}]`) : stage ? [stage] : [];

  if (stageTokens.length === 0) {
    const name = [program, dim.dimension].filter(Boolean).join('.');
    return [asParam(name, ids)];
  }

  return stageTokens.map((token) =>
    asParam([program, token, dim.dimension].filter(Boolean).join('.'), ids)
  );
}

type EndpointKind =
  | 'aggregate'
  | 'eventQuery'
  | 'eventAggregate'
  | 'enrollmentQuery'
  | 'trackedEntityQuery';

/** Which analytics endpoint reproduces this favourite. */
export function endpointKind(vis: VisualizationDetail): EndpointKind {
  if (vis.source === 'visualization') return 'aggregate';
  if (vis.dataType === 'AGGREGATED_VALUES') return 'eventAggregate';
  switch (vis.outputType) {
    case 'ENROLLMENT':
      return 'enrollmentQuery';
    case 'TRACKED_ENTITY_INSTANCE':
      return 'trackedEntityQuery';
    default:
      return 'eventQuery';
  }
}

const ENDPOINT_LABEL: Record<EndpointKind, string> = {
  aggregate: 'Aggregate analytics',
  eventQuery: 'Event query analytics',
  eventAggregate: 'Event aggregate analytics',
  enrollmentQuery: 'Enrollment query analytics',
  trackedEntityQuery: 'Tracked entity query analytics',
};

const fail = (error: string): AnalyticsRequest => ({
  resource: '',
  dimension: [],
  filter: [],
  params: {},
  replacedPeriod: false,
  totalPages: false,
  endpointLabel: '—',
  error,
});

/**
 * Turn a saved favourite into the analytics query that reproduces it.
 *
 * When the user supplies an explicit date range we drop the `pe` dimension and
 * pass `startDate`/`endDate` instead — analytics rejects a request that carries
 * both. If `pe` was the only dimension there is nothing left to query by, so in
 * that (pathological) case the period is kept and the range ignored; callers
 * surface that via `replacedPeriod`.
 */
export function buildAnalyticsRequest(
  vis: VisualizationDetail,
  range: ResolvedDateRange | null
): AnalyticsRequest {
  const kind = endpointKind(vis);
  return kind === 'aggregate'
    ? buildAggregateRequest(vis, range)
    : buildEventRequest(vis, range, kind);
}

function buildAggregateRequest(
  vis: VisualizationDetail,
  range: ResolvedDateRange | null
): AnalyticsRequest {
  const param = (dim: VisualizationDimension) => asParam(dim.dimension, itemIds(dim, vis));

  const axisDims = [...(vis.columns ?? []), ...(vis.rows ?? [])];
  // A filter with no items ("filter=co") is rejected by analytics — the
  // dimension is present but selects nothing. On an axis the same bare form is
  // legal and means "break down by every option", so only filters are pruned.
  const filterDims = (vis.filters ?? []).filter((d) => itemIds(d, vis).length > 0);

  const useRange = !!range;
  const keep = (dim: VisualizationDimension) => !(useRange && dim.dimension === 'pe');

  let dimension = axisDims.filter(keep).map(param);
  let filter = filterDims.filter(keep).map(param);
  let replacedPeriod = useRange;

  // Nothing left to slice by — keep the period rather than send an empty query.
  if (dimension.length === 0 && filter.length === 0) {
    dimension = axisDims.map(param);
    filter = filterDims.map(param);
    replacedPeriod = false;
  }

  const params: Record<string, string | number | boolean> = {
    displayProperty: 'NAME',
    skipMeta: false,
    skipRounding: !!vis.skipRounding,
    paging: true,
  };
  if (replacedPeriod && range) {
    params.startDate = range.startDate;
    params.endDate = range.endDate;
  }

  return {
    resource: 'analytics',
    dimension,
    filter,
    params,
    replacedPeriod,
    totalPages: false,
    endpointLabel: `${ENDPOINT_LABEL.aggregate} · /api/analytics`,
  };
}

function buildEventRequest(
  vis: VisualizationDetail,
  range: ResolvedDateRange | null,
  kind: Exclude<EndpointKind, 'aggregate'>
): AnalyticsRequest {
  const programId = vis.program?.id;
  const tetId = vis.trackedEntityType?.id;

  if (kind === 'trackedEntityQuery' && !tetId)
    return fail(
      'This tracked-entity line list has no tracked entity type saved, so there is no ' +
        '/api/analytics/trackedEntities endpoint to call. Re-save it in the Line Listing app.'
    );
  if (kind !== 'trackedEntityQuery' && !programId)
    return fail(
      'This favourite has no program saved. Multi-program event visualizations cannot be ' +
        'exported from here — open it in the Line Listing app and save it against one program.'
    );

  const useRange = !!range;
  const isPeriod = (d: VisualizationDimension) => d.dimension === 'pe';

  const axisDims = [...(vis.columns ?? []), ...(vis.rows ?? [])];
  const filterDims = (vis.filters ?? []).filter((d) => itemIds(d, vis).length > 0);
  const keep = (d: VisualizationDimension) => !(useRange && isPeriod(d));

  const expand = (dims: VisualizationDimension[]) =>
    dims.flatMap((d) => eventDimensionParams(d, vis, kind));

  let dimension = expand(axisDims.filter(keep));
  let filter = expand(filterDims.filter(keep));
  let replacedPeriod = useRange;

  if (dimension.length === 0 && filter.length === 0) {
    dimension = expand(axisDims);
    filter = expand(filterDims);
    replacedPeriod = false;
  }

  const params: Record<string, string | number | boolean> = {};
  const resource = (() => {
    switch (kind) {
      case 'eventQuery':
        return `analytics/events/query/${programId}`;
      case 'eventAggregate':
        return `analytics/events/aggregate/${programId}`;
      case 'enrollmentQuery':
        return `analytics/enrollments/query/${programId}`;
      case 'trackedEntityQuery':
        return `analytics/trackedEntities/query/${tetId}`;
    }
  })();

  // The stage narrows an event query to one stage of the program; on the other
  // endpoints the stage travels with each data-element dimension instead.
  if ((kind === 'eventQuery' || kind === 'eventAggregate') && vis.programStage?.id)
    params.stage = vis.programStage.id;

  if (kind === 'trackedEntityQuery' && programId) params.program = programId;

  if (kind === 'eventAggregate') {
    params.displayProperty = 'NAME';
    params.skipMeta = false;
    params.skipRounding = !!vis.skipRounding;
    if (vis.outputType) params.outputType = vis.outputType;
    if (vis.aggregationType && vis.aggregationType !== 'DEFAULT')
      params.aggregationType = vis.aggregationType;
  }

  if (kind === 'trackedEntityQuery') params.displayProperty = 'NAME';

  // `completedOnly` is a visualization-model flag with no analytics parameter
  // behind it; the equivalent filter on these endpoints is the status pair.
  if (vis.programStatus) params.programStatus = vis.programStatus;
  if (vis.eventStatus && kind !== 'enrollmentQuery') params.eventStatus = vis.eventStatus;

  // Date window. The query endpoints take startDate/endDate; the tracked entity
  // endpoint has no such pair and expresses a window as a custom period on one
  // of its date fields, of which enrollment date is the one a line list is
  // normally read against.
  const start = replacedPeriod ? range?.startDate : vis.startDate;
  const end = replacedPeriod ? range?.endDate : vis.endDate;
  if (start && end) {
    if (kind === 'trackedEntityQuery') params.enrollmentDate = `${start}_${end}`;
    else {
      params.startDate = start;
      params.endDate = end;
    }
  }

  // Nothing bounds the query in time: the endpoint would reject it, so say why
  // here rather than surfacing a bare server error after a download attempt.
  if (kind !== 'trackedEntityQuery' && !start && !constrainsTime([...dimension, ...filter]))
    return fail(
      'This visualization has no period saved, and the event analytics endpoints need one. ' +
        'Choose “Since a date” or “Last N …” above.'
    );

  return {
    resource,
    dimension,
    filter,
    params,
    replacedPeriod,
    totalPages: kind !== 'eventAggregate',
    endpointLabel: `${ENDPOINT_LABEL[kind]} · /api/${resource}`,
  };
}

/* ------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* ------------------------------------------------------------------------- */

/** Human-readable summary of what a favourite is made of, for the UI. */
export function describeVisualization(vis: VisualizationDetail): string {
  const names = (dims?: VisualizationDimension[]) =>
    (dims ?? []).map((d) => d.dimension).join(', ') || '—';
  return `Columns: ${names(vis.columns)} · Rows: ${names(vis.rows)} · Filters: ${names(vis.filters)}`;
}

/** `LINE_LIST` → `Line list`, for tags and table cells. */
export function prettyType(type?: string): string {
  if (!type) return 'Unknown';
  const lower = type.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export const OUTPUT_TYPE_LABEL: Record<EventOutputType, string> = {
  EVENT: 'Events',
  ENROLLMENT: 'Enrollments',
  TRACKED_ENTITY_INSTANCE: 'Tracked entities',
};
