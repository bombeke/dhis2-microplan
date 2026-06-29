import React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FlagResult, Settlement } from '../types';

/**
 * Virtualised list of out-of-bounds points. Virtualisation keeps the DOM
 * light even with tens of thousands of flagged points. Clicking a row should
 * fly the map to the coordinate (wire via store/selection in production).
 */
export const FlagTable: React.FC<{
  rows: FlagResult[];
  settlements: Map<string, Settlement>;
}> = ({ rows, settlements }) => {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

  return (
    <div className="flagtable">
      <header className="flagtable__head">
        <h2>Out-of-bounds points</h2>
        <span className="flagtable__count">{rows.length.toLocaleString()} flagged</span>
      </header>
      <div ref={parentRef} className="flagtable__scroll">
        <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
          {virt.getVirtualItems().map((vi) => {
            const f = rows[vi.index];
            const nearest = f.nearestSettlementId
              ? settlements.get(f.nearestSettlementId)
              : undefined;
            return (
              <div
                key={f.point.id}
                className="flagtable__row"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <span className="flagtable__badge">
                  {f.point.kind === 'enrollment' ? 'ENR' : 'EVT'}
                </span>
                <div className="flagtable__cell">
                  <strong>{f.point.name ?? f.point.id}</strong>
                  <small>
                    team {f.point.teamCode ?? '—'} ·{' '}
                    {f.point.coordinate[1].toFixed(4)}, {f.point.coordinate[0].toFixed(4)}
                  </small>
                </div>
                <div className="flagtable__dist">
                  {nearest ? (
                    <>
                      {Math.round((f.distanceMeters ?? 0))}m from <em>{nearest.name}</em>
                    </>
                  ) : (
                    'no assigned settlement'
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
