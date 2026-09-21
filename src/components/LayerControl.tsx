import React, { useState } from 'react';
import { IconChevronDown16, IconChevronUp16, IconLegend16, Switch } from '@dhis2/ui';
import { useStore } from '../store/useStore';
import { BASEMAPS, type OverlayToggles } from '../lib/basemaps';
import { cardLabel, cn, floatCard } from '../lib/ui';

/**
 * Floating layer card, modeled on the DHIS2 Maps app's layer panel:
 *  - basemap chooser (swatches) — switch tile source live
 *  - overlay switches — show/hide settlement polygons, visits, flagged visits
 *    and boundary context
 *
 * The overlays are grouped into what you *count* (the visits) and what you
 * read them *against* (the boundaries), because that is how the two halves of
 * the map are actually used — a supervisor turns the context off to see the
 * points, not to see fewer layers.
 */
const OVERLAY_SECTIONS: {
  title: string;
  items: { key: keyof OverlayToggles; label: string }[];
}[] = [
  {
    title: 'Visits',
    items: [
      { key: 'points', label: 'Visits in assigned area' },
      { key: 'flagged', label: 'Flagged visits' },
    ],
  },
  {
    title: 'Context',
    items: [
      { key: 'settlementBoundaries', label: 'Outreach settlements' },
      { key: 'settlements', label: 'Settlement boundaries' },
      { key: 'boundaries', label: 'Organisation unit' },
    ],
  },
];

export const LayerControl: React.FC<{ defaultOpen?: boolean }> = ({ defaultOpen = true }) => {
  const { basemapId, setBasemapId, overlays, toggleOverlay } = useStore();
  const [open, setOpen] = useState(defaultOpen);

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
        <IconLegend16 />
        <span className="flex-1 text-left">Layers</span>
        {open ? <IconChevronUp16 /> : <IconChevronDown16 />}
      </button>

      {open && (
        <div className="max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain px-3 pb-3 pt-2.5">
          <div>
            <div className={cardLabel}>Basemap</div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[11.5px] leading-tight',
                    basemapId === b.id
                      ? 'border-accent bg-accent/10'
                      : 'border-line bg-canvas hover:border-accent/50'
                  )}
                  onClick={() => setBasemapId(b.id)}
                  aria-pressed={basemapId === b.id}
                  title={b.name}
                >
                  <span
                    className="size-4 shrink-0 rounded border border-black/10"
                    style={{ background: b.thumbnailColor }}
                  />
                  <span className="truncate">{b.name}</span>
                </button>
              ))}
            </div>
          </div>

          {OVERLAY_SECTIONS.map((section) => (
            <div className="mt-3 border-t border-line pt-2.5" key={section.title}>
              <div className={cardLabel}>{section.title}</div>
              <div className="mt-1.5 flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <Switch
                    key={item.key}
                    dense
                    checked={overlays[item.key]}
                    label={<span className="text-[12.5px]">{item.label}</span>}
                    onChange={() => toggleOverlay(item.key)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
