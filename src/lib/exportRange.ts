/**
 * The date-range model behind the Export page.
 *
 * Analytics can be asked for data in two ways: a relative-period keyword on the
 * `pe` dimension (what the saved pivot table already carries), or an explicit
 * `startDate`/`endDate` pair. We resolve every user choice into the explicit
 * pair, because the relative keywords only exist for a fixed set of N (there is
 * no `LAST_7_MONTHS`) and the requirement is an arbitrary positive N.
 */
export type RangeMode = 'default' | 'since' | 'last';
export type RangeUnit = 'days' | 'weeks' | 'months' | 'years';

export interface ExportDateRange {
  mode: RangeMode;
  /** mode 'since': ISO yyyy-mm-dd */
  startDate: string;
  /** mode 'last': how many `unit`s back from today */
  lastN: number;
  unit: RangeUnit;
}

export interface ResolvedDateRange {
  startDate: string;
  endDate: string;
}

export const DEFAULT_EXPORT_RANGE: ExportDateRange = {
  mode: 'default',
  startDate: '',
  lastN: 3,
  unit: 'months',
};

export const RANGE_UNITS: { value: RangeUnit; label: string }[] = [
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' },
];

const pad = (n: number) => String(n).padStart(2, '0');
export const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const shiftBack = (from: Date, n: number, unit: RangeUnit): Date => {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  switch (unit) {
    case 'days':
      d.setDate(d.getDate() - n);
      break;
    case 'weeks':
      d.setDate(d.getDate() - n * 7);
      break;
    case 'months':
      d.setMonth(d.getMonth() - n);
      break;
    case 'years':
      d.setFullYear(d.getFullYear() - n);
      break;
  }
  return d;
};

/** `null` means "leave the visualization's own period alone". */
export function resolveExportRange(
  range: ExportDateRange,
  now = new Date()
): ResolvedDateRange | null {
  if (range.mode === 'default') return null;

  const today = toIso(now);

  if (range.mode === 'since') {
    if (!range.startDate) return null;
    // A start date in the future would produce an inverted range; clamp it.
    return { startDate: range.startDate, endDate: range.startDate > today ? range.startDate : today };
  }

  if (!Number.isInteger(range.lastN) || range.lastN < 1) return null;
  return { startDate: toIso(shiftBack(now, range.lastN, range.unit)), endDate: today };
}

/**
 * Why the current selection can't be used, or `null` when it's fine. Drives the
 * inline validation message rather than silently falling back to the default.
 */
export function validateExportRange(range: ExportDateRange): string | null {
  if (range.mode === 'since') {
    if (!range.startDate) return 'Pick a start date.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(range.startDate)) return 'Start date must be a valid date.';
    if (range.startDate > toIso(new Date())) return 'Start date cannot be in the future.';
  }
  if (range.mode === 'last') {
    if (!Number.isFinite(range.lastN) || !Number.isInteger(range.lastN))
      return 'N must be a whole number.';
    if (range.lastN < 1) return 'N must be greater than 0.';
  }
  return null;
}

export function describeExportRange(range: ExportDateRange, now = new Date()): string {
  const resolved = resolveExportRange(range, now);
  if (!resolved) return "The pivot table's own period";
  if (range.mode === 'since') return `Since ${resolved.startDate} (to ${resolved.endDate})`;
  const unit = range.lastN === 1 ? range.unit.replace(/s$/, '') : range.unit;
  return `Last ${range.lastN} ${unit} (${resolved.startDate} → ${resolved.endDate})`;
}

/** Short, filename-safe token describing the range, e.g. `last-3-months`. */
export function rangeFileToken(range: ExportDateRange): string {
  if (range.mode === 'since') return `since-${range.startDate}`;
  if (range.mode === 'last') return `last-${range.lastN}-${range.unit}`;
  return 'default-period';
}
