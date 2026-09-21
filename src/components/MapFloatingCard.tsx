import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/ui';

/**
 * A card that floats *over* the whole page rather than inside the map.
 *
 * A maplibre popup is a child of the map container, so it is clipped by the
 * map's bounds and by its `overflow: hidden` — a tall profile opened near the
 * bottom edge simply loses its lower half, which is the part with the data in
 * it. This renders into `document.body` at fixed coordinates instead, so the
 * card is only ever constrained by the viewport.
 *
 * Placement picks the side with room: to the right of the point normally, to
 * the left when the point is close to the right edge, and clamped vertically so
 * the card is always whole. Below the `sm` breakpoint there is no useful "side"
 * on a phone, so it becomes a bottom sheet.
 */

export interface AnchorPoint {
  /** viewport coordinates of the thing the card describes */
  x: number;
  y: number;
}

/** Distance from the anchor point, and from the viewport edge. */
const GAP = 18;
const MARGIN = 12;
/** Below this width a side placement has nowhere to go; use a sheet instead. */
const SHEET_BREAKPOINT = 640;

type Placement =
  | { mode: 'side'; left: number; top: number; side: 'left' | 'right' }
  | { mode: 'sheet' };

/** Exported for tests: the placement decision is the whole point of this file. */
export function place(
  anchor: AnchorPoint,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): Placement {
  if (viewport.width < SHEET_BREAKPOINT) return { mode: 'sheet' };

  const roomRight = viewport.width - anchor.x - GAP - MARGIN;
  const roomLeft = anchor.x - GAP - MARGIN;

  // Prefer the right; fall back to the left; if neither fits outright, take
  // the roomier side and let the clamp below pull the card on screen.
  const side: 'left' | 'right' =
    roomRight >= size.width || roomRight >= roomLeft ? 'right' : 'left';

  const rawLeft = side === 'right' ? anchor.x + GAP : anchor.x - GAP - size.width;
  const left = Math.min(
    Math.max(rawLeft, MARGIN),
    Math.max(MARGIN, viewport.width - size.width - MARGIN)
  );

  // Centre on the point, then clamp so the card never hangs off the top or
  // bottom — the whole reason this isn't a maplibre popup.
  const rawTop = anchor.y - size.height / 2;
  const top = Math.min(
    Math.max(rawTop, MARGIN),
    Math.max(MARGIN, viewport.height - size.height - MARGIN)
  );

  return { mode: 'side', left, top, side };
}

export const MapFloatingCard: React.FC<{
  anchor: AnchorPoint | null;
  /** hover previews don't take pointer events, so they can't block the map */
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ anchor, interactive = true, className, children }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const reposition = useCallback(() => {
    const el = cardRef.current;
    if (!el || !anchor) return;
    setPlacement(
      place(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
  }, [anchor]);

  // Measure before paint so the card never flashes at the wrong place.
  useLayoutEffect(() => {
    reposition();
  }, [reposition, children]);

  // The card's own height changes as sections expand or the profile loads,
  // which can push it off screen — re-clamp whenever it resizes.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(reposition);
    ro.observe(el);
    return () => ro.disconnect();
  }, [reposition]);

  useEffect(() => {
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [reposition]);

  if (!anchor || typeof document === 'undefined') return null;

  const sheet = placement?.mode === 'sheet';

  return createPortal(
    <div
      ref={cardRef}
      // z-index clears the DHIS2 header bar and the map's own controls; the
      // card is the frontmost thing on the page while it is open.
      className={cn(
        'fixed z-[1200]',
        sheet
          ? 'inset-x-0 bottom-0 max-h-[75vh] w-full'
          : 'w-[min(22rem,calc(100vw-1.5rem))]',
        !interactive && 'pointer-events-none',
        // hidden until measured, so it can't be seen at 0,0 for a frame
        !placement && 'invisible',
        className
      )}
      style={
        placement?.mode === 'side'
          ? { left: placement.left, top: placement.top }
          : undefined
      }
    >
      {children}
    </div>,
    document.body
  );
};
