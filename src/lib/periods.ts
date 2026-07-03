import type { Dhis2Period } from '../types';

/**
 * DHIS2-compatible relative periods plus a resolver to concrete date ranges,
 * so the same selection drives both analytics (`pe` dimension) and tracker
 * (`occurredAfter`/`occurredBefore`) queries. We model the common relatives
 * used in routine-immunisation outreach reporting.
 */
/**
 * The full set of DHIS2 relative periods, grouped by period type (Daily →
 * Yearly, plus Financial Year). These are the relative-period keywords DHIS2
 * accepts for the analytics `pe` dimension and for relative date params such as
 * `lastUpdated` (e.g. `&lastUpdated=LAST_MONTH`). Grouping drives the optgroups
 * in the Period selector.
 */
export const RELATIVE_PERIODS: Dhis2Period[] = [
  // Daily
  { id: 'TODAY', name: 'Today', group: 'Daily' },
  { id: 'YESTERDAY', name: 'Yesterday', group: 'Daily' },
  { id: 'LAST_3_DAYS', name: 'Last 3 days', group: 'Daily' },
  { id: 'LAST_7_DAYS', name: 'Last 7 days', group: 'Daily' },
  { id: 'LAST_14_DAYS', name: 'Last 14 days', group: 'Daily' },
  { id: 'LAST_30_DAYS', name: 'Last 30 days', group: 'Daily' },
  { id: 'LAST_60_DAYS', name: 'Last 60 days', group: 'Daily' },
  { id: 'LAST_90_DAYS', name: 'Last 90 days', group: 'Daily' },
  { id: 'LAST_180_DAYS', name: 'Last 180 days', group: 'Daily' },
  // Weekly
  { id: 'THIS_WEEK', name: 'This week', group: 'Weekly' },
  { id: 'LAST_WEEK', name: 'Last week', group: 'Weekly' },
  { id: 'LAST_4_WEEKS', name: 'Last 4 weeks', group: 'Weekly' },
  { id: 'LAST_12_WEEKS', name: 'Last 12 weeks', group: 'Weekly' },
  { id: 'LAST_52_WEEKS', name: 'Last 52 weeks', group: 'Weekly' },
  { id: 'WEEKS_THIS_YEAR', name: 'Weeks this year', group: 'Weekly' },
  // Bi-weekly
  { id: 'THIS_BIWEEK', name: 'This bi-week', group: 'Bi-weekly' },
  { id: 'LAST_BIWEEK', name: 'Last bi-week', group: 'Bi-weekly' },
  { id: 'LAST_4_BIWEEKS', name: 'Last 4 bi-weeks', group: 'Bi-weekly' },
  // Monthly
  { id: 'THIS_MONTH', name: 'This month', group: 'Monthly' },
  { id: 'LAST_MONTH', name: 'Last month', group: 'Monthly' },
  { id: 'LAST_3_MONTHS', name: 'Last 3 months', group: 'Monthly' },
  { id: 'LAST_6_MONTHS', name: 'Last 6 months', group: 'Monthly' },
  { id: 'LAST_12_MONTHS', name: 'Last 12 months', group: 'Monthly' },
  { id: 'MONTHS_THIS_YEAR', name: 'Months this year', group: 'Monthly' },
  // Bi-monthly
  { id: 'THIS_BIMONTH', name: 'This bi-month', group: 'Bi-monthly' },
  { id: 'LAST_BIMONTH', name: 'Last bi-month', group: 'Bi-monthly' },
  { id: 'LAST_6_BIMONTHS', name: 'Last 6 bi-months', group: 'Bi-monthly' },
  { id: 'BIMONTHS_THIS_YEAR', name: 'Bi-months this year', group: 'Bi-monthly' },
  // Quarterly
  { id: 'THIS_QUARTER', name: 'This quarter', group: 'Quarterly' },
  { id: 'LAST_QUARTER', name: 'Last quarter', group: 'Quarterly' },
  { id: 'LAST_4_QUARTERS', name: 'Last 4 quarters', group: 'Quarterly' },
  { id: 'QUARTERS_THIS_YEAR', name: 'Quarters this year', group: 'Quarterly' },
  // Six-monthly
  { id: 'THIS_SIX_MONTH', name: 'This six-month', group: 'Six-monthly' },
  { id: 'LAST_SIX_MONTH', name: 'Last six-month', group: 'Six-monthly' },
  { id: 'LAST_2_SIXMONTHS', name: 'Last 2 six-months', group: 'Six-monthly' },
  // Yearly
  { id: 'THIS_YEAR', name: 'This year', group: 'Yearly' },
  { id: 'LAST_YEAR', name: 'Last year', group: 'Yearly' },
  { id: 'LAST_5_YEARS', name: 'Last 5 years', group: 'Yearly' },
  { id: 'LAST_10_YEARS', name: 'Last 10 years', group: 'Yearly' },
  // Financial year
  { id: 'THIS_FINANCIAL_YEAR', name: 'This financial year', group: 'Financial year' },
  { id: 'LAST_FINANCIAL_YEAR', name: 'Last financial year', group: 'Financial year' },
  { id: 'LAST_5_FINANCIAL_YEARS', name: 'Last 5 financial years', group: 'Financial year' },
];

/** Relative periods grouped for optgroup rendering, preserving definition order. */
export function relativePeriodsByGroup(): { group: string; periods: Dhis2Period[] }[] {
  const order: string[] = [];
  const map = new Map<string, Dhis2Period[]>();
  for (const p of RELATIVE_PERIODS) {
    const g = p.group ?? 'Other';
    if (!map.has(g)) {
      map.set(g, []);
      order.push(g);
    }
    map.get(g)!.push(p);
  }
  return order.map((group) => ({ group, periods: map.get(group)! }));
}

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
