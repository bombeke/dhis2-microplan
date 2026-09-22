import Papa from 'papaparse';
import {
  GPS_STATUS_LABEL,
  METHOD_LABEL,
  SYNC_LABEL,
  currentOf,
  isPendingSync,
  proposedOf,
  type GeoValue,
  type GpsEdit,
  type GpsStatus,
} from './gpsEditStore';
import { isValidLat, isValidLon, type SettlementRecord } from './settlementRegistry';
import { fold } from './settlementCatalog';

/**
 * Filtering, sorting and CSV for the Manage Settlements table. Everything here
 * is a plain linear pass over arrays — no per-row allocation beyond the output
 * — so it stays in the tens of milliseconds at 200 000 rows.
 */

export type RowFilter =
  | 'ALL'
  | 'MISSING_GPS'
  | 'MISSING_POLYGON'
  | 'UNSAVED'
  | 'DRAFT'
  | 'SUBMITTED'
  | 'SENT_BACK'
  | 'APPROVED'
  | 'REJECTED'
  | 'PENDING_SYNC';

export const ROW_FILTER_LABEL: Record<RowFilter, string> = {
  ALL: 'All',
  MISSING_GPS: 'Missing GPS',
  MISSING_POLYGON: 'Missing polygon',
  UNSAVED: 'Unsaved',
  DRAFT: 'Draft',
  SUBMITTED: 'In review',
  SENT_BACK: 'Sent back',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PENDING_SYNC: 'Pending sync',
};

export type SortKey =
  | 'name'
  | 'status'
  | 'ward'
  | 'lga'
  | 'state'
  | 'lat'
  | 'lon'
  | 'polygon'
  | 'source'
  | 'households'
  | 'updated';

export interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

/** The coordinate a row shows: the open proposal if there is one, else the current value. */
export const shownGeo = (r: SettlementRecord, e: GpsEdit | undefined): GeoValue =>
  proposedOf(e) ?? currentOf(r, e);

export const hasGps = (g: GeoValue) => isValidLat(g.lat) && isValidLon(g.lon) && !(g.lat === 0 && g.lon === 0);

const STATUS_ORDER: Record<GpsStatus | 'NONE', number> = {
  SENT_BACK: 0,
  DRAFT: 1,
  SUBMITTED: 2,
  REJECTED: 3,
  APPROVED: 4,
  NONE: 5,
};

export function filterRows(
  rows: SettlementRecord[],
  editOf: (id: string) => GpsEdit | undefined,
  opts: { query: string; filter: RowFilter; isDirty: (id: string) => boolean }
): SettlementRecord[] {
  const terms = fold(opts.query).split(/\s+/).filter(Boolean);
  const f = opts.filter;
  const out: SettlementRecord[] = [];
  for (const r of rows) {
    if (terms.length) {
      let ok = true;
      for (const t of terms) {
        if (!r.k.includes(t)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
    }
    if (f !== 'ALL') {
      const e = editOf(r.id);
      switch (f) {
        case 'MISSING_GPS':
          if (hasGps(shownGeo(r, e))) continue;
          break;
        case 'MISSING_POLYGON':
          if (shownGeo(r, e).polygon) continue;
          break;
        case 'UNSAVED':
          if (!opts.isDirty(r.id)) continue;
          break;
        case 'PENDING_SYNC':
          if (!isPendingSync(e)) continue;
          break;
        default:
          if (e?.status !== f) continue;
      }
    }
    out.push(r);
  }
  return out;
}

export function sortRows(
  rows: SettlementRecord[],
  editOf: (id: string) => GpsEdit | undefined,
  sort: SortState | null
): SettlementRecord[] {
  if (!sort) return rows;
  const { key, dir } = sort;
  // decorate → sort → undecorate, so the comparator never recomputes a key
  const keyed: { v: string | number; r: SettlementRecord }[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let v: string | number;
    switch (key) {
      case 'name':
        v = r.name.toLowerCase();
        break;
      case 'ward':
        v = r.ward.toLowerCase();
        break;
      case 'lga':
        v = r.lga.toLowerCase();
        break;
      case 'state':
        v = r.state.toLowerCase();
        break;
      case 'source':
        v = (r.source ?? '￿').toLowerCase();
        break;
      case 'households':
        v = r.households ?? -Infinity;
        break;
      case 'lat':
        v = shownGeo(r, editOf(r.id)).lat ?? -Infinity;
        break;
      case 'lon':
        v = shownGeo(r, editOf(r.id)).lon ?? -Infinity;
        break;
      case 'polygon':
        v = shownGeo(r, editOf(r.id)).polygon ? 1 : 0;
        break;
      case 'status':
        v = STATUS_ORDER[editOf(r.id)?.status ?? 'NONE'];
        break;
      case 'updated':
        v = editOf(r.id)?.updatedAt ?? '';
        break;
    }
    keyed[i] = { v, r };
  }
  keyed.sort((a, b) => (a.v < b.v ? -dir : a.v > b.v ? dir : 0));
  return keyed.map((x) => x.r);
}

/* ---- CSV ---------------------------------------------------------------------------- */

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '' : n);
const who = (u?: { name: string; username: string }) => (u ? `${u.name} (${u.username})` : '');

/** Every row passed in (the whole loaded table, not the page) as CSV text. */
export function settlementsToCsv(
  rows: SettlementRecord[],
  editOf: (id: string) => GpsEdit | undefined
): string {
  const fields = [
    'Settlement ID',
    'Settlement',
    'Ward',
    'LGA',
    'State',
    'Latitude',
    'Longitude',
    'GPS',
    'Polygon',
    'Source',
    'Estimated households',
    'Proposed latitude',
    'Proposed longitude',
    'Proposed polygon (GeoJSON)',
    'Capture method',
    'Status',
    'Review decision',
    'On reject',
    'Review note',
    'Created by',
    'Created at',
    'Updated by',
    'Updated at',
    'Submitted by',
    'Submitted at',
    'Reviewed by',
    'Reviewed at',
    'Sync',
    'Synced by',
    'Synced at',
  ];
  const data: (string | number)[][] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const e = editOf(r.id);
    const cur = currentOf(r, e);
    const prop = proposedOf(e);
    data[i] = [
      r.id,
      r.name,
      r.ward,
      r.lga,
      r.state,
      fmt(cur.lat),
      fmt(cur.lon),
      hasGps(cur) ? 'Present' : r.gpsIssue === 'invalid' && !e ? 'Invalid' : 'Missing',
      cur.polygon ? 'Present' : 'Missing',
      r.source ?? '',
      fmt(r.households),
      fmt(prop?.lat),
      fmt(prop?.lon),
      prop?.polygon ? JSON.stringify(prop.polygon) : '',
      e?.method ? METHOD_LABEL[e.method] : '',
      e ? GPS_STATUS_LABEL[e.status] : 'Not edited',
      e?.decision === 'ACCEPTED' ? 'Accepted' : e?.decision === 'REJECTED' ? 'Rejected' : '',
      e?.decision === 'REJECTED' ? (e.rejectAction === 'BLANK' ? 'Blank GPS' : 'Keep current GPS') : '',
      e?.note ?? '',
      who(e?.createdBy),
      e?.createdAt ?? '',
      who(e?.updatedBy),
      e?.updatedAt ?? '',
      who(e?.submittedBy),
      e?.submittedAt ?? '',
      who(e?.reviewedBy),
      e?.reviewedAt ?? '',
      e ? SYNC_LABEL[e.sync] : '',
      who(e?.syncedBy),
      e?.syncedAt ?? '',
    ];
  }
  // BOM so Excel opens accented names as UTF-8
  return '﻿' + Papa.unparse({ fields, data });
}
