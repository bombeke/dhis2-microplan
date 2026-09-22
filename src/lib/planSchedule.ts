/**
 * Periods and plan columns for the Create Microplan page.
 *
 * A microplan is drawn up for one period on one of three schedules:
 *
 *   MONTHLY    one month,   columns = its weeks
 *   QUARTERLY  one quarter, columns = its three months
 *   YEARLY     one year,    columns = its twelve months
 *
 * Years and quarters follow the instance's **reporting cycle** (set by an
 * administrator on the Settings page): a calendar year, or a financial year
 * starting in April, July or October. Period ids follow DHIS2's own formats
 * where DHIS2 has one, and are unambiguous either way, because a plan's id is
 * built from its period:
 *
 *   month                  202609        (same in every cycle)
 *   calendar year          2026
 *   financial year         2026April · 2026July · 2026Oct   (the FY *starting* in 2026)
 *   calendar quarter       2026Q3
 *   financial quarter      2026AprilQ2 · 2026JulyQ1 · 2026OctQ4
 *
 * Only forward-looking periods are offered — the current one and the ones
 * after it — because a microplan is a plan, not a record:
 *
 *   MONTHLY    the current month and the next 12, grouped by financial year
 *   QUARTERLY  the rest of the current year's 4 quarters, and all 4 of the next
 *   YEARLY     the current year and the next 5
 *
 * Weeks run Monday → Sunday. A week that straddles a month boundary belongs to
 * the *later* month (it is that month's Week 1), which is the same as saying a
 * week belongs to the month its Sunday falls in. So a month has 4 weeks, or 5
 * when it holds five Sundays, and every day of the year sits in exactly one
 * week of exactly one month's plan.
 */

export type Schedule = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

/** First month of the reporting year. JANUARY = the calendar year. */
export type ReportingCycle = 'JANUARY' | 'APRIL' | 'JULY' | 'OCTOBER';

export const REPORTING_CYCLES: { value: ReportingCycle; label: string; description: string }[] = [
  { value: 'JANUARY', label: 'Calendar year', description: 'January – December' },
  { value: 'APRIL', label: 'Financial year from April', description: 'April – March' },
  { value: 'JULY', label: 'Financial year from July', description: 'July – June' },
  { value: 'OCTOBER', label: 'Financial year from October', description: 'October – September' },
];

export const DEFAULT_REPORTING_CYCLE: ReportingCycle = 'JANUARY';

export const isReportingCycle = (v: unknown): v is ReportingCycle =>
  REPORTING_CYCLES.some((c) => c.value === v);

export interface PeriodOption {
  id: string;
  label: string;
  /** option-group heading in the picker, e.g. "FY 2026/27" */
  group?: string;
}

/** One time column of the plan grid (a week, or a month). */
export interface PlanColumn {
  key: string; // w1..w5 or m01..m12 — positional, used as the cell key in storage
  label: string; // "Week 1" / "Jan 2027"
  range: string; // "28 Jul – 3 Aug"
  start: string; // ISO date (yyyy-mm-dd)
  end: string; // ISO date, inclusive
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 0-based first month of the year, and the DHIS2 period-id suffix. */
const CYCLE: Record<ReportingCycle, { month0: number; suffix: string }> = {
  JANUARY: { month0: 0, suffix: '' },
  APRIL: { month0: 3, suffix: 'April' },
  JULY: { month0: 6, suffix: 'July' },
  OCTOBER: { month0: 9, suffix: 'Oct' },
};
const SUFFIX_TO_CYCLE = new Map(
  (Object.entries(CYCLE) as [ReportingCycle, { suffix: string }][]).map(([c, v]) => [v.suffix, c])
);

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-date ISO string; toISOString() would shift the day across UTC. */
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const YEARS_AHEAD = 5;
export const MONTHS_AHEAD = 12;

/* ---- reporting years ------------------------------------------------------ */

/** The reporting year a date falls in, named by the calendar year it starts in. */
export function reportingYearOf(d: Date, cycle: ReportingCycle): number {
  const m0 = CYCLE[cycle].month0;
  return d.getMonth() >= m0 ? d.getFullYear() : d.getFullYear() - 1;
}

/** First day of reporting year `y` (plus `monthOffset` months). */
const yearStart = (y: number, cycle: ReportingCycle, monthOffset = 0) =>
  new Date(y, CYCLE[cycle].month0 + monthOffset, 1);

/** "2026" for a calendar year, "FY 2026/27" for a financial one. */
export function yearName(y: number, cycle: ReportingCycle): string {
  return cycle === 'JANUARY' ? String(y) : `FY ${y}/${String(y + 1).slice(2)}`;
}

/** "Apr 2026 – Mar 2027" — the months a span of `months` from `start` covers. */
function monthSpan(start: Date, months: number): string {
  const end = new Date(start.getFullYear(), start.getMonth() + months - 1, 1);
  return start.getFullYear() === end.getFullYear()
    ? `${MONTHS[start.getMonth()]}–${MONTHS[end.getMonth()]} ${end.getFullYear()}`
    : `${MONTHS[start.getMonth()]} ${start.getFullYear()} – ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

/* ---- period ids ----------------------------------------------------------- */

type ParsedPeriod =
  | { kind: 'MONTHLY'; year: number; month0: number }
  | { kind: 'QUARTERLY'; year: number; quarter: number; cycle: ReportingCycle }
  | { kind: 'YEARLY'; year: number; cycle: ReportingCycle };

export function parsePeriod(id: string): ParsedPeriod | null {
  let m = /^(\d{4})(\d{2})$/.exec(id);
  if (m) return { kind: 'MONTHLY', year: Number(m[1]), month0: Number(m[2]) - 1 };
  m = /^(\d{4})(April|July|Oct|)Q([1-4])$/.exec(id);
  if (m) {
    return {
      kind: 'QUARTERLY',
      year: Number(m[1]),
      quarter: Number(m[3]),
      cycle: SUFFIX_TO_CYCLE.get(m[2]) ?? 'JANUARY',
    };
  }
  m = /^(\d{4})(April|July|Oct|)$/.exec(id);
  if (m) return { kind: 'YEARLY', year: Number(m[1]), cycle: SUFFIX_TO_CYCLE.get(m[2]) ?? 'JANUARY' };
  return null;
}

const yearId = (y: number, c: ReportingCycle) => `${y}${CYCLE[c].suffix}`;
const quarterId = (y: number, q: number, c: ReportingCycle) => `${y}${CYCLE[c].suffix}Q${q}`;

/** The current period and the ones after it, for the period picker. */
export function periodOptions(
  schedule: Schedule,
  cycle: ReportingCycle = DEFAULT_REPORTING_CYCLE,
  today = new Date()
): PeriodOption[] {
  const thisYear = reportingYearOf(today, cycle);

  if (schedule === 'YEARLY') {
    return Array.from({ length: YEARS_AHEAD + 1 }, (_, i) => {
      const y = thisYear + i;
      return { id: yearId(y, cycle), label: periodLabel(yearId(y, cycle)) };
    });
  }

  if (schedule === 'QUARTERLY') {
    // months since the start of the current reporting year → current quarter
    const monthsIn =
      (today.getFullYear() - yearStart(thisYear, cycle).getFullYear()) * 12 +
      today.getMonth() -
      CYCLE[cycle].month0;
    const currentQ = Math.floor(monthsIn / 3) + 1;
    const out: PeriodOption[] = [];
    for (const y of [thisYear, thisYear + 1]) {
      for (let q = y === thisYear ? currentQ : 1; q <= 4; q++) {
        const id = quarterId(y, q, cycle);
        out.push({ id, label: periodLabel(id), group: yearName(y, cycle) });
      }
    }
    return out;
  }

  return Array.from({ length: MONTHS_AHEAD + 1 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const fy = reportingYearOf(d, cycle);
    const q = Math.floor(((d.getMonth() - CYCLE[cycle].month0 + 12) % 12) / 3) + 1;
    return {
      id: `${d.getFullYear()}${pad(d.getMonth() + 1)}`,
      label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`,
      group: `${yearName(fy, cycle)} · Q${q}`,
    };
  });
}

/** Human label for a period id of any schedule and cycle. */
export function periodLabel(period: string): string {
  const p = parsePeriod(period);
  if (!p) return period;
  if (p.kind === 'MONTHLY') return `${MONTHS_LONG[p.month0]} ${p.year}`;
  if (p.kind === 'YEARLY') {
    return p.cycle === 'JANUARY'
      ? String(p.year)
      : `${yearName(p.year, p.cycle)} (${monthSpan(yearStart(p.year, p.cycle), 12)})`;
  }
  const start = yearStart(p.year, p.cycle, (p.quarter - 1) * 3);
  return p.cycle === 'JANUARY'
    ? `Q${p.quarter} ${p.year} (${monthSpan(start, 3)})`
    : `Q${p.quarter} ${yearName(p.year, p.cycle)} (${monthSpan(start, 3)})`;
}

/** The schedule a period id belongs to. */
export const scheduleOf = (period: string): Schedule | null => parsePeriod(period)?.kind ?? null;

/* ---- columns -------------------------------------------------------------- */

/** "3 Aug" when both ends share a month, else each end carries its month. */
function rangeLabel(start: Date, end: Date): string {
  const s = `${start.getDate()} ${MONTHS[start.getMonth()]}`;
  const e = `${end.getDate()} ${MONTHS[end.getMonth()]}`;
  return start.getMonth() === end.getMonth() ? `${start.getDate()}–${e}` : `${s} – ${e}`;
}

/** Monday–Sunday weeks whose Sunday falls in the given month (see header). */
export function weeksOfMonth(year: number, month0: number): PlanColumn[] {
  const out: PlanColumn[] = [];
  const first = new Date(year, month0, 1);
  const sunday = new Date(year, month0, 1 + ((7 - first.getDay()) % 7));
  let n = 1;
  while (sunday.getMonth() === month0) {
    const monday = new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() - 6);
    out.push({
      key: `w${n}`,
      label: `Week ${n}`,
      range: rangeLabel(monday, sunday),
      start: iso(monday),
      end: iso(sunday),
    });
    n += 1;
    sunday.setDate(sunday.getDate() + 7);
  }
  return out;
}

/** `count` consecutive whole months from `start`, keyed m01, m02, … */
export function monthColumns(start: Date, count: number): PlanColumn[] {
  return Array.from({ length: count }, (_, i) => {
    const s = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    const m = MONTHS[s.getMonth()];
    return {
      key: `m${pad(i + 1)}`,
      label: `${m} ${s.getFullYear()}`,
      range: `1–${e.getDate()} ${m}`,
      start: iso(s),
      end: iso(e),
    };
  });
}

/** The time columns for a period. */
export function planColumns(period: string): PlanColumn[] {
  const p = parsePeriod(period);
  if (!p) return [];
  if (p.kind === 'MONTHLY') return weeksOfMonth(p.year, p.month0);
  if (p.kind === 'QUARTERLY') return monthColumns(yearStart(p.year, p.cycle, (p.quarter - 1) * 3), 3);
  return monthColumns(yearStart(p.year, p.cycle), 12);
}
