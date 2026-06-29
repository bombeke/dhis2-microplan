import type { Dhis2Period } from '../types';

/**
 * DHIS2-compatible relative periods plus a resolver to concrete date ranges,
 * so the same selection drives both analytics (`pe` dimension) and tracker
 * (`occurredAfter`/`occurredBefore`) queries. We model the common relatives
 * used in routine-immunisation outreach reporting.
 */
export const RELATIVE_PERIODS: Dhis2Period[] = [
  { id: 'THIS_MONTH', name: 'This month' },
  { id: 'LAST_MONTH', name: 'Last month' },
  { id: 'LAST_3_MONTHS', name: 'Last 3 months' },
  { id: 'THIS_QUARTER', name: 'This quarter' },
  { id: 'LAST_QUARTER', name: 'Last quarter' },
  { id: 'THIS_YEAR', name: 'This year' },
  { id: 'LAST_12_MONTHS', name: 'Last 12 months' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthStart = (y: number, m: number) => new Date(y, m, 1);
const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);

export interface DateRange {
  start: string;
  end: string;
}

export function resolvePeriod(id: string, now = new Date()): DateRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  const q = Math.floor(m / 3);

  switch (id) {
    case 'THIS_MONTH':
      return { start: iso(monthStart(y, m)), end: iso(monthEnd(y, m)) };
    case 'LAST_MONTH':
      return { start: iso(monthStart(y, m - 1)), end: iso(monthEnd(y, m - 1)) };
    case 'LAST_3_MONTHS':
      return { start: iso(monthStart(y, m - 3)), end: iso(monthEnd(y, m - 1)) };
    case 'THIS_QUARTER':
      return { start: iso(monthStart(y, q * 3)), end: iso(monthEnd(y, q * 3 + 2)) };
    case 'LAST_QUARTER':
      return { start: iso(monthStart(y, (q - 1) * 3)), end: iso(monthEnd(y, (q - 1) * 3 + 2)) };
    case 'THIS_YEAR':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'LAST_12_MONTHS':
      return { start: iso(monthStart(y, m - 12)), end: iso(monthEnd(y, m - 1)) };
    default:
      return { start: iso(monthStart(y, m)), end: iso(monthEnd(y, m)) };
  }
}
