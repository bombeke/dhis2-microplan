import React from 'react';
import { useStore } from '../store/useStore';

/**
 * Step 4 — filter overlay for coordinate-analytics dimensions.
 *
 * Lists the COORDINATE dimensions that returned points (program attributes and
 * program-stage data elements), labelled from the analytics response's
 * metaData.items, and lets the user toggle which ones are drawn as clusters on
 * the map. Works like the basemap LayerControl but for coordinate layers.
 */
export const CoordinateLayerControl: React.FC<{
  dimensionIds: string[];
  metaItems: Record<string, { name?: string; [k: string]: unknown }>;
  countsByDim: Record<string, number>;
}> = ({ dimensionIds, metaItems, countsByDim }) => {
  const { hiddenCoordinateDims, toggleCoordinateDim } = useStore();

  if (dimensionIds.length === 0) return null;

  // A dimension id is either "<attrId>" or "<stageId>.<deId>"; label each from
  // metaData.items, falling back to the raw id.
  // Attribute dims → just the attribute name. Stage-dataElement dims (id is
  // "stageId.deId") → "DataElement (Stage)" e.g. "Geo-coordinate (6 Weeks)".
  const labelFor = (dimId: string): string => {
    if (dimId.includes('.')) {
      const [stageId, deId] = dimId.split('.');
      const de = (metaItems[deId]?.name as string | undefined) ?? deId;
      const stage = metaItems[stageId]?.name as string | undefined;
      return stage ? `${de} (${stage})` : de;
    }
    return (metaItems[dimId]?.name as string | undefined) ?? dimId;
  };

  return (
    <div className="coordctl">
      <div className="coordctl__title">Coordinate layers</div>
      <ul className="coordctl__list">
        {dimensionIds.map((dimId) => {
          const on = !hiddenCoordinateDims.includes(dimId);
          return (
            <li key={dimId} className="coordctl__item">
              <label>
                <input type="checkbox" checked={on} onChange={() => toggleCoordinateDim(dimId)} />
                <span className="coordctl__label">{labelFor(dimId)}</span>
                <span className="coordctl__count">{countsByDim[dimId] ?? 0}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
