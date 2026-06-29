import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { MicroplanRow, TeamPlan } from '../types';

/**
 * Header aliasing — real microplan spreadsheets are messy. We map a wide set
 * of likely header spellings onto our canonical field names so ingestion
 * survives the spreadsheets people actually upload.
 */
const HEADER_ALIASES: Record<keyof MicroplanRow, string[]> = {
  settlement: ['nigeria settlements', 'settlement', 'settlement name', 'community'],
  teamCode: ['team code', 'teamcode', 'team', 'team id'],
  ward: ['ward', 'ward name'],
  state: ['state', 'state name'],
  facilityName: ['facility name', 'facility', 'health facility', 'hf'],
  week1: ['outreach week 1', 'week 1', 'wk1', 'w1'],
  week2: ['outreach week 2', 'week 2', 'wk2', 'w2'],
  week3: ['outreach week 3', 'week 3', 'wk3', 'w3'],
  week4: ['outreach week 4', 'week 4', 'wk4', 'w4'],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function buildHeaderMap(headers: string[]): Partial<Record<keyof MicroplanRow, number>> {
  const map: Partial<Record<keyof MicroplanRow, number>> = {};
  const normalized = headers.map(norm);
  (Object.keys(HEADER_ALIASES) as (keyof MicroplanRow)[]).forEach((field) => {
    const idx = normalized.findIndex((h) => HEADER_ALIASES[field].includes(h));
    if (idx >= 0) map[field] = idx;
  });
  return map;
}

function rowsToMicroplan(matrix: string[][]): MicroplanRow[] {
  if (matrix.length < 2) return [];
  const headerMap = buildHeaderMap(matrix[0]);
  const get = (row: string[], f: keyof MicroplanRow) => {
    const i = headerMap[f];
    return i === undefined ? '' : (row[i] ?? '').toString().trim();
  };
  return matrix
    .slice(1)
    .filter((r) => r.some((c) => c && c.toString().trim()))
    .map((r) => ({
      settlement: get(r, 'settlement'),
      teamCode: get(r, 'teamCode'),
      ward: get(r, 'ward'),
      state: get(r, 'state'),
      facilityName: get(r, 'facilityName'),
      week1: get(r, 'week1'),
      week2: get(r, 'week2'),
      week3: get(r, 'week3'),
      week4: get(r, 'week4'),
    }));
}

export async function parseUpload(file: File): Promise<MicroplanRow[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv' || ext === 'tsv') {
    return new Promise((resolve, reject) => {
      Papa.parse<string[]>(file, {
        complete: (res) => resolve(rowsToMicroplan(res.data as string[][])),
        error: reject,
      });
    });
  }
  // xlsx / xls
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
  return rowsToMicroplan(matrix);
}

/** A cell is "active" for a week if it holds anything truthy (date, X, tick). */
const isActive = (v: string) => !!v && !['0', 'no', 'n', 'false', '-'].includes(norm(v));

/** Collapse microplan rows into per-team plans keyed by team code. */
export function buildTeamPlans(
  rows: MicroplanRow[],
  resolveSettlementId: (name: string, ward: string) => string | undefined
): TeamPlan[] {
  const byTeam = new Map<string, TeamPlan>();

  for (const row of rows) {
    if (!row.teamCode) continue;
    let plan = byTeam.get(row.teamCode);
    if (!plan) {
      plan = {
        teamCode: row.teamCode,
        ward: row.ward,
        state: row.state,
        facilityName: row.facilityName,
        visits: {},
      };
      byTeam.set(row.teamCode, plan);
    }
    const settlementId = resolveSettlementId(row.settlement, row.ward) ?? `name:${norm(row.settlement)}`;
    const weeks: number[] = [];
    if (isActive(row.week1)) weeks.push(1);
    if (isActive(row.week2)) weeks.push(2);
    if (isActive(row.week3)) weeks.push(3);
    if (isActive(row.week4)) weeks.push(4);
    const existing = plan.visits[settlementId] ?? [];
    plan.visits[settlementId] = Array.from(new Set([...existing, ...weeks])).sort();
  }

  return Array.from(byTeam.values()).sort((a, b) => a.teamCode.localeCompare(b.teamCode));
}
