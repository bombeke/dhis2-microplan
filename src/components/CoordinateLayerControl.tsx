import React, { useState } from 'react';
import { Checkbox, IconChevronDown16, IconChevronUp16 } from '@dhis2/ui';
import { useStore } from '../store/useStore';
import { cn, floatCard } from '../lib/ui';

/**
 * Filter card for the coordinate-analytics dimensions.
 *
 * Lists the COORDINATE dimensions that returned points (program attributes and
 * program-stage data elements), labelled from the analytics response's
 * metaData.items, and lets the user toggle which ones are drawn on the map.
 * Works like LayerControl but for the point layers themselves.
 */
export const CoordinateLayerControl: React.FC<{
  dimensionIds: string[];
  metaItems: Record<string, { name?: string; [k: string]: unknown }>;
  countsByDim: Record<string, number>;
  defaultOpen?: boolean;
}> = ({ dimensionIds, metaItems, countsByDim, defaultOpen = true }) => {
  const { hiddenCoordinateDims, toggleCoordinateDim, setHiddenCoordinateDims } = useStore();
  const [open, setOpen] = useState(defaultOpen);

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

  const anyHidden = dimensionIds.some((id) => hiddenCoordinateDims.includes(id));

  return (
    <div className={cn(floatCard, 'overflow-hidden')}>
      <button
        type="button"
        className={cn(
          'flex w-full items-center gap-2 bg-panel px-3 py-2.5 text-[12.5px] font-semibold',
          open && 'border-b border-line'
        )}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="flex-1 text-left">Point layers</span>
        <span className="rounded-full bg-panel2 px-1.5 text-[11px] font-semibold tabular-nums text-muted">
          {dimensionIds.length}
        </span>
        {open ? <IconChevronUp16 /> : <IconChevronDown16 />}
      </button>

      {open && (
        <>
          <ul className="max-h-56 overflow-y-auto overscroll-contain px-3 py-2">
            {dimensionIds.map((dimId) => (
              <li key={dimId} className="flex items-center gap-2 py-0.5">
                <span className="min-w-0 flex-1">
                  <Checkbox
                    dense
                    checked={!hiddenCoordinateDims.includes(dimId)}
                    label={<span className="text-[12.5px]">{labelFor(dimId)}</span>}
                    onChange={() => toggleCoordinateDim(dimId)}
                  />
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted">
                  {countsByDim[dimId] ?? 0}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="w-full border-t border-line px-3 py-1.5 text-left text-xs text-accent hover:bg-panel2"
            onClick={() => setHiddenCoordinateDims(anyHidden ? [] : dimensionIds.slice())}
          >
            {anyHidden ? 'Show all' : 'Hide all'}
          </button>
        </>
      )}
    </div>
  );
};
