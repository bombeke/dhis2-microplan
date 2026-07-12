import React, { useState } from 'react';
import { AnalyticsTable } from '@/lib/analyticsEnrollments';

/**
 * A modern button pinned at the bottom of the map. On click it opens a clean
 * data table of the underlying analytics rows (analytics/enrollments/query),
 * matching the current program / org unit / period / user / dimension filters.
 * Fetch is lazy — nothing is requested until the panel is opened.
 */
export const AnalyticsDataPanel: React.FC<{
  program?: string;
  orgUnitId: string | null;
  period?: string | null;
  userFilter?: string | null;
  tableResult?: AnalyticsTable;
}> = ({ program, orgUnitId, period, userFilter, tableResult: data }) => {
  const [open, setOpen] = useState(false);
  const enabled = !!program && !!orgUnitId && !!period && !!userFilter;
  console.log("disabled:",enabled);

  return (
    <>
      <button
        className="datapanel__fab"
        onClick={() => setOpen((o) => !o)}
        disabled={!enabled}
        title={!enabled ? 'Select a program and org unit first' : 'View the underlying data'}
      >
        <span className="datapanel__fab-icon">▤</span>
        {open ? 'Hide data' : 'View data'}
        {data ? <span className="datapanel__fab-count">{data.total}</span> : null}
      </button>

      {open && (
        <div className="datapanel">
          <div className="datapanel__head">
            <span className="datapanel__title">
              Analytics data{data ? ` · ${data.total} row(s)` : ''}
            </span>
            <button className="datapanel__close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>

          <div className="datapanel__body">
            {data && data.rows.length === 0 && (
              <div className="datapanel__state">No rows for the current selection.</div>
            )}
            {data && data.rows.length > 0 && (
              <div className="datapanel__scroll">
                <table className="datatable">
                  <thead>
                    <tr>
                      {data.columns.map((c) => (
                        <th key={c.name}>{c.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell, j) => (
                          <td key={j}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
