import Papa from 'papaparse';
import {
  ROW_STATUS_LABEL,
  byAge,
  normaliseValue,
  type DetectedGroup,
  type DuplicateCase,
  type EntityRef,
  type RetainedMark,
  type RowStatus,
  type ScanEntity,
  type StoredDecisions,
} from './duplicateStore';

/**
 * Rows for the Manage Duplicates grid.
 *
 * Everything is assembled per *group* first — the scan's members, plus
 * members only the stored decisions still know about (merged-away records are
 * gone from DHIS2; a decision may predate the last scan) — and then one row
 * is produced per member except the group's effective original:
 *
 *  - a retained member is RETAINED and never counts as the original;
 *  - a member deleted by an accepted merge is MERGED;
 *  - a member of the group's open merge takes its status (PENDING / FLAGGED);
 *  - anything else is DETECTED.
 *
 * The original is the oldest member that is neither retained nor merged away
 * (for a merged group, the record that was kept).
 */

export interface GroupView {
  id: string;
  key: string;
  /** every member ever seen, oldest first */
  members: EntityRef[];
  /** members that are neither retained nor merged away, oldest first */
  active: EntityRef[];
  original: EntityRef;
  retained: Map<string, RetainedMark>;
  /** removed record id -> the accepted merge that deleted it */
  deleted: Map<string, DuplicateCase>;
  /** the merge in progress (awaiting approval or rejected), if any */
  open?: DuplicateCase;
  /** every stored merge of the group, newest first */
  cases: DuplicateCase[];
}

export interface DupRow {
  /** the tracked entity id */
  id: string;
  group: GroupView;
  status: RowStatus;
  record: EntityRef;
  /** the merge this row is part of, if any */
  case?: DuplicateCase;
  retained?: RetainedMark;
  /** lower-cased text the search box matches against */
  haystack: string;
}

type OuLookup = (id: string) => { name: string; path: string } | undefined;

const refOf = (e: ScanEntity, ou: OuLookup): EntityRef => {
  const o = ou(e.ou);
  return {
    id: e.id,
    orgUnit: e.ou,
    orgUnitName: o?.name,
    orgUnitPath: o?.path,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    createdBy: e.createdBy,
    updatedBy: e.updatedBy,
    values: e.values,
  };
};

const fill = (r: EntityRef, ou: OuLookup): EntityRef =>
  r.orgUnitName && r.orgUnitPath
    ? r
    : { ...r, orgUnitName: r.orgUnitName ?? ou(r.orgUnit)?.name, orgUnitPath: r.orgUnitPath ?? ou(r.orgUnit)?.path };

export function buildGroups(scan: DetectedGroup[], decisions: StoredDecisions, ou: OuLookup): GroupView[] {
  const acc = new Map<string, { key: string; members: Map<string, EntityRef>; cases: DuplicateCase[] }>();
  const at = (id: string, key: string) => {
    let g = acc.get(id);
    if (!g) acc.set(id, (g = { key, members: new Map(), cases: [] }));
    return g;
  };
  for (const g of scan) {
    const a = at(g.id, g.key);
    for (const m of g.members) a.members.set(m.id, refOf(m, ou));
  }
  for (const c of decisions.cases.values()) {
    const a = at(c.groupId, c.key);
    a.cases.push(c);
    for (const m of c.members) if (!a.members.has(m.id)) a.members.set(m.id, fill(m, ou));
  }
  for (const r of decisions.retained.values()) {
    const a = at(r.groupId, r.key);
    if (!a.members.has(r.record.id)) a.members.set(r.record.id, fill(r.record, ou));
    if (!a.members.has(r.original.id)) a.members.set(r.original.id, fill(r.original, ou));
  }

  const out: GroupView[] = [];
  for (const [id, a] of acc) {
    const members = [...a.members.values()].sort(byAge);
    const cases = a.cases.sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    const deleted = new Map<string, DuplicateCase>();
    for (const c of cases) if (c.status === 'MERGED') for (const rid of c.removedIds) deleted.set(rid, c);
    const retained = new Map<string, RetainedMark>();
    for (const m of members) {
      const r = decisions.retained.get(m.id);
      if (r) retained.set(m.id, r);
    }
    const active = members.filter((m) => !retained.has(m.id) && !deleted.has(m.id));
    out.push({
      id,
      key: a.key,
      members,
      active,
      original: active[0] ?? members[0],
      retained,
      deleted,
      open: cases.find((c) => c.status !== 'MERGED'),
      cases,
    });
  }
  return out;
}

const hay = (r: EntityRef, c?: DuplicateCase, m?: RetainedMark) =>
  normaliseValue(
    [r.id, r.orgUnitName, r.createdBy, r.updatedBy, ...r.values, c?.preparedBy?.name, c?.reviewedBy?.name, m?.retainedBy.name]
      .filter(Boolean)
      .join(' ')
  );

export function buildRows(groups: GroupView[]): DupRow[] {
  const out: DupRow[] = [];
  for (const g of groups) {
    for (const m of g.members) {
      const retained = g.retained.get(m.id);
      if (retained) {
        out.push({ id: m.id, group: g, status: 'RETAINED', record: m, retained, haystack: hay(m, undefined, retained) });
        continue;
      }
      const merged = g.deleted.get(m.id);
      if (merged) {
        out.push({ id: m.id, group: g, status: 'MERGED', record: m, case: merged, haystack: hay(m, merged) });
        continue;
      }
      const c = g.open && (g.open.removedIds.includes(m.id) || g.open.keptId === m.id) ? g.open : undefined;
      // the original has no row of its own — unless a prepared merge removes it in favour of a newer record
      if (m.id === g.original.id && !(c && c.keptId !== m.id)) continue;
      out.push({ id: m.id, group: g, status: c ? c.status : 'DETECTED', record: m, case: c, haystack: hay(m, c) });
    }
  }
  return out;
}

/* ---- filter & sort ------------------------------------------------------------------- */

export type RowFilter = 'ALL' | RowStatus | 'ERRORS';
export const ROW_FILTER_LABEL: Record<RowFilter, string> = {
  ALL: 'All',
  DETECTED: ROW_STATUS_LABEL.DETECTED,
  PENDING: ROW_STATUS_LABEL.PENDING,
  FLAGGED: ROW_STATUS_LABEL.FLAGGED,
  RETAINED: ROW_STATUS_LABEL.RETAINED,
  MERGED: ROW_STATUS_LABEL.MERGED,
  ERRORS: 'With errors',
};

export function filterRows(rows: DupRow[], query: string, filter: RowFilter): DupRow[] {
  const q = normaliseValue(query);
  const terms = q ? q.split(' ') : [];
  if (!terms.length && filter === 'ALL') return rows;
  return rows.filter((r) => {
    if (filter === 'ERRORS') {
      if (!r.case?.error) return false;
    } else if (filter !== 'ALL' && r.status !== filter) return false;
    for (const t of terms) if (!r.haystack.includes(t)) return false;
    return true;
  });
}

export type SortKey = 'status' | 'value' | 'orgUnit' | 'created' | 'updated' | 'originalCreated' | 'group' | 'decided';
export interface SortState {
  key: SortKey;
  dir: 1 | -1;
  /** index of the attribute column when key is 'value' */
  col?: number;
}

const STATUS_ORDER: Record<RowStatus, number> = { PENDING: 0, DETECTED: 1, FLAGGED: 2, RETAINED: 3, MERGED: 4 };

export function sortRows(rows: DupRow[], sort: SortState | null): DupRow[] {
  if (!sort) return rows;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const get = (r: DupRow): string | number => {
    switch (sort.key) {
      case 'status':
        return STATUS_ORDER[r.status];
      case 'value':
        return r.record.values[sort.col ?? 0] ?? '';
      case 'orgUnit':
        return r.record.orgUnitName ?? '';
      case 'created':
        return r.record.createdAt;
      case 'updated':
        return r.record.updatedAt;
      case 'originalCreated':
        return r.group.original.createdAt;
      case 'group':
        return r.group.members.length;
      case 'decided':
        return r.case?.updatedAt ?? r.retained?.retainedAt ?? '';
    }
  };
  // decorate-sort-undecorate: one key read per row instead of two per comparison
  const dec = rows.map((r) => [get(r), r] as const);
  dec.sort((a, b) => {
    const x = a[0];
    const y = b[0];
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y));
    return c * sort.dir;
  });
  return dec.map((d) => d[1]);
}

/* ---- CSV ---------------------------------------------------------------------------- */

export function duplicatesToCsv(
  rows: DupRow[],
  attributes: { id: string; name: string }[],
  hierarchy: (path: string | undefined) => string
): string {
  const fields = [
    'Status',
    ...attributes.map((a) => a.name),
    'Tracked entity ID',
    'Org unit',
    'Org unit hierarchy',
    'Registered',
    'Registered by',
    'Last updated',
    'Updated by',
    'Duplicate of',
    'Original org unit',
    'Group size',
    'Kept record',
    'Removed records',
    'Prepared by',
    'Prepared at',
    'Decided by',
    'Decided at',
    'Retained by',
    'Retained at',
    'Note',
    'Error',
  ];
  const data = rows.map((r) => [
    ROW_STATUS_LABEL[r.status],
    ...attributes.map((_, i) => r.record.values[i] ?? ''),
    r.record.id,
    r.record.orgUnitName ?? r.record.orgUnit,
    hierarchy(r.record.orgUnitPath),
    r.record.createdAt,
    r.record.createdBy ?? '',
    r.record.updatedAt,
    r.record.updatedBy ?? '',
    r.group.original.id,
    r.group.original.orgUnitName ?? r.group.original.orgUnit,
    r.group.members.length,
    r.case?.keptId ?? '',
    r.case?.removedIds.join(' ') ?? '',
    r.case?.preparedBy?.username ?? '',
    r.case?.preparedAt ?? '',
    r.case?.reviewedBy?.username ?? '',
    r.case?.reviewedAt ?? '',
    r.retained?.retainedBy.username ?? '',
    r.retained?.retainedAt ?? '',
    r.retained?.note ?? r.case?.note ?? '',
    r.case?.error ?? '',
  ]);
  return '\ufeff' + Papa.unparse({ fields, data });
}
