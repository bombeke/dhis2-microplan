import React from 'react';
import { useMicroplanIndex, useDeleteMicroplan } from '../hooks/useMicroplans';
import { useStore } from '../store/useStore';
import { RELATIVE_PERIODS } from '../lib/periods';
import { useRoute } from '../hooks/useRoute';

const periodName = (id: string) => RELATIVE_PERIODS.find((p) => p.id === id)?.name ?? id;

/**
 * Catalogue of uploaded microplans (read from the dataStore index key). Each
 * row can be activated onto the map or deleted. Activating navigates to the
 * map page with that microplan toggled on.
 */
export const FilesPage: React.FC = () => {
  const { data: files, isLoading, error } = useMicroplanIndex();
  const del = useDeleteMicroplan();
  const { activeMicroplanIds, toggleMicroplan } = useStore();
  const [, navigate] = useRoute();

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
        <table className="filetable">
          <thead>
            <tr>
              <th>File</th><th>Period</th><th>Org unit</th><th>Lvl</th>
              <th>Teams</th><th>Settlements</th><th>Uploaded by</th><th>When</th><th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className={activeMicroplanIds.includes(f.id) ? 'is-active' : ''}>
                <td><strong>{f.fileName}</strong></td>
                <td>{periodName(f.period)}</td>
                <td>{f.orgUnitName}</td>
                <td>{f.level}</td>
                <td>{f.teamCount}</td>
                <td>{f.settlementCount}</td>
                <td>{f.uploadedBy}</td>
                <td>{new Date(f.uploadedAt).toLocaleDateString()}</td>
                <td className="filetable__actions">
                  <button className="btn btn--sm" onClick={() => showOnMap(f.id)}>
                    {activeMicroplanIds.includes(f.id) ? 'On map ✓' : 'Show on map'}
                  </button>
                  <button
                    className="btn btn--sm btn--danger"
                    onClick={() => {
                      if (confirm(`Delete "${f.fileName}"?`)) del.mutate(f.id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
