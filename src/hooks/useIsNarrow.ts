import { useEffect, useState } from 'react';

/**
 * True on phone-sized viewports, matching Tailwind's `sm` breakpoint (640px).
 *
 * Some layout decisions can't be made in CSS alone — whether a floating card
 * starts open, whether a popover becomes a sheet — because they are component
 * state, not styling. This keeps that one number in a single place so the
 * JavaScript and the `sm:` utilities can't disagree about where "narrow" ends.
 */
const QUERY = '(max-width: 639.98px)';

export function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    setNarrow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
