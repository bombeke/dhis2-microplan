import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDataEngine } from '@dhis2/app-runtime';
import {
  Button,
  ButtonStrip,
  CheckboxField,
  CircularLoader,
  IconDownload24,
  IconTable16,
  IconList16,
  InputField,
  LinearLoader,
  NoticeBox,
  Pagination,
  SegmentedControl,
  Tab,
  TabBar,
  Table,
  TableBody,
  TableCell,
  TableCellHead,
  TableHead,
  TableRow,
  TableRowHead,
  Tag,
} from '@dhis2/ui';
import {
  useDebouncedValue,
  useVisualizationDetail,
  useVisualizationList,
} from '../hooks/useVisualizations';
import { ExportDateRange } from '../components/ExportDateRange';
import {
  DEFAULT_EXPORT_RANGE,
  describeExportRange,
  rangeFileToken,
  resolveExportRange,
  validateExportRange,
  type ExportDateRange as Range,
} from '../lib/exportRange';
import {
  GROUP_LABEL,
  OUTPUT_TYPE_LABEL,
  buildAnalyticsRequest,
  describeVisualization,
  prettyType,
  type VisualizationGroup,
  type VisualizationSource,
  type VisualizationSummary,
} from '../lib/visualizations';
import {
  DEFAULT_PAGE_SIZE,
  downloadFile,
  exportFileName,
  fetchAnalyticsChunked,
  recordColumns,
  toCsvString,
  toJsonString,
  toRecords,
  type AnalyticsGrid,
  type DownloadProgress,
} from '../lib/analyticsExport';

type ExportFormat = 'csv' | 'json';
type Phase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

const LIST_PAGE_SIZE = 8;
const PREVIEW_ROWS = 8;

/**
 * The tabs list by metadata resource, which is *almost* the aggregated /
 * line-list split the user sees — the exception being an event visualization
 * saved as `AGGREGATED_VALUES`, aggregate data that lives in
 * `/api/eventVisualizations` and so appears under Events / Line list. Listing
 * by resource is what keeps one pager per tab (see useVisualizations.ts), and
 * the row's own "Aggregated" badge tells the truth in that one case.
 */
const GROUP_HINT: Record<VisualizationGroup, string> = {
  aggregated:
    'Pivot tables and charts saved in Data Visualizer. Exported through /api/analytics — one row per dimension combination.',
  lineList:
    'Line lists and event charts saved in Event Visualizer / Line Listing. Exported through the event, enrollment or tracked-entity analytics endpoints — one row per record.',
};

/** Short badges describing a row, so the list reads without opening anything. */
const RowBadges: React.FC<{ item: VisualizationSummary }> = ({ item }) => (
  <>
    <Tag neutral>{prettyType(item.type)}</Tag>
    {item.outputType && <Tag>{OUTPUT_TYPE_LABEL[item.outputType]}</Tag>}
    {item.source === 'eventVisualization' && item.dataType === 'AGGREGATED_VALUES' && (
      <Tag>Aggregated</Tag>
    )}
  </>
);

/**
 * Export page: pick a saved DHIS2 favourite — a pivot table or chart from Data
 * Visualizer, or a line list from Event Visualizer — optionally narrow it to a
 * date range, pull the whole result set down in chunks, then write it out as
 * CSV or JSON.
 *
 * The download is deliberately a separate step from the export: a wide pivot
 * table or a long line list can be tens of thousands of rows and many requests,
 * so the user sees the chunk progress and can cancel, and the **Export** button
 * only lights up once a complete, consistent result set is in hand. Changing
 * the favourite, the range, or the ID option discards it again rather than
 * letting someone export a file that doesn't match the controls on screen.
 *
 * The layout is two columns: what you are exporting stays on the left while
 * you configure and run the export on the right, so the selection never
 * scrolls out of sight behind a long preview.
 */
export const ExportPage: React.FC = () => {
  const engine = useDataEngine();

  // --- step 1: choose a favourite ---------------------------------------
  const [group, setGroup] = useState<VisualizationGroup>('aggregated');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [listPage, setListPage] = useState(1);
  const [selected, setSelected] = useState<{ source: VisualizationSource; id: string } | null>(
    null
  );

  // Both lists are queried on every search so each tab can show a live count —
  // that is what tells a user their favourite is in the *other* tab instead of
  // looking like it doesn't exist. The inactive tab is always asked for page 1:
  // its count is the same whichever page is requested, and pinning it there
  // keeps one cache entry per search instead of one per search × page.
  const aggregated = useVisualizationList(
    'visualization',
    debouncedSearch,
    group === 'aggregated' ? listPage : 1,
    LIST_PAGE_SIZE
  );
  const lineList = useVisualizationList(
    'eventVisualization',
    debouncedSearch,
    group === 'lineList' ? listPage : 1,
    LIST_PAGE_SIZE
  );
  const list = group === 'aggregated' ? aggregated : lineList;

  const detail = useVisualizationDetail(selected?.source ?? null, selected?.id ?? null);

  // A new search or a tab change resets to page 1 — otherwise a narrow result
  // set lands the user on an empty page 4.
  useEffect(() => setListPage(1), [debouncedSearch, group]);

  // --- step 2: date range -----------------------------------------------
  const [range, setRange] = useState<Range>(DEFAULT_EXPORT_RANGE);
  const rangeError = validateExportRange(range);
  const resolvedRange = useMemo(() => resolveExportRange(range), [range]);

  const request = useMemo(
    () => (detail.data ? buildAnalyticsRequest(detail.data, resolvedRange) : null),
    [detail.data, resolvedRange]
  );

  // --- step 3: chunked download -----------------------------------------
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [grid, setGrid] = useState<AnalyticsGrid | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // --- step 4: export ----------------------------------------------------
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [includeIds, setIncludeIds] = useState(true);

  const resetDownload = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setGrid(null);
    setProgress(null);
    setErrorMsg(null);
    setPhase('idle');
  }, []);

  // Any change to what would be fetched invalidates what was fetched.
  useEffect(() => {
    resetDownload();
  }, [
    selected?.id,
    selected?.source,
    range.mode,
    range.startDate,
    range.lastN,
    range.unit,
    resetDownload,
  ]);

  // Leaving the page mid-download shouldn't leave requests in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const startDownload = async () => {
    if (!request || request.error || rangeError) return;
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase('running');
    setErrorMsg(null);
    setProgress(null);
    setGrid(null);

    try {
      const result = await fetchAnalyticsChunked(engine as any, request, {
        pageSize: DEFAULT_PAGE_SIZE,
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted) return;
      setGrid(result);
      setPhase('done');
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === 'AbortError') {
        setPhase('cancelled');
        return;
      }
      setErrorMsg(e?.message ?? String(e));
      setPhase('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancelDownload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase('cancelled');
  };

  const columns = useMemo(
    () => (grid ? recordColumns(grid, { includeIds }) : []),
    [grid, includeIds]
  );
  const records = useMemo(() => (grid ? toRecords(grid, { includeIds }) : []), [grid, includeIds]);

  const doExport = () => {
    if (!grid || !detail.data || !request) return;
    const vis = detail.data;
    const token = rangeFileToken(range);
    if (format === 'csv') {
      downloadFile(
        toCsvString(records, columns),
        exportFileName(vis.name, token, 'csv'),
        'text/csv'
      );
    } else {
      downloadFile(
        toJsonString({
          visualization: {
            id: vis.id,
            name: vis.name,
            type: vis.type,
            source: vis.source,
            outputType: vis.outputType,
          },
          endpoint: request.endpointLabel,
          generatedAt: new Date().toISOString(),
          dateRange: describeExportRange(range),
          rowCount: records.length,
          columns,
          rows: records,
        }),
        exportFileName(vis.name, token, 'json'),
        'application/json'
      );
    }
  };

  const items = list.data?.items ?? [];
  const pager = list.data?.pager;
  const downloading = phase === 'running';
  const canDownload = !!request && !request.error && !rangeError && !detail.isLoading;

  const percent = (() => {
    if (!progress) return 0;
    if (progress.rowsTotal) return Math.min(100, (progress.rowsFetched / progress.rowsTotal) * 100);
    if (progress.chunkCount) return Math.min(100, (progress.chunk / progress.chunkCount) * 100);
    return 0;
  })();

  const tabCount = (q: typeof aggregated) =>
    q.data?.pager ? ` (${q.data.pager.total})` : q.isLoading ? '' : ' (0)';

  return (
    <div className="page page--export">
      <header className="page__head">
        <div>
          <h2>Export analytics data</h2>
          <p className="page__lead">
            Download the data behind any saved DHIS2 visualization — an aggregated{' '}
            <strong>pivot table or chart</strong>, or an event{' '}
            <strong>line list</strong> — as CSV or JSON. Large results are fetched in chunks of{' '}
            {DEFAULT_PAGE_SIZE} rows.
          </p>
        </div>
      </header>

      <div className="export__layout">
        {/* ---- step 1: the picker, pinned beside the configuration ------ */}
        <section className="card export__picker">
          <div className="card__head">
            <h3>
              <span className="card__step">1</span> Choose a visualization
            </h3>
          </div>

          <div className="card__body">
            <InputField
              label="Search by name"
              type="search"
              name="visualization-search"
              placeholder="Start typing a name…"
              clearable
              loading={list.isFetching && !!debouncedSearch}
              value={search}
              onChange={({ value }) => setSearch(value ?? '')}
            />

            <TabBar>
              <Tab
                icon={<IconTable16 />}
                selected={group === 'aggregated'}
                onClick={() => setGroup('aggregated')}
              >
                {`${GROUP_LABEL.aggregated}${tabCount(aggregated)}`}
              </Tab>
              <Tab
                icon={<IconList16 />}
                selected={group === 'lineList'}
                onClick={() => setGroup('lineList')}
              >
                {`${GROUP_LABEL.lineList}${tabCount(lineList)}`}
              </Tab>
            </TabBar>

            <p className="muted export__hint">{GROUP_HINT[group]}</p>

            {list.isLoading && (
              <div className="card__center">
                <CircularLoader small />
              </div>
            )}

            {list.error && (
              <NoticeBox error title="Could not load visualizations">
                {(list.error as Error).message}
              </NoticeBox>
            )}

            {!list.isLoading && items.length === 0 && (
              <p className="muted">
                {debouncedSearch
                  ? `Nothing in ${GROUP_LABEL[group]} matches “${debouncedSearch}”.`
                  : `No ${GROUP_LABEL[group].toLowerCase()} visualizations are shared with your account on this instance.`}
              </p>
            )}

            {items.length > 0 && (
              <ul className="vizlist">
                {items.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      className={`vizlist__item ${selected?.id === v.id ? 'is-selected' : ''}`}
                      onClick={() => setSelected({ source: v.source, id: v.id })}
                      disabled={downloading}
                    >
                      <span className="vizlist__name">{v.name}</span>
                      <span className="vizlist__tags">
                        <RowBadges item={v} />
                      </span>
                      <span className="vizlist__meta">
                        {v.program?.name ? `${v.program.name} · ` : ''}
                        {v.lastUpdated
                          ? `Updated ${new Date(v.lastUpdated).toLocaleDateString()}`
                          : v.id}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {pager && pager.pageCount > 1 && (
              <Pagination
                page={pager.page}
                pageCount={pager.pageCount}
                pageSize={pager.pageSize}
                total={pager.total}
                hidePageSizeSelect
                disabled={downloading}
                onPageChange={setListPage}
              />
            )}
          </div>
        </section>

        <div className="export__config">
          {/* ---- what is selected ------------------------------------- */}
          {!selected && (
            <NoticeBox title="Nothing selected yet">
              Pick a visualization on the left. Its dimensions, the analytics endpoint it will be
              read from, and the export options all appear here.
            </NoticeBox>
          )}

          {detail.isLoading && (
            <div className="card">
              <div className="card__center">
                <CircularLoader small />
              </div>
            </div>
          )}

          {detail.error && (
            <NoticeBox error title="Could not load that visualization">
              {(detail.error as Error).message}
            </NoticeBox>
          )}

          {detail.data && (
            <section className="card selected">
              <div className="card__head">
                <h3>{detail.data.name}</h3>
                <span className="selected__tags">
                  <RowBadges item={detail.data} />
                </span>
              </div>
              <div className="card__body">
                {detail.data.description && <p className="muted">{detail.data.description}</p>}
                <dl className="selected__facts">
                  <div>
                    <dt>Dimensions</dt>
                    <dd>{describeVisualization(detail.data)}</dd>
                  </div>
                  {detail.data.program?.name && (
                    <div>
                      <dt>Program</dt>
                      <dd>
                        {detail.data.program.name}
                        {detail.data.programStage?.name
                          ? ` · ${detail.data.programStage.name}`
                          : ''}
                      </dd>
                    </div>
                  )}
                  {detail.data.trackedEntityType?.name && (
                    <div>
                      <dt>Entity type</dt>
                      <dd>{detail.data.trackedEntityType.name}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Read from</dt>
                    <dd>
                      <code>{request?.endpointLabel ?? '—'}</code>
                    </dd>
                  </div>
                </dl>

                {request?.error && (
                  <NoticeBox error title="This visualization can't be exported">
                    {request.error}
                  </NoticeBox>
                )}

                {request && !request.error && (
                  <details className="selected__raw">
                    <summary>Request details</summary>
                    <pre>
                      {[
                        `resource: ${request.resource}`,
                        ...request.dimension.map((d) => `dimension: ${d}`),
                        ...request.filter.map((f) => `filter: ${f}`),
                        ...Object.entries(request.params).map(([k, v]) => `${k}: ${v}`),
                      ].join('\n')}
                    </pre>
                  </details>
                )}
              </div>
            </section>
          )}

          {/* ---- step 2 ------------------------------------------------ */}
          <section className="card">
            <div className="card__head">
              <h3>
                <span className="card__step">2</span> Date range
              </h3>
            </div>
            <div className="card__body">
              <ExportDateRange value={range} onChange={setRange} disabled={downloading} />
              {resolvedRange && (
                <p className="muted">
                  {detail.data?.group === 'lineList'
                    ? "The line list's own period is replaced by this range."
                    : "The visualization's own period dimension is replaced by this range."}
                </p>
              )}
            </div>
          </section>

          {/* ---- step 3 ------------------------------------------------ */}
          <section className="card">
            <div className="card__head">
              <h3>
                <span className="card__step">3</span> Download the data
              </h3>
            </div>
            <div className="card__body">
              <ButtonStrip>
                <Button
                  primary
                  disabled={!canDownload || downloading}
                  loading={downloading}
                  onClick={startDownload}
                >
                  {downloading ? 'Downloading…' : grid ? 'Download again' : 'Download data'}
                </Button>
                {downloading && (
                  <Button secondary onClick={cancelDownload}>
                    Cancel
                  </Button>
                )}
              </ButtonStrip>

              {!selected && <p className="muted">Pick a visualization to enable the download.</p>}

              {(downloading || progress) && (
                <div className="progress">
                  <LinearLoader amount={percent} width="100%" />
                  <p className="muted">
                    {progress
                      ? `Chunk ${progress.chunk}${
                          progress.chunkCount ? ` of ${progress.chunkCount}` : ''
                        } · ${progress.rowsFetched.toLocaleString()}${
                          progress.rowsTotal ? ` of ${progress.rowsTotal.toLocaleString()}` : ''
                        } rows`
                      : 'Starting…'}
                  </p>
                </div>
              )}

              {phase === 'cancelled' && (
                <NoticeBox warning title="Download cancelled">
                  Nothing was exported. Press <strong>Download data</strong> to start again.
                </NoticeBox>
              )}
              {phase === 'error' && (
                <NoticeBox error title="Download failed">
                  {errorMsg}
                </NoticeBox>
              )}
              {phase === 'done' && grid && (
                <NoticeBox valid title="Download complete">
                  {grid.rows.length.toLocaleString()} rows in {grid.chunks} chunk
                  {grid.chunks === 1 ? '' : 's'} — {describeExportRange(range)}.
                </NoticeBox>
              )}
            </div>
          </section>

          {/* ---- step 4 ------------------------------------------------ */}
          <section className="card">
            <div className="card__head">
              <h3>
                <span className="card__step">4</span> Export
              </h3>
            </div>
            <div className="card__body">
              <div className="export__options">
                <div>
                  <label className="field__label">Export type</label>
                  <SegmentedControl
                    selected={format}
                    onChange={({ value }) => setFormat(value as ExportFormat)}
                    options={[
                      { label: 'CSV', value: 'csv' },
                      { label: 'JSON', value: 'json' },
                    ]}
                  />
                </div>
                <CheckboxField
                  label="Include dimension item IDs"
                  checked={includeIds}
                  onChange={({ checked }) => setIncludeIds(!!checked)}
                />
              </div>

              <ButtonStrip>
                <Button primary icon={<IconDownload24 />} disabled={!grid} onClick={doExport}>
                  Export {format.toUpperCase()}
                </Button>
              </ButtonStrip>

              {!grid && (
                <p className="muted">
                  The Export button turns on once all chunks have finished downloading.
                </p>
              )}

              {grid && records.length > 0 && (
                <div className="preview">
                  <p className="preview__head">
                    Preview — first {Math.min(PREVIEW_ROWS, records.length)} of{' '}
                    {records.length.toLocaleString()} rows
                  </p>
                  <div className="preview__scroll">
                    <Table>
                      <TableHead>
                        <TableRowHead>
                          {columns.map((c) => (
                            <TableCellHead key={c}>{c}</TableCellHead>
                          ))}
                        </TableRowHead>
                      </TableHead>
                      <TableBody>
                        {records.slice(0, PREVIEW_ROWS).map((r, i) => (
                          <TableRow key={i}>
                            {columns.map((c) => (
                              <TableCell key={c}>{r[c]}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {grid && records.length === 0 && (
                <NoticeBox warning title="No rows">
                  This visualization returned no data for{' '}
                  {describeExportRange(range).toLowerCase()}. Try a wider date range.
                </NoticeBox>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
