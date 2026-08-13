import React, { useEffect, useMemo, useState } from 'react';
import {
  Table,
  TableHead,
  TableRowHead,
  TableCellHead,
  TableBody,
  TableRow,
  TableCell,
  Pagination,
} from '@dhis2/ui';
import { useMicroplanIndex, useDeleteMicroplan } from '../hooks/useMicroplans';
import { useStore } from '../store/useStore';
import { getPeriodName, RELATIVE_PERIODS } from '../lib/periods';
import { useRoute } from '../hooks/useRoute';
import { useUserPermissions } from '@/hooks/useUserPermissions';



const PAGE_SIZES = ['10', '25', '50', '100'];
const DEFAULT_PAGE_SIZE = 10;

/**
 * Catalogue of uploaded microplans (read from the dataStore index key). Each
 * row can be activated onto the map or deleted. Activating navigates to the
 * map page with that microplan toggled on.
 *
 * Paged with @dhis2/ui's Pagination — the control only shows once there are
 * more files than fit on one page, and the page size is selectable
 * (10/25/50/100) like the rest of the DHIS2 platform's list views.
 */
export const FilesPage: React.FC = () => {
  const { data: files, isLoading, error } = useMicroplanIndex();
  const { permissions, isLoading: permLoading } = useUserPermissions();

  const canDeletePlan = permissions?.canAny(['F_DELETE_MICROPLAN', 'ALL']);

  const del = useDeleteMicroplan();
  const { activeMicroplanIds, toggleMicroplan } = useStore();
  const [, navigate] = useRoute();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const total = files?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Clamp the current page when the page size or the underlying file count
  // changes (e.g. after a delete drops the last row off the last page).
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const pageFiles = useMemo(() => {
    if (!files) return [];
    const start = (page - 1) * pageSize;
    return files.slice(start, start + pageSize);
  }, [files, page, pageSize]);

  const showOnMap = (id: string) => {
    if (!activeMicroplanIds.includes(id)) toggleMicroplan(id);
    navigate('map');
  };

  return (
    <div className="page page--files">
      <div className="page__bar">
        <h2>Uploaded microplans</h2>
        <button className="btn" onClick={() => navigate('upload')}>+ Upload new</button>
      </div>

      {isLoading && <p className="muted">Loading from dataStore…</p>}
      {error && <p className="error">Failed to load: {(error as Error).message}</p>}
      {files && files.length === 0 && (
        <p className="muted">No microplans uploaded yet. Use “Upload new” to add one.</p>
      )}

      {files && files.length > 0 && (
        <>
          <Table className="filetable">
            <TableHead>
              <TableRowHead>
                <TableCellHead>File</TableCellHead>
                <TableCellHead>Program</TableCellHead>
                <TableCellHead>Period</TableCellHead>
                <TableCellHead>Org unit</TableCellHead>
                <TableCellHead>Level</TableCellHead>
                <TableCellHead>Teams</TableCellHead>
                <TableCellHead>Settlements</TableCellHead>
                <TableCellHead>Uploaded by</TableCellHead>
                <TableCellHead>Created</TableCellHead>
                <TableCellHead></TableCellHead>
              </TableRowHead>
            </TableHead>
            <TableBody>
              {pageFiles.map((f) => (
                <TableRow key={f.id} className={activeMicroplanIds.includes(f.id) ? 'is-active' : undefined}>
                  <TableCell><strong>{f.fileName}</strong></TableCell>
                  <TableCell>{f.programName || <span className="muted">—</span>}</TableCell>
                  <TableCell>{getPeriodName(f.period).displayName}</TableCell>
                  <TableCell>{f.orgUnitName}</TableCell>
                  <TableCell>{f.level}</TableCell>
                  <TableCell>{f.teamCount}</TableCell>
                  <TableCell>{f.settlementCount}</TableCell>
                  <TableCell>{f.uploadedBy}</TableCell>
                  <TableCell>{new Date(f.uploadedAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="filetable__actions">
                      <button className="btn btn--sm" onClick={() => showOnMap(f.id)}>
                        {activeMicroplanIds.includes(f.id) ? 'On map ✓' : 'Show on map'}
                      </button>
                      {canDeletePlan && (
                        <button
                          className="btn btn--sm btn--danger"
                          onClick={() => {
                            if (confirm(`Delete "${f.fileName}"?`)) del.mutate(f.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {total > pageSize && (
            <Pagination
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              pageSizes={PAGE_SIZES}
              total={total}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          )}
        </>
      )}
    </div>
  );
};
