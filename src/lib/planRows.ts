import Papa from 'papaparse';
import {
  isEditableStatus,
  rowKey,
  type CreatedPlan,
  type PlanRow,
  type UserRef,
} from './createdPlanStore';
import type { PlanFacility } from '../hooks/useCreatePlan';
import type { PlanColumn } from './planSchedule';

/**
 * Building the grid's rows, and turning them into a CSV.
 */

const sortKey = (r: PlanRow) =>
  `${r.ancestors.map((a) => a.name).join('\u0001')}\u0001${r.facility.name}\u0001${r.user?.name ?? '￿'}`;

const hasCells = (r: PlanRow) => Object.values(r.cells).some((c) => c.length > 0);

/**
 * The rows to edit: one per facility × assigned user, from live DHIS2 data,
 * carrying over whatever the saved plan holds for the same key.
 *
 * Once a plan has been submitted it is a snapshot — the saved rows are used as
 * they are, so a reviewer sees exactly what was submitted even if assignments
 * have changed since. While it is still editable, the live assignments win,
 * with two courtesies so nothing planned is silently lost:
 *
 *  - a facility's "Unassigned" row that now has users hands its cells to the
 *    first of them;
 *  - any other saved row whose user is no longer assigned is kept (and
 *    reported in `staleKeys`) as long as it holds settlements.
 */
export function mergeRows(
  facilities: PlanFacility[],
  usersByFacility: Map<string, UserRef[]>,
  plan: CreatedPlan | null
): { rows: PlanRow[]; staleKeys: Set<string> } {
  if (plan && !isEditableStatus(plan.status)) {
    return { rows: plan.rows, staleKeys: new Set() };
  }

  const saved = new Map((plan?.rows ?? []).map((r) => [r.key, r]));
  const used = new Set<string>();
  const rows: PlanRow[] = [];

  for (const f of facilities) {
    const users = usersByFacility.get(f.id) ?? [];
    const facility = { id: f.id, name: f.name, level: f.level };
    const forFacility: PlanRow[] = (users.length ? users : [null]).map((u) => {
      const key = rowKey(f.id, u?.id ?? null);
      const prev = saved.get(key);
      if (prev) used.add(key);
      return {
        key,
        facility,
        ancestors: f.ancestors,
        user: u,
        cells: prev?.cells ?? {},
        note: prev?.note,
      };
    });

    const unassigned = saved.get(rowKey(f.id, null));
    if (users.length && unassigned && hasCells(unassigned) && !used.has(unassigned.key)) {
      const target = forFacility.find((r) => !hasCells(r));
      if (target) {
        target.cells = unassigned.cells;
        target.note = target.note ?? unassigned.note;
        used.add(unassigned.key);
      }
    }
    rows.push(...forFacility);
  }

  const staleKeys = new Set<string>();
  for (const r of plan?.rows ?? []) {
    if (used.has(r.key) || !hasCells(r)) continue;
    staleKeys.add(r.key);
    rows.push(r);
  }

  const keyed = rows.map((r) => [sortKey(r), r] as const);
  keyed.sort((a, b) => a[0].localeCompare(b[0]));
  return { rows: keyed.map(([, r]) => r), staleKeys };
}

/** Drop empty cell arrays before storing — most of a fresh plan is empty. */
export const compactRows = (rows: PlanRow[]): PlanRow[] =>
  rows.map((r) => {
    const cells: PlanRow['cells'] = {};
    for (const [k, v] of Object.entries(r.cells)) if (v.length) cells[k] = v;
    const out: PlanRow = { ...r, cells };
    if (!r.note) delete out.note;
    return out;
  });

export interface CsvLevel {
  level: number;
  name: string;
}

/** The whole grid (not just the current page) as CSV text. */
export function rowsToCsv(
  rows: PlanRow[],
  columns: PlanColumn[],
  levels: CsvLevel[],
  opts: { includeNotes: boolean; status: string; period: string }
): string {
  const fields = [
    ...levels.map((l) => l.name),
    'Facility',
    'Facility ID',
    'Assigned to',
    'Username',
    ...columns.map((c) => `${c.label} (${c.start} to ${c.end})`),
    'Settlements (total)',
    ...(opts.includeNotes ? ['Review note'] : []),
    'Period',
    'Status',
  ];
  const data = rows.map((r) => {
    const byLevel = new Map(r.ancestors.map((a) => [a.level, a.name]));
    const total = new Set(columns.flatMap((c) => (r.cells[c.key] ?? []).map((i) => i.id))).size;
    return [
      ...levels.map((l) => byLevel.get(l.level) ?? ''),
      r.facility.name,
      r.facility.id,
      r.user?.name ?? 'Unassigned',
      r.user?.username ?? '',
      ...columns.map((c) => (r.cells[c.key] ?? []).map((i) => i.name).join('; ')),
      total,
      ...(opts.includeNotes ? [r.note ?? ''] : []),
      opts.period,
      opts.status,
    ];
  });
  // BOM so Excel opens accented settlement names as UTF-8
  return '﻿' + Papa.unparse({ fields, data });
}

export function downloadText(text: string, fileName: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (s: string) =>
  s.replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 120) || 'microplan';
